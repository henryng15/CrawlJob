"""Web screens end to end (spec §22, §23.2).

Runs the real FastAPI app against the test database, with only the session
factory and settings swapped. The point of these tests is the properties the
screens must have — the login wall, CSRF, the absence of any send or submit — not
that a particular heading renders.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import (
    Application,
    ApplicationField,
    Company,
    Job,
    JobScore,
    OutreachTask,
    Recruiter,
    ResumeVersion,
    ScheduledTask,
    SponsorshipAssessment,
)
from app.domain.normalization import canonicalize_url, url_hash
from app.domain.states import ApplicationState, JobState, OutreachState
from app.web.app import create_app
from app.web.deps import get_config, get_db
from app.web.security import COOKIE_NAME, hash_password
from tests.helpers import not_none

pytestmark = pytest.mark.db

PASSWORD = "a-long-enough-test-password"
NOW = datetime(2026, 7, 28, 15, 0, tzinfo=UTC)


@pytest.fixture(scope="module")
def password_hash() -> str:
    return hash_password(PASSWORD)


@pytest.fixture
def settings(password_hash: str) -> Settings:
    return Settings(
        app_env="development",
        app_secret_key="web-test-secret",
        admin_username="hoan",
        admin_password_hash=password_hash,
    )


@pytest.fixture
def web(db: Session, settings: Settings) -> Iterator[FastAPI]:
    def request_session() -> Iterator[Session]:
        """The request's session, flushed but never committed.

        Committing would defeat the rollback the ``db`` fixture relies on;
        *not* flushing would leave the handler's writes pending, so a
        ``db.refresh()`` in the test would read the old row back and the
        assertion would be about the fixture rather than the code.
        """
        yield db
        db.flush()

    application = create_app()
    application.dependency_overrides[get_db] = request_session
    application.dependency_overrides[get_config] = lambda: settings
    # The cookie-refresh middleware reads settings from app.state; leaving the
    # real ones here would re-sign each response with a different secret.
    application.state.settings = settings
    yield application
    application.dependency_overrides.clear()


@pytest.fixture
def client(web: FastAPI) -> Iterator[TestClient]:
    with TestClient(web, follow_redirects=False) as c:
        yield c


@pytest.fixture
def signed_in(client: TestClient) -> TestClient:
    response = client.post("/login", data={"username": "hoan", "password": PASSWORD})
    assert response.status_code == 303, response.text
    return client


def all_paths(app: FastAPI) -> set[str]:
    """Every registered path, including those inside included routers.

    FastAPI stores included routers as wrapper objects rather than flattening
    them, so a naive ``app.routes`` walk sees four entries for a thirty-route
    application.
    """
    found: set[str] = set()
    pending: list[object] = list(app.routes)
    while pending:
        item = pending.pop()
        path = getattr(item, "path", None)
        if isinstance(path, str):
            found.add(path)
        for attribute in ("routes", "original_router"):
            nested = getattr(item, attribute, None)
            if isinstance(nested, list):
                pending.extend(nested)
            elif nested is not None:
                pending.append(nested)
    return found


def csrf(client: TestClient, settings: Settings) -> str:
    from app.web.security import read

    session = not_none(read(client.cookies.get(COOKIE_NAME), settings))
    return session.csrf_token


def _gmail_step(body: str) -> str:
    """The status word the setup screen prints against "Connect Gmail"."""
    import re

    marker = body.index("Connect Gmail")
    after = re.sub(r"<[^>]+>", " ", body[marker : marker + 600])
    for word in after.split():
        if word in {"done", "needed", "optional"}:
            return word
    raise AssertionError("no status found next to the Gmail step")


# ----------------------------------------------------------------- fixtures


def make_job(db: Session, *, title: str = "Software Engineer Intern", **kw: object) -> Job:
    company = db.query(Company).filter_by(normalized_name="acme").first() or Company(
        canonical_name="Acme Inc", normalized_name="acme"
    )
    db.add(company)
    db.flush()
    url = f"https://boards.greenhouse.io/acme/jobs/{uuid.uuid4().hex[:8]}"
    defaults: dict[str, object] = {
        "company_id": company.id,
        "canonical_url": canonicalize_url(url),
        "canonical_url_hash": url_hash(url),
        "title": title,
        "normalized_title": title.lower(),
        "dedupe_fingerprint": uuid.uuid4().hex,
        "discovered_at": NOW,
        "status": JobState.SCORED,
        "description_text": "We build things. Python and FastAPI.",
    }
    job = Job(**{**defaults, **kw})
    db.add(job)
    db.flush()
    return job


def make_application(db: Session, job: Job, status: ApplicationState) -> Application:
    application = Application(
        job_id=job.id, application_url=job.canonical_url, status=status
    )
    db.add(application)
    db.flush()
    return application


# ------------------------------------------------------------------- tests


class TestLoginWall:
    @pytest.mark.parametrize(
        "path", ["/", "/today", "/jobs", "/applications", "/outreach", "/settings"]
    )
    def test_every_screen_redirects_when_signed_out(self, client: TestClient, path: str):
        response = client.get(path)
        assert response.status_code == 303
        assert response.headers["location"].startswith("/login")

    def test_the_redirect_remembers_where_you_were_going(self, client: TestClient):
        response = client.get("/applications")
        assert "next=/applications" in response.headers["location"]

    def test_a_correct_password_signs_you_in(self, client: TestClient):
        response = client.post("/login", data={"username": "hoan", "password": PASSWORD})
        assert response.status_code == 303
        assert COOKIE_NAME in response.cookies

    def test_a_wrong_password_does_not(self, client: TestClient):
        response = client.post("/login", data={"username": "hoan", "password": "nope"})
        assert response.status_code == 401
        assert COOKIE_NAME not in response.cookies

    def test_the_error_does_not_say_which_half_was_wrong(self, client: TestClient):
        body = client.post("/login", data={"username": "nobody", "password": "nope"}).text
        assert "Incorrect username or password" in body
        assert "unknown user" not in body.lower()

    def test_the_cookie_is_httponly_samesite_strict(self, client: TestClient):
        response = client.post("/login", data={"username": "hoan", "password": PASSWORD})
        cookie = response.headers["set-cookie"]
        assert "HttpOnly" in cookie
        assert "SameSite=strict" in cookie.replace("Strict", "strict")

    def test_a_forged_cookie_does_not_authenticate(self, client: TestClient):
        client.cookies.set(COOKIE_NAME, "made.up.value")
        response = client.get("/")
        assert response.status_code == 303
        assert response.headers["location"].startswith("/login")

    def test_signing_out_clears_the_cookie(self, signed_in: TestClient, settings: Settings):
        response = signed_in.post("/logout", data={"csrf_token": csrf(signed_in, settings)})
        assert response.status_code == 303
        assert 'internship_ops_session=""' in response.headers["set-cookie"]

    def test_next_cannot_point_off_site(self, client: TestClient):
        """Otherwise a mailed login link lands the user on someone else's page."""
        response = client.post(
            "/login",
            data={"username": "hoan", "password": PASSWORD, "next": "//evil.example.com"},
        )
        assert response.headers["location"] == "/"


