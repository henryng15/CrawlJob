"""The audit log (spec §12, §23.5).

Every state change worth explaining later, recorded once, in one shape. The
question this exists to answer is "why does this application say SUBMITTED when I
never pressed anything" — and answering it needs the transition, who caused it,
and when, months after the fact.

Two rules the helpers enforce so callers cannot get them wrong:

* **Redaction is not optional.** §23.5 forbids demographic answers, addresses and
  secrets from logs. An audit row is a log with a longer memory, so payloads pass
  through :func:`redact` on the way in rather than relying on each caller to
  remember.
* **An audit write never fails the work.** A record that could roll back a
  submission would be worse than no record.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Final

from sqlalchemy.orm import Session

from app.db.models import AuditEvent

__all__ = ["REDACTED_KEYS", "Actor", "record", "redact", "transition"]

log = logging.getLogger(__name__)


class Actor:
    USER: Final = "USER"
    WORKER: Final = "WORKER"
    SYSTEM: Final = "SYSTEM"


#: Substrings that mark a value as unloggable (§23.5). Matched loosely on
#: purpose: a key called ``applicant_ssn`` should be caught by ``ssn``, and the
#: cost of over-redacting an audit payload is nothing.
REDACTED_KEYS: tuple[str, ...] = (
    "password",
    "token",
    "secret",
    "cookie",
    "api_key",
    "ssn",
    "date_of_birth",
    "address",
    "eeo",
    "race",
    "gender",
    "veteran",
    "disability",
    "resume_text",
)

_PLACEHOLDER: Final = "[redacted]"


def redact(payload: dict[str, Any]) -> dict[str, Any]:
    """Replace anything §23.5 forbids logging. Recurses into nested dicts."""
    clean: dict[str, Any] = {}
    for key, value in payload.items():
        if any(marker in key.lower() for marker in REDACTED_KEYS):
            clean[key] = _PLACEHOLDER
        elif isinstance(value, dict):
            clean[key] = redact(value)
        else:
            clean[key] = value
    return clean


def record(
    session: Session,
    *,
    event_type: str,
    entity_type: str,
    entity_id: uuid.UUID | None = None,
    actor_type: str = Actor.WORKER,
    actor_id: str | None = None,
    **payload: Any,
) -> AuditEvent | None:
    """Write one audit row. Returns ``None`` if it could not be written.

    Added to the caller's session so it commits with the change it describes: an
    audit row for a transaction that rolled back would be a record of something
    that did not happen.
    """
    try:
        event = AuditEvent(
            event_type=event_type,
            entity_type=entity_type,
            entity_id=entity_id,
            actor_type=actor_type,
            actor_id=actor_id,
            event_metadata=redact(payload),
        )
        session.add(event)
        return event
    except Exception:
        log.exception("could not record audit event %s", event_type)
        return None


def transition(
    session: Session,
    entity: Any,
    *,
    entity_type: str,
    was: str,
    now: str,
    actor_type: str = Actor.WORKER,
    actor_id: str | None = None,
    **extra: Any,
) -> AuditEvent | None:
    """Record a state change.

    ``was`` is passed rather than read from the object because by the time this
    is called the object already holds the new value — reading it here would
    record ``SUBMITTED -> SUBMITTED`` and lose the only interesting part.
    """
    return record(
        session,
        event_type=f"{entity_type.upper()}_TRANSITION",
        entity_type=entity_type,
        entity_id=getattr(entity, "id", None),
        actor_type=actor_type,
        actor_id=actor_id,
        was=was,
        now=now,
        **extra,
    )
