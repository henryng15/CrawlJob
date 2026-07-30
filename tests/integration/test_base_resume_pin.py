"""A plan belongs to one version of the resume (spec §7.7).

Bullet ids are addresses into a particular ``.tex``. ``work-experience.todd.2``
means "the second bullet under Todd" *in the file the model was shown* — edit that
file and the same id can name a different sentence, or none at all.

The window is real. A tailoring batch may sit for up to a day between being
submitted and being collected, and the canonical resume is a file the user is
expected to keep improving. Without a pin, a plan collected after an edit would be
spliced into whatever now occupies those positions: it would compile, fit on one
page, and describe the wrong work.

So the base resume's SHA-256 is recorded when the inventory is read, and checked
before the plan is applied. A mismatch throws the plan away. That is the right
trade: re-tailoring costs one more model call, and the alternative costs a resume
that misrepresents the candidate.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.db.models import Application, Company, Job, LLMBatch, ResumeVersion
from app.domain.normalization import canonicalize_url, url_hash
from app.domain.states import ApplicationState, JobState
from app.domain.tasks import TaskType, idempotency_key
from app.services.llm.base import BudgetLedger, ModelPricing, NullProvider
from app.services.llm.batch import BatchOutcome, BatchStatus, outcome_from
from app.services.queue import enqueue
from app.services.tailoring import base_resume_source
from app.worker.handlers import register_pipeline
from app.worker.runtime import Registry, Worker

pytestmark = pytest.mark.db

NOW = datetime.now(UTC).replace(microsecond=0)

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
    "section_order": [],
}


class FakeBatchClient:
    def __init__(self) -> None:
        self.batch_id = "batch_pin_0001"
        self.status_value = BatchStatus("batch_pin_0001", "ended", succeeded=1)
        self.outcome = BatchOutcome()

    def submit(self, requests, *, model, schema, system=None):
        return self.batch_id

    def status(self, batch_id):
        return self.status_value

    def results(self, batch_id):
        return self.outcome

    def cancel(self, batch_id):
        return "canceling"


@pytest.fixture
def fake_client(monkeypatch: pytest.MonkeyPatch) -> FakeBatchClient:
    client = FakeBatchClient()
    monkeypatch.setattr(
        "app.services.llm.batch_client.AnthropicBatchClient", lambda **_: client
    )
    return client


@pytest.fixture
def base(tmp_path: Path, sample_resume: tuple[Path, Path]) -> tuple[Path, Path]:
    """A private copy, so a test may edit it without touching anything shared."""
    source_tex, source_pdf = sample_resume
    tex = tmp_path / "base.tex"
    tex.write_bytes(source_tex.read_bytes())
    pdf = tmp_path / "base.pdf"
    pdf.write_bytes(source_pdf.read_bytes())
    return tex, pdf


@pytest.fixture
def settings(tmp_path: Path, base: tuple[Path, Path]) -> Settings:
    from pydantic import SecretStr

    tex, pdf = base
    return Settings(
        app_env="development",
        app_secret_key="pin-tests",
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
def worker(
    committing_db: sessionmaker[Session], settings: Settings, provider: NullProvider
) -> Worker:
    return Worker(
        session_factory=committing_db,
        worker_id="pin-test",
        registry=register_pipeline(
            Registry(), settings=settings, provider_factory=lambda _: provider
        ),
        poll_interval=0.0,
    )


@pytest.fixture
def db(committing_db: sessionmaker[Session]) -> Iterator[Session]:
    session = committing_db()
    try:
        yield session
    finally:
        session.close()


def make_application(db: Session) -> Application:
    company = Company(
        canonical_name="Acme Inc",
        normalized_name=f"acme-{uuid.uuid4().hex[:6]}",
        domain="acme.com",
    )
    db.add(company)
    db.flush()

    url = f"https://boards.greenhouse.io/acme/jobs/{uuid.uuid4().hex[:8]}"
    job = Job(
        company_id=company.id,
        canonical_url=canonicalize_url(url),
        canonical_url_hash=url_hash(url),
        title="Software Engineer Intern",
        normalized_title="software engineer intern",
        dedupe_fingerprint=uuid.uuid4().hex,
        discovered_at=NOW,
        status=JobState.SCORED,
        description_text="Python and FastAPI work.",
    )
    db.add(job)
    db.flush()

    row = Application(job_id=job.id, application_url=url, status=ApplicationState.CREATED)
    db.add(row)
    db.commit()
    return row


def store_facts(db: Session) -> None:
    from app.services.candidate import Actor, set_fact

    set_fact(db, "candidate.preferred_name", "Hoan", actor=Actor.USER)
    set_fact(
        db,
        "resume.fact.f1",
        {
            "text": "Built backend services with Python and FastAPI.",
            "technologies": ["python", "fastapi"],
            "organisation": "Todd Labs",
        },
        actor=Actor.USER,
        verified=True,
    )
    db.commit()


def drain(worker: Worker, limit: int = 3) -> int:
    ran = 0
    while ran < limit and worker.run_once(now=NOW + timedelta(minutes=1)):
        ran += 1
    return ran


def succeeded(custom_id: str, payload: dict) -> dict:
    return {
        "custom_id": custom_id,
        "result": {
            "type": "succeeded",
            "message": {
                "content": [
                    {"type": "tool_use", "name": "record_result", "input": payload}
                ],
                "usage": {"input_tokens": 100, "output_tokens": 100},
            },
        },
    }


def submit(db: Session, worker: Worker, application: Application, key: str = "pin") -> LLMBatch:
    enqueue(
        db,
        task_type=TaskType.SUBMIT_TAILORING_BATCH,
        dedupe_key=idempotency_key(TaskType.SUBMIT_TAILORING_BATCH, key),
        payload={"dedupe_key": key, "application_ids": [str(application.id)]},
        run_at=NOW,
    )
    db.commit()
    drain(worker, limit=1)
    db.expire_all()
    return db.scalars(select(LLMBatch)).one()


def versions(db: Session, application: Application) -> list[ResumeVersion]:
    return list(
        db.scalars(
            select(ResumeVersion).where(ResumeVersion.application_id == application.id)
        ).all()
    )


class TestThePinIsRecorded:
    def test_the_batch_records_the_resume_it_was_planned_against(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient, base, settings
    ):
        tex, _ = base
        application = make_application(db)
        store_facts(db)
        batch = submit(db, worker, application)

        assert batch.base_tex_sha256 == hashlib.sha256(tex.read_bytes()).hexdigest()

    def test_every_application_in_the_batch_records_it_too(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient, base
    ):
        """So a later run can tell what an application was last planned against
        even if the batch itself is abandoned."""
        tex, _ = base
        application = make_application(db)
        store_facts(db)
        batch = submit(db, worker, application)

        db.refresh(application)
        assert application.base_tex_sha256 == batch.base_tex_sha256
        assert application.base_tex_sha256 == hashlib.sha256(tex.read_bytes()).hexdigest()

    def test_the_synchronous_path_pins_it_as_well(
        self, worker: Worker, db: Session, provider: NullProvider, base
    ):
        tex, _ = base
        application = make_application(db)
        store_facts(db)
        provider.queue(PLAN)

        enqueue(
            db,
            task_type=TaskType.TAILOR_RESUME,
            dedupe_key=idempotency_key(TaskType.TAILOR_RESUME, str(application.id)),
            payload={"application_id": str(application.id)},
            run_at=NOW,
        )
        db.commit()
        drain(worker, limit=1)

        db.expire_all()
        db.refresh(application)
        assert application.base_tex_sha256 == hashlib.sha256(tex.read_bytes()).hexdigest()

    def test_the_fingerprint_is_of_the_tex_bytes(self, settings: Settings, base):
        tex, _ = base
        source = base_resume_source(settings)
        assert source is not None
        assert source.sha256 == hashlib.sha256(tex.read_bytes()).hexdigest()

    def test_editing_the_resume_changes_the_fingerprint(self, settings: Settings, base):
        tex, _ = base
        before = base_resume_source(settings)
        tex.write_text(tex.read_text(encoding="utf-8") + "\n% a later thought\n")
        after = base_resume_source(settings)

        assert before is not None and after is not None
        assert before.sha256 != after.sha256


class TestADelayedPlanIsRefused:
    def _edit_the_resume(self, tex: Path) -> None:
        """The kind of change that moves bullet ids: a new job at the top.

        Not a cosmetic edit — after this, ``work-experience.todd-labs.1`` is a
        sentence about a different employer.
        """
        source = tex.read_text(encoding="utf-8")
        insert = r"""
    \resumeSubheading
      {Globex}{January 2026 - Present}
      {Data Engineer Intern}{}
      \resumeItemListStart
        \resumeItem{Built a Spark pipeline over billing events}
      \resumeItemListEnd
