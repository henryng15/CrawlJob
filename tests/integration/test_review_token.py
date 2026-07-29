"""Live-review authorization (spec §15.3).

A live review session is a real browser holding the user's address, their date of
birth, and whatever else the employer's form asked for. Caddy routes that path
but does not authenticate it, so these tests are what stand between "on the
tailnet" and "looking at someone's application".
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
from app.db.models import Application, BrowserSession, Company, Job
from app.domain.normalization import canonicalize_url, url_hash
from app.domain.states import ApplicationState, BrowserSlotState, JobState
from app.web.app import create_app
from app.web.deps import get_config, get_db
from app.web.review_token import (
    DEFAULT_TTL,
    hash_token,
    issue_token,
    review_cookie_name,
    verify_token,
)
from app.web.security import hash_password

pytestmark = pytest.mark.db

PASSWORD = "review-token-tests-password"
NOW = datetime.now(UTC)


@pytest.fixture(scope="module")
def password_hash() -> str:
    return hash_password(PASSWORD)


@pytest.fixture
def settings(password_hash: str) -> Settings:
    return Settings(
        app_env="development",
        app_secret_key="review-token-secret",
        admin_username="hoan",
        admin_password_hash=password_hash,
    )


# ----------------------------------------------------------------- unit


class TestToken:
    def test_a_fresh_token_verifies(self, settings: Settings):
        application_id = uuid.uuid4()
        token, digest = issue_token(
            application_id=application_id, slot_name="slot-1", settings=settings
        )
        grant = verify_token(
            token, slot_name="slot-1", stored_hash=digest, settings=settings
        )
        assert grant is not None
        assert grant.application_id == application_id

    def test_only_the_hash_needs_storing(self, settings: Settings):
        """A stolen database row must not yield a working link."""
        token, digest = issue_token(
            application_id=uuid.uuid4(), slot_name="slot-1", settings=settings
        )
        assert token not in digest
        assert hash_token(token) == digest

    def test_a_token_for_another_slot_is_refused(self, settings: Settings):
        """Otherwise one live review is a key to every other one."""
        token, digest = issue_token(
            application_id=uuid.uuid4(), slot_name="slot-1", settings=settings
        )
        assert (
            verify_token(token, slot_name="slot-2", stored_hash=digest, settings=settings) is None
        )

    def test_a_revoked_token_is_refused(self, settings: Settings):
        """Replacing the stored hash invalidates every earlier link."""
        token, _ = issue_token(
            application_id=uuid.uuid4(), slot_name="slot-1", settings=settings
        )
        _, newer = issue_token(
            application_id=uuid.uuid4(), slot_name="slot-1", settings=settings
        )
        assert (
            verify_token(token, slot_name="slot-1", stored_hash=newer, settings=settings) is None
        )

    def test_a_tampered_token_is_refused(self, settings: Settings):
        token, digest = issue_token(
            application_id=uuid.uuid4(), slot_name="slot-1", settings=settings
        )
        mangled = token[:-4] + "AAAA"
        assert (
            verify_token(mangled, slot_name="slot-1", stored_hash=digest, settings=settings)
            is None
        )

    def test_a_token_signed_with_another_key_is_refused(self, settings: Settings):
        other = Settings(app_secret_key="a-different-secret")
        token, digest = issue_token(
            application_id=uuid.uuid4(), slot_name="slot-1", settings=other
        )
        assert (
            verify_token(token, slot_name="slot-1", stored_hash=digest, settings=settings) is None
        )

    def test_an_expired_token_is_refused(self, settings: Settings, monkeypatch):
        import time as time_module

        import itsdangerous.timed

        long_ago = time_module.time() - DEFAULT_TTL.total_seconds() - 60
        monkeypatch.setattr(itsdangerous.timed.time, "time", lambda: long_ago)
        token, digest = issue_token(
            application_id=uuid.uuid4(), slot_name="slot-1", settings=settings
        )
        monkeypatch.undo()

        assert (
            verify_token(token, slot_name="slot-1", stored_hash=digest, settings=settings) is None
        )

    def test_a_token_asking_for_a_longer_life_is_clamped(self, settings: Settings, monkeypatch):
        """The TTL is read from the payload before the signature is checked, so
        it must not be able to extend the token's life."""
        import time as time_module

        import itsdangerous.timed

        long_ago = time_module.time() - DEFAULT_TTL.total_seconds() - 60
        monkeypatch.setattr(itsdangerous.timed.time, "time", lambda: long_ago)
        token, digest = issue_token(
            application_id=uuid.uuid4(),
            slot_name="slot-1",
            settings=settings,
            ttl=timedelta(days=30),
        )
        monkeypatch.undo()

        assert (
            verify_token(token, slot_name="slot-1", stored_hash=digest, settings=settings) is None
        )

    def test_nothing_verifies_without_a_stored_hash(self, settings: Settings):
        """A slot that never issued a link must not accept one."""
        token, _ = issue_token(
            application_id=uuid.uuid4(), slot_name="slot-1", settings=settings
        )
        assert (
            verify_token(token, slot_name="slot-1", stored_hash=None, settings=settings) is None
        )

    def test_the_cookie_is_scoped_per_slot(self):
        assert review_cookie_name("slot-1") != review_cookie_name("slot-2")


