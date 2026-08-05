"""A clock that steps backwards must not log anyone out (spec §23.2, §15.3).

This is the regression test for an intermittent failure that took a while to
pin down: roughly one run of the suite in fifteen, some test that had logged in
would get a 303 back instead of a page, or ``csrf()`` would find no session in
the cookie jar. Different test each time, no ordering to it, and it never
reproduced in isolation.

The cause was one line in ``itsdangerous``:

    if age < 0:
        raise SignatureExpired(f"Signature age {age} < 0 seconds", ...)

Passing ``max_age`` to ``loads`` asks it to reject a token whose timestamp is in
the **future** as well as one that is too old. A host clock that steps backwards
by a single second — an NTP correction, or a VM resynchronising with its host
after the host slept, which is routine under WSL2 — makes every token signed in
the preceding second look as though it comes from the future. The session is
refused, and because the redirect to the login page deletes the cookie on its way
past, the user has to log in again.

Nothing about that is test-only. It is a production bug that would show up as
being logged out at random, with nothing in the logs to explain it.

Rejecting future timestamps also buys nothing here: the timestamp is inside the
HMAC, so nobody without the secret key can put one there. The only thing that can
sign a token from the future is our own clock.

So the age check is ours now, with a bounded grace for the clock having moved,
and ``now`` is injectable — which is what makes these tests deterministic instead
of a matter of waiting for a machine to misbehave.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.config import Settings
from app.web.security import CLOCK_SKEW_GRACE, Session, is_fresh, issue, read

NOW = datetime(2026, 7, 30, 12, 0, tzinfo=UTC)


@pytest.fixture
def settings() -> Settings:
    return Settings(app_env="development", app_secret_key="clock-skew-tests")


@pytest.fixture
def cookie(settings: Settings) -> str:
    return issue(Session("hoan", "csrf-token"), settings)


def idle_timeout(settings: Settings) -> timedelta:
    return timedelta(minutes=settings.session_idle_timeout_minutes)


def sign_ahead(monkeypatch: pytest.MonkeyPatch, settings: Settings, seconds: int) -> str:
    """Sign a cookie as a clock ``seconds`` ahead of the real one would.

    The same thing the process saw when the host clock resynchronised: a token
    stamped a moment in the future, read back against the real clock. Written this
    way rather than by injecting ``now`` into ``read`` so that the test exercises
    the path the flake actually took — the reader here has no idea anything is
    unusual, which is the whole point.
    """
    import time

    import itsdangerous.timed

    ahead = time.time() + seconds
    monkeypatch.setattr(itsdangerous.timed.time, "time", lambda: ahead)
    cookie = issue(Session("hoan", "csrf-token"), settings)
    monkeypatch.undo()
    return cookie


class TestTheStepThatCausedIt:
    def test_a_cookie_signed_a_second_in_the_future_still_works(
        self, settings: Settings, monkeypatch: pytest.MonkeyPatch
    ):
        """The exact failure, reproduced deterministically.

        Signed by a clock one second ahead, read by the real one. Before the fix
        this raised ``SignatureExpired: Signature age -1 < 0 seconds`` and the
        session was gone.
        """
        cookie = sign_ahead(monkeypatch, settings, 1)
        session = read(cookie, settings)

        assert session is not None
        assert session.username == "hoan"
        assert session.csrf_token == "csrf-token"

    @pytest.mark.parametrize("seconds", [1, 2, 30, 120])
    def test_any_step_inside_the_grace_survives(
        self, settings: Settings, monkeypatch: pytest.MonkeyPatch, seconds: int
    ):
        assert read(sign_ahead(monkeypatch, settings, seconds), settings) is not None

    def test_a_step_beyond_the_grace_is_still_refused(
        self, settings: Settings, monkeypatch: pytest.MonkeyPatch
    ):
        ahead = int(CLOCK_SKEW_GRACE.total_seconds()) + 60
        assert read(sign_ahead(monkeypatch, settings, ahead), settings) is None

    def test_a_one_second_backwards_step_keeps_the_session(self, settings: Settings, cookie: str):
        """The same thing said through the injected clock, which is what the rest
        of this file uses."""
        signed_at = datetime.now(UTC)
        session = read(cookie, settings, now=signed_at - timedelta(seconds=1))

        assert session is not None
        assert session.username == "hoan"
        assert session.csrf_token == "csrf-token"

    @pytest.mark.parametrize("seconds", [1, 2, 30, 120, 299])
    def test_steps_within_the_grace_are_survivable(
        self, settings: Settings, cookie: str, seconds: int
    ):
        now = datetime.now(UTC) - timedelta(seconds=seconds)
        assert read(cookie, settings, now=now) is not None

    def test_the_csrf_token_survives_the_step_too(self, settings: Settings, cookie: str):
        """The other half of the symptom: ``csrf()`` returning ``None``."""
        back = datetime.now(UTC) - timedelta(seconds=1)
        session = read(cookie, settings, now=back)
        assert session is not None
        assert session.csrf_matches("csrf-token")


class TestTheGraceIsBounded:
    def test_a_wildly_wrong_clock_is_still_refused(self, settings: Settings, cookie: str):
        """Beyond the grace the clock is wrong by more than a correction explains,
        and refusing is the safer reading."""
        far_back = datetime.now(UTC) - CLOCK_SKEW_GRACE - timedelta(seconds=1)
        assert read(cookie, settings, now=far_back) is None

    def test_the_grace_cannot_meaningfully_extend_a_session(self, settings: Settings):
        """Five minutes against a sixty-minute idle window.

        Stated as a test because the grace is only acceptable while it stays
        small relative to the timeout it sits inside.
        """
        assert idle_timeout(settings) / 4 > CLOCK_SKEW_GRACE


class TestTheIdleTimeoutStillWorks:
    """The check this replaced still has to do its actual job."""

    def test_a_cookie_older_than_the_timeout_is_refused(self, settings: Settings, cookie: str):
        later = datetime.now(UTC) + idle_timeout(settings) + timedelta(seconds=30)
        assert read(cookie, settings, now=later) is None

    def test_a_cookie_just_inside_the_timeout_is_accepted(self, settings: Settings, cookie: str):
        later = datetime.now(UTC) + idle_timeout(settings) - timedelta(seconds=30)
        assert read(cookie, settings, now=later) is not None

    def test_a_forged_cookie_is_refused_whatever_the_clock_says(self, settings: Settings):
        assert read("made.up.value", settings, now=NOW) is None

    def test_another_keys_cookie_is_refused_whatever_the_clock_says(self, settings: Settings):
        other = issue(Session("hoan", "t"), Settings(app_secret_key="a-different-key"))
        assert read(other, settings, now=datetime.now(UTC)) is None


class TestTheRule:
    """``is_fresh`` on its own, since both token paths depend on it."""

    def test_a_token_issued_now_is_fresh(self):
        assert is_fresh(NOW, timedelta(hours=1), now=NOW)

    def test_a_token_from_just_after_now_is_fresh(self):
        assert is_fresh(NOW + timedelta(seconds=1), timedelta(hours=1), now=NOW)

    def test_a_token_from_the_far_future_is_not(self):
        ahead = NOW + CLOCK_SKEW_GRACE + timedelta(seconds=1)
        assert not is_fresh(ahead, timedelta(hours=1), now=NOW)

    def test_a_token_past_its_window_is_not(self):
        assert not is_fresh(NOW - timedelta(hours=2), timedelta(hours=1), now=NOW)

    def test_the_boundaries_are_inclusive(self):
        assert is_fresh(NOW - timedelta(hours=1), timedelta(hours=1), now=NOW)
        assert is_fresh(NOW + CLOCK_SKEW_GRACE, timedelta(hours=1), now=NOW)