class TestCsrfProtection:
    def test_a_post_without_a_token_is_refused(self, signed_in: TestClient, db: Session):
        job = make_job(db)
        response = signed_in.post(f"/jobs/{job.id}/skip")
        assert response.status_code == 403

    def test_a_post_with_the_wrong_token_is_refused(self, signed_in: TestClient, db: Session):
        job = make_job(db)
        response = signed_in.post(
            f"/jobs/{job.id}/skip", data={"csrf_token": "borrowed-from-nowhere"}
        )
        assert response.status_code == 403

    def test_a_post_with_the_right_token_succeeds(
        self, signed_in: TestClient, db: Session, settings: Settings
    ):
        job = make_job(db)
        response = signed_in.post(
            f"/jobs/{job.id}/skip", data={"csrf_token": csrf(signed_in, settings)}
        )
        assert response.status_code == 303
        assert job.status == JobState.ARCHIVED


class TestDashboard:
    def test_it_renders_with_an_empty_database(self, signed_in: TestClient):
        response = signed_in.get("/")
        assert response.status_code == 200
        assert "Dashboard" in response.text

    def test_a_job_discovered_today_appears(self, signed_in: TestClient, db: Session):
        make_job(db, title="Backend Intern", discovered_at=datetime.now(UTC))
        assert "Backend Intern" in signed_in.get("/").text

    def test_a_job_from_last_week_does_not(self, signed_in: TestClient, db: Session):
        make_job(
            db,
            title="Ancient Posting",
            discovered_at=datetime.now(UTC) - timedelta(days=7),
            status=JobState.DISCOVERED,
        )
        body = signed_in.get("/").text
        # It is absent from "discovered today"; it may still be reachable via /jobs.
        assert "Ancient Posting" not in body.split("Discovered today")[1]

    def test_an_application_waiting_on_a_person_is_surfaced(
        self, signed_in: TestClient, db: Session
    ):
        make_application(db, make_job(db, title="Needs You"), ApplicationState.READY_FOR_REVIEW)
        assert "Needs You" in signed_in.get("/").text

    def test_the_badge_counts_what_is_waiting(self, signed_in: TestClient, db: Session):
        make_application(db, make_job(db), ApplicationState.READY_FOR_REVIEW)
        assert "waiting on you" in signed_in.get("/").text


class TestTodayRun:
    """§22.1: today's run, separated from the whole history."""

    def test_it_renders_with_an_empty_database(self, signed_in: TestClient):
        response = signed_in.get("/today")
        assert response.status_code == 200

    def test_it_shows_the_daily_quota_and_the_run_times(
        self, signed_in: TestClient, settings: Settings
    ):
        body = signed_in.get("/today").text
        assert f"/ {settings.max_prepared_applications_per_day}" in body
        assert "08:00" in body and "14:00" in body

    def test_it_shows_the_live_slot_cap(self, signed_in: TestClient, settings: Settings):
        assert f"of {settings.max_live_sessions}" in signed_in.get("/today").text

    def test_an_application_waiting_on_a_person_is_surfaced(
        self, signed_in: TestClient, db: Session
    ):
        make_application(db, make_job(db, title="Needs You"), ApplicationState.READY_FOR_REVIEW)
        assert "Needs You" in signed_in.get("/today").text

    def test_an_expired_application_is_not_in_the_waiting_list(
        self, signed_in: TestClient, db: Session
    ):
        """It lapsed. Today's screen is for what is still actionable."""
        application = make_application(
            db, make_job(db, title="Lapsed Role"), ApplicationState.READY_FOR_REVIEW
        )
        application.status = ApplicationState.EXPIRED
        db.flush()
        body = signed_in.get("/today").text
        assert "Lapsed Role" not in body.split("Waiting on you")[1].split("Prepared today")[0]


