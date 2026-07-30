"""Short-lived tokens for live browser review (spec §15.3).

A live review session is a real browser holding the user's address, their date of
birth, and whatever the employer's form asked. Caddy routes ``/review/slot-1/*``
but does not authenticate it, so without this anyone already on the tailnet — a
guest device, a phone someone borrowed, a machine that joined and was forgotten —
can open that page by guessing a URL that never changes.

§15.3 asks for five properties. All five are here:

* an authenticated session issues the token;
* it is scoped to one application;
* it expires;
* it must match the slot it is presented to;
* only the hash is stored, so a stolen database row yields no working link.

The hash is why this file exists rather than a signature check alone: a signed
token that the database also records in plaintext is a password written down.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final

from itsdangerous import BadSignature, URLSafeTimedSerializer

from app.config import Settings
from app.web.security import is_fresh

__all__ = [
    "DEFAULT_TTL",
    "ReviewGrant",
    "hash_token",
    "issue_token",
    "review_cookie_name",
    "verify_token",
]

_SALT: Final = "internship-ops.review.v1"

#: Long enough to fill in a form and think about it, short enough that a link
#: left in a chat window is useless by the time anyone else finds it.
DEFAULT_TTL: Final = timedelta(minutes=30)


@dataclass(frozen=True, slots=True)
class ReviewGrant:
    """What a valid token proves."""

    application_id: uuid.UUID
    slot_name: str


def review_cookie_name(slot_name: str) -> str:
    """Per-slot cookie name, so a grant for one slot cannot travel to another."""
    return f"review_{slot_name.replace('-', '_')}"


def hash_token(token: str) -> str:
    """What goes in ``browser_sessions.review_token_hash``.

    SHA-256 rather than a password hash: the token is 32 random bytes, so there
    is no dictionary to attack and no reason to make verification slow.
    """
    return hashlib.sha256(token.encode()).hexdigest()


def issue_token(
    *,
    application_id: uuid.UUID,
    slot_name: str,
    settings: Settings,
    ttl: timedelta = DEFAULT_TTL,
) -> tuple[str, str]:
    """Mint a token. Returns ``(token, hash)``; store only the hash."""
    payload = {
        "a": str(application_id),
        "s": slot_name,
        # Random component so two tokens for the same application differ, and so
        # revoking one by replacing the stored hash revokes exactly that one.
        "n": secrets.token_urlsafe(24),
        "ttl": int(ttl.total_seconds()),
    }
    token = str(_serializer(settings).dumps(payload))
    return token, hash_token(token)


def verify_token(
    token: str | None,
    *,
    slot_name: str,
    stored_hash: str | None,
    settings: Settings,
    now: datetime | None = None,
) -> ReviewGrant | None:
    """Check a token against the slot presenting it. ``None`` means refuse.

    Every failure returns ``None`` rather than distinguishing expiry from
    forgery: the caller has nothing different to do, and saying which one it was
    tells an attacker which they produced.
    """
    if not token or not stored_hash:
        return None

    # The hash first. A signature valid for a token the database has never seen
    # means the token was revoked — or was minted for a different session.
    if not hmac.compare_digest(hash_token(token), stored_hash):
        return None

    try:
        payload, issued_at = _serializer(settings).loads(token, return_timestamp=True)
    except BadSignature:
        return None
    # Age checked here rather than by ``loads(max_age=...)``, for the same reason
    # as the session cookie: a clock that steps backwards must not expire a review
    # link somebody is in the middle of using. See security.CLOCK_SKEW_GRACE.
    if not is_fresh(issued_at, timedelta(seconds=_max_age(token, settings)), now=now):
        return None
    if not isinstance(payload, dict):
        return None

    if not hmac.compare_digest(str(payload.get("s", "")), slot_name):
        # A token for slot-1 must not open slot-2. Without this, one live review
        # is a key to every other one.
        return None

    try:
        application_id = uuid.UUID(str(payload.get("a")))
    except ValueError:
        return None

    return ReviewGrant(application_id=application_id, slot_name=slot_name)


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.app_secret_key.get_secret_value(), salt=_SALT)


def _max_age(token: str, settings: Settings) -> int:
    """The TTL the token itself asks for, bounded by the default.

    Read from the payload without verifying first — which is safe only because
    the result is *clamped*: a tampered token cannot ask for a longer life than
    the default, and the signature is checked immediately afterwards anyway.
    """
    default = int(DEFAULT_TTL.total_seconds())
    try:
        unsafe = _serializer(settings).loads_unsafe(token)[1]
    except Exception:
        return default
    if not isinstance(unsafe, dict):
        return default
    requested = unsafe.get("ttl")
    if not isinstance(requested, int) or requested <= 0:
        return default
    return min(requested, default)
