"""The pipeline, stage by stage (spec §16.2).

Each stage is driven through the real ``Worker``, not called directly, so the
tests also cover the thing that makes the pipeline safe: work and fan-out commit
together, and a stage that fails enqueues nothing.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.db.models import (
    Application,
    Company,
    Job,
    JobScore,
    OutreachTask,
    Recruiter,
    ResumeVersion,
    ScheduledTask,
    SponsorshipAssessment,
    SuppressionEntry,
)
from app.domain.normalization import canonicalize_url, url_hash
from app.domain.states import ApplicationState, JobState, OutreachState
from app.domain.tasks import TaskStatus, TaskType, idempotency_key
from app.services.candidate import Actor, set_fact
from app.services.llm.base import NullProvider
from app.services.outreach_policy import next_send_window
from app.services.queue import enqueue
from app.worker.handlers import register_pipeline
from app.worker.runtime import Registry, Worker
from tests.helpers import not_none

pytestmark = pytest.mark.db

#: Anchored to the wall clock. Follow-up tasks are enqueued with the real
#: ``utcnow()``, so a fixed date in the past would leave every second stage
#: unclaimable and the pipeline tests would silently only ever test one step.
NOW = datetime.now(UTC).replace(microsecond=0)

NO_SPONSORSHIP_JD = """
We are hiring a Software Engineer Intern for Summer 2027.
You will write Python. We are unable to sponsor or take over sponsorship of an
employment visa at this time.
"""

CITIZENS_ONLY_JD = """
Software Engineer Intern, Summer 2027. Python and FastAPI work.
Applicants must be a U.S. citizen to be eligible for this position.
"""

#: What the model would return for a posting that says nothing about sponsorship.
#: Queued explicitly so a test can never pass on a response nobody wrote.
SILENT = {
    "classification": "SPONSORSHIP_NOT_MENTIONED",
    "work_authorization_restriction": "UNKNOWN",
    "evidence": [],
    "confidence": 0.4,
    "reasoning_summary": "The posting does not mention sponsorship.",
}

JUDGMENT = {
    "core_swe_relevance": 16.0,
    "skills_overlap": 11.0,
    "experience_relevance": 10.0,
    "fact_references": ["skill.python"],
    "reasons": ["Python and FastAPI match the stored skills."],
}

ORDINARY_JD = """
Software Engineer Intern, Summer 2027. You will write Python and work on our
FastAPI services alongside the platform team.
"""

#: A bullet id from ``SAMPLE_RESUME_TEX`` in ``tests/conftest.py``. Tailoring plans
#: address the resume's own bullets, so a plan naming anything else is refused —
#: which is what stops one employer's work being written under another's heading.


@pytest.fixture
def settings(tmp_path: Path, sample_resume: Path) -> Settings:
    pdf = sample_resume
    # Explicit rather than inherited from .env: a test that silently used
    # whatever resume the developer had configured would pass or fail for
    # reasons outside the test.
    return Settings(
        app_env="development",
        app_secret_key="handler-tests",
        data_dir=tmp_path / "data",
        base_resume_pdf=pdf,
    )


@pytest.fixture
def provider() -> NullProvider:
    """One provider for the whole run, so queued responses are consumed in order."""
    return NullProvider()


@pytest.fixture
def registry(settings: Settings, provider: NullProvider) -> Registry:
    return register_pipeline(
        Registry(), settings=settings, provider_factory=lambda _: provider
    )


@pytest.fixture
def worker(committing_db: sessionmaker[Session], registry: Registry) -> Worker:
    return Worker(
        session_factory=committing_db,
        worker_id="pipeline-test",
        registry=registry,
        poll_interval=0.0,
    )


@pytest.fixture
def db(committing_db: sessionmaker[Session]) -> Iterator[Session]:
    """A session on the same database the worker commits to.

    The rollback-wrapped ``db`` fixture cannot be used here: the worker runs in
    its own session and would not see anything this one had not committed.
    """
    session = committing_db()
    try:
        yield session
    finally:
        session.close()


# ------------------------------------------------------------------ setup


def make_job(session: Session, *, description: str = ORDINARY_JD, **kw: object) -> Job:
    company = session.scalars(
        select(Company).where(Company.normalized_name == "acme")
    ).first() or Company(canonical_name="Acme Inc", normalized_name="acme", domain="acme.com")
    session.add(company)
    session.flush()

    url = f"https://boards.greenhouse.io/acme/jobs/{uuid.uuid4().hex[:8]}"
    defaults: dict[str, object] = {
        "company_id": company.id,
        "canonical_url": canonicalize_url(url),
        "canonical_url_hash": url_hash(url),
        "title": "Software Engineer Intern",
        "normalized_title": "software engineer intern",
        "dedupe_fingerprint": uuid.uuid4().hex,
        "discovered_at": NOW,
        "posted_at": NOW - timedelta(days=3),
        "season": "SUMMER_2027",
        "status": JobState.DISCOVERED,
        "description_text": description,
        "normalized_location": "remote",
    }
    job = Job(**{**defaults, **kw})
    session.add(job)
    session.commit()
    return job


def queue(session: Session, task_type: TaskType, **payload: str) -> None:
    enqueue(
        session,
        task_type=task_type,
        dedupe_key=idempotency_key(task_type, *payload.values()),
        payload=payload,
        run_at=NOW,
    )
    session.commit()


def drain(worker: Worker, *, now: datetime | None = None, limit: int = 12) -> int:
    """Run until the queue is empty. Returns how many tasks ran.

    ``now`` moves slightly ahead of the enqueue time so a task queued by the
    stage before it is claimable in the same drain.
    """
    moment = now or (NOW + timedelta(minutes=1))
    ran = 0
    while ran < limit and worker.run_once(now=moment):
        ran += 1
    return ran


def tasks(session: Session, task_type: TaskType) -> list[ScheduledTask]:
    session.expire_all()
    return list(
        session.scalars(select(ScheduledTask).where(ScheduledTask.task_type == task_type)).all()
    )


class _Empty:
    """A discovery adapter that fetches nothing, for screening tests."""

    source_name = "empty"

    def fetch(self) -> list[object]:
        return []


# ------------------------------------------------------------------ tests


class TestRegistration:
    def test_every_non_browser_task_type_has_a_handler(self, registry: Registry):
        """A task type with no handler is buried on arrival, so a gap here is not
        a missing feature — it is a queue that silently discards work."""
        # The two browser types are registered by the slot, and by exactly one
        # process: two handlers for one type would mean whichever worker claimed
        # it first decided whether the task made sense.
        assert registry.missing() == {
            TaskType.PREPARE_APPLICATION,
            TaskType.REPLAY_APPLICATION,
        }

    def test_registering_twice_is_refused(self, settings: Settings, provider: NullProvider):
        target = Registry()
        register_pipeline(target, settings=settings, provider_factory=lambda _: provider)
        with pytest.raises(ValueError, match="already has a handler"):
            register_pipeline(target, settings=settings, provider_factory=lambda _: provider)


class TestPreSpendScreen:
    """The gate between discovery and the first euro (§7.3).

    Everything downstream of ``DISCOVER_SOURCE`` costs something: sponsorship
    analysis and scoring both call a model, and a job that survives them can take
    one of the day's thirty prepared-application slots. So these tests assert on
    the fan-out, not on a return value — a job that is screened out must produce
    no ``ANALYZE_SPONSORSHIP`` task at all.
    """

    @pytest.fixture
    def no_feed(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A source that fetches nothing.

        Isolates the screen from the adapters: the jobs under test are already in
        the database, and the ``pending`` query picks them up regardless of what
        this run fetched.
        """
        monkeypatch.setattr("app.worker.sources.adapters_for", lambda *a, **k: [_Empty()])

    def _run(self, worker: Worker, db: Session) -> list[ScheduledTask]:
        queue(db, TaskType.DISCOVER_SOURCE, kind="greenhouse", name="acme")
        drain(worker)
        return tasks(db, TaskType.ANALYZE_SPONSORSHIP)

    def test_a_fresh_targeted_us_job_reaches_sponsorship_analysis(
        self, worker: Worker, db: Session, no_feed: None
    ):
        job = make_job(db, posted_at=NOW - timedelta(hours=2), location_text="Austin, TX")
        assert [t.payload["job_id"] for t in self._run(worker, db)] == [str(job.id)]

    def test_a_posting_older_than_the_window_never_reaches_a_model(
        self, worker: Worker, db: Session, no_feed: None
    ):
        job = make_job(db, posted_at=NOW - timedelta(days=30), location_text="Austin, TX")
        assert self._run(worker, db) == []
        db.refresh(job)
        assert job.status == JobState.ELIGIBILITY_REJECTED

    def test_a_stale_posting_seen_today_is_still_stale(
        self, worker: Worker, db: Session, no_feed: None
    ):
        """``max(posted_at, discovered_at)`` would have let this one through."""
        make_job(
            db,
            posted_at=NOW - timedelta(days=90),
            discovered_at=NOW,
            location_text="Austin, TX",
        )
        assert self._run(worker, db) == []

    def test_a_posting_with_no_posted_at_falls_back_to_when_it_was_seen(
        self, worker: Worker, db: Session, no_feed: None
    ):
        job = make_job(db, posted_at=None, discovered_at=NOW, location_text="Austin, TX")
        assert [t.payload["job_id"] for t in self._run(worker, db)] == [str(job.id)]

    def test_an_untargeted_title_never_reaches_a_model(
        self, worker: Worker, db: Session, no_feed: None
    ):
        make_job(
            db,
            title="Marketing Intern",
            normalized_title="marketing intern",
            posted_at=NOW - timedelta(hours=2),
            location_text="Austin, TX",
        )
        assert self._run(worker, db) == []

    def test_a_remote_role_in_europe_never_reaches_a_model(
        self, worker: Worker, db: Session, no_feed: None
    ):
        """The case normalization cannot see: both fold to "remote"."""
        make_job(
            db,
            posted_at=NOW - timedelta(hours=2),
            location_text="Remote (EU)",
            normalized_location="remote",
        )
        assert self._run(worker, db) == []

    def test_a_remote_us_role_does_reach_a_model(
        self, worker: Worker, db: Session, no_feed: None
    ):
        job = make_job(
            db,
            posted_at=NOW - timedelta(hours=2),
            location_text="Remote - US",
            normalized_location="remote",
        )
        assert [t.payload["job_id"] for t in self._run(worker, db)] == [str(job.id)]

    def test_a_screened_out_job_is_kept_with_its_reason(
        self, worker: Worker, db: Session, no_feed: None
    ):
        """Rejection is a state change and an audit entry, never a delete."""
        from app.db.models import AuditEvent

        job = make_job(db, posted_at=NOW - timedelta(days=30), location_text="Austin, TX")
        self._run(worker, db)

        db.refresh(job)
        assert job.status == JobState.ELIGIBILITY_REJECTED
        entries = db.scalars(select(AuditEvent).where(AuditEvent.entity_id == job.id)).all()
        reasons = [str(e.event_metadata.get("reason", "")) for e in entries]
        assert any("older than 168h" in r for r in reasons), reasons
        assert any(
            e.event_metadata.get("stage") == "pre_spend_screen" for e in entries
        ), "the audit trail must say which gate turned it away"

    def test_a_probable_duplicate_is_never_screened_or_spent_on(
        self, worker: Worker, db: Session, no_feed: None
    ):
        """Deduplication is the first filter, and it runs during ingest.

        A probable duplicate waits for the user's decision (§7.4), so it must not
        be fanned out — and equally must not be rejected by the screen, which
        would settle a question that is the user's to settle.
        """
        job = make_job(
            db,
            status=JobState.DUPLICATE_PROBABLE,
            posted_at=NOW - timedelta(hours=2),
            location_text="Austin, TX",
        )
        assert self._run(worker, db) == []
        db.refresh(job)
        assert job.status == JobState.DUPLICATE_PROBABLE


