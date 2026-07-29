"""Bringing an expired application back (spec §7.9, §7.11).

Restoring is not "make a new application for that job". It is the *same row*,
returned to the user with the work that was already done for it: the answers
they were going to review, the exact resume that was going to be uploaded, the
session that was already logged in. That distinction is the whole feature — a
new application would cost a daily slot, produce a second row against one job,
and throw away twenty minutes of form-filling.

Three things can make that impossible, and all three are checked *before* a
browser slot is taken, because a slot is one of only two:

* the posting closed, so there is nothing left to submit to;
* another application already covers the job, so restoring would duplicate it;
* the stored replay package is gone, so there is nothing to reproduce.

A fourth is only discoverable with the page open — the form changed materially —
and is handled where it is found, in the replay handler.

None of these are failures. They are answers, and each one is recorded on the
row in words the user can act on.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import Application, AuditEvent, Job
from app.domain.states import (
    HUMAN_GATED_APPLICATION_STATES,
    ApplicationState,
    JobState,
)

__all__ = [
    "RESTORE_TARGET_DEFAULT",
    "RestoreCheck",
    "check_restorable",
    "previous_human_state",
    "replay_package_path",
]


def replay_package_path(settings: Settings, application_id: uuid.UUID) -> Path | None:
    """The stored form snapshot for an application, if it is still on disk.

    Lives here rather than in the browser worker so the pipeline worker can ask
    the question without importing Playwright.
    """
    path = settings.artifacts_dir / str(application_id) / "replay.json"
    return path if path.is_file() else None

#: Where a restored application goes when the audit trail cannot say where it
#: came from. The review queue is the safe answer: it is human-gated, and it is
#: where a prepared application belongs.
RESTORE_TARGET_DEFAULT = ApplicationState.READY_FOR_REVIEW


@dataclass(frozen=True, slots=True)
class RestoreCheck:
    """Whether a restore may proceed, and why not when it may not."""

    allowed: bool
    reason: str = ""

    def __bool__(self) -> bool:
        return self.allowed


def previous_human_state(session: Session, application: Application) -> ApplicationState:
    """The human-gated state this application expired from.

    Read from the audit trail rather than stored on the row, because the audit
    trail is the record that cannot be quietly overwritten — and because it is
    already written for every transition, so there is nothing extra to maintain.

    Falls back to the review queue when the trail says nothing useful, which is
    the case for a row expired before this feature existed.
    """
    events = session.scalars(
        select(AuditEvent)
        .where(AuditEvent.entity_id == application.id)
        .where(AuditEvent.entity_type == "application")
        .order_by(AuditEvent.created_at.desc())
    ).all()

    for event in events:
        metadata = event.event_metadata or {}
        if metadata.get("now") != ApplicationState.EXPIRED.value:
            continue
        try:
            was = ApplicationState(str(metadata.get("was")))
        except ValueError:
            break
        # Only a state that waits for a person is a legitimate target. Anything
        # else would hand the row back to a worker that is not expecting it.
        return was if was in HUMAN_GATED_APPLICATION_STATES else RESTORE_TARGET_DEFAULT

    return RESTORE_TARGET_DEFAULT


def check_restorable(
    session: Session, application: Application, *, has_replay_package: bool
) -> RestoreCheck:
    """Whether this expired application can be brought back.

    Args:
        application: the row the user asked to restore.
        has_replay_package: whether the stored form snapshot still exists on
            disk. Artifact cleanup can remove it long after expiry, and without
            it there is nothing to replay.
    """
    if application.status != ApplicationState.EXPIRED:
        return RestoreCheck(
            False,
            f"only an expired application can be restored, not one that is "
            f"{application.status}",
        )

    job = session.get(Job, application.job_id)
    if job is None:
        return RestoreCheck(False, "the job this application was for no longer exists")

    if job.status == JobState.CLOSED or job.closed_at is not None:
        return RestoreCheck(False, "the posting has closed, so there is nothing left to submit to")

    # Anything not in a closed state is an application that still counts. Note
    # that EXPIRED and RESTORE_BLOCKED are themselves closed, so several expired
    # attempts at one job do not block each other.
    other = session.scalars(
        select(Application)
        .where(Application.job_id == application.job_id)
        .where(Application.id != application.id)
        .where(
            Application.status.not_in(
                [
                    ApplicationState.SKIPPED,
                    ApplicationState.WITHDRAWN,
                    ApplicationState.FAILED,
                    ApplicationState.EXPIRED,
                    ApplicationState.RESTORE_BLOCKED,
                ]
            )
        )
    ).first()
    if other is not None:
        verb = (
            "was already submitted"
            if other.status == ApplicationState.SUBMITTED
            else "is already in progress"
        )
        return RestoreCheck(False, f"another application for this job {verb} ({other.status})")

    if not has_replay_package:
        return RestoreCheck(
            False,
            "the stored form snapshot is no longer on disk, so the saved answers "
            "cannot be put back; this job would have to be prepared again",
        )

    return RestoreCheck(True)
