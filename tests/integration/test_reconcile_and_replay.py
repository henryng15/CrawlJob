"""Submission reconciliation and replay packages (spec §7.10, §7.11).

Both exist for the same reason: a live browser session is fragile, and the two
things that must survive it are "did this get submitted" and "the twenty minutes
of filling".
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.ats.fields import Answer, FieldSpec, FieldType, SourceType
from app.ats.replay import ReplayPackage, build_package, check_replayable
from app.config import Settings
from app.db.models import Application, Company, Job, ScheduledTask
from app.domain.normalization import canonicalize_url, url_hash
from app.domain.states import ApplicationState, JobState
from app.domain.tasks import TaskStatus, TaskType, idempotency_key
from app.services.llm.base import NullProvider
from app.services.queue import enqueue
from app.worker.handlers import register_pipeline
from app.worker.runtime import Registry, Worker
from tests.helpers import not_none

pytestmark = pytest.mark.db

NOW = datetime.now(UTC).replace(microsecond=0)


# ------------------------------------------------------------- replay


def _spec(label: str, name: str, *, required: bool = False) -> FieldSpec:
    return FieldSpec(
        question_text=label,
        name=name,
        field_type=FieldType.TEXT,
        required=required,
    )


def _answer(value: str) -> Answer:
    return Answer("candidate.first_name", value, SourceType.PROFILE_FACT)


class TestReplayRoundTrip:
    """A package that cannot be read back is not a package."""

    def _package(self) -> ReplayPackage:
        specs = [_spec("First name", "first_name", required=True), _spec("Why us?", "why")]
        answers = [_answer("Hoan"), Answer(None, None, SourceType.MANUAL_REQUIRED)]
        return build_package(
            application_id=str(uuid.uuid4()),
            application_url="https://boards.greenhouse.io/acme/jobs/1",
            ats_type="GREENHOUSE",
            specs=specs,
            answers=answers,
            created_at=NOW,
            storage_state_path="/data/state.json",
            resume_artifact_path="/data/resume.pdf",
        )

    def test_json_survives_a_round_trip(self):
        original = self._package()
        restored = ReplayPackage.from_json(json.loads(json.dumps(original.to_json())))

        assert restored.application_id == original.application_id
        assert restored.page_fingerprint == original.page_fingerprint
        assert restored.storage_state_path == "/data/state.json"
        assert restored.resume_artifact_path == "/data/resume.pdf"

    def test_the_answers_survive(self):
        restored = ReplayPackage.from_json(self._package().to_json())
        assert [f.value for f in restored.fields] == ["Hoan"]

    def test_manual_fields_stay_separate(self):
        """Replay must not type into them; merging the lists would lose that."""
        restored = ReplayPackage.from_json(self._package().to_json())
        assert [f.label for f in restored.manual_fields] == ["Why us?"]

    def test_locators_survive(self):
        """A package with no locators is a package that cannot replay anything."""
        restored = ReplayPackage.from_json(self._package().to_json())
        assert restored.fields[0].locators

    def test_a_restored_package_still_matches_its_form(self):
        specs = [_spec("First name", "first_name", required=True), _spec("Why us?", "why")]
        restored = ReplayPackage.from_json(self._package().to_json())
        assert check_replayable(restored, specs).can_replay

    def test_a_changed_form_stops_the_replay(self):
        """Typing stored answers into moved boxes produces a form that looks
        plausible and is wrong — the hardest error for a reviewer to catch."""
        restored = ReplayPackage.from_json(self._package().to_json())
        moved = [_spec("Given name", "first_name"), _spec("Why us?", "why")]
        assert not check_replayable(restored, moved).can_replay


# ------------------------------------------------- submission reconciliation


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        app_env="development",
        app_secret_key="reconcile-tests",
        data_dir=tmp_path / "data",
    )


@pytest.fixture
def worker(committing_db: sessionmaker[Session], settings: Settings) -> Worker:
    return Worker(
        session_factory=committing_db,
        worker_id="reconcile-test",
        registry=register_pipeline(
            Registry(), settings=settings, provider_factory=lambda _: NullProvider()
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


def make_application(db: Session, *, confirmation: dict | None = None) -> Application:
    company = db.scalars(
        select(Company).where(Company.normalized_name == "acme")
    ).first() or Company(canonical_name="Acme", normalized_name="acme")
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
        status=JobState.SELECTED,
    )
    db.add(job)
    db.flush()

    application = Application(
        job_id=job.id,
        application_url=url,
        status=ApplicationState.SUBMISSION_PENDING_CONFIRMATION,
        confirmation_data=confirmation,
    )
    db.add(application)
    db.commit()
    return application


def run(worker: Worker, db: Session, *, now: datetime) -> None:
    enqueue(
        db,
        task_type=TaskType.RECONCILE_SUBMISSION,
        dedupe_key=idempotency_key(TaskType.RECONCILE_SUBMISSION, now.isoformat()),
        run_at=now,
    )
    db.commit()
    worker.run_once(now=now)
    db.expire_all()


class TestSubmissionReconciliation:
    def test_a_clear_success_is_confirmed(self, worker: Worker, db: Session):
        application = make_application(
            db,
            confirmation={
                "url_before": "https://boards.greenhouse.io/acme/jobs/1",
                "url_after": "https://boards.greenhouse.io/acme/jobs/1/confirmation",
                "text_after": "Thank you for applying. Your application has been received.",
                "form_present_before": True,
                "form_present_after": False,
            },
        )

        run(worker, db, now=NOW)
        db.refresh(application)
        assert application.status == ApplicationState.SUBMITTED
        assert application.submitted_at is not None

    def test_navigating_away_is_not_a_submission(self, worker: Worker, db: Session):
        """URL and title both change when you simply leave a form.

        Treating that as success would produce a recruiter email about an
        application that does not exist.
        """
        application = make_application(
            db,
            confirmation={
                "url_before": "https://boards.greenhouse.io/acme/jobs/1",
                "url_after": "https://boards.greenhouse.io/acme/jobs",
                "title_before": "Apply — Acme",
                "title_after": "Careers — Acme",
                "form_present_after": True,
            },
        )

        run(worker, db, now=NOW)
        db.refresh(application)
        assert application.status == ApplicationState.SUBMISSION_PENDING_CONFIRMATION

    def test_visible_errors_veto_a_confirmation(self, worker: Worker, db: Session):
        """A rejected form re-renders and retitles, which mimics success."""
        application = make_application(
            db,
            confirmation={
                "url_before": "https://x/1",
                "url_after": "https://x/1/confirmation",
                "text_after": "Thank you for applying",
                "form_present_after": False,
                "errors_visible": True,
            },
        )

        run(worker, db, now=NOW)
        db.refresh(application)
        assert application.status != ApplicationState.SUBMITTED

    def test_no_observation_at_all_leaves_it_pending(self, worker: Worker, db: Session):
        """Ambiguity resolves to "ask", never to "submitted"."""
        application = make_application(db, confirmation=None)

        run(worker, db, now=NOW)
        db.refresh(application)
        assert application.status == ApplicationState.SUBMISSION_PENDING_CONFIRMATION

    def test_after_the_grace_period_the_user_is_asked(self, worker: Worker, db: Session):
        application = make_application(db, confirmation={})

        run(worker, db, now=NOW + timedelta(hours=3))
        db.refresh(application)
        assert application.status == ApplicationState.SUBMISSION_UNCERTAIN

    def test_a_confirmed_submission_schedules_outreach(self, worker: Worker, db: Session):
        application = make_application(
            db,
            confirmation={
                "url_before": "https://x/1",
                "url_after": "https://x/1/confirmation",
                "text_after": "Your application has been received",
                "form_present_after": False,
            },
        )

        run(worker, db, now=NOW)
        follow_ups = db.scalars(
            select(ScheduledTask).where(ScheduledTask.task_type == "SCHEDULE_OUTREACH")
        ).all()
        assert any(t.payload.get("application_id") == str(application.id) for t in follow_ups)

    def test_the_decision_is_audited(self, worker: Worker, db: Session):
        from app.db.models import AuditEvent

        application = make_application(
            db,
            confirmation={
                "url_before": "https://x/1",
                "url_after": "https://x/1/confirmation",
                "text_after": "Thank you for applying",
                "form_present_after": False,
            },
        )

        run(worker, db, now=NOW)
        event = not_none(
            db.scalars(select(AuditEvent).where(AuditEvent.entity_id == application.id)).first()
        )
        assert event.event_metadata["now"] == "SUBMITTED"
        assert event.event_metadata["method"]

    def test_the_scan_reports_what_it_examined(self, worker: Worker, db: Session):
        make_application(db, confirmation={})
        run(worker, db, now=NOW)

        task = not_none(
            db.scalars(
                select(ScheduledTask).where(ScheduledTask.task_type == "RECONCILE_SUBMISSION")
            ).first()
        )
        assert task.status == TaskStatus.SUCCEEDED