class TestSponsorship:
    def test_a_citizens_only_posting_is_rejected_without_a_model_call(
        self, worker: Worker, db: Session, provider: NullProvider
    ):
        """The keyword pre-pass settles this, so the budget is never touched.

        A citizenship requirement the candidate does not meet is the one
        sponsorship case with a decisive answer; everything softer goes to the
        user (see the next test).
        """
        job = make_job(db, description=CITIZENS_ONLY_JD)
        queue(db, TaskType.ANALYZE_SPONSORSHIP, job_id=str(job.id))

        drain(worker)
        db.refresh(job)

        assert job.status == JobState.ELIGIBILITY_REJECTED
        assert provider.calls == []

    def test_no_sponsorship_wording_goes_to_the_user_rather_than_the_bin(
        self, worker: Worker, db: Session
    ):
        """"We cannot sponsor" is the employer's policy, not a legal conclusion
        about this candidate. §7.5 routes it to a human."""
        job = make_job(db, description=NO_SPONSORSHIP_JD)
        queue(db, TaskType.ANALYZE_SPONSORSHIP, job_id=str(job.id))
        worker.run_once(now=NOW)

        assessment = not_none(
            db.scalars(
                select(SponsorshipAssessment).where(SponsorshipAssessment.job_id == job.id)
            ).first()
        )
        assert assessment.recommended_action == "MANUAL_REVIEW"
        db.refresh(job)
        assert job.status != JobState.ELIGIBILITY_REJECTED

    def test_the_quote_is_stored_as_evidence(self, worker: Worker, db: Session):
        job = make_job(db, description=NO_SPONSORSHIP_JD)
        queue(db, TaskType.ANALYZE_SPONSORSHIP, job_id=str(job.id))
        drain(worker)

        assessment = not_none(
            db.scalars(select(SponsorshipAssessment).where(SponsorshipAssessment.job_id == job.id))
            .first()
        )
        assert assessment.evidence
        assert "unable to sponsor" in assessment.evidence[0]["quote"].lower()

    def test_a_rejected_job_is_never_scored(self, worker: Worker, db: Session):
        job = make_job(db, description=CITIZENS_ONLY_JD)
        queue(db, TaskType.ANALYZE_SPONSORSHIP, job_id=str(job.id))
        drain(worker)

        assert tasks(db, TaskType.SCORE_JOB) == []

    def test_an_ordinary_posting_fans_out_to_scoring(
        self, worker: Worker, db: Session, provider: NullProvider
    ):
        provider.queue(SILENT)
        job = make_job(db)
        queue(db, TaskType.ANALYZE_SPONSORSHIP, job_id=str(job.id))
        worker.run_once(now=NOW)

        assert [t.dedupe_key for t in tasks(db, TaskType.SCORE_JOB)] == [
            idempotency_key(TaskType.SCORE_JOB, str(job.id))
        ]

    def test_re_running_does_not_duplicate_the_assessment(
        self, worker: Worker, db: Session, provider: NullProvider
    ):
        provider.queue(SILENT)
        provider.queue(JUDGMENT)
        job = make_job(db)
        queue(db, TaskType.ANALYZE_SPONSORSHIP, job_id=str(job.id))
        drain(worker)

        enqueue(
            db,
            task_type=TaskType.ANALYZE_SPONSORSHIP,
            dedupe_key="second-look",
            payload={"job_id": str(job.id)},
            run_at=NOW,
        )
        db.commit()
        drain(worker)

        count = len(
            db.scalars(
                select(SponsorshipAssessment).where(SponsorshipAssessment.job_id == job.id)
            ).all()
        )
        assert count == 1

    def test_a_job_that_vanished_is_buried_not_retried(self, worker: Worker, db: Session):
        queue(db, TaskType.ANALYZE_SPONSORSHIP, job_id=str(uuid.uuid4()))
        worker.run_once(now=NOW)

        task = tasks(db, TaskType.ANALYZE_SPONSORSHIP)[0]
        assert task.status == TaskStatus.DEAD

    def test_a_malformed_payload_is_buried(self, worker: Worker, db: Session):
        queue(db, TaskType.ANALYZE_SPONSORSHIP, job_id="not-a-uuid")
        worker.run_once(now=NOW)
        assert tasks(db, TaskType.ANALYZE_SPONSORSHIP)[0].status == TaskStatus.DEAD


