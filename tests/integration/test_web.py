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
        "path", ["/", "/jobs", "/applications", "/outreach", "/settings"]
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
        queued = db.query(ScheduledTask).all()
        assert [t.task_type for t in queued] == ["PREPARE_APPLICATION"]

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

        set_fact(db, "candidate.github", "github.com/Vicientt", actor=Actor.USER)
        db.flush()
        assert "github.com/Vicientt" in signed_in.get("/settings").text


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
