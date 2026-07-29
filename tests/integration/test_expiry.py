"""Prepared applications the user did not act on (spec §7.9).

The requirement is "remove it from the dashboard after 24 hours", but the thing
worth testing is the half that is easy to get wrong: *removing* it must not
remove anything. These tests assert on what survives at least as hard as on what
changes.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Application, ApplicationField, AuditEvent, Company, Job, ResumeVersion
from app.domain.normalization import canonicalize_url, url_hash
from app.domain.states import ApplicationState, JobState
from app.services.expiry import clear_deadline, due, expire_due, set_deadline

pytestmark = pytest.mark.db

NOW = datetime(2026, 7, 29, 12, 0, tzinfo=UTC)


def make_application(
    session: Session,
    *,
    status: ApplicationState = ApplicationState.READY_FOR_REVIEW,
    expires_at: datetime | None = NOW - timedelta(minutes=1),
    with_answers: bool = False,
) -> Application:
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
        status=JobState.DISCOVERED,
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
        status=status,
        application_url=url,
        ready_for_review_at=NOW - timedelta(hours=25),
        expires_at=expires_at,
    )
    session.add(application)
    session.flush()

    if with_answers:
        session.add(
            ApplicationField(
                application_id=application.id,
                semantic_key="candidate.first_name",
                question_text="First name",
                field_type="text",
                answer_json={"value": "Hoan"},
                source_type="LOCKED_FACT",
            )
        )
    session.flush()
    return application


class TestTheDeadline:
    def test_the_clock_starts_at_the_configured_ttl(self, db: Session):
        application = make_application(db, expires_at=None)
        deadline = set_deadline(application, now=NOW, ttl_hours=24)
        assert deadline == NOW + timedelta(hours=24)
        assert application.expires_at == deadline

    def test_clearing_it_means_not_waiting(self, db: Session):
        application = make_application(db)
        clear_deadline(application)
        assert application.expires_at is None
        assert due(db, now=NOW + timedelta(days=7)) == []

    def test_an_application_without_a_deadline_never_expires(self, db: Session):
        """NULL means "the machine still owns this", so a missing stamp is safe.

        The failure mode this rules out is the dangerous one: a waiting state the
        sweep does not recognise must leave the application alone, not delete it.
        """
        make_application(db, expires_at=None)
        assert expire_due(db, now=NOW + timedelta(days=365)) == []


class TestWhatExpires:
    def test_an_application_past_its_deadline_expires(self, db: Session):
        application = make_application(db)
        assert expire_due(db, now=NOW) == [application]
        assert application.status == ApplicationState.EXPIRED

    def test_one_still_inside_its_window_does_not(self, db: Session):
        application = make_application(db, expires_at=NOW + timedelta(hours=1))
        assert expire_due(db, now=NOW) == []
        assert application.status == ApplicationState.READY_FOR_REVIEW

    def test_the_boundary_belongs_to_the_user(self, db: Session):
        """At exactly the deadline it expires; a second before, it does not."""
        application = make_application(db, expires_at=NOW)
        assert expire_due(db, now=NOW - timedelta(seconds=1)) == []
        assert expire_due(db, now=NOW) == [application]

    @pytest.mark.parametrize(
        "status",
        [
            ApplicationState.READY_FOR_REVIEW,
            ApplicationState.LIVE_REVIEW_READY,
            ApplicationState.MANUAL_LOGIN_REQUIRED,
            ApplicationState.MANUAL_FIELD_REQUIRED,
        ],
    )
    def test_every_state_that_waits_for_a_person_can_expire(self, db: Session, status):
        application = make_application(db, status=status)
        assert expire_due(db, now=NOW) == [application]

    @pytest.mark.parametrize(
        "status",
        [
            ApplicationState.MATERIALS_PREPARING,
            ApplicationState.BROWSER_QUEUED,
            ApplicationState.BROWSER_FILLING,
            ApplicationState.REPLAYING,
            ApplicationState.SUBMITTED,
        ],
    )
    def test_work_the_machine_still_owns_is_never_taken_away(self, db: Session, status):
        """A stale deadline must not let the sweep interrupt a worker.

        These rows carry an expired ``expires_at`` on purpose — the status check
        is the guarantee, not the absence of a stamp.
        """
        application = make_application(db, status=status)
        assert expire_due(db, now=NOW + timedelta(days=7)) == []
        assert application.status == status

    def test_a_submitted_application_is_never_expired(self, db: Session):
        application = make_application(db, status=ApplicationState.SUBMITTED)
        expire_due(db, now=NOW + timedelta(days=30))
        assert application.status == ApplicationState.SUBMITTED


class TestNothingIsLost:
    """§7.9's real requirement. Expiry is a status change and nothing else."""

    def test_the_row_survives(self, db: Session):
        application = make_application(db)
        application_id = application.id
        expire_due(db, now=NOW)
        db.flush()
        assert db.get(Application, application_id) is not None

    def test_the_answers_and_their_provenance_survive(self, db: Session):
        application = make_application(db, with_answers=True)
        expire_due(db, now=NOW)
        db.flush()

        fields = db.scalars(
            select(ApplicationField).where(ApplicationField.application_id == application.id)
        ).all()
        assert len(fields) == 1
        assert fields[0].answer_json == {"value": "Hoan"}
        assert fields[0].source_type == "LOCKED_FACT"

    def test_the_tailored_resume_survives(self, db: Session):
        application = make_application(db)
        resume_id = application.resume_version_id
        expire_due(db, now=NOW)
        db.flush()
        assert application.resume_version_id == resume_id
        assert db.get(ResumeVersion, resume_id) is not None

    def test_the_expiry_is_written_to_the_audit_trail(self, db: Session):
        application = make_application(db)
        expire_due(db, now=NOW)
        db.flush()

        events = db.scalars(
            select(AuditEvent).where(AuditEvent.entity_id == application.id)
        ).all()
        assert events, "an expiry the audit log does not record is a silent removal"
        assert any(e.event_metadata.get("now") == "EXPIRED" for e in events)
        assert any(
            "not acted on" in str(e.event_metadata.get("reason", "")) for e in events
        )

    def test_the_audit_trail_records_where_it_came_from(self, db: Session):
        """Restoring needs to know which state to put it back into."""
        application = make_application(db, status=ApplicationState.LIVE_REVIEW_READY)
        expire_due(db, now=NOW)
        db.flush()

        events = db.scalars(
            select(AuditEvent).where(AuditEvent.entity_id == application.id)
        ).all()
        assert any(e.event_metadata.get("was") == "LIVE_REVIEW_READY" for e in events)