class TestScoring:
    def test_a_scored_job_gets_a_row_and_a_status(
        self, worker: Worker, db: Session, provider: NullProvider
    ):
        provider.queue(JUDGMENT)
        job = make_job(db)
        set_fact(db, "education.graduation_date", "2028-05-15", actor=Actor.USER)
        db.commit()

        queue(db, TaskType.SCORE_JOB, job_id=str(job.id))
        drain(worker)
        db.refresh(job)

        stored = not_none(db.scalars(select(JobScore).where(JobScore.job_id == job.id)).first())
        assert job.status == JobState.SCORED
        assert 0 < float(stored.total_score) <= 100

    def test_an_ineligible_job_scores_zero_and_skips_the_model(
        self, worker: Worker, db: Session, provider: NullProvider
    ):
        """§7.6: a high AI score may never override a hard ineligibility, and the
        cheapest way to guarantee that is not to ask."""
        job = make_job(db, title="Senior Staff Engineer", normalized_title="senior staff engineer")
        queue(db, TaskType.SCORE_JOB, job_id=str(job.id))
        drain(worker)
        db.refresh(job)

        stored = not_none(db.scalars(select(JobScore).where(JobScore.job_id == job.id)).first())
        assert float(stored.total_score) == 0
        assert job.status == JobState.ELIGIBILITY_REJECTED
        assert provider.calls == []

    def test_the_breakdown_is_stored_for_the_review_screen(
        self, worker: Worker, db: Session, provider: NullProvider
    ):
        provider.queue(JUDGMENT)
        job = make_job(db)
        queue(db, TaskType.SCORE_JOB, job_id=str(job.id))
        drain(worker)

        stored = not_none(db.scalars(select(JobScore).where(JobScore.job_id == job.id)).first())
        assert "internship_level_fit" in stored.components

    def test_scoring_does_not_start_an_application(
        self, worker: Worker, db: Session, provider: NullProvider
    ):
        """Selection is the user's (§0.2). A good score is an invitation, not a
        decision."""
        provider.queue(JUDGMENT)
        job = make_job(db)
        queue(db, TaskType.SCORE_JOB, job_id=str(job.id))
        drain(worker)

        assert db.scalars(select(Application)).all() == []
        assert tasks(db, TaskType.PREPARE_APPLICATION) == []