class TestAllApplications:
    """§7.9: the complete record, and the only place a restore is offered."""

    def test_it_lists_every_state_including_the_closed_ones(
        self, signed_in: TestClient, db: Session
    ):
        for title, status in [
            ("Was Submitted", ApplicationState.SUBMITTED),
            ("Was Skipped", ApplicationState.SKIPPED),
            ("Did Fail", ApplicationState.FAILED),
            ("Has Lapsed", ApplicationState.EXPIRED),
            ("Still Waiting", ApplicationState.READY_FOR_REVIEW),
        ]:
            make_application(db, make_job(db, title=title), status)
        body = signed_in.get("/applications").text
        for title in ("Was Submitted", "Was Skipped", "Did Fail", "Has Lapsed", "Still Waiting"):
            assert title in body, f"{title} is missing from the complete record"

    def test_an_expired_application_offers_restore(self, signed_in: TestClient, db: Session):
        application = make_application(db, make_job(db), ApplicationState.EXPIRED)
        body = signed_in.get("/applications").text
        assert f"/applications/{application.id}/restore" in body

    def test_a_live_application_does_not_offer_restore(
        self, signed_in: TestClient, db: Session
    ):
        application = make_application(db, make_job(db), ApplicationState.READY_FOR_REVIEW)
        body = signed_in.get("/applications").text
        assert f"/applications/{application.id}/restore" not in body

    def test_restore_is_not_offered_on_today(self, signed_in: TestClient, db: Session):
        """The requirement is specific: restoring happens from All Applications."""
        make_application(db, make_job(db), ApplicationState.EXPIRED)
        assert "/restore" not in signed_in.get("/today").text

    def test_a_blocked_restore_shows_its_reason(self, signed_in: TestClient, db: Session):
        application = make_application(db, make_job(db), ApplicationState.EXPIRED)
        application.status = ApplicationState.RESTORE_BLOCKED
        application.restore_blocked_reason = "the posting has closed"
        db.flush()
        assert "the posting has closed" in signed_in.get("/applications").text

    def test_a_restored_application_is_marked_as_such(
        self, signed_in: TestClient, db: Session
    ):
        application = make_application(db, make_job(db), ApplicationState.READY_FOR_REVIEW)
        application.restored_at = datetime.now(UTC)
        db.flush()
        assert "restored" in signed_in.get("/applications").text

    def test_it_can_be_filtered_by_status(self, signed_in: TestClient, db: Session):
        make_application(db, make_job(db, title="Lapsed One"), ApplicationState.EXPIRED)
        make_application(db, make_job(db, title="Live One"), ApplicationState.READY_FOR_REVIEW)
        body = signed_in.get("/applications?status=EXPIRED").text
        assert "Lapsed One" in body
        assert "Live One" not in body


class TestRestoreRoute:
    def test_restoring_queues_the_work_rather_than_doing_it(
        self, signed_in: TestClient, db: Session, settings: Settings
    ):
        """A browser slot may be busy; the page has to return either way."""
        application = make_application(db, make_job(db), ApplicationState.EXPIRED)
        response = signed_in.post(
            f"/applications/{application.id}/restore",
            data={"csrf_token": csrf(signed_in, settings)},
        )
        assert response.status_code == 303
        db.refresh(application)
        assert application.status == ApplicationState.EXPIRED

        queued = db.query(ScheduledTask).filter_by(task_type="RESTORE_APPLICATION").all()
        assert len(queued) == 1
        assert queued[0].payload["application_id"] == str(application.id)

    def test_restoring_something_that_did_not_expire_is_refused(
        self, signed_in: TestClient, db: Session, settings: Settings
    ):
        application = make_application(db, make_job(db), ApplicationState.SUBMITTED)
        response = signed_in.post(
            f"/applications/{application.id}/restore",
            data={"csrf_token": csrf(signed_in, settings)},
        )
        assert response.status_code == 409
        assert db.query(ScheduledTask).filter_by(task_type="RESTORE_APPLICATION").count() == 0

    def test_restoring_without_a_csrf_token_is_refused(
        self, signed_in: TestClient, db: Session
    ):
        application = make_application(db, make_job(db), ApplicationState.EXPIRED)
        response = signed_in.post(f"/applications/{application.id}/restore", data={})
        assert response.status_code == 403
        assert db.query(ScheduledTask).filter_by(task_type="RESTORE_APPLICATION").count() == 0