class TestTheDashboard:
    """"Removed from the dashboard" is half the requirement; the other half is
    that it is only the dashboard it is removed from."""

    def _dashboard(self, db: Session):
        from app.config import Settings
        from app.web.queries import dashboard

        return dashboard(
            db,
            Settings(app_env="development", app_secret_key="expiry-tests"),
            now=NOW,
        )

    def test_a_waiting_application_is_on_it(self, db: Session):
        application = make_application(db)
        db.flush()
        assert application.id in {row.id for row in self._dashboard(db).applications}

    def test_an_expired_one_is_not(self, db: Session):
        application = make_application(db)
        expire_due(db, now=NOW)
        db.flush()
        assert application.id not in {row.id for row in self._dashboard(db).applications}

    def test_but_it_is_still_in_the_database(self, db: Session):
        application = make_application(db)
        expire_due(db, now=NOW)
        db.flush()
        assert db.get(Application, application.id) is not None


class TestRestorability:
    def test_an_expired_application_can_go_back_to_the_user(self, db: Session):
        """Expiry is reversible by design.

        Via a replay, not a direct jump: the browser has to reopen the form and
        put the stored answers back, so the row cannot claim to be in a review
        state it has not actually reached.
        """
        from app.domain.states import assert_transition

        application = make_application(db)
        expire_due(db, now=NOW)
        assert (
            assert_transition(
                ApplicationState(application.status), ApplicationState.READY_FOR_REPLAY
            )
            is ApplicationState.READY_FOR_REPLAY
        )

    def test_expiring_frees_the_job_for_a_fresh_attempt(self, db: Session):
        """The partial unique index must stop counting an expired row as active."""
        application = make_application(db)
        expire_due(db, now=NOW)
        db.flush()

        replacement = Application(
            job_id=application.job_id,
            status=ApplicationState.CREATED,
            application_url=application.application_url,
        )
        db.add(replacement)
        db.flush()  # would raise IntegrityError if EXPIRED still counted as active
        assert replacement.id is not None