class TestPreparingTheResume:
    """The stage that gives an application its resume.

    It does not rewrite anything: the user keeps one PDF, and this copies it in
    and hands the application to a browser. What is worth testing is the handoff
    and the refusal — an application with no resume must not reach a form.
    """

    def _application(self, db: Session) -> Application:
        job = make_job(db)
        application = Application(
            job_id=job.id,
            application_url=job.canonical_url,
            status=ApplicationState.MATERIALS_PREPARING,
        )
        db.add(application)
        db.commit()
        return application

    def test_it_attaches_the_base_resume_and_queues_a_browser(
        self, worker: Worker, db: Session, settings: Settings
    ):
        """It owns the materials stage and hands off — one owner per task type."""
        from app.services.resume_artifacts import selected_version

        application = self._application(db)

        queue(db, TaskType.PREPARE_RESUME, application_id=str(application.id))
        worker.run_once(now=NOW)

        db.expire_all()
        db.refresh(application)
        row = not_none(selected_version(db, application.id))
        assert Path(row.pdf_path).is_file()
        assert application.status == ApplicationState.BROWSER_QUEUED
        assert tasks(db, TaskType.PREPARE_APPLICATION), "the browser was queued"

    def test_the_attached_file_is_a_copy_in_the_applications_folder(
        self, worker: Worker, db: Session, settings: Settings
    ):
        from app.services.resume_artifacts import resume_dir, selected_version

        application = self._application(db)

        queue(db, TaskType.PREPARE_RESUME, application_id=str(application.id))
        worker.run_once(now=NOW)

        db.expire_all()
        row = not_none(selected_version(db, application.id))
        assert Path(row.pdf_path).is_relative_to(resume_dir(settings, application.id))

    def test_it_does_not_claim_the_resume_was_uploaded(
        self, worker: Worker, db: Session
    ):
        """Selected is intent; uploaded is what a browser actually did."""
        from app.services.resume_artifacts import selected_version, uploaded_version

        application = self._application(db)

        queue(db, TaskType.PREPARE_RESUME, application_id=str(application.id))
        worker.run_once(now=NOW)

        db.expire_all()
        assert selected_version(db, application.id) is not None
        assert uploaded_version(db, application.id) is None

    def test_it_calls_no_model(
        self, worker: Worker, db: Session, provider: NullProvider
    ):
        """There is nothing here to ask a model about, and asking would cost money."""
        application = self._application(db)

        queue(db, TaskType.PREPARE_RESUME, application_id=str(application.id))
        worker.run_once(now=NOW)

        assert provider.calls == []

    def test_running_it_twice_does_not_produce_a_second_resume(
        self, worker: Worker, db: Session
    ):
        application = self._application(db)

        for suffix in ("first", "second"):
            queue(
                db,
                TaskType.PREPARE_RESUME,
                application_id=str(application.id),
                key=suffix,
            )
            worker.run_once(now=NOW)

        db.expire_all()
        rows = db.scalars(
            select(ResumeVersion).where(ResumeVersion.application_id == application.id)
        ).all()
        assert len(rows) == 1


