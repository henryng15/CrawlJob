"""Recurring work (spec §16.2).

Without this the system is a set of commands, not a system: discovery runs when
someone types a command, Gmail is never reconciled, so outreach never reaches
SENT, so follow-ups never come due and a reply never suppresses anything.

**Every worker may tick.** There is no leader election and no lock, because the
idempotency key carries the time bucket: a daily job's key contains the local
date, a periodic job's key contains the slot. Two workers ticking the same second
produce the same key, and the queue's unique index collapses them. Adding a lock
would be adding a way to be wrong.

The corollary is that a tick missed while the worker was down is simply skipped
rather than replayed twenty times at startup — which is what you want from
"reconcile Gmail every 30 minutes" and is why the bucket is derived from the
clock rather than from the last run.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import SourceRegistry
from app.domain.tasks import TaskType, idempotency_key
from app.services.queue import enqueue

__all__ = ["SCHEDULE", "Cadence", "Job", "due_jobs", "tick"]

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Cadence:
    """When a job runs. Exactly one of ``at`` or ``every`` is set."""

    #: Local wall-clock time, in the configured business timezone.
    at: time | None = None
    every: timedelta | None = None

    def bucket(self, now: datetime, tz: ZoneInfo) -> str | None:
        """The identity of the current occurrence, or ``None`` if not due.

        This string goes into the idempotency key, so it is what makes a tick
        idempotent: the same occurrence always produces the same key.
        """
        local = now.astimezone(tz)
        if self.at is not None:
            # Due for the whole day once the hour passes. A worker started at
            # 09:00 still runs the 07:00 discovery, rather than skipping a day
            # because it was not awake at the exact minute.
            if local.time() < self.at:
                return None
            return local.date().isoformat()

        assert self.every is not None
        seconds = int(self.every.total_seconds())
        epoch = int(now.timestamp())
        return f"{epoch - epoch % seconds}"


@dataclass(frozen=True, slots=True)
class Job:
    name: str
    task_type: TaskType
    cadence: Cadence
    payload: dict[str, Any] | None = None


#: §16.2's default schedule. Discovery is expanded per enabled source, so it is
#: not listed here.
SCHEDULE: tuple[Job, ...] = (
    Job(
        "submission_reconciliation",
        TaskType.RECONCILE_SUBMISSION,
        Cadence(every=timedelta(minutes=15)),
    ),
    Job("outreach_due_scan", TaskType.SCHEDULE_OUTREACH, Cadence(every=timedelta(minutes=30))),
    Job("gmail_reconciliation", TaskType.RECONCILE_GMAIL, Cadence(every=timedelta(minutes=30))),
    Job("backup_database", TaskType.BACKUP_DATABASE, Cadence(at=time(2, 30))),
    Job("backup_artifacts", TaskType.BACKUP_ARTIFACTS, Cadence(at=time(2, 45))),
    Job("cleanup", TaskType.CLEANUP_EXPIRED_SESSION, Cadence(at=time(3, 15))),
)

#: Discovery runs once a day per source (§16.2: 07:00 Eastern). One task per
#: source rather than one for all of them, so a board that 500s costs only itself.
DISCOVERY_AT = time(7, 0)


def due_jobs(now: datetime, tz: ZoneInfo) -> Iterator[tuple[Job, str]]:
    for job in SCHEDULE:
        bucket = job.cadence.bucket(now, tz)
        if bucket is not None:
            yield job, bucket


def tick(session: Session, settings: Settings, *, now: datetime | None = None) -> int:
    """Enqueue everything due. Returns how many tasks were newly queued.

    Safe to call as often as you like: a task already queued for this occurrence
    is rejected by the queue's unique dedupe key, and ``enqueue`` returns ``None``
    rather than raising.
    """
    moment = now or datetime.now(UTC)
    tz = settings.timezone
    queued = 0

    for job, bucket in due_jobs(moment, tz):
        created = enqueue(
            session,
            task_type=job.task_type,
            dedupe_key=idempotency_key(job.task_type, job.name, bucket),
            payload=job.payload or {},
            run_at=moment,
        )
        if created is not None:
            queued += 1
            log.info("scheduled %s for %s", job.name, bucket)

    queued += _schedule_discovery(session, settings, now=moment)
    return queued


def _schedule_discovery(session: Session, settings: Settings, *, now: datetime) -> int:
    """One discovery task per enabled source, once a day."""
    bucket = Cadence(at=DISCOVERY_AT).bucket(now, settings.timezone)
    if bucket is None:
        return 0

    queued = 0
    sources = session.scalars(
        select(SourceRegistry).where(SourceRegistry.enabled.is_(True))
    ).all()
    for source in sources:
        payload: dict[str, Any] = {
            "kind": source.kind,
            "name": source.identifier,
            **(source.options or {}),
        }
        created = enqueue(
            session,
            task_type=TaskType.DISCOVER_SOURCE,
            dedupe_key=idempotency_key(
                TaskType.DISCOVER_SOURCE, source.kind, source.identifier, bucket
            ),
            payload=payload,
            run_at=now,
        )
        if created is not None:
            queued += 1

    if not sources:
        log.info("no enabled sources; add some in Settings or with: internship-ops add-source")
    return queued