class TestJobReview:
    def test_the_page_shows_the_description_and_score(self, signed_in: TestClient, db: Session):
        job = make_job(db)
        db.add(
            JobScore(
                job_id=job.id,
                total_score=81.5,
                components={"title_match": 20, "tech_overlap": 15},
                hard_filter_result="PASS",
            )
        )
        db.flush()

        body = signed_in.get(f"/jobs/{job.id}").text
        assert "81.5" in body
        assert "Python and FastAPI" in body
        assert "title match" in body

    def test_sponsorship_evidence_is_quoted(self, signed_in: TestClient, db: Session):
        job = make_job(db)
        db.add(
            SponsorshipAssessment(
                job_id=job.id,
                classification="NO_SPONSORSHIP",
                work_authorization_restriction="US_CITIZEN_ONLY",
                evidence=[{"quote": "Must be a US citizen", "source_url": job.canonical_url}],
                confidence=0.95,
                recommended_action="SKIP",
            )
        )
        db.flush()

        body = signed_in.get(f"/jobs/{job.id}").text
        assert "Must be a US citizen" in body

    def test_a_job_the_employer_rules_out_cannot_be_selected(
        self, signed_in: TestClient, db: Session, settings: Settings
    ):
        job = make_job(db)
        db.add(
            SponsorshipAssessment(
                job_id=job.id,
                classification="NO_SPONSORSHIP",
                work_authorization_restriction="US_CITIZEN_ONLY",
                evidence=[{"quote": "US citizens only", "source_url": job.canonical_url}],
                confidence=0.95,
                recommended_action="SKIP",
            )
        )
        db.flush()

        assert "disabled" in signed_in.get(f"/jobs/{job.id}").text
        refused = signed_in.post(
            f"/jobs/{job.id}/select", data={"csrf_token": csrf(signed_in, settings)}
        )
        assert refused.status_code == 400

    def test_selecting_creates_an_application_and_queues_the_work(
        self, signed_in: TestClient, db: Session, settings: Settings
    ):
        job = make_job(db)
        response = signed_in.post(
            f"/jobs/{job.id}/select", data={"csrf_token": csrf(signed_in, settings)}
        )
        assert response.status_code == 303

        application = not_none(db.query(Application).filter_by(job_id=job.id).first())
        assert application.status == ApplicationState.CREATED
        assert job.status == JobState.SELECTED
        # Tailoring first: it produces the resume the form needs, and hands off
        # to a browser slot when it succeeds.
        queued = db.query(ScheduledTask).all()
        assert [t.task_type for t in queued] == ["TAILOR_RESUME"]

    def test_the_company_cap_blocks_a_second_selection(
        self, signed_in: TestClient, db: Session, settings: Settings
    ):
        """§16.3: two live applications at one employer is the limit."""
        for _ in range(settings.max_active_applications_per_company):
            make_application(db, make_job(db), ApplicationState.MATERIALS_READY)

        job = make_job(db)
        response = signed_in.post(
            f"/jobs/{job.id}/select", data={"csrf_token": csrf(signed_in, settings)}
        )
        assert response.status_code == 400
        assert "active application" in response.text

    def test_an_unknown_job_is_a_404(self, signed_in: TestClient):
        assert signed_in.get(f"/jobs/{uuid.uuid4()}").status_code == 404


