"""Session authentication and CSRF (spec §23.2).

The app runs behind Tailscale Serve, but §23.2 still requires a local login: a
Tailscale-joined device that is left unlocked is exactly as reachable as one on
the public internet, and this app can queue applications under the user's name.

Three properties worth stating, because each is easy to get subtly wrong:

* **The timeout is idle, not absolute.** The cookie is re-signed on every
  authenticated request, so working for three hours does not log you out and
  walking away for one does.
* **Login is constant-time in the username too.** Verifying the password only
  when the username matches leaks which usernames exist by timing; a dummy
  verification keeps both paths the same shape.
* **CSRF tokens live inside the signed cookie.** Nothing on the page can be
  replayed from another origin, because the attacker cannot read the cookie to
  learn the token, and cannot forge it without the secret key.

* **A clock that steps backwards does not log you out.** The freshness check is
  an *idle timeout*: it asks whether a cookie is too old. ``itsdangerous`` also
  rejects one whose timestamp is in the future, which sounds prudent and is
  wrong here — the timestamp is inside the signature, so the only thing that can
  produce a future one is our own clock having moved. See :data:`CLOCK_SKEW_GRACE`.
"""

from __future__ import annotations

import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any, Final

from itsdangerous import BadSignature, URLSafeTimedSerializer

from app.config import Settings

__all__ = [
    "CLOCK_SKEW_GRACE",
    "COOKIE_NAME",
    "CSRF_FIELD",
    "Session",
    "hash_password",
    "is_fresh",
    "issue",
    "read",
    "verify_password",
]

COOKIE_NAME: Final = "internship_ops_session"
CSRF_FIELD: Final = "csrf_token"
_SALT: Final = "internship-ops.session.v1"

#: How far a signed timestamp may sit in the future before the token is refused.
#:
#: Not a courtesy. A host clock that steps backwards — an NTP correction, a VM
#: resynchronising after the host slept — makes every token signed in the
#: preceding moment look as though it comes from the future, and
#: ``itsdangerous`` treats that as expired. The user is then logged out at
#: random, and because the redirect deletes the cookie on the way past, they have
#: to log in again. A one-second step is enough.
#:
#: Tolerating it costs nothing: the timestamp lives inside the HMAC, so nobody
#: without the secret key can put a future one there. The only signer is us.
#:
#: The grace is bounded anyway. Beyond it the clock is wrong by more than any
#: correction explains, and refusing is the safer reading — five minutes cannot
#: meaningfully extend a sixty-minute idle window.
CLOCK_SKEW_GRACE: Final = timedelta(minutes=5)


def is_fresh(
    issued_at: datetime, max_age: timedelta, *, now: datetime | None = None
) -> bool:
    """Whether a signed timestamp is inside its window.

    Two-sided on purpose, and asymmetric: too old is expiry, a little in the
    future is a clock that moved, and a lot in the future is a clock nobody
    should be trusting.
    """
    age = (now or datetime.now(UTC)) - issued_at
    return -CLOCK_SKEW_GRACE <= age <= max_age

@lru_cache(maxsize=1)
def _dummy_hash() -> str:
    """A real hash of an unknowable password.

    Verified against when the username does not match, so a wrong username costs
    the same as a wrong password. Computed rather than hard-coded because a
    malformed literal would raise immediately and return *faster* than a genuine
    check — the precise leak this exists to close.
    """
    return hash_password(secrets.token_urlsafe(32))


@dataclass(frozen=True, slots=True)
class Session:
    """An authenticated browser session."""

    username: str
    csrf_token: str

    def csrf_matches(self, submitted: str | None) -> bool:
        return bool(submitted) and hmac.compare_digest(self.csrf_token, submitted or "")


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(
        settings.app_secret_key.get_secret_value(), salt=_SALT
    )


def hash_password(password: str) -> str:
    """Hash a password for ``ADMIN_PASSWORD_HASH``."""
    from argon2 import PasswordHasher

    return str(PasswordHasher().hash(password))


def verify_password(password: str, password_hash: str) -> bool:
    from argon2 import PasswordHasher
    from argon2.exceptions import Argon2Error

    try:
        return bool(PasswordHasher().verify(password_hash or _dummy_hash(), password))
    except (Argon2Error, ValueError):
        return False


def authenticate(username: str, password: str, settings: Settings) -> Session | None:
    """Check credentials. Returns a new session, or ``None``.

    An unconfigured ``admin_password_hash`` denies everyone rather than allowing
    everyone — development included, where an empty hash otherwise reads as "no
    password required".
    """
    if not settings.admin_password_hash:
        # Still spend the time: a fast rejection here would tell an attacker the
        # instance is unconfigured.
        verify_password(password, _dummy_hash())
        return None

    expected = settings.admin_username
    stored = (
        settings.admin_password_hash
        if hmac.compare_digest(username, expected)
        else _dummy_hash()
    )

    if not verify_password(password, stored):
        return None
    if not hmac.compare_digest(username, expected):
        return None
    return Session(username=username, csrf_token=secrets.token_urlsafe(32))


def issue(session: Session, settings: Settings) -> str:
    """Sign a session into a cookie value."""
    payload: dict[str, Any] = {"u": session.username, "c": session.csrf_token}
    return str(_serializer(settings).dumps(payload))


def read(
    cookie: str | None, settings: Settings, *, now: datetime | None = None
) -> Session | None:
    """Recover a session from a cookie, or ``None`` if absent, tampered or idle.

    Every failure mode collapses to ``None``: the caller has nothing useful to do
    differently for an expired cookie versus a forged one, and distinguishing them
    in a response tells an attacker which they produced.

    The age is checked here rather than by passing ``max_age`` to ``loads``, so
    that a backwards clock step is treated as the clock being wrong rather than
    the session being over (:data:`CLOCK_SKEW_GRACE`). ``now`` is injectable so
    that behaviour can be tested without waiting for a real clock to misbehave.
    """
    if not cookie:
        return None
    try:
        payload, issued_at = _serializer(settings).loads(cookie, return_timestamp=True)
    except BadSignature:
        return None
    max_age = timedelta(minutes=settings.session_idle_timeout_minutes)
    if not is_fresh(issued_at, max_age, now=now):
        return None
    if not isinstance(payload, dict):
        return None
    username, csrf = payload.get("u"), payload.get("c")
    if not isinstance(username, str) or not isinstance(csrf, str):
        return None
    return Session(username=username, csrf_token=csrf)