"""
        marker = r"\section{Work Experience}" + "\n  \\resumeSubHeadingListStart"
        assert marker in source
        tex.write_text(source.replace(marker, marker + insert), encoding="utf-8")

    def test_a_plan_collected_after_an_edit_is_not_applied(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient, base
    ):
        tex, _ = base
        application = make_application(db)
        store_facts(db)
        submit(db, worker, application)

        # The user improves their resume while the batch is running.
        self._edit_the_resume(tex)

        fake_client.outcome = outcome_from([succeeded(str(application.id), PLAN)])
        drain(worker, limit=1)

        db.expire_all()
        assert versions(db, application) == [], "no resume was built from a stale plan"
        db.refresh(application)
        assert application.resume_version_id is None

    def test_the_reason_names_both_fingerprints(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient, base
    ):
        """So the user can tell "the resume changed" from any other refusal."""
        tex, _ = base
        application = make_application(db)
        store_facts(db)
        batch = submit(db, worker, application)
        planned = batch.base_tex_sha256

        self._edit_the_resume(tex)
        fake_client.outcome = outcome_from([succeeded(str(application.id), PLAN)])
        drain(worker, limit=1)

        db.expire_all()
        batch = db.scalars(select(LLMBatch)).one()
        reason = batch.failures[str(application.id)]
        assert "base resume changed" in reason
        assert planned[:12] in reason
        assert "re-run tailoring" in reason

    def test_the_application_is_not_queued_for_a_browser(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient, base
    ):
        """A form filled with no resume wastes one of two slots."""
        from app.db.models import ScheduledTask

        tex, _ = base
        application = make_application(db)
        store_facts(db)
        submit(db, worker, application)
        self._edit_the_resume(tex)

        fake_client.outcome = outcome_from([succeeded(str(application.id), PLAN)])
        drain(worker, limit=1)

        db.expire_all()
        queued = db.scalars(
            select(ScheduledTask).where(
                ScheduledTask.task_type == TaskType.PREPARE_APPLICATION
            )
        ).all()
        assert queued == []

    def test_the_money_already_spent_is_still_recorded(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient, base
    ):
        """Refusing the plan does not un-bill the batch.

        The cap tracks what was spent, not what was useful — a month that quietly
        forgot a wasted batch would let the next one exceed it.
        """
        tex, _ = base
        application = make_application(db)
        store_facts(db)
        submit(db, worker, application)
        self._edit_the_resume(tex)

        fake_client.outcome = outcome_from([succeeded(str(application.id), PLAN)])
        drain(worker, limit=1)

        db.expire_all()
        batch = db.scalars(select(LLMBatch)).one()
        assert batch.input_tokens == 100
        assert batch.actual_cost_usd is not None

    def test_a_plan_collected_without_an_edit_is_applied(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient, base
    ):
        """The control. The pin must not refuse the ordinary case."""
        application = make_application(db)
        store_facts(db)
        submit(db, worker, application)

        fake_client.outcome = outcome_from([succeeded(str(application.id), PLAN)])
        drain(worker, limit=1)

        db.expire_all()
        assert versions(db, application), "an unchanged resume must still tailor"

    def test_a_missing_base_resume_refuses_rather_than_falling_back(
        self, worker: Worker, db: Session, fake_client: FakeBatchClient, base
    ):
        """"Unavailable" is not "use whatever else is around"."""
        tex, _ = base
        application = make_application(db)
        store_facts(db)
        submit(db, worker, application)
        tex.unlink()

        fake_client.outcome = outcome_from([succeeded(str(application.id), PLAN)])
        drain(worker, limit=1)

        db.expire_all()
        assert versions(db, application) == []
        batch = db.scalars(select(LLMBatch)).one()
        assert "not available" in batch.failures[str(application.id)]

    def test_re_tailoring_after_the_edit_succeeds(
        self, worker: Worker, db: Session, provider: NullProvider, fake_client, base
    ):
        """The refusal has to be recoverable, or it is just a dead end.

        A fresh run reads the resume as it now is, pins the new fingerprint, and
        the plan it produces addresses ids that exist.
        """
        tex, _ = base
        application = make_application(db)
        store_facts(db)
        submit(db, worker, application)
        self._edit_the_resume(tex)
        fake_client.outcome = outcome_from([succeeded(str(application.id), PLAN)])
        drain(worker, limit=1)
        db.expire_all()
        assert versions(db, application) == []

        provider.queue(PLAN)
        enqueue(
            db,
            task_type=TaskType.TAILOR_RESUME,
            dedupe_key=idempotency_key(TaskType.TAILOR_RESUME, str(application.id)),
            payload={"application_id": str(application.id)},
            run_at=NOW,
        )
        db.commit()
        drain(worker, limit=1)

        db.expire_all()
        assert versions(db, application), "a fresh plan against the new resume works"
        db.refresh(application)
        assert application.base_tex_sha256 == hashlib.sha256(tex.read_bytes()).hexdigest()
