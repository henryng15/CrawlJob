"""Prepared applications that the user did not act on (spec §7.9).

The user is offered thirty prepared applications a day. Anything they have not
acted on within the TTL stops being offered — otherwise yesterday's queue is
still on the screen competing with today's, and the dashboard stops meaning
"what is waiting for you".

**Expiry is a state change, never a delete.** The tailored resume, every answer
and its provenance, the screenshots and the whole audit trail survive untouched;
only ``status`` moves. That is what makes restoring possible, and it is also the
only honest way to treat a record of what the system did on the user's behalf.

The deadline lives in ``Application.expires_at`` rather than being recomputed
from ``ready_for_review_at`` at sweep time, for two reasons. Not every waiting
state sets ``ready_for_review_at`` — an application stuck on a login screen
never reaches review but is just as much the user's to act on. And a stamped
deadline does not move when someone edits the TTL, so an application prepared
under a 24-hour rule keeps the deadline the user was shown.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Application
from app.domain.states import (
    HUMAN_GATED_APPLICATION_STATES,
    ApplicationState,
    assert_transition,
)
from app.services import audit

__all__ = ["WAITING_STATES", "clear_deadline", "due", "expire_due", "set_deadline"]

log = logging.getLogger(__name__)

#: The states in which an application is waiting for a person, and therefore the
#: only ones a TTL may act on. Deliberately the human-gated set itself rather
#: than a copy: if a new state is ever added that waits for the user, it becomes
#: expirable automatically instead of quietly living forever.
WAITING_STATES = HUMAN_GATED_APPLICATION_STATES


def set_deadline(application: Application, *, now: datetime, ttl_hours: int) -> datetime:
    """Start the clock. Call when an application begins waiting for the user."""
    application.expires_at = now + timedelta(hours=ttl_hours)
    return application.expires_at


def clear_deadline(application: Application) -> None:
    """Stop the clock. Call when the machine takes the application back.

    Without this, an application that returned to the worker — a replay, a
    resumed fill — would keep a deadline it is no longer waiting on, and the
    sweep's status check would be the only thing preventing a wrong expiry.
    Belt and braces: the sweep checks the status too.
    """
    application.expires_at = None


def due(session: Session, *, now: datetime, limit: int = 200) -> list[Application]:
    """Applications whose deadline has passed while still waiting for the user.

    Both conditions are required. The status check is what guarantees the sweep
    can never take an application away from a worker mid-flight, even if a stale
    deadline was left behind.
    """
    return list(
        session.scalars(
            select(Application)
            .where(Application.expires_at.is_not(None))
            .where(Application.expires_at <= now)
            .where(Application.status.in_(sorted(WAITING_STATES)))
            .order_by(Application.expires_at)
            .limit(limit)
        ).all()
    )


def expire_due(
    session: Session, *, now: datetime, limit: int = 200, actor_id: str | None = None
) -> list[Application]:
    """Expire everything past its deadline. Returns what was expired.

    Each row is transitioned through the state machine rather than by assignment,
    so an application that moved on since the query — the user pressed Submit a
    second ago — raises rather than being quietly overwritten, and is skipped.
    """
    expired: list[Application] = []
    for application in due(session, now=now, limit=limit):
        was = str(application.status)
        try:
            application.status = assert_transition(
                ApplicationState(application.status), ApplicationState.EXPIRED
            )
        except Exception:
            # The user acted between the query and this line. Their action wins.
            log.info("skipping expiry of %s: it moved on from %s", application.id, was)
            continue

        clear_deadline(application)
        audit.transition(
            session,
            application,
            entity_type="application",
            was=was,
            now=str(ApplicationState.EXPIRED),
            actor_id=actor_id,
            reason="not acted on before the deadline",
            expired_at=now.isoformat(),
        )
        expired.append(application)
    return expired