class TestApplicationReview:
    def test_every_answer_shows_its_source(self, signed_in: TestClient, db: Session):
        application = make_application(db, make_job(db), ApplicationState.READY_FOR_REVIEW)
        db.add(
            ApplicationField(
                application_id=application.id,
                semantic_key="candidate.first_name",
                question_text="First name",
                field_type="TEXT",
                answer_json={"value": "Hoan"},
                source_type="LOCKED_FACT",
                source_fact_ids=["candidate.legal_name"],
            )
        )
        db.flush()

        body = signed_in.get(f"/applications/{application.id}").text
        assert "LOCKED_FACT" in body
        assert "candidate.legal_name" in body

    def test_a_restricted_answer_is_not_rendered(self, signed_in: TestClient, db: Session):
        """§23.5: demographic answers are stored, never displayed back."""
        application = make_application(db, make_job(db), ApplicationState.READY_FOR_REVIEW)
        db.add(
            ApplicationField(
                application_id=application.id,
                semantic_key="eeo.race",
                question_text="Race/ethnicity",
                field_type="SELECT",
                answer_json={"value": "Decline to self-identify"},
                source_type="LOCKED_FACT",
            )
        )
        db.flush()

        body = signed_in.get(f"/applications/{application.id}").text
        assert "Decline to self-identify" not in body
        assert "stored, not displayed" in body

    def test_the_page_says_it_will_not_submit(self, signed_in: TestClient, db: Session):
        application = make_application(db, make_job(db), ApplicationState.READY_FOR_REVIEW)
        assert "never presses Submit" in signed_in.get(f"/applications/{application.id}").text

    def test_answering_a_manual_field_marks_it_as_yours(
        self, signed_in: TestClient, db: Session, settings: Settings
    ):
        application = make_application(db, make_job(db), ApplicationState.MANUAL_FIELD_REQUIRED)
        field = ApplicationField(
            application_id=application.id,
            semantic_key="work_authorization.requires_sponsorship",
            question_text="Will you require sponsorship?",
            field_type="SELECT",
            source_type="MANUAL_REQUIRED",
            manual_required=True,
            required=True,
        )
        db.add(field)
        db.flush()

        response = signed_in.post(
            f"/applications/{application.id}/answers",
            data={"csrf_token": csrf(signed_in, settings), f"field:{field.id}": "Yes"},
        )
        assert response.status_code == 303
        db.refresh(field)
        assert field.answer_json == {"value": "Yes"}
        assert field.source_type == "USER_OVERRIDE"
        assert field.user_overridden is True

    def test_answering_the_last_manual_field_readies_the_application(
        self, signed_in: TestClient, db: Session, settings: Settings
    ):
        application = make_application(db, make_job(db), ApplicationState.MANUAL_FIELD_REQUIRED)
        field = ApplicationField(
            application_id=application.id,
            question_text="Why us?",
            field_type="TEXTAREA",
            source_type="MANUAL_REQUIRED",
            manual_required=True,
        )
        db.add(field)
        db.flush()

        signed_in.post(
            f"/applications/{application.id}/answers",
            data={"csrf_token": csrf(signed_in, settings), f"field:{field.id}": "Because."},
        )
        db.refresh(application)
        assert application.status == ApplicationState.READY_FOR_REVIEW

    def test_marking_submitted_records_the_user_as_the_actor(
        self, signed_in: TestClient, db: Session, settings: Settings
    ):
        application = make_application(db, make_job(db), ApplicationState.READY_FOR_REVIEW)
        response = signed_in.post(
            f"/applications/{application.id}/submitted",
            data={"csrf_token": csrf(signed_in, settings)},
        )
        assert response.status_code == 303
        db.refresh(application)
        assert application.status == ApplicationState.SUBMITTED
        assert application.submission_detection_method == "USER_CONFIRMED"

    def test_marking_submitted_schedules_outreach(
        self, signed_in: TestClient, db: Session, settings: Settings
    ):
        application = make_application(db, make_job(db), ApplicationState.READY_FOR_REVIEW)
        signed_in.post(
            f"/applications/{application.id}/submitted",
            data={"csrf_token": csrf(signed_in, settings)},
        )
        assert db.query(ScheduledTask).filter_by(task_type="SCHEDULE_OUTREACH").count() == 1

    def test_marking_submitted_from_a_state_that_cannot_reach_it_is_refused(
        self, signed_in: TestClient, db: Session, settings: Settings
    ):
        """A stale page must not push a row through an impossible transition."""
        application = make_application(db, make_job(db), ApplicationState.CREATED)
        response = signed_in.post(
            f"/applications/{application.id}/submitted",
            data={"csrf_token": csrf(signed_in, settings)},
        )
        assert response.status_code == 400
        db.refresh(application)
        assert application.status == ApplicationState.CREATED


class TestOutreachReview:
    def _task(self, db: Session, **kw: object) -> OutreachTask:
        application = make_application(db, make_job(db), ApplicationState.SUBMITTED)
        defaults: dict[str, object] = {
            "application_id": application.id,
            "status": OutreachState.READY_FOR_REVIEW,
            "due_at": NOW,
            "subject": "Following up on my application",
            "body": "Hello.",
        }
        task = OutreachTask(**{**defaults, **kw})
        db.add(task)
        db.flush()
        return task

    def test_the_page_states_that_nothing_is_sent(self, signed_in: TestClient, db: Session):
        task = self._task(db)
        body = " ".join(signed_in.get(f"/outreach/{task.id}").text.split())
        assert "Sending is yours alone" in body
        assert "has no send scope" in body

    def test_the_app_exposes_no_send_route(self, web: FastAPI):
        """§29: the absence of a send action is a property, not a habit.

        Asserted over the route table rather than by probing URLs, because a
        probe only rules out the paths someone thought to guess.
        """
        paths = all_paths(web)
        # An empty walk would make the real assertion below pass for the wrong
        # reason; FastAPI nests included routers, and it did exactly that once.
        assert "/outreach/{task_id}" in paths
        assert not [p for p in paths if "send" in p.lower()]

    def test_a_hook_without_a_source_is_flagged(self, signed_in: TestClient, db: Session):
        task = self._task(db, hook_json={"hook": "I loved your talk", "hook_type": "TALK"})
        body = signed_in.get(f"/outreach/{task.id}").text
        assert "falls back to a plain version" in body

    def test_changing_the_recruiter_sticks(
        self, signed_in: TestClient, db: Session, settings: Settings
    ):
        task = self._task(db)
        company = not_none(db.query(Company).filter_by(normalized_name="acme").first())
        recruiter = Recruiter(
            full_name="Alice Nguyen",
            raw_company="Acme Inc",
            email="alice@acme.com",
            company_id=company.id,
        )
        db.add(recruiter)
        db.flush()

        response = signed_in.post(
            f"/outreach/{task.id}/recruiter",
            data={"csrf_token": csrf(signed_in, settings), "recruiter_id": str(recruiter.id)},
        )
        assert response.status_code == 303
        db.refresh(task)
        assert task.recruiter_id == recruiter.id

    def test_a_suppressed_recruiter_cannot_be_chosen(
        self, signed_in: TestClient, db: Session, settings: Settings
    ):
        task = self._task(db)
        recruiter = Recruiter(
            full_name="Bob Optout",
            raw_company="Acme Inc",
            email="bob@acme.com",
            do_not_contact=True,
        )
        db.add(recruiter)
        db.flush()

        response = signed_in.post(
            f"/outreach/{task.id}/recruiter",
            data={"csrf_token": csrf(signed_in, settings), "recruiter_id": str(recruiter.id)},
        )
        assert response.status_code == 400

    def test_suppressing_is_permanent_and_recorded(
        self, signed_in: TestClient, db: Session, settings: Settings
    ):
        from app.db.models import SuppressionEntry

        task = self._task(db)
        recruiter = Recruiter(
            full_name="Carol", raw_company="Acme Inc", email="carol@acme.com"
        )
        db.add(recruiter)
        db.flush()
        task.recruiter_id = recruiter.id
        db.flush()

        response = signed_in.post(
            f"/outreach/{task.id}/suppress", data={"csrf_token": csrf(signed_in, settings)}
        )
        assert response.status_code == 303
        db.refresh(recruiter)
        assert recruiter.do_not_contact is True
        assert db.query(SuppressionEntry).filter_by(email="carol@acme.com").count() == 1

    def test_saving_a_draft_that_still_has_a_placeholder_is_refused(
        self, signed_in: TestClient, db: Session, settings: Settings
    ):
        task = self._task(db)
        response = signed_in.post(
            f"/outreach/{task.id}/draft",
            data={
                "csrf_token": csrf(signed_in, settings),
                "subject": "Hello {{first_name}}",
                "body": "Hi there.",
            },
        )
        assert response.status_code == 400