# ---------------------------------------------------------- integration


@pytest.fixture
def web(db: Session, settings: Settings) -> Iterator[FastAPI]:
    def request_session() -> Iterator[Session]:
        yield db
        db.flush()

    application = create_app()
    application.dependency_overrides[get_db] = request_session
    application.dependency_overrides[get_config] = lambda: settings
    application.state.settings = settings
    yield application
    application.dependency_overrides.clear()


@pytest.fixture
def client(web: FastAPI) -> Iterator[TestClient]:
    with TestClient(web, follow_redirects=False) as c:
        c.post("/login", data={"username": "hoan", "password": PASSWORD})
        yield c


@pytest.fixture
def live_slot(db: Session) -> tuple[Application, BrowserSession]:
    company = Company(canonical_name="Acme", normalized_name="acme")
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
        job_id=job.id, application_url=url, status=ApplicationState.READY_FOR_REVIEW
    )
    db.add(application)
    db.flush()

    slot = BrowserSession(
        slot_name="slot-1",
        application_id=application.id,
        status=BrowserSlotState.LIVE_REVIEW,
        heartbeat_at=NOW,
    )
    db.add(slot)
    db.flush()
    return application, slot


class TestReviewFlow:
    def test_the_application_page_mints_a_link(
        self, client: TestClient, live_slot: tuple[Application, BrowserSession]
    ):
        application, slot = live_slot
        body = client.get(f"/applications/{application.id}").text
        assert "/review/slot-1/?token=" in body
        assert slot.review_token_hash, "the hash should have been stored"

    def test_no_link_when_the_slot_is_not_live(
        self, client: TestClient, db: Session, live_slot: tuple[Application, BrowserSession]
    ):
        application, slot = live_slot
        slot.status = BrowserSlotState.IDLE
        db.flush()

        assert "/review/slot-1/?token=" not in client.get(f"/applications/{application.id}").text

    def test_opening_the_link_sets_a_scoped_cookie(
        self, client: TestClient, settings: Settings, live_slot: tuple[Application, BrowserSession]
    ):
        application, slot = live_slot
        token, digest = issue_token(
            application_id=application.id, slot_name="slot-1", settings=settings
        )
        slot.review_token_hash = digest

        response = client.get(f"/review/slot-1/?token={token}")
        assert response.status_code == 303
        assert "vnc.html" in response.headers["location"]

        cookie = response.headers["set-cookie"]
        assert "review_slot_1=" in cookie
        assert "HttpOnly" in cookie
        assert "Path=/review/slot-1/" in cookie

    def test_a_missing_token_is_refused(
        self, client: TestClient, live_slot: tuple[Application, BrowserSession]
    ):
        assert client.get("/review/slot-1/").status_code == 403

    def test_a_forged_token_is_refused(
        self, client: TestClient, live_slot: tuple[Application, BrowserSession]
    ):
        assert client.get("/review/slot-1/?token=made.up.value").status_code == 403

    def test_signing_out_does_not_leave_the_review_open(
        self, web: FastAPI, live_slot: tuple[Application, BrowserSession]
    ):
        """The review page requires a signed-in session to mint a link."""
        with TestClient(web, follow_redirects=False) as anonymous:
            response = anonymous.get("/review/slot-1/?token=anything")
            assert response.status_code == 303
            assert response.headers["location"].startswith("/login")


