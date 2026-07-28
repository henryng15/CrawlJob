"""Worker loop and task dispatch (spec §16, §9.1).

Claims a task, runs its handler, and records the outcome. The loop itself holds no
domain knowledge — handlers are registered by task type, so adding a stage to the
pipeline does not mean touching this file.

Three properties the loop is responsible for:

* **A handler's work and its completion commit together.** The transaction spans
  both, so a crash between "did the work" and "marked it done" is impossible: one
  or the other, never a half.
* **An unknown task type does not spin.** It is buried immediately rather than
  retried, because no amount of waiting teaches the worker a handler it does not
  have.
* **A crashed worker's tasks come back.** Each pass reclaims expired leases before
  claiming anything new.
"""

from __future__ import annotations

import logging
import os
import signal
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from types import FrameType
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from app.db.base import utcnow
from app.db.models import ScheduledTask
from app.domain.tasks import TaskStatus, TaskType
from app.services.queue import DEFAULT_LEASE, claim, complete, fail, reclaim_stale

__all__ = ["Handler", "HandlerResult", "Worker", "registry"]

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class HandlerResult:
    """What a handler did. Returned so the loop can log without guessing."""

    detail: str = ""
    #: Tasks to enqueue as a consequence. Committed in the same transaction, so a
    #: stage that fans out cannot half-fan-out.
    follow_ups: tuple[tuple[TaskType, str, dict[str, Any]], ...] = ()


class PermanentFailure(Exception):
    """A failure no retry can fix: a CAPTCHA, a manual login, a revoked token.

    Raising this instead of a plain exception is how a handler says "stop", and
    §16.6 requires those cases to stop rather than back off and try again.
    """


Handler = Callable[[Session, ScheduledTask], HandlerResult | None]


@dataclass(slots=True)
class Registry:
    """Maps task types to handlers."""

    handlers: dict[TaskType, Handler] = field(default_factory=dict)

    def register(self, task_type: TaskType) -> Callable[[Handler], Handler]:
        def decorator(handler: Handler) -> Handler:
            if task_type in self.handlers:
                raise ValueError(f"{task_type.value} already has a handler")
            self.handlers[task_type] = handler
            return handler

        return decorator

    def get(self, task_type: str) -> Handler | None:
        try:
            return self.handlers.get(TaskType(task_type))
        except ValueError:
            return None

    @property
    def registered(self) -> frozenset[TaskType]:
        return frozenset(self.handlers)

    def missing(self) -> frozenset[TaskType]:
        """Task types with no handler. Surfaced on the health page."""
        return frozenset(TaskType) - self.registered


registry = Registry()


@dataclass(slots=True)
class Worker:
    """Polls the queue and runs whatever it finds."""

    session_factory: sessionmaker[Session]
    worker_id: str = field(default_factory=lambda: f"worker-{os.getpid()}")
    task_types: list[TaskType] | None = None
    lease: timedelta = DEFAULT_LEASE
    poll_interval: float = 5.0
    registry: Registry = field(default_factory=lambda: registry)

    _stopping: bool = False
    processed: int = 0

    def request_stop(self, *_: object) -> None:
        """Finish the task in hand, then exit. Wired to SIGTERM and SIGINT."""
        self._stopping = True

    def install_signal_handlers(self) -> None:
        for received in (signal.SIGTERM, signal.SIGINT):
            signal.signal(received, self._on_signal)

    def _on_signal(self, signum: int, frame: FrameType | None) -> None:
        log.info("worker %s received signal %s; finishing current task", self.worker_id, signum)
        self.request_stop()

    def run_once(self, *, now: datetime | None = None) -> bool:
        """Reclaim stale leases, then run at most one task.

        Returns whether a task was run, so the caller knows whether to sleep.
        """
        moment = now or utcnow()

        with self.session_factory() as session:
            recovered = reclaim_stale(session, lease=self.lease, now=moment)
            session.commit()
            if recovered:
                log.warning("reclaimed %d task(s) from an expired lease", recovered)

        with self.session_factory() as session:
            task = claim(session, worker_id=self.worker_id, task_types=self.task_types, now=moment)
            if task is None:
                session.commit()
                return False

            self._execute(session, task, now=moment)
            session.commit()

        self.processed += 1
        return True

    def _execute(self, session: Session, task: ScheduledTask, *, now: datetime) -> None:
        """Run one task. ``now`` is threaded through so retry scheduling uses the
        same clock as the claim, rather than the wall clock."""
        handler = self.registry.get(task.task_type)

        if handler is None:
            # No retry: waiting does not teach the worker a handler it lacks.
            fail(session, task, error=f"no handler for {task.task_type}", retry=False, now=now)
            log.error("no handler registered for %s", task.task_type)
            return

        try:
            result = handler(session, task) or HandlerResult()
        except PermanentFailure as exc:
            fail(session, task, error=str(exc), retry=False, now=now)
            log.warning("task %s failed permanently: %s", task.id, exc)
            return
        except Exception as exc:
            status = fail(session, task, error=f"{type(exc).__name__}: {exc}", now=now)
            log.exception(
                "task %s failed (attempt %d/%d) -> %s",
                task.id,
                task.attempt_count,
                task.max_attempts,
                status.value,
            )
            return

        for task_type, dedupe_key, payload in result.follow_ups:
            from app.services.queue import enqueue

            enqueue(session, task_type=task_type, dedupe_key=dedupe_key, payload=payload)

        complete(session, task, now=now)
        log.info("task %s (%s) done: %s", task.id, task.task_type, result.detail)

    def run_forever(self, *, max_tasks: int | None = None) -> int:
        """Poll until stopped. Returns how many tasks ran.

        Sleeps only when the queue is empty, so a backlog drains at full speed
        rather than one task per interval.
        """
        while not self._stopping:
            if max_tasks is not None and self.processed >= max_tasks:
                break
            try:
                did_work = self.run_once()
            except Exception:
                # Reaching here means the loop itself broke, not a task. Sleeping
                # keeps a database outage from becoming a hot spin.
                log.exception("worker loop error; backing off")
                time.sleep(self.poll_interval)
                continue

            if not did_work:
                time.sleep(self.poll_interval)

        log.info("worker %s stopped after %d task(s)", self.worker_id, self.processed)
        return self.processed


def health(session: Session) -> dict[str, Any]:
    """Queue health, for ``/health/queue`` (§25.1)."""
    from sqlalchemy import func, select

    rows = session.execute(
        select(ScheduledTask.status, func.count()).group_by(ScheduledTask.status)
    ).all()
    counts: dict[str, int] = {status: total for status, total in rows}
    return {
        "pending": counts.get(TaskStatus.PENDING.value, 0),
        "running": counts.get(TaskStatus.RUNNING.value, 0),
        "dead": counts.get(TaskStatus.DEAD.value, 0),
        "succeeded": counts.get(TaskStatus.SUCCEEDED.value, 0),
        "handlers_missing": sorted(t.value for t in registry.missing()),
    }
