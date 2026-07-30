"""The two batch tailoring handlers, driven through the real worker (§7.7).

The Anthropic client is replaced with a fake, so no request leaves the machine
and no key is needed. What is *not* faked is the queue, the transaction boundary
or the database constraint that makes submitting idempotent — those are the parts
worth testing.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.db.models import (
    Application,
    BatchState,
    Company,
    Job,
    LLMBatch,
    ResumeVersion,
    ScheduledTask,
)
from app.domain.normalization import canonicalize_url, url_hash
from app.domain.states import ApplicationState, JobState
from app.domain.tasks import TaskType, idempotency_key
from app.services.llm.base import BudgetLedger, ModelPricing, NullProvider
from app.services.llm.batch import BatchOutcome, BatchStatus
from app.services.queue import enqueue
from app.worker.handlers import register_pipeline
from app.worker.runtime import Registry, Worker

pytestmark = pytest.mark.db

NOW = datetime.now(UTC).replace(microsecond=0)

#: A plan is a list of operations against the base resume's own bullet ids. The id
#: here comes from ``SAMPLE_RESUME_TEX`` in ``tests/conftest.py``; a made-up one
#: would be refused, which is the point of the scheme.
BULLET_ID = "work-experience.todd-labs.1"

PLAN = {
    "summary": "",
    "summary_fact_ids": [],
    "operations": [
        {
            "bullet_id": BULLET_ID,
            "action": "rewrite",
            "text": "Built services with Python and FastAPI.",
            "fact_ids": ["f1"],
        }
    ],
    "section_order": ["experience"],
}


# ------------------------------------------------------------- the fake


class FakeBatchClient:
    """Records what it was asked and returns what the test told it to."""

    def __init__(self) -> None:
        self.submitted: list[list[str]] = []
        self.requests: list[Any] = []
        self.batch_id = "batch_test_0001"
        self.status_value = BatchStatus("batch_test_0001", "ended", succeeded=1)
        self.outcome = BatchOutcome()
        self.cancelled: list[str] = []
        self.submit_calls = 0

    def submit(self, requests, *, model, schema, system=None):
        self.submit_calls += 1
        self.submitted.append([r.custom_id for r in requests])
        self.requests.extend(requests)
        return self.batch_id

    def status(self, batch_id):
        return self.status_value

    def results(self, batch_id):
        return self.outcome

    def cancel(self, batch_id):
        self.cancelled.append(batch_id)
        return "canceling"


@pytest.fixture
def fake_client(monkeypatch: pytest.MonkeyPatch) -> FakeBatchClient:
    client = FakeBatchClient()
    monkeypatch.setattr(
        "app.services.llm.batch_client.AnthropicBatchClient",
        lambda **_: client,
    )
    return client


@pytest.fixture
def settings(tmp_path: Path, sample_resume: tuple[Path, Path]) -> Settings:
    from pydantic import SecretStr

    tex, pdf = sample_resume
    return Settings(
        app_env="development",
        app_secret_key="batch-tests",
        data_dir=tmp_path / "data",
        anthropic_api_key=SecretStr("test-key-never-used"),
        base_resume_tex=tex,
        base_resume_pdf=pdf,
    )


@pytest.fixture
def provider() -> NullProvider:
    p = NullProvider(budget=BudgetLedger(monthly_cap_usd=15.0))
    p.pricing = {"claude-sonnet-5": ModelPricing(3.0, 15.0)}
    return p


@pytest.fixture
def registry(settings: Settings, provider: NullProvider) -> Registry:
    return register_pipeline(Registry(), settings=settings, provider_factory=lambda _: provider)


@pytest.fixture
def worker(committing_db: sessionmaker[Session], registry: Registry) -> Worker:
    return Worker(
        session_factory=committing_db,
        worker_id="batch-test",
        registry=registry,
        poll_interval=0.0,
    )


@pytest.fixture
def db(committing_db: sessionmaker[Session]) -> Iterator[Session]:
    session = committing_db()
    try:
        yield session
    finally:
        session.close()


# ------------------------------------------------------------------ setup


def make_application(db: Session, *, title: str = "Software Engineer Intern") -> Application:
    company = Company(
        canonical_name="Acme Inc", normalized_name=f"acme-{uuid.uuid4().hex[:6]}", domain="a.com"
    )
    db.add(company)
    db.flush()

    url = f"https://boards.greenhouse.io/acme/jobs/{uuid.uuid4().hex[:8]}"
    job = Job(
        company_id=company.id,
        canonical_url=canonicalize_url(url),
        canonical_url_hash=url_hash(url),
        title=title,
        normalized_title=title.lower(),
        dedupe_fingerprint=uuid.uuid4().hex,
        discovered_at=NOW,
        status=JobState.SCORED,
        description_text="Python and FastAPI work.",
    )
    db.add(job)
    db.flush()

    application = Application(
        job_id=job.id, application_url=url, status=ApplicationState.CREATED
    )
    db.add(application)
    db.commit()
    return application


def store_facts(db: Session) -> None:
    from app.services.candidate import Actor, set_fact

    set_fact(db, "profile.name", "Hoan Nguyen", actor=Actor.USER)
    set_fact(db, "candidate.preferred_name", "Hoan", actor=Actor.USER)
    # verified=True is required: tailoring may only cite facts the user has
    # confirmed, because the resume is a document they sign their name to.
    set_fact(
        db,
        "resume.fact.f1",
        {
            "text": "Built backend services with Python and FastAPI.",
            "technologies": ["python", "fastapi"],
            # The employer this fact belongs to. Checked against the entry the
            # rewritten bullet sits under, so a fact from one job cannot be
            # written up under another.
            "organisation": "Todd Labs",
        },
        actor=Actor.USER,
        verified=True,
    )
    db.commit()


def queue_submit(db: Session, *, application_ids: list[str] | None = None, key: str = "b1") -> None:
    payload: dict = {"dedupe_key": key}
    if application_ids is not None:
        payload["application_ids"] = application_ids
    enqueue(
        db,
        task_type=TaskType.SUBMIT_TAILORING_BATCH,
        dedupe_key=idempotency_key(TaskType.SUBMIT_TAILORING_BATCH, key),
        payload=payload,
        run_at=NOW,
    )
    db.commit()


def drain(worker: Worker, limit: int = 3) -> int:
    ran = 0
    while ran < limit and worker.run_once(now=NOW + timedelta(minutes=1)):
        ran += 1
    return ran


def succeeded(custom_id: str, payload: dict, *, tokens: int = 500) -> dict:
    return {
        "custom_id": custom_id,
        "result": {
            "type": "succeeded",
            "message": {
                "content": [{"type": "tool_use", "name": "record_result", "input": payload}],
                "usage": {"input_tokens": tokens, "output_tokens": tokens},
            },
        },
    }


# ------------------------------------------------------------------ tests


class TestSubmitting:
    def test_a_batch_is_submitted_and_recorded(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient
    ):
        application = make_application(db)
        store_facts(db)
        queue_submit(db, application_ids=[str(application.id)])
        drain(worker, limit=1)

        db.expire_all()
        batch = db.scalars(select(LLMBatch)).one()
        assert batch.provider_batch_id == "batch_test_0001"
        assert batch.custom_ids == [str(application.id)]
        assert batch.estimated_cost_usd > 0

    def test_every_request_carries_the_resumes_bullet_ids(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient
    ):
        """The batch path asks the same question as the synchronous one.

        A batch submitted without the inventory would come back with operations
        naming nothing, all of them refused, and thirty applications tailored to
        no effect — at full price, since a batch cannot be un-submitted.
        """
        application = make_application(db)
        store_facts(db)
        queue_submit(db, application_ids=[str(application.id)])
        drain(worker, limit=1)

        [request] = fake_client.requests
        body = "".join(str(m["content"]) for m in request.messages)
        assert BULLET_ID in body
        assert "(Work Experience / Todd Labs)" in body

    def test_the_custom_id_is_the_application_id(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient
    ):
        """The only link between a result and the work that asked for it."""
        application = make_application(db)
        store_facts(db)
        queue_submit(db, application_ids=[str(application.id)])
        drain(worker, limit=1)
        assert fake_client.submitted == [[str(application.id)]]

    def test_submitting_twice_under_one_key_submits_once(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient
    ):
        """The window: the API accepts, the worker dies before committing, the
        task is retried. Without the stored row the user pays twice."""
        application = make_application(db)
        store_facts(db)

        queue_submit(db, application_ids=[str(application.id)], key="same-key")
        drain(worker, limit=1)
        # A second task with the same logical key, as a retry would produce.
        enqueue(
            db,
            task_type=TaskType.SUBMIT_TAILORING_BATCH,
            dedupe_key=idempotency_key(TaskType.SUBMIT_TAILORING_BATCH, "same-key", "retry"),
            payload={"dedupe_key": "same-key", "application_ids": [str(application.id)]},
            run_at=NOW,
        )
        db.commit()
        drain(worker, limit=1)

        assert fake_client.submit_calls == 1
        assert db.scalars(select(LLMBatch)).all().__len__() == 1

    def test_an_over_budget_batch_is_never_submitted(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient, provider: NullProvider
    ):
        application = make_application(db)
        store_facts(db)
        provider.budget.spent_usd = 15.0  # the cap

        queue_submit(db, application_ids=[str(application.id)])
        drain(worker, limit=1)

        assert fake_client.submit_calls == 0
        assert db.scalars(select(LLMBatch)).first() is None

    def test_nothing_to_tailor_is_not_a_failure(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient
    ):
        store_facts(db)
        queue_submit(db, application_ids=[])
        drain(worker, limit=1)
        assert fake_client.submit_calls == 0

    def test_a_poll_is_queued_after_submitting(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient
    ):
        application = make_application(db)
        store_facts(db)
        queue_submit(db, application_ids=[str(application.id)])
        drain(worker, limit=1)

        polls = db.scalars(
            select(ScheduledTask).where(
                ScheduledTask.task_type == TaskType.POLL_TAILORING_BATCH
            )
        ).all()
        assert len(polls) == 1


class TestPolling:
    def _submit(self, worker, db, fake_client, count: int = 1) -> list[Application]:
        applications = [make_application(db) for _ in range(count)]
        store_facts(db)
        queue_submit(db, application_ids=[str(a.id) for a in applications])
        drain(worker, limit=1)
        return applications

    def test_an_unfinished_batch_queues_another_poll(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient
    ):
        self._submit(worker, db, fake_client)
        fake_client.status_value = BatchStatus("batch_test_0001", "in_progress")
        drain(worker, limit=1)

        db.expire_all()
        batch = db.scalars(select(LLMBatch)).one()
        assert batch.state == BatchState.SUBMITTED
        polls = db.scalars(
            select(ScheduledTask).where(
                ScheduledTask.task_type == TaskType.POLL_TAILORING_BATCH
            )
        ).all()
        assert len(polls) >= 2, "the batch must still be checked again"

    def test_a_finished_batch_produces_a_tailored_resume(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient
    ):
        from app.services.llm.batch import outcome_from

        [application] = self._submit(worker, db, fake_client)
        fake_client.outcome = outcome_from([succeeded(str(application.id), PLAN)])
        drain(worker, limit=1)

        db.expire_all()
        db.refresh(application)
        assert application.resume_version_id is not None
        version = db.get(ResumeVersion, application.resume_version_id)
        assert version.kind == "TAILORED"

    def test_each_result_reaches_its_own_application(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient
    ):
        """Returned in reverse order on purpose.

        If results were paired positionally, each applicant would receive the
        other's tailored resume — plausible output, wrong content.
        """
        from app.services.llm.batch import outcome_from

        first, second = self._submit(worker, db, fake_client, count=2)

        def plan_saying(text: str) -> dict:
            return {
                **PLAN,
                "operations": [
                    {
                        "bullet_id": BULLET_ID,
                        "action": "rewrite",
                        "text": text,
                        "fact_ids": ["f1"],
                    }
                ],
            }

        fake_client.outcome = outcome_from(
            [
                succeeded(str(second.id), plan_saying("Built FastAPI services, second.")),
                succeeded(str(first.id), plan_saying("Built FastAPI services, first.")),
            ]
        )
        drain(worker, limit=1)

        db.expire_all()
        db.refresh(first)
        db.refresh(second)
        assert first.resume_version_id is not None
        assert second.resume_version_id is not None
        assert first.resume_version_id != second.resume_version_id

        def recorded_plan_of(application: Application) -> str:
            path = db.get(ResumeVersion, application.resume_version_id).validation_path
            return Path(path).read_text(encoding="utf-8")

        assert "first." in recorded_plan_of(first)
        assert "second." in recorded_plan_of(second)
        assert "second." not in recorded_plan_of(first), "results were paired by position"

        def built_tex_of(application: Application) -> str:
            path = db.get(ResumeVersion, application.resume_version_id).source_path
            return Path(path).read_text(encoding="utf-8")

        # And in the document itself, not only in the sidecar. This is the
        # artifact that becomes the PDF the employer opens.
        assert "first." in built_tex_of(first)
        assert "second." not in built_tex_of(first)

    def test_actual_usage_and_cost_are_recorded(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient
    ):
        from app.services.llm.batch import outcome_from

        [application] = self._submit(worker, db, fake_client)
        fake_client.outcome = outcome_from(
            [succeeded(str(application.id), PLAN, tokens=1_000_000)]
        )
        drain(worker, limit=1)

        db.expire_all()
        batch = db.scalars(select(LLMBatch)).one()
        assert batch.input_tokens == 1_000_000
        assert batch.output_tokens == 1_000_000
        # (3 + 15) at half the batch rate.
        assert batch.actual_cost_usd == pytest.approx(9.0)

    def test_the_charge_lands_on_the_shared_ledger(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient, provider: NullProvider
    ):
        from app.services.llm.batch import outcome_from

        [application] = self._submit(worker, db, fake_client)
        fake_client.outcome = outcome_from(
            [succeeded(str(application.id), PLAN, tokens=1_000_000)]
        )
        drain(worker, limit=1)
        assert provider.budget.spent_usd == pytest.approx(9.0)

    def test_a_missing_result_is_recorded_rather_than_ignored(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient
    ):
        from app.services.llm.batch import outcome_from

        first, second = self._submit(worker, db, fake_client, count=2)
        fake_client.outcome = outcome_from([succeeded(str(first.id), PLAN)])
        drain(worker, limit=1)

        db.expire_all()
        batch = db.scalars(select(LLMBatch)).one()
        assert batch.failures.get(str(second.id)) == "no result returned"

    def test_retrieving_twice_does_not_tailor_twice(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient
    ):
        from app.services.llm.batch import outcome_from

        [application] = self._submit(worker, db, fake_client)
        fake_client.outcome = outcome_from([succeeded(str(application.id), PLAN)])
        drain(worker, limit=1)

        db.expire_all()
        db.refresh(application)
        first_version = application.resume_version_id

        enqueue(
            db,
            task_type=TaskType.POLL_TAILORING_BATCH,
            dedupe_key=idempotency_key(TaskType.POLL_TAILORING_BATCH, "again"),
            payload={"batch_id": str(db.scalars(select(LLMBatch)).one().id)},
            run_at=NOW,
        )
        db.commit()
        drain(worker, limit=1)

        db.expire_all()
        db.refresh(application)
        assert application.resume_version_id == first_version
        assert len(db.scalars(select(ResumeVersion)).all()) == 1

    def test_a_batch_past_its_timeout_is_abandoned_and_cancelled(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient
    ):
        self._submit(worker, db, fake_client)
        fake_client.status_value = BatchStatus("batch_test_0001", "in_progress")

        db.expire_all()
        batch = db.scalars(select(LLMBatch)).one()
        batch.submitted_at = NOW - timedelta(hours=30)
        db.commit()

        drain(worker, limit=1)
        db.expire_all()
        assert db.scalars(select(LLMBatch)).one().state == BatchState.ABANDONED
        assert fake_client.cancelled == ["batch_test_0001"]

    def test_a_tailored_application_is_queued_for_a_browser(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient
    ):
        from app.services.llm.batch import outcome_from

        [application] = self._submit(worker, db, fake_client)
        fake_client.outcome = outcome_from([succeeded(str(application.id), PLAN)])
        drain(worker, limit=1)

        db.expire_all()
        db.refresh(application)
        assert application.status == ApplicationState.BROWSER_QUEUED
        queued = db.scalars(
            select(ScheduledTask).where(
                ScheduledTask.task_type == TaskType.PREPARE_APPLICATION
            )
        ).all()
        assert len(queued) == 1


class TestTheDegradationLadder:
    """§26.2's tiers, as they actually affect what gets tailored."""

    def _scored(self, db: Session, count: int) -> list[Application]:
        """Applications whose jobs have descending fit scores."""
        from app.db.models import JobScore

        made = []
        for index in range(count):
            application = make_application(db, title=f"Software Engineer Intern {index}")
            db.add(
                JobScore(
                    job_id=application.job_id,
                    total_score=float(100 - index * 10),
                    components={},
                    hard_filter_result="PASS",
                    fact_references=[],
                )
            )
            made.append(application)
        db.commit()
        store_facts(db)
        return made

    def test_at_ok_the_whole_daily_quota_is_eligible(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient, provider: NullProvider
    ):
        applications = self._scored(db, 3)
        queue_submit(db)
        drain(worker, limit=1)

        assert len(fake_client.submitted[0]) == len(applications)

    def test_at_restricted_only_the_best_few_are_tailored(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient, provider: NullProvider
    ):
        """Not "stop tailoring" — "tailor only the top-scoring"."""
        self._scored(db, 8)
        provider.budget.spent_usd = 13.6  # 91% of $15
        assert provider.budget.state.value == "RESTRICTED"

        queue_submit(db)
        drain(worker, limit=1)

        assert len(fake_client.submitted[0]) == 5

    def test_at_restricted_the_ones_chosen_are_the_highest_scoring(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient, provider: NullProvider
    ):
        """The whole point of rationing rather than truncating arbitrarily."""
        applications = self._scored(db, 8)
        provider.budget.spent_usd = 13.6

        queue_submit(db)
        drain(worker, limit=1)

        chosen = set(fake_client.submitted[0])
        best_five = {str(a.id) for a in applications[:5]}
        assert chosen == best_five

    def test_at_exhausted_nothing_is_tailored_and_nothing_is_charged(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient, provider: NullProvider
    ):
        self._scored(db, 3)
        provider.budget.spent_usd = 15.0
        before = provider.budget.spent_usd

        queue_submit(db)
        drain(worker, limit=1)

        assert fake_client.submit_calls == 0
        assert db.scalars(select(LLMBatch)).first() is None
        assert provider.budget.spent_usd == before

    def test_exhausted_is_not_a_failure_the_queue_retries(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient, provider: NullProvider
    ):
        """The rest of the pipeline still runs; it just runs without a model.

        Burying the task would make a spent budget look like a broken system.
        """
        from app.domain.tasks import TaskStatus

        self._scored(db, 2)
        provider.budget.spent_usd = 15.0

        queue_submit(db)
        drain(worker, limit=1)

        task = db.scalars(
            select(ScheduledTask).where(
                ScheduledTask.task_type == TaskType.SUBMIT_TAILORING_BATCH
            )
        ).one()
        assert task.status == TaskStatus.SUCCEEDED


class TestTheGate:
    def test_submitting_is_gated_but_polling_is_not(self):
        """Polling collects results already paid for.

        Gating it would mean that pausing after a submit threw the money away.
        """
        from app.services.pipeline_gate import is_pipeline_task

        assert is_pipeline_task(TaskType.SUBMIT_TAILORING_BATCH)
        assert not is_pipeline_task(TaskType.POLL_TAILORING_BATCH)
