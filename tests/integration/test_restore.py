"""Bringing an expired application back (spec §7.9, §7.11).

Restoring is the one operation that touches an application the system has
already let go of, so the tests are weighted towards the things that would be
expensive to get wrong: taking a browser slot for a restore that could never
have worked, silently creating a second application for one job, and charging
the user a daily slot for work they had already paid for.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.db.models import Application, Company, Job, ResumeVersion, ScheduledTask
from app.domain.normalization import canonicalize_url, url_hash
from app.domain.states import ApplicationState, JobState
from app.domain.tasks import TaskType, idempotency_key
from app.services.expiry import expire_due
from app.services.llm.base import NullProvider
from app.services.queue import enqueue
from app.services.restore import (
    RESTORE_TARGET_DEFAULT,
    check_restorable,
    previous_human_state,
    replay_package_path,
)
from app.worker.handlers import register_pipeline
from app.worker.runtime import Registry, Worker

pytestmark = pytest.mark.db

NOW = datetime.now(UTC).replace(microsecond=0)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        app_env="development",
        app_secret_key="restore-tests",
        data_dir=tmp_path / "data",
    )


@pytest.fixture
def registry(settings: Settings) -> Registry:
    return register_pipeline(
        Registry(), settings=settings, provider_factory=lambda _: NullProvider()
    )


@pytest.fixture
def worker(committing_db: sessionmaker[Session], registry: Registry) -> Worker:
    return Worker(
        session_factory=committing_db,
        worker_id="restore-test",
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


def make_expired(
    session: Session,
    settings: Settings,
    *,
    from_state: ApplicationState = ApplicationState.READY_FOR_REVIEW,
    job_status: JobState = JobState.DISCOVERED,
    with_package: bool = True,
) -> Application:
    """An application that has genuinely been through expiry.

    Driven through ``expire_due`` rather than assigned, so the audit record the
    restore reads is the real one rather than one the test wrote.
    """
    company = Company(
        canonical_name="Acme Inc", normalized_name=f"acme-{uuid.uuid4().hex[:6]}", domain="a.com"
    )
    session.add(company)
    session.flush()

    url = f"https://boards.greenhouse.io/acme/jobs/{uuid.uuid4().hex[:8]}"
    job = Job(
        company_id=company.id,
        canonical_url=canonicalize_url(url),
        canonical_url_hash=url_hash(url),
        title="Software Engineer Intern",
        normalized_title="software engineer intern",
        dedupe_fingerprint=uuid.uuid4().hex,
        discovered_at=NOW,
        status=job_status,
    )
    session.add(job)
    session.flush()

    resume = ResumeVersion(
        kind="TAILORED",
        status="READY",
        source_path="/artifacts/r.tex",
        pdf_path="/artifacts/r.pdf",
        sha256=uuid.uuid4().hex,
    )
    session.add(resume)
    session.flush()

    application = Application(
        job_id=job.id,
        resume_version_id=resume.id,
        status=from_state,
        application_url=url,
        ready_for_review_at=NOW - timedelta(hours=25),
        expires_at=NOW - timedelta(hours=1),
    )
    session.add(application)
    session.flush()

    expire_due(session, now=NOW)
    session.commit()

    if with_package:
        write_package(settings, application.id)
    return application


def write_package(settings: Settings, application_id: uuid.UUID) -> Path:
    directory = settings.artifacts_dir / str(application_id)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "replay.json"
    path.write_text(json.dumps({"fields": []}), encoding="utf-8")
    return path


def add_active(session: Session, job_id: uuid.UUID, status: ApplicationState) -> Application:
    other = Application(
        job_id=job_id,
        status=status,
        application_url="https://boards.greenhouse.io/acme/jobs/other",
    )
    session.add(other)
    session.commit()
    return other


def request_restore(session: Session, application: Application) -> None:
    enqueue(
        session,
        task_type=TaskType.RESTORE_APPLICATION,
        dedupe_key=idempotency_key(TaskType.RESTORE_APPLICATION, str(application.id), "t1"),
        payload={"application_id": str(application.id)},
        run_at=NOW,
    )
    session.commit()


def drain(worker: Worker, limit: int = 4) -> int:
    ran = 0
    while ran < limit and worker.run_once(now=NOW + timedelta(minutes=1)):
        ran += 1
    return ran


# ------------------------------------------------------------------ tests


class TestTheChecks:
    """All of these run before a browser slot is taken. There are only two."""

    def test_a_restorable_application_passes(self, db: Session, settings: Settings):
        application = make_expired(db, settings)
        check = check_restorable(db, application, has_replay_package=True)
        assert check, check.reason

    def test_only_an_expired_application_can_be_restored(
        self, db: Session, settings: Settings
    ):
        application = make_expired(db, settings)
        application.status = ApplicationState.SUBMITTED
        check = check_restorable(db, application, has_replay_package=True)
        assert not check
        assert "only an expired application" in check.reason

    def test_a_closed_posting_blocks_it(self, db: Session, settings: Settings):
        application = make_expired(db, settings, job_status=JobState.CLOSED)
        check = check_restorable(db, application, has_replay_package=True)
        assert not check
        assert "closed" in check.reason

    def test_a_posting_with_a_closed_at_blocks_it(self, db: Session, settings: Settings):
        application = make_expired(db, settings)
        db.get(Job, application.job_id).closed_at = NOW
        check = check_restorable(db, application, has_replay_package=True)
        assert not check
        assert "closed" in check.reason

    @pytest.mark.parametrize(
        "status",
        [
            ApplicationState.CREATED,
            ApplicationState.BROWSER_FILLING,
            ApplicationState.READY_FOR_REVIEW,
            ApplicationState.SUBMITTED,
        ],
    )
    def test_another_application_for_the_same_job_blocks_it(
        self, db: Session, settings: Settings, status
    ):
        application = make_expired(db, settings)
        add_active(db, application.job_id, status)
        check = check_restorable(db, application, has_replay_package=True)
        assert not check
        assert "another application for this job" in check.reason

    def test_a_submitted_duplicate_says_so_specifically(
        self, db: Session, settings: Settings
    ):
        """"Already submitted" and "already in progress" call for different
        reactions from the user, so the reason distinguishes them."""
        application = make_expired(db, settings)
        add_active(db, application.job_id, ApplicationState.SUBMITTED)
        assert "was already submitted" in check_restorable(
            db, application, has_replay_package=True
        ).reason

    @pytest.mark.parametrize(
        "status",
        [
            ApplicationState.SKIPPED,
            ApplicationState.WITHDRAWN,
            ApplicationState.FAILED,
            ApplicationState.EXPIRED,
        ],
    )
    def test_an_abandoned_application_does_not_block_it(
        self, db: Session, settings: Settings, status
    ):
        """A job the user skipped once is not a job that is already covered."""
        application = make_expired(db, settings)
        add_active(db, application.job_id, status)
        assert check_restorable(db, application, has_replay_package=True)

    def test_a_missing_replay_package_blocks_it(self, db: Session, settings: Settings):
        """Artifact cleanup can remove it long after expiry."""
        application = make_expired(db, settings, with_package=False)
        check = check_restorable(db, application, has_replay_package=False)
        assert not check
        assert "no longer on disk" in check.reason


class TestThePreviousState:
    """§7.9: a restore returns the application to where it was, not to a
    default that happens to be convenient."""

    @pytest.mark.parametrize(
        "from_state",
        [
            ApplicationState.READY_FOR_REVIEW,
            ApplicationState.LIVE_REVIEW_READY,
            ApplicationState.MANUAL_LOGIN_REQUIRED,
            ApplicationState.MANUAL_FIELD_REQUIRED,
        ],
    )
    def test_it_is_read_from_the_audit_trail(
        self, db: Session, settings: Settings, from_state
    ):
        application = make_expired(db, settings, from_state=from_state)
        assert previous_human_state(db, application) == from_state

    def test_an_application_with_no_audit_history_falls_back_to_the_queue(
        self, db: Session, settings: Settings
    ):
        """A row expired before this feature existed still has to go somewhere."""
        application = make_expired(db, settings)
        from app.db.models import AuditEvent

        for event in db.scalars(
            select(AuditEvent).where(AuditEvent.entity_id == application.id)
        ).all():
            db.delete(event)
        db.flush()
        assert previous_human_state(db, application) is RESTORE_TARGET_DEFAULT


class TestTheHandler:
    def test_a_good_restore_queues_a_replay_carrying_its_target(
        self, worker: Worker, db: Session, settings: Settings
    ):
        application = make_expired(db, settings, from_state=ApplicationState.LIVE_REVIEW_READY)
        request_restore(db, application)
        drain(worker)

        db.expire_all()
        assert application.status == ApplicationState.READY_FOR_REPLAY
        replay = db.scalars(
            select(ScheduledTask).where(ScheduledTask.task_type == TaskType.REPLAY_APPLICATION)
        ).first()
        assert replay is not None
        assert replay.payload["restore"] is True
        assert replay.payload["restore_target"] == "LIVE_REVIEW_READY"

    def test_a_blocked_restore_never_queues_a_replay(
        self, worker: Worker, db: Session, settings: Settings
    ):
        """The point of checking first: a browser slot is one of only two."""
        application = make_expired(db, settings, job_status=JobState.CLOSED)
        request_restore(db, application)
        drain(worker)

        db.expire_all()
        assert application.status == ApplicationState.RESTORE_BLOCKED
        assert (
            db.scalars(
                select(ScheduledTask).where(
                    ScheduledTask.task_type == TaskType.REPLAY_APPLICATION
                )
            ).first()
            is None
        )

    def test_the_block_reason_is_on_the_row_for_the_user_to_read(
        self, worker: Worker, db: Session, settings: Settings
    ):
        application = make_expired(db, settings, job_status=JobState.CLOSED)
        request_restore(db, application)
        drain(worker)

        db.expire_all()
        assert application.restore_blocked_reason is not None
        assert "closed" in application.restore_blocked_reason

    def test_restoring_does_not_create_a_second_application(
        self, worker: Worker, db: Session, settings: Settings
    ):
        application = make_expired(db, settings)
        before = db.scalar(select(func.count()).select_from(Application))
        request_restore(db, application)
        drain(worker)
        assert db.scalar(select(func.count()).select_from(Application)) == before

    def test_restoring_does_not_spend_a_daily_slot(
        self, worker: Worker, db: Session, settings: Settings
    ):
        """The quota counts ``ready_for_review_at``. A restore must not move it.

        The user already spent a slot preparing this application; charging them
        again for getting their own work back would make restoring more expensive
        than starting over, which is exactly backwards.
        """
        application = make_expired(db, settings)
        original = application.ready_for_review_at

        request_restore(db, application)
        drain(worker)

        db.expire_all()
        assert application.ready_for_review_at == original

    def test_a_stale_block_reason_is_cleared_when_trying_again(
        self, worker: Worker, db: Session, settings: Settings
    ):
        """A reason from a block that has since lifted must not stay on screen."""
        application = make_expired(db, settings, job_status=JobState.CLOSED)
        request_restore(db, application)
        drain(worker)
        db.expire_all()
        assert application.restore_blocked_reason is not None

        # The block lifts: the posting reopens and the user asks again.
        db.get(Job, application.job_id).status = JobState.DISCOVERED
        application.status = ApplicationState.EXPIRED
        db.commit()
        enqueue(
            db,
            task_type=TaskType.RESTORE_APPLICATION,
            dedupe_key=idempotency_key(
                TaskType.RESTORE_APPLICATION, str(application.id), "t2"
            ),
            payload={"application_id": str(application.id)},
            run_at=NOW,
        )
        db.commit()
        drain(worker)

        db.expire_all()
        assert application.status == ApplicationState.READY_FOR_REPLAY
        assert application.restore_blocked_reason is None

    def test_nothing_is_lost_by_a_block(
        self, worker: Worker, db: Session, settings: Settings
    ):
        application = make_expired(db, settings, job_status=JobState.CLOSED)
        resume_id = application.resume_version_id
        request_restore(db, application)
        drain(worker)

        db.expire_all()
        assert db.get(Application, application.id) is not None
        assert application.resume_version_id == resume_id


class TestTheRoute:
    def test_restoring_frees_nothing_until_the_worker_runs(
        self, db: Session, settings: Settings
    ):
        """The request queues work; it does not do it.

        A browser slot may be busy, and the page has to return either way.
        """
        application = make_expired(db, settings)
        request_restore(db, application)
        db.expire_all()
        assert application.status == ApplicationState.EXPIRED

    def test_the_package_path_is_found_without_importing_a_browser(
        self, db: Session, settings: Settings
    ):
        application = make_expired(db, settings)
        assert replay_package_path(settings, application.id) is not None

    def test_a_missing_package_reads_as_absent(self, db: Session, settings: Settings):
        application = make_expired(db, settings, with_package=False)
        assert replay_package_path(settings, application.id) is None