class TestResumeVersions:
    """§7.7: the screen that answers "why is this the PDF that went out"."""

    def _version(self, db: Session, application, **kw) -> ResumeVersion:
        from app.db.models import ResumeVersion as RV

        defaults: dict = {
            "application_id": application.id,
            "job_id": application.job_id,
            "kind": "TAILORED",
            "status": "READY_FOR_REVIEW",
            "attempt": 1,
            "source_path": "/artifacts/r.tex",
            "pdf_path": "/artifacts/r.pdf",
            "sha256": "a" * 64,
            "tex_sha256": "b" * 64,
            "page_count": 1,
            "model_name": "claude-sonnet-5",
            "prompt_version": "resume/v1",
            "facts_used": ["f1"],
            # Selected by the build. Uploading is a separate fact set by the
            # browser, so a version is not "uploaded" just because it exists.
            "is_selected": True,
        }
        version = RV(**{**defaults, **kw})
        db.add(version)
        db.flush()
        return version

    def test_the_page_renders_with_nothing_built(self, signed_in: TestClient):
        response = signed_in.get("/resumes")
        assert response.status_code == 200
        assert "Resume versions" in response.text

    def test_versions_are_grouped_under_their_application(
        self, signed_in: TestClient, db: Session
    ):
        application = make_application(
            db, make_job(db, title="Backend Intern"), ApplicationState.READY_FOR_REVIEW
        )
        self._version(db, application)
        body = signed_in.get("/resumes").text
        assert "Backend Intern" in body

    def test_every_attempt_is_listed_including_the_failures(
        self, signed_in: TestClient, db: Session
    ):
        """The attempts that did not qualify are the answer to "why that one"."""
        application = make_application(db, make_job(db), ApplicationState.READY_FOR_REVIEW)
        self._version(db, application, attempt=1, page_count=2, status="REJECTED",
                      is_selected=False)
        self._version(db, application, attempt=2, page_count=2, status="REJECTED",
                      is_selected=False)
        self._version(db, application, attempt=3, page_count=1, is_selected=True)

        body = signed_in.get("/resumes").text
        assert body.count("#1") >= 1
        assert body.count("#2") >= 1
        assert body.count("#3") >= 1

    def test_a_version_that_was_only_selected_is_not_called_uploaded(
        self, signed_in: TestClient, db: Session
    ):
        """The distinction the screen exists to show.

        A prepared application whose browser slot died has a perfectly good PDF
        that no employer has seen. Calling that "uploaded" would describe the
        failure as finished.
        """
        application = make_application(db, make_job(db), ApplicationState.READY_FOR_REVIEW)
        self._version(db, application)
        body = signed_in.get("/resumes").text
        assert ">selected<" in body
        assert "not yet attached to the form" in body

    def test_a_version_the_browser_attached_is_marked_uploaded(
        self, signed_in: TestClient, db: Session
    ):
        from datetime import UTC, datetime

        application = make_application(db, make_job(db), ApplicationState.READY_FOR_REVIEW)
        self._version(
            db, application, is_uploaded=True, uploaded_at=datetime.now(UTC)
        )
        assert ">uploaded<" in signed_in.get("/resumes").text

    def test_a_fallback_shows_its_reason(self, signed_in: TestClient, db: Session):
        application = make_application(db, make_job(db), ApplicationState.READY_FOR_REVIEW)
        self._version(
            db,
            application,
            kind="BASE",
            attempt=0,
            fallback_reason="3 attempts did not produce a one-page PDF",
        )
        body = signed_in.get("/resumes").text
        assert "did not produce a one-page PDF" in body
        assert "used the base resume" in body

    def test_page_count_model_and_hashes_are_shown(
        self, signed_in: TestClient, db: Session
    ):
        application = make_application(db, make_job(db), ApplicationState.READY_FOR_REVIEW)
        version = self._version(db, application)
        body = signed_in.get("/resumes").text

        assert "claude-sonnet-5" in body
        assert "resume/v1" in body
        assert version.sha256[:12] in body
        assert version.tex_sha256[:12] in body
        assert "1 fact(s) cited" in body

    def test_a_two_page_attempt_is_flagged(self, signed_in: TestClient, db: Session):
        application = make_application(db, make_job(db), ApplicationState.READY_FOR_REVIEW)
        self._version(db, application, page_count=2, is_selected=False)
        assert 'class="tag bad">2<' in signed_in.get("/resumes").text

    def test_there_is_an_inline_preview(self, signed_in: TestClient, db: Session):
        application = make_application(db, make_job(db), ApplicationState.READY_FOR_REVIEW)
        version = self._version(db, application)
        assert f"/resumes/{version.id}/view" in signed_in.get("/resumes").text

    def test_open_and_download_are_both_offered(self, signed_in: TestClient, db: Session):
        application = make_application(db, make_job(db), ApplicationState.READY_FOR_REVIEW)
        version = self._version(db, application)
        body = signed_in.get("/resumes").text
        assert f"/resumes/{version.id}/view" in body
        assert f"/resumes/{version.id}/download" in body
        assert f"/resumes/{version.id}/source" in body