class TestPreparingRefusesWithoutAResume:
    def test_no_base_resume_buries_the_task_naming_the_setting(
        self, db: Session, committing_db, tmp_path: Path, provider: NullProvider
    ):
        """A form filled with no resume wastes one of two browser slots."""
        settings = Settings(
            app_env="development",
            app_secret_key="handler-tests",
            data_dir=tmp_path / "data",
            base_resume_pdf=None,
        )
        worker = Worker(
            session_factory=committing_db,
            worker_id="no-resume",
            registry=register_pipeline(
                Registry(), settings=settings, provider_factory=lambda _: provider
            ),
            poll_interval=0.0,
        )
        job = make_job(db)
        application = Application(
            job_id=job.id,
            application_url=job.canonical_url,
            status=ApplicationState.MATERIALS_PREPARING,
        )
        db.add(application)
        db.commit()

        queue(db, TaskType.PREPARE_RESUME, application_id=str(application.id))
        worker.run_once(now=NOW)

        task = tasks(db, TaskType.PREPARE_RESUME)[0]
        assert task.status == TaskStatus.DEAD
        assert "BASE_RESUME_PDF" in not_none(task.last_error)
        assert tasks(db, TaskType.PREPARE_APPLICATION) == []


#: Comfortably past the two-business-day delay and inside the send window, so the
#: tests below are about matching and drafting rather than about the calendar.
#: Computed with the policy's own helper rather than a hand-picked date, which
#: would land on a weekend roughly two runs in seven.
AFTER_THE_DELAY = next_send_window(NOW + timedelta(days=9))


