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
"""

from __future__ import annotations

import hmac
import secrets
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Final

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import Settings

__all__ = [
    "COOKIE_NAME",
    "CSRF_FIELD",
    "Session",
    "hash_password",
    "issue",
    "read",
    "verify_password",
]

COOKIE_NAME: Final = "internship_ops_session"
CSRF_FIELD: Final = "csrf_token"
_SALT: Final = "internship-ops.session.v1"

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


def read(cookie: str | None, settings: Settings) -> Session | None:
    """Recover a session from a cookie, or ``None`` if absent, tampered or idle.

    Every failure mode collapses to ``None``: the caller has nothing useful to do
    differently for an expired cookie versus a forged one, and distinguishing them
    in a response tells an attacker which they produced.
    """
    if not cookie:
        return None
    max_age = settings.session_idle_timeout_minutes * 60
    try:
        payload = _serializer(settings).loads(cookie, max_age=max_age)
    except (SignatureExpired, BadSignature):
        return None
    if not isinstance(payload, dict):
        return None
    username, csrf = payload.get("u"), payload.get("c")
    if not isinstance(username, str) or not isinstance(csrf, str):
        return None
    return Session(username=username, csrf_token=csrf)