class TestResumeArtifactAccess:
    def test_an_artifact_outside_the_root_is_refused(
        self, signed_in: TestClient, db: Session
    ):
        """A database row is not a capability.

        The path comes from the database; confining it to the artifacts
        directory means a bad or tampered row cannot read /etc/passwd.
        """
        from app.db.models import ResumeVersion as RV

        application = make_application(db, make_job(db), ApplicationState.READY_FOR_REVIEW)
        version = RV(
            application_id=application.id,
            job_id=application.job_id,
            kind="TAILORED",
            status="READY_FOR_REVIEW",
            source_path="/etc/passwd",
            pdf_path="/etc/passwd",
            log_path="/etc/passwd",
            sha256="c" * 64,
        )
        db.add(version)
        db.flush()

        for suffix in ("view", "download", "source", "log"):
            assert signed_in.get(f"/resumes/{version.id}/{suffix}").status_code == 404

    def test_the_base_resume_is_offered_when_configured(self, signed_in: TestClient):
        """Configured or not, the page must render rather than error."""
        response = signed_in.get("/resumes")
        assert response.status_code == 200
        assert "Base resume" in response.text


class TestSettings:
    def test_the_kill_switches_are_shown_as_disabled(self, signed_in: TestClient):
        body = signed_in.get("/settings").text
        assert body.count("disabled") >= 4

    def test_the_gmail_scopes_exclude_send(self, signed_in: TestClient):
        body = signed_in.get("/settings").text
        assert "compose" in body
        assert "gmail.send" not in body

    def test_a_restricted_fact_is_not_rendered(self, signed_in: TestClient, db: Session):
        from app.services.candidate import Actor, set_fact

        set_fact(db, "candidate.legal_name", "Hoan Nguyen", actor=Actor.USER)
        db.flush()

        body = signed_in.get("/settings").text
        assert "Hoan Nguyen" not in body
        assert "stored, not displayed" in body

    def test_a_public_fact_is_rendered(self, signed_in: TestClient, db: Session):
        from app.services.candidate import Actor, set_fact

        set_fact(db, "candidate.github", "github.com/henryng15", actor=Actor.USER)
        db.flush()
        assert "github.com/henryng15" in signed_in.get("/settings").text


class TestHealth:
    def test_liveness_needs_no_login(self, client: TestClient):
        assert client.get("/health/live").json() == {"status": "ok"}

    def test_readiness_reports_the_kill_switches(self, client: TestClient):
        payload = client.get("/health/ready").json()
        assert payload["auto_submit_enabled"] is False
        assert payload["auto_send_email_enabled"] is False

    def test_the_queue_endpoint_counts_tasks(self, client: TestClient):
        assert "pending" in client.get("/health/queue").json()

    def test_health_leaks_no_job_or_person(self, client: TestClient, db: Session):
        make_job(db, title="Secret Role At Acme")
        for path in ("/health/live", "/health/ready", "/health/queue"):
            assert "Secret Role" not in client.get(path).text


class TestSecurityHeaders:
    def test_a_content_security_policy_is_sent(self, signed_in: TestClient):
        headers = signed_in.get("/").headers
        assert "script-src 'self'" in headers["content-security-policy"]

    def test_pages_are_not_cached(self, signed_in: TestClient):
        assert signed_in.get("/").headers["cache-control"] == "no-store"

    def test_framing_is_refused(self, signed_in: TestClient):
        assert signed_in.get("/").headers["x-frame-options"] == "DENY"

    def test_a_job_description_cannot_inject_script(self, signed_in: TestClient, db: Session):
        """Descriptions come from the open web; they are text, not markup."""
        job = make_job(db, description_text="<script>alert('xss')</script>")
        body = signed_in.get(f"/jobs/{job.id}").text
        assert "<script>alert" not in body
        assert "&lt;script&gt;" in body


