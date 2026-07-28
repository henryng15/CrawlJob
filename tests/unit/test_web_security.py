"""Session cookies, CSRF and login (spec §23.2)."""

from __future__ import annotations

import time

import pytest

from app.config import Settings
from app.web.security import (
    Session,
    authenticate,
    hash_password,
    issue,
    read,
    verify_password,
)

PASSWORD = "correct horse battery staple"


@pytest.fixture(scope="module")
def password_hash() -> str:
    return hash_password(PASSWORD)


@pytest.fixture
def settings(password_hash: str) -> Settings:
    return Settings(
        app_secret_key="test-secret-key-not-a-real-one",
        admin_username="hoan",
        admin_password_hash=password_hash,
        session_idle_timeout_minutes=60,
    )


class TestPasswordHashing:
    def test_a_password_verifies_against_its_hash(self, password_hash: str):
        assert verify_password(PASSWORD, password_hash)

    def test_a_wrong_password_does_not(self, password_hash: str):
        assert not verify_password("wrong", password_hash)

    def test_the_hash_is_salted(self):
        """Two hashes of one password must differ, or a leak reveals reuse."""
        assert hash_password(PASSWORD) != hash_password(PASSWORD)

    def test_a_malformed_hash_denies_rather_than_raising(self):
        assert not verify_password(PASSWORD, "not-a-hash")

    def test_an_empty_hash_denies(self):
        """An unconfigured deployment must let nobody in, not everybody."""
        assert not verify_password(PASSWORD, "")


class TestAuthenticate:
    def test_correct_credentials_produce_a_session(self, settings: Settings):
        session = authenticate("hoan", PASSWORD, settings)
        assert session is not None
        assert session.username == "hoan"
        assert len(session.csrf_token) >= 32

    def test_a_wrong_password_is_refused(self, settings: Settings):
        assert authenticate("hoan", "guess", settings) is None

    def test_a_wrong_username_is_refused(self, settings: Settings):
        assert authenticate("someone-else", PASSWORD, settings) is None

    def test_an_unconfigured_instance_refuses_everyone(self, password_hash: str):
        """Empty ADMIN_PASSWORD_HASH must not mean "no password required"."""
        settings = Settings(app_secret_key="k", admin_password_hash="")
        assert authenticate("admin", "", settings) is None
        assert authenticate("admin", "anything", settings) is None

    def test_each_session_gets_a_fresh_csrf_token(self, settings: Settings):
        first = authenticate("hoan", PASSWORD, settings)
        second = authenticate("hoan", PASSWORD, settings)
        assert first is not None and second is not None
        assert first.csrf_token != second.csrf_token

    def test_a_wrong_username_costs_about_as_much_as_a_wrong_password(self, settings: Settings):
        """A fast rejection for an unknown username leaks which names exist.

        The bound is loose on purpose — this asserts the dummy verification
        happens at all, not a precise timing budget on a shared CI box.
        """
        def elapsed(user: str, password: str) -> float:
            start = time.perf_counter()
            authenticate(user, password, settings)
            return time.perf_counter() - start

        wrong_user = min(elapsed("nobody", PASSWORD) for _ in range(3))
        wrong_password = min(elapsed("hoan", "guess") for _ in range(3))
        assert wrong_user > wrong_password / 4


class TestCookies:
    def test_a_session_survives_a_round_trip(self, settings: Settings):
        original = Session(username="hoan", csrf_token="tok")
        assert read(issue(original, settings), settings) == original

    def test_a_tampered_cookie_is_rejected(self, settings: Settings):
        cookie = issue(Session("hoan", "tok"), settings)
        assert read(cookie[:-4] + "AAAA", settings) is None

    def test_a_cookie_signed_with_another_key_is_rejected(self, settings: Settings):
        """The secret key is what makes the cookie unforgeable."""
        other = settings.model_copy(update={"app_secret_key": settings.app_secret_key})
        cookie = issue(Session("hoan", "tok"), Settings(app_secret_key="a-different-key"))
        assert read(cookie, other) is None

    def test_an_absent_cookie_is_not_a_session(self, settings: Settings):
        assert read(None, settings) is None
        assert read("", settings) is None

    def test_an_idle_cookie_expires(self, settings: Settings, monkeypatch):
        """The cookie is re-signed while you work, so this fires only for a
        session nobody has touched for longer than the timeout."""
        import itsdangerous.timed

        an_hour_and_a_bit_ago = time.time() - (settings.session_idle_timeout_minutes * 60 + 30)
        monkeypatch.setattr(itsdangerous.timed.time, "time", lambda: an_hour_and_a_bit_ago)
        stale = issue(Session("hoan", "tok"), settings)
        monkeypatch.undo()

        assert read(stale, settings) is None

    def test_a_cookie_just_inside_the_timeout_still_works(self, settings: Settings, monkeypatch):
        import itsdangerous.timed

        recently = time.time() - (settings.session_idle_timeout_minutes * 60 - 30)
        monkeypatch.setattr(itsdangerous.timed.time, "time", lambda: recently)
        cookie = issue(Session("hoan", "tok"), settings)
        monkeypatch.undo()

        assert read(cookie, settings) is not None

    def test_a_cookie_carrying_the_wrong_shape_is_rejected(self, settings: Settings):
        import itsdangerous

        serializer = itsdangerous.URLSafeTimedSerializer(
            settings.app_secret_key.get_secret_value(), salt="internship-ops.session.v1"
        )
        assert read(serializer.dumps(["not", "a", "dict"]), settings) is None
        assert read(serializer.dumps({"u": 1, "c": 2}), settings) is None


class TestCsrf:
    def test_the_matching_token_passes(self):
        assert Session("hoan", "tok").csrf_matches("tok")

    def test_a_different_token_fails(self):
        assert not Session("hoan", "tok").csrf_matches("other")

    def test_a_missing_token_fails(self):
        assert not Session("hoan", "tok").csrf_matches(None)
        assert not Session("hoan", "tok").csrf_matches("")