class TestForwardAuth:
    """What Caddy calls before proxying each asset and the WebSocket upgrade."""

    def _granted(
        self, client: TestClient, settings: Settings, slot: BrowserSession, application: Application
    ) -> dict[str, str]:
        """Establish a grant and return the headers Caddy would forward.

        The cookie is path-scoped to ``/review/slot-1/``, so a browser sends it
        on requests under that path and Caddy copies it onto the forward_auth
        call. Passing it explicitly here is what that looks like from the app's
        side; letting the test client attach it would prove nothing, because it
        would not attach it to ``/internal/review-auth`` at all.
        """
        token, digest = issue_token(
            application_id=application.id, slot_name=slot.slot_name, settings=settings
        )
        slot.review_token_hash = digest
        client.get(f"/review/{slot.slot_name}/?token={token}")
        return {"Cookie": f"{review_cookie_name(slot.slot_name)}={token}"}

    def test_a_granted_request_is_allowed(
        self, client: TestClient, settings: Settings, live_slot: tuple[Application, BrowserSession]
    ):
        application, slot = live_slot
        granted = self._granted(client, settings, slot, application)

        response = client.get(
            "/internal/review-auth",
            headers={"X-Forwarded-Uri": "/review/slot-1/vnc.html", **granted},
        )
        assert response.status_code == 204

    def test_an_ungranted_request_is_refused(
        self, client: TestClient, live_slot: tuple[Application, BrowserSession]
    ):
        """The whole point: reaching vnc.html directly must not work."""
        response = client.get(
            "/internal/review-auth", headers={"X-Forwarded-Uri": "/review/slot-1/vnc.html"}
        )
        assert response.status_code == 403

    def test_a_grant_for_one_slot_does_not_open_another(
        self, client: TestClient, settings: Settings, live_slot: tuple[Application, BrowserSession]
    ):
        application, slot = live_slot
        granted = self._granted(client, settings, slot, application)

        response = client.get(
            "/internal/review-auth",
            headers={"X-Forwarded-Uri": "/review/slot-2/vnc.html", **granted},
        )
        assert response.status_code == 403

    def test_a_path_outside_review_is_refused(self, client: TestClient):
        response = client.get("/internal/review-auth", headers={"X-Forwarded-Uri": "/settings"})
        assert response.status_code == 403

    def test_a_traversal_attempt_is_refused(self, client: TestClient):
        response = client.get(
            "/internal/review-auth", headers={"X-Forwarded-Uri": "/review/../settings"}
        )
        assert response.status_code == 403

    def test_the_websocket_path_is_checked_too(
        self, client: TestClient, settings: Settings, live_slot: tuple[Application, BrowserSession]
    ):
        """noVNC opens a socket at /websockify; without a check the page is
        pointless but the *screen* is still reachable."""
        application, slot = live_slot
        granted = self._granted(client, settings, slot, application)

        allowed = client.get(
            "/internal/review-auth",
            headers={"X-Forwarded-Uri": "/review/slot-1/websockify", **granted},
        )
        assert allowed.status_code == 204
