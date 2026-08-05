"""The audit log (spec §12, §23.5).

The question this exists to answer is "why does this say SUBMITTED when I never
pressed anything". So the tests are about whether that question can be answered,
and whether answering it leaks anything §23.5 forbids.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import Application, AuditEvent, Company, Job
from app.domain.normalization import canonicalize_url, url_hash
from app.domain.states import ApplicationState, JobState
from app.services import audit
from app.web.app import create_app
from app.web.deps import get_config, get_db
from app.web.security import COOKIE_NAME, hash_password, read
from tests.helpers import not_none

pytestmark = pytest.mark.db

PASSWORD = "audit-tests-password"
NOW = datetime.now(UTC)


class TestRedaction:
    @pytest.mark.parametrize(
        "key",
        [
            "password",
            "api_key",
            "refresh_token",
            "session_cookie",
            "candidate_ssn",
            "date_of_birth",
            "street_address",
            "eeo_race",
            "gender_identity",
            "veteran_status",
            "disability_status",
            "resume_text",
        ],
    )
    def test_forbidden_values_never_reach_the_log(self, key: str):
        """§23.5. An audit row is a log with a longer memory."""
        assert audit.redact({key: "sensitive"})[key] == "[redacted]"

    def test_ordinary_values_are_kept(self):
        payload = audit.redact({"was": "CREATED", "now": "SUBMITTED", "confidence": 0.9})
        assert payload == {"was": "CREATED", "now": "SUBMITTED", "confidence": 0.9}

    def test_nested_payloads_are_redacted_too(self):
        clean = audit.redact({"detail": {"api_key": "sk-live", "count": 3}})
        assert clean["detail"]["api_key"] == "[redacted]"
        assert clean["detail"]["count"] == 3

    def test_matching_is_loose_enough_to_catch_variants(self):
        """A key called applicant_ssn must be caught by "ssn"."""
        assert audit.redact({"applicant_ssn": "x"})["applicant_ssn"] == "[redacted]"


class TestRecording:
    def test_a_transition_records_both_states(self, db: Session):
        """Reading the old value off the object would record X -> X."""
        job = _make_job(db)
        was = str(job.status)
        job.status = JobState.SCORED
        audit.transition(db, job, entity_type="job", was=was, now="SCORED")
        db.flush()

        event = not_none(db.scalars(select(AuditEvent)).first())
        assert event.event_metadata["was"] == "DISCOVERED"
        assert event.event_metadata["now"] == "SCORED"
        assert event.entity_id == job.id

    def test_the_row_commits_with_the_change_it_describes(self, db: Session):
        """An audit row for a rolled-back transaction is a record of a fiction."""
        job = _make_job(db)
        audit.transition(db, job, entity_type="job", was="DISCOVERED", now="SCORED")
        db.flush()

        assert len(db.scalars(select(AuditEvent)).all()) == 1
        assert not db.new, "the event should be flushed with the caller's work"


class TestUserDecisionsAreAttributed:
    """Months later the log has to say a person did this, not the machine."""

    def test_marking_submitted_is_recorded_as_the_user(
        self, client: TestClient, db: Session, settings: Settings
    ):
        application = _make_application(db, ApplicationState.NEEDS_ME)
        client.post(
            f"/applications/{application.id}/submitted",
            data={"csrf_token": _csrf(client, settings)},
        )

        events = db.scalars(select(AuditEvent).where(AuditEvent.entity_id == application.id)).all()
        submitted = [e for e in events if e.event_metadata.get("now") == "SUBMITTED"]
        assert submitted, [e.event_metadata for e in events]
        assert submitted[0].actor_type == "USER"
        assert submitted[0].actor_id == "hoan"
        assert submitted[0].event_metadata["method"] == "USER_CONFIRMED"

    def test_selecting_a_job_is_recorded(self, client: TestClient, db: Session, settings: Settings):
        job = _make_job(db, status=JobState.SCORED)
        client.post(f"/jobs/{job.id}/select", data={"csrf_token": _csrf(client, settings)})

        event = not_none(
            db.scalars(select(AuditEvent).where(AuditEvent.entity_id == job.id)).first()
        )
        assert event.event_metadata["now"] == "SELECTED"
        assert event.actor_type == "USER"

    def test_skipping_a_job_is_recorded(self, client: TestClient, db: Session, settings: Settings):
        job = _make_job(db)
        client.post(f"/jobs/{job.id}/skip", data={"csrf_token": _csrf(client, settings)})

        events = db.scalars(select(AuditEvent).where(AuditEvent.entity_id == job.id)).all()
        # Two hops: the job machine has no DISCOVERED -> ARCHIVED edge, so a skip
        # closes first. Both are recorded, which is what makes the history read
        # correctly later.
        assert [e.event_metadata["now"] for e in events] == ["CLOSED", "ARCHIVED"]
        assert all(e.actor_type == "USER" for e in events)

    def test_a_refused_transition_records_nothing(
        self, client: TestClient, db: Session, settings: Settings
    ):
        """The log must not contain a change that did not happen."""
        application = _make_application(db, ApplicationState.CREATED)
        response = client.post(
            f"/applications/{application.id}/submitted",
            data={"csrf_token": _csrf(client, settings)},
        )
        assert response.status_code == 400
        events = db.scalars(select(AuditEvent).where(AuditEvent.entity_id == application.id)).all()
        assert events == []


# ---------------------------------------------------------------- fixtures


def _make_job(db: Session, *, status: JobState = JobState.DISCOVERED) -> Job:
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
        status=status,
    )
    db.add(job)
    db.flush()
    return job


def _make_application(db: Session, status: ApplicationState) -> Application:
    job = _make_job(db, status=JobState.SELECTED)
    application = Application(job_id=job.id, application_url=job.canonical_url, status=status)
    db.add(application)
    db.flush()
    return application


def _csrf(client: TestClient, settings: Settings) -> str:
    return not_none(read(client.cookies.get(COOKIE_NAME), settings)).csrf_token


@pytest.fixture(scope="module")
def password_hash() -> str:
    return hash_password(PASSWORD)


@pytest.fixture
def settings(password_hash: str) -> Settings:
    return Settings(
        app_env="development",
        app_secret_key="audit-secret",
        admin_username="hoan",
        admin_password_hash=password_hash,
    )


@pytest.fixture
def client(db: Session, settings: Settings) -> Iterator[TestClient]:
    def request_session() -> Iterator[Session]:
        yield db
        db.flush()

    app: FastAPI = create_app()
    app.dependency_overrides[get_db] = request_session
    app.dependency_overrides[get_config] = lambda: settings
    app.state.settings = settings

    with TestClient(app, follow_redirects=False) as signed_in:
        signed_in.post("/login", data={"username": "hoan", "password": PASSWORD})
        yield signed_in
    app.dependency_overrides.clear()