class TestOutreachPipeline:
    def _submitted(self, db: Session) -> Application:
        job = make_job(db)
        application = Application(
            job_id=job.id,
            application_url=job.canonical_url,
            status=ApplicationState.SUBMITTED,
            submitted_at=NOW - timedelta(days=1),
        )
        db.add(application)
        db.commit()
        return application

    def _recruiter(self, db: Session, **kw: object) -> Recruiter:
        company = db.scalars(
            select(Company).where(Company.normalized_name == "acme")
        ).first() or Company(canonical_name="Acme Inc", normalized_name="acme", domain="acme.com")
        db.add(company)
        db.flush()
        defaults: dict[str, object] = {
            "full_name": "Alice Nguyen",
            "raw_company": "Acme Inc",
            "email": "alice@acme.com",
            "email_domain": "acme.com",
            "company_id": company.id,
            "title": "University Recruiter",
        }
        recruiter = Recruiter(**{**defaults, **kw})
        db.add(recruiter)
        db.commit()
        return recruiter

    def test_outreach_is_due_two_business_days_later(self, worker: Worker, db: Session):
        application = self._submitted(db)
        queue(db, TaskType.SCHEDULE_OUTREACH, application_id=str(application.id))
        worker.run_once(now=NOW)

        outreach = not_none(db.scalars(select(OutreachTask)).first())
        assert outreach.due_at > (application.submitted_at or NOW)
        assert outreach.status == OutreachState.SCHEDULED

    def test_outreach_is_refused_before_submission(self, worker: Worker, db: Session):
        """§8.2: the email says "I applied". It must be true."""
        job = make_job(db)
        application = Application(
            job_id=job.id,
            application_url=job.canonical_url,
            status=ApplicationState.READY_FOR_REVIEW,
        )
        db.add(application)
        db.commit()

        queue(db, TaskType.SCHEDULE_OUTREACH, application_id=str(application.id))
        worker.run_once(now=NOW)

        assert db.scalars(select(OutreachTask)).all() == []
        assert tasks(db, TaskType.SCHEDULE_OUTREACH)[0].status == TaskStatus.DEAD

    def test_an_unmatched_company_asks_rather_than_guessing(self, worker: Worker, db: Session):
        application = self._submitted(db)
        queue(db, TaskType.SCHEDULE_OUTREACH, application_id=str(application.id))
        drain(worker, now=AFTER_THE_DELAY)

        outreach = not_none(db.scalars(select(OutreachTask)).first())
        assert outreach.status == OutreachState.RECRUITER_MATCH_REQUIRED
        assert outreach.recruiter_id is None

    def test_a_matched_recruiter_leads_to_a_draft(self, worker: Worker, db: Session):
        self._recruiter(db)
        application = self._submitted(db)
        set_fact(db, "candidate.preferred_name", "Hoan", actor=Actor.USER)
        db.commit()

        queue(db, TaskType.SCHEDULE_OUTREACH, application_id=str(application.id))
        drain(worker, now=AFTER_THE_DELAY)

        outreach = not_none(db.scalars(select(OutreachTask)).first())
        assert outreach.status == OutreachState.READY_FOR_REVIEW
        assert outreach.gmail_draft_id
        assert outreach.subject and outreach.body

    def test_the_body_names_the_role_and_the_recruiter(self, worker: Worker, db: Session):
        self._recruiter(db)
        application = self._submitted(db)
        set_fact(db, "candidate.preferred_name", "Hoan", actor=Actor.USER)
        db.commit()

        queue(db, TaskType.SCHEDULE_OUTREACH, application_id=str(application.id))
        drain(worker, now=AFTER_THE_DELAY)

        outreach = not_none(db.scalars(select(OutreachTask)).first())
        assert "Alice" in not_none(outreach.body)
        assert "Software Engineer Intern" in not_none(outreach.body)

    def test_a_draft_carries_no_unrendered_placeholder(self, worker: Worker, db: Session):
        """The draft goes through validate_content, which refuses one."""
        self._recruiter(db)
        application = self._submitted(db)
        set_fact(db, "candidate.preferred_name", "Hoan", actor=Actor.USER)
        db.commit()

        queue(db, TaskType.SCHEDULE_OUTREACH, application_id=str(application.id))
        drain(worker, now=AFTER_THE_DELAY)

        outreach = not_none(db.scalars(select(OutreachTask)).first())
        assert "{{" not in not_none(outreach.body)

    def test_a_withheld_draft_records_why(self, worker: Worker, db: Session):
        """"No draft" with no explanation is indistinguishable from a bug."""
        self._recruiter(db)
        application = self._submitted(db)
        set_fact(db, "candidate.preferred_name", "Hoan", actor=Actor.USER)
        db.commit()

        queue(db, TaskType.SCHEDULE_OUTREACH, application_id=str(application.id))
        # Deliberately before the due date: the two-business-day delay is the
        # rule being exercised.
        drain(worker, now=NOW + timedelta(minutes=1))

        outreach = not_none(db.scalars(select(OutreachTask)).first())
        assert outreach.gmail_draft_id is None
        assert any("not due until" in r for r in (outreach.hook_json or {}).get("withheld", []))

    def test_a_suppressed_recruiter_gets_no_draft(self, worker: Worker, db: Session):
        recruiter = self._recruiter(db)
        db.add(SuppressionEntry(email=recruiter.email, reason="OPT_OUT", source="test"))
        application = self._submitted(db)
        set_fact(db, "candidate.preferred_name", "Hoan", actor=Actor.USER)
        db.commit()

        queue(db, TaskType.SCHEDULE_OUTREACH, application_id=str(application.id))
        drain(worker, now=AFTER_THE_DELAY)

        outreach = not_none(db.scalars(select(OutreachTask)).first())
        assert outreach.gmail_draft_id is None
        assert outreach.status != OutreachState.READY_FOR_REVIEW

    def test_a_do_not_contact_recruiter_is_never_matched(self, worker: Worker, db: Session):
        self._recruiter(db, do_not_contact=True)
        application = self._submitted(db)
        db.commit()

        queue(db, TaskType.SCHEDULE_OUTREACH, application_id=str(application.id))
        drain(worker, now=AFTER_THE_DELAY)

        outreach = not_none(db.scalars(select(OutreachTask)).first())
        assert outreach.gmail_draft_id is None

    def test_without_a_candidate_name_the_task_stops_and_says_why(
        self, worker: Worker, db: Session
    ):
        """Better a clear stop than an email signed by nobody."""
        self._recruiter(db)
        application = self._submitted(db)

        queue(db, TaskType.SCHEDULE_OUTREACH, application_id=str(application.id))
        drain(worker, now=AFTER_THE_DELAY)

        hook_task = tasks(db, TaskType.GENERATE_HOOK)[0]
        assert hook_task.status == TaskStatus.DEAD
        assert "candidate.preferred_name" in not_none(hook_task.last_error)


class TestTransactionality:
    def test_a_failing_stage_enqueues_nothing(self, worker: Worker, db: Session):
        """The whole point of committing work and fan-out together."""
        queue(db, TaskType.ANALYZE_SPONSORSHIP, job_id=str(uuid.uuid4()))
        worker.run_once(now=NOW)

        assert tasks(db, TaskType.SCORE_JOB) == []
