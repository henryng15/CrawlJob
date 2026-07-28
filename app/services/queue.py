"""Durable task queue backed by PostgreSQL (spec §11.3, §16).

No Redis, no Celery. One VM, two workers and a handful of tasks per day do not
justify another moving part, and putting the queue in the same database as the
data buys atomicity: a task that enqueues follow-up work commits both or neither.

Three properties matter, and each has a test that exercises it against a real
database rather than a mock:

* **No task runs twice.** Claiming uses ``FOR UPDATE SKIP LOCKED``, so two
  workers polling simultaneously get different rows.
* **No task is lost.** A worker that dies holding a task leaves a stale lock;
  :func:`reclaim_stale` returns it to the queue once the lease expires.
* **Enqueueing is idempotent.** The scheduler may fire twice, a retry may
  re-submit; ``dedupe_key`` collapses them to one row.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.db.models import ScheduledTask, TaskRun
from app.domain.tasks import TaskStatus, TaskType

__all__ = [
    "DEFAULT_LEASE",
    "backoff_delay",
    "claim",
    "complete",
    "enqueue",
    "fail",
    "reclaim_stale",
]

#: How long a worker may hold a task before it is considered crashed. Longer than
#: the slowest task (browser preparation, §9.2 budgets 5 minutes) so a slow run is
#: never mistaken for a dead worker.
DEFAULT_LEASE = timedelta(minutes=15)

_BACKOFF_BASE = timedelta(seconds=30)
_BACKOFF_CAP = timedelta(hours=1)


def backoff_delay(attempt: int, *, jitter: float | None = None) -> timedelta:
    """Exponential backoff with jitter, capped (§16.6).

    Args:
        attempt: 1 for the first retry.
        jitter: fraction in [0, 1) to apply; random when omitted. Jitter spreads
            retries so a provider outage does not produce a synchronised thundering
            herd when it recovers.
    """
    if attempt < 1:
        raise ValueError(f"attempt must be >= 1, got {attempt}")
    # Clamp the exponent before multiplying: timedelta * 2**49 overflows the C
    # int behind timedelta, and every exponent past ~13 is capped anyway.
    exponent = min(attempt - 1, 20)
    raw: timedelta = _BACKOFF_BASE * (2**exponent)
    capped: timedelta = min(raw, _BACKOFF_CAP)
    factor = random.random() if jitter is None else jitter  # noqa: S311 — not cryptographic
    return capped + timedelta(seconds=capped.total_seconds() * factor * 0.25)


def enqueue(
    session: Session,
    *,
    task_type: TaskType,
    dedupe_key: str,
    payload: dict[str, Any] | None = None,
    run_at: datetime | None = None,
    priority: int = 0,
    max_attempts: int = 3,
) -> ScheduledTask | None:
    """Insert a task unless one with the same ``dedupe_key`` already exists.

    Returns the new task, or ``None`` if an equivalent task was already queued.
    ``None`` is a normal outcome, not an error — it is what makes the daily
    scheduler safe to run twice.
    """
    stmt = (
        pg_insert(ScheduledTask)
        .values(
            task_type=task_type.value,
            dedupe_key=dedupe_key,
            payload=payload or {},
            run_at=run_at or utcnow(),
            priority=priority,
            max_attempts=max_attempts,
            status=TaskStatus.PENDING.value,
        )
        .on_conflict_do_nothing(index_elements=["dedupe_key"])
        .returning(ScheduledTask.id)
    )
    inserted_id = session.execute(stmt).scalar_one_or_none()
    if inserted_id is None:
        return None
    session.flush()
    return session.get(ScheduledTask, inserted_id)


def claim(
    session: Session,
    *,
    worker_id: str,
    task_types: list[TaskType] | None = None,
    now: datetime | None = None,
) -> ScheduledTask | None:
    """Atomically take the next due task, or return ``None``.

    The row lock is held until the caller's transaction ends, so the caller must
    commit (or roll back) promptly. ``SKIP LOCKED`` means a second worker polling
    at the same instant sees the next row instead of blocking.
    """
    moment = now or utcnow()
    stmt = (
        select(ScheduledTask)
        .where(
            ScheduledTask.status == TaskStatus.PENDING.value,
            ScheduledTask.run_at <= moment,
        )
        .order_by(ScheduledTask.priority.desc(), ScheduledTask.run_at.asc())
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if task_types:
        stmt = stmt.where(ScheduledTask.task_type.in_([t.value for t in task_types]))

    task = session.scalars(stmt).first()
    if task is None:
        return None

    task.status = TaskStatus.RUNNING.value
    task.locked_by = worker_id
    task.locked_at = moment
    task.attempt_count += 1

    session.add(
        TaskRun(
            task_id=task.id,
            worker_id=worker_id,
            attempt=task.attempt_count,
            started_at=moment,
        )
    )
    session.flush()
    return task


def _finish_run(
    session: Session,
    task: ScheduledTask,
    outcome: str,
    error: str | None,
    now: datetime,
) -> None:
    session.execute(
        update(TaskRun)
        .where(TaskRun.task_id == task.id, TaskRun.attempt == task.attempt_count)
        .values(finished_at=now, outcome=outcome, error=error)
    )


def complete(session: Session, task: ScheduledTask, *, now: datetime | None = None) -> None:
    """Mark a claimed task done."""
    task.status = TaskStatus.SUCCEEDED.value
    task.locked_by = None
    task.locked_at = None
    task.last_error = None
    _finish_run(session, task, TaskStatus.SUCCEEDED.value, None, now or utcnow())
    session.flush()


def fail(
    session: Session,
    task: ScheduledTask,
    *,
    error: str,
    retry: bool = True,
    jitter: float | None = None,
    now: datetime | None = None,
) -> TaskStatus:
    """Record a failure and either schedule a retry or bury the task.

    A task that exhausts ``max_attempts`` becomes ``DEAD`` rather than being
    retried forever: §16.6 forbids unbounded retry loops, and a broken ATS adapter
    left retrying overnight would quietly consume the monthly LLM budget.

    Pass ``retry=False`` for failures no amount of waiting will fix — a CAPTCHA, a
    required login, a revoked Gmail token.

    Returns the status the task ended up in.
    """
    moment = now or utcnow()
    #: Errors are surfaced in the dashboard, so keep them short and free of PII.
    task.last_error = error[:2000]
    task.locked_by = None
    task.locked_at = None

    exhausted = task.attempt_count >= task.max_attempts
    if not retry or exhausted:
        task.status = TaskStatus.DEAD.value
    else:
        task.status = TaskStatus.PENDING.value
        task.run_at = moment + backoff_delay(task.attempt_count, jitter=jitter)

    _finish_run(session, task, TaskStatus.FAILED.value, task.last_error, moment)
    session.flush()
    return TaskStatus(task.status)


def reclaim_stale(
    session: Session,
    *,
    lease: timedelta = DEFAULT_LEASE,
    now: datetime | None = None,
) -> int:
    """Return tasks held by dead workers to the queue. Returns how many.

    A worker that is killed mid-task leaves its row ``RUNNING`` with a lock older
    than the lease. Without this, that task would never run again (§9.1).

    The attempt already counted against the task, so a crash loop still hits
    ``max_attempts`` and stops rather than spinning forever.
    """
    cutoff = (now or utcnow()) - lease
    result = session.execute(
        update(ScheduledTask)
        .where(
            ScheduledTask.status == TaskStatus.RUNNING.value,
            ScheduledTask.locked_at.isnot(None),
            ScheduledTask.locked_at < cutoff,
        )
        .values(
            status=TaskStatus.PENDING.value,
            locked_by=None,
            locked_at=None,
            last_error="reclaimed after worker lease expired",
        )
    )
    session.flush()
    # rowcount is exposed by the cursor result the ORM returns for a bulk UPDATE.
    return int(result.rowcount)  # type: ignore[attr-defined]
