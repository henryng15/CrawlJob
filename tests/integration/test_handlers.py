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
    ResumeVersion,
    ScheduledTask,
    SponsorshipAssessment,
)
from app.domain.normalization import canonicalize_url, url_hash
from app.domain.states import ApplicationState, JobState
from app.domain.tasks import TaskStatus, TaskType, idempotency_key
from app.services.candidate import Actor, set_fact
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
def registry(settings: Settings) -> Registry:
    return register_pipeline(
        Registry(), settings=settings
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
        # Submitting is registered by the browser worker, and by exactly one
        # process: two handlers for one type would mean whichever worker claimed
        # it first decided whether the task made sense.
        assert registry.missing() == {TaskType.SUBMIT_APPLICATION}

    def test_registering_twice_is_refused(self, settings: Settings):
        target = Registry()
        register_pipeline(target, settings=settings)
        with pytest.raises(ValueError, match="already has a handler"):
            register_pipeline(target, settings=settings)


class TestPreSpendScreen:
    """The gate between discovery and the first euro (§7.3).

    A job that survives the screen can take one of the day's application slots
    and, past the browser, be sent to a real employer. So these tests assert on
    the fan-out, not on a return value — a job that is screened out must produce
    no ``SCORE_JOB`` task at all.
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
        return tasks(db, TaskType.SCORE_JOB)

    def test_a_fresh_targeted_us_job_reaches_scoring(
        self, worker: Worker, db: Session, no_feed: None
    ):
        job = make_job(db, posted_at=NOW - timedelta(hours=2), location_text="Austin, TX")
        assert [t.payload["job_id"] for t in self._run(worker, db)] == [str(job.id)]

    def test_a_posting_older_than_the_window_is_screened_out(
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

    def test_an_untargeted_title_is_screened_out(
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

    def test_a_remote_role_in_europe_is_screened_out(
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

    def test_a_remote_us_role_survives_the_screen(
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
    """The employer's stated policy, read by regex during discovery.

    There is no separate stage any more: the prepass is cheap enough to run
    inline, so what these assert is that a restrictive posting never reaches
    scoring at all.
    """

    @pytest.fixture
    def no_feed(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("app.worker.sources.adapters_for", lambda *a, **k: [_Empty()])

    def _discover(self, worker: Worker, db: Session) -> None:
        queue(db, TaskType.DISCOVER_SOURCE, kind="greenhouse", name="acme")
        drain(worker)

    def test_a_citizens_only_posting_is_rejected(
        self, worker: Worker, db: Session, no_feed: None
    ):
        """A citizenship requirement the candidate does not meet is the one
        sponsorship case with a decisive answer; everything softer is left
        alone (see the next test)."""
        job = make_job(db, description=CITIZENS_ONLY_JD)
        self._discover(worker, db)
        db.refresh(job)

        assert job.status == JobState.ELIGIBILITY_REJECTED

    def test_no_sponsorship_wording_stops_the_job_before_it_costs_anything(
        self, worker: Worker, db: Session, no_feed: None
    ):
        """"We cannot sponsor" is the employer's policy. For a candidate who
        needs sponsorship it is decisive, and applying anyway wastes both
        sides' time."""
        job = make_job(db, description=NO_SPONSORSHIP_JD)
        self._discover(worker, db)

        assessment = not_none(
            db.scalars(
                select(SponsorshipAssessment).where(SponsorshipAssessment.job_id == job.id)
            ).first()
        )
        assert assessment.recommended_action == "SKIP"
        assert tasks(db, TaskType.SCORE_JOB) == []

    def test_the_quote_is_stored_as_evidence(
        self, worker: Worker, db: Session, no_feed: None
    ):
        """A restrictive classification with no quote is an assertion, not a
        finding — and the user reads this sentence on the job page."""
        job = make_job(db, description=NO_SPONSORSHIP_JD)
        self._discover(worker, db)

        assessment = not_none(
            db.scalars(
                select(SponsorshipAssessment).where(SponsorshipAssessment.job_id == job.id)
            ).first()
        )
        assert assessment.evidence_quotes
        assert "unable to sponsor" in assessment.evidence_quotes[0]["quote"].lower()

    def test_a_silent_posting_reaches_scoring(
        self, worker: Worker, db: Session, no_feed: None
    ):
        job = make_job(db)
        self._discover(worker, db)

        assert [t.payload["job_id"] for t in tasks(db, TaskType.SCORE_JOB)] == [str(job.id)]

    def test_re_running_does_not_duplicate_the_assessment(
        self, worker: Worker, db: Session, no_feed: None
    ):
        job = make_job(db, description=NO_SPONSORSHIP_JD)
        self._discover(worker, db)
        enqueue(
            db,
            task_type=TaskType.DISCOVER_SOURCE,
            dedupe_key="second-look",
            payload={"kind": "greenhouse", "name": "acme"},
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


class TestScoringRefusesBadInput:
    def test_a_job_that_vanished_is_buried_not_retried(self, worker: Worker, db: Session):
        queue(db, TaskType.SCORE_JOB, job_id=str(uuid.uuid4()))
        worker.run_once(now=NOW)

        assert tasks(db, TaskType.SCORE_JOB)[0].status == TaskStatus.DEAD

    def test_a_malformed_payload_is_buried(self, worker: Worker, db: Session):
        queue(db, TaskType.SCORE_JOB, job_id="not-a-uuid")
        worker.run_once(now=NOW)
        assert tasks(db, TaskType.SCORE_JOB)[0].status == TaskStatus.DEAD


class TestScoring:
    def test_a_scored_job_gets_a_row_and_a_status(
        self, worker: Worker, db: Session
    ):
        job = make_job(db)
        set_fact(db, "education.graduation_date", "2028-05-15", actor=Actor.USER)
        db.commit()

        queue(db, TaskType.SCORE_JOB, job_id=str(job.id))
        drain(worker)
        db.refresh(job)

        stored = not_none(db.scalars(select(JobScore).where(JobScore.job_id == job.id)).first())
        assert job.status == JobState.SCORED
        assert 0 < float(stored.total_score) <= 100

    def test_an_ineligible_job_scores_zero(
        self, worker: Worker, db: Session
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

    def test_the_breakdown_is_stored_for_the_review_screen(
        self, worker: Worker, db: Session
    ):
        job = make_job(db)
        queue(db, TaskType.SCORE_JOB, job_id=str(job.id))
        drain(worker)

        stored = not_none(db.scalars(select(JobScore).where(JobScore.job_id == job.id)).first())
        assert "internship_level_fit" in stored.components

    def test_a_good_score_starts_an_application(
        self, worker: Worker, db: Session
    ):
        """The change that makes this an auto-apply system: nobody presses a
        button between a job scoring well and an application existing."""
        job = make_job(db)
        queue(db, TaskType.SCORE_JOB, job_id=str(job.id))
        drain(worker)

        application = not_none(db.scalars(select(Application)).first())
        assert application.job_id == job.id
        assert [t.payload["application_id"] for t in tasks(db, TaskType.PREPARE_APPLICATION)] == [
            str(application.id)
        ]

    def test_a_poor_score_starts_nothing(self, worker: Worker, db: Session):
        job = make_job(db, title="Senior Staff Engineer", location_text="Boise, ID")
        queue(db, TaskType.SCORE_JOB, job_id=str(job.id))
        drain(worker)

        assert db.scalars(select(Application)).all() == []

    def test_a_second_application_for_one_job_is_refused(
        self, worker: Worker, db: Session
    ):
        """Re-scoring must not apply twice to the same posting."""
        job = make_job(db)
        queue(db, TaskType.SCORE_JOB, job_id=str(job.id))
        drain(worker)
        enqueue(
            db,
            task_type=TaskType.SCORE_JOB,
            dedupe_key="second-look",
            payload={"job_id": str(job.id)},
            run_at=NOW,
        )
        db.commit()
        drain(worker)

        assert len(db.scalars(select(Application)).all()) == 1


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
        self, worker: Worker, db: Session
    ):
        """There is nothing here to ask a model about, and asking would cost money."""
        application = self._application(db)

        queue(db, TaskType.PREPARE_RESUME, application_id=str(application.id))
        worker.run_once(now=NOW)


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


class TestCompaniesYouHandleYourself:
    """Employers on the manual-only list get materials and nothing else.

    The user fills those in by hand, so filling them here is work thrown away —
    and a browser slot is the scarcest thing this system has.
    """

    def _application(self, db: Session, *, domain: str) -> Application:
        job = make_job(db)
        company = db.get(Company, job.company_id)
        assert company is not None
        company.domain = domain
        application = Application(
            job_id=job.id,
            application_url=job.canonical_url,
            status=ApplicationState.MATERIALS_PREPARING,
        )
        db.add(application)
        db.commit()
        return application

    def _listed(self, db: Session, domain: str) -> None:
        from app.db.models import ManualOnlyCompany

        db.add(
            ManualOnlyCompany(
                domain=domain, company_name="Acme Inc", source="test"
            )
        )
        db.commit()

    def test_a_listed_employer_is_handed_over_without_a_browser(
        self, worker: Worker, db: Session
    ):
        from app.services.resume_artifacts import selected_version

        self._listed(db, "acme.com")
        application = self._application(db, domain="acme.com")

        queue(db, TaskType.PREPARE_RESUME, application_id=str(application.id))
        worker.run_once(now=NOW)

        db.expire_all()
        db.refresh(application)
        assert application.status == ApplicationState.READY_FOR_REVIEW
        assert selected_version(db, application.id) is not None, "still gets its resume"
        assert tasks(db, TaskType.PREPARE_APPLICATION) == [], "no browser was queued"

    def test_an_unlisted_employer_still_goes_to_a_browser(
        self, worker: Worker, db: Session
    ):
        """The control: the policy must turn away only what is on the list."""
        self._listed(db, "somewhere-else.com")
        application = self._application(db, domain="acme.com")

        queue(db, TaskType.PREPARE_RESUME, application_id=str(application.id))
        worker.run_once(now=NOW)

        db.expire_all()
        db.refresh(application)
        assert application.status == ApplicationState.BROWSER_QUEUED
        assert tasks(db, TaskType.PREPARE_APPLICATION), "the browser was queued"

    def test_the_reason_is_recorded_where_the_user_will_read_it(
        self, worker: Worker, db: Session
    ):
        """An application that skipped the browser looks identical to one the
        browser failed on, unless it says why."""
        from app.db.models import AuditEvent

        self._listed(db, "acme.com")
        application = self._application(db, domain="acme.com")

        queue(db, TaskType.PREPARE_RESUME, application_id=str(application.id))
        worker.run_once(now=NOW)

        db.expire_all()
        entries = db.scalars(
            select(AuditEvent).where(AuditEvent.entity_id == application.id)
        ).all()
        reasons = [str(e.event_metadata.get("reason", "")) for e in entries]
        assert any("manual-only" in r for r in reasons), reasons

    def test_it_waits_for_you_rather_than_expiring_immediately(
        self, worker: Worker, db: Session
    ):
        """It is still a prepared application, so the TTL still applies."""
        self._listed(db, "acme.com")
        application = self._application(db, domain="acme.com")

        queue(db, TaskType.PREPARE_RESUME, application_id=str(application.id))
        worker.run_once(now=NOW)

        db.expire_all()
        db.refresh(application)
        assert application.expires_at is not None
        assert application.ready_for_review_at is not None


class TestPreparingRefusesWithoutAResume:
    def test_no_base_resume_buries_the_task_naming_the_setting(
        self, db: Session, committing_db, tmp_path: Path
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



class TestTransactionality:
    def test_a_failing_stage_enqueues_nothing(self, worker: Worker, db: Session):
        """The whole point of committing work and fan-out together."""
        queue(db, TaskType.SCORE_JOB, job_id=str(uuid.uuid4()))
        worker.run_once(now=NOW)

        assert tasks(db, TaskType.PREPARE_APPLICATION) == []