class TestSetup:
    """The page that tells you why the dashboard is empty (§22.6)."""

    def test_a_fresh_install_lists_what_is_missing(self, signed_in: TestClient):
        body = signed_in.get("/setup").text
        assert "Watch a job board" in body
        assert "Import your resume" in body
        assert body.count("needed") >= 2

    def test_an_unreadable_gmail_token_directory_is_not_a_crash(
        self, signed_in: TestClient, settings: Settings, tmp_path: Path
    ):
        """In production the secrets directory belongs to another user.

        The web container mounts it only to ask whether the token has arrived.
        ``Path.exists()`` re-raises PermissionError rather than answering, and
        this whole page returned 500 on the instance because of it. Being shut
        out of the directory is an answer — no — not an error.
        """
        secrets_dir = tmp_path / "secrets"
        secrets_dir.mkdir(mode=0o700)
        previous = settings.gmail_token_path
        # Settings is frozen, which is the point of it everywhere but here.
        object.__setattr__(settings, "gmail_token_path", secrets_dir / "gmail_token.enc")
        secrets_dir.chmod(0o000)
        try:
            response = signed_in.get("/setup")
        finally:
            secrets_dir.chmod(0o700)
            object.__setattr__(settings, "gmail_token_path", previous)

        assert response.status_code == 200
        assert "Connect Gmail" in response.text

    def test_a_gmail_token_the_worker_cannot_read_is_not_done(
        self, signed_in: TestClient, settings: Settings, tmp_path: Path
    ):
        """The exact shape of the production failure.

        push-gmail.sh installed the token owned by the account that delivered it
        rather than the uid the containers run as. The file was there, so the
        screen ticked the box, while the worker got PermissionError on every
        draft. A tick that survives an unusable credential is worse than no tick
        at all — it sends you looking anywhere but here.
        """
        token = tmp_path / "gmail_token.enc"
        token.write_bytes(b"encrypted")
        object.__setattr__(settings, "gmail_token_path", token)

        assert "Connect Gmail" in signed_in.get("/setup").text
        readable = _gmail_step(signed_in.get("/setup").text)

        token.chmod(0o000)
        try:
            unreadable = _gmail_step(signed_in.get("/setup").text)
        finally:
            token.chmod(0o600)

        assert readable == "done"
        assert unreadable != "done"

    def test_adding_a_board_marks_the_step_done(
        self, signed_in: TestClient, db: Session, settings: Settings
    ):
        response = signed_in.post(
            "/settings/sources",
            data={
                "csrf_token": csrf(signed_in, settings),
                "kind": "greenhouse",
                "identifier": "stripe",
            },
        )
        assert response.status_code == 303
        assert "stripe" in signed_in.get("/settings").text

    def test_an_unknown_source_kind_is_refused(
        self, signed_in: TestClient, settings: Settings
    ):
        response = signed_in.post(
            "/settings/sources",
            data={
                "csrf_token": csrf(signed_in, settings),
                "kind": "workday",
                "identifier": "acme",
            },
        )
        assert response.status_code == 400

    def test_a_board_can_be_paused_rather_than_deleted(
        self, signed_in: TestClient, db: Session, settings: Settings
    ):
        """Losing the row loses the failure history that explains why it broke."""
        from app.db.models import SourceRegistry

        signed_in.post(
            "/settings/sources",
            data={
                "csrf_token": csrf(signed_in, settings),
                "kind": "lever",
                "identifier": "figma",
            },
        )
        source = not_none(db.query(SourceRegistry).filter_by(identifier="figma").first())
        signed_in.post(
            f"/settings/sources/{source.id}/toggle",
            data={"csrf_token": csrf(signed_in, settings)},
        )
        db.refresh(source)
        assert source.enabled is False

    def test_saving_the_profile_stores_locked_facts(
        self, signed_in: TestClient, db: Session, settings: Settings
    ):
        from app.services.candidate import get_fact

        response = signed_in.post(
            "/setup/profile",
            data={
                "csrf_token": csrf(signed_in, settings),
                "preferred_name": "Hoan",
                "graduation_date": "2028-05-15",
                "needs_sponsorship": "on",
            },
        )
        assert response.status_code == 303

        name = not_none(get_fact(db, "candidate.preferred_name"))
        assert name.value == "Hoan"
        sponsorship = not_none(
            get_fact(db, "work_authorization.requires_future_sponsorship")
        )
        assert sponsorship.value is True
        assert sponsorship.is_locked, "work authorization is locked by policy"
        assert sponsorship.is_verified, "the user set it, so it counts as confirmed"

    def test_an_unchecked_box_records_false_rather_than_nothing(
        self, signed_in: TestClient, db: Session, settings: Settings
    ):
        """A missing checkbox is an answer, and the wrong one to drop."""
        from app.services.candidate import get_fact

        signed_in.post(
            "/setup/profile",
            data={"csrf_token": csrf(signed_in, settings), "preferred_name": "Hoan"},
        )
        fact = not_none(get_fact(db, "work_authorization.requires_future_sponsorship"))
        assert fact.value is False

    def test_a_malformed_graduation_date_is_refused(
        self, signed_in: TestClient, settings: Settings
    ):
        response = signed_in.post(
            "/setup/profile",
            data={
                "csrf_token": csrf(signed_in, settings),
                "preferred_name": "Hoan",
                "graduation_date": "next summer",
            },
        )
        assert response.status_code == 400
