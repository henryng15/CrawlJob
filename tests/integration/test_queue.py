"""Durable task queue tests (spec §11.3, §16.5, §16.6, §9.1).

The concurrency and crash-recovery tests use real, separate database connections.
A mock cannot demonstrate that ``FOR UPDATE SKIP LOCKED`` does what we need it to.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import ScheduledTask, TaskRun
from app.domain.tasks import TaskStatus, TaskType, idempotency_key
from app.services.queue import (
    backoff_delay,
    claim,
    complete,
    enqueue,
    fail,
    reclaim_stale,
)
from tests.helpers import not_none

pytestmark = pytest.mark.db

NOW = datetime(2026, 7, 28, 12, 0, tzinfo=UTC)


def add(session: Session, key: str, **kw: object) -> ScheduledTask | None:
    return enqueue(
        session,
        task_type=kw.pop("task_type", TaskType.SCORE_JOB),  # type: ignore[arg-type]
        dedupe_key=key,
        run_at=kw.pop("run_at", NOW),  # type: ignore[arg-type]
        **kw,  # type: ignore[arg-type]
    )


class TestIdempotentEnqueue:
    def test_first_enqueue_returns_a_task(self, db: Session):
        task = add(db, "score:job-1")
        assert task is not None
        assert task.status == TaskStatus.PENDING
        assert task.attempt_count == 0

    def test_duplicate_dedupe_key_returns_none(self, db: Session):
        """§16.5: the scheduler firing twice must not double the work."""
        assert add(db, "score:job-1") is not None
        assert add(db, "score:job-1") is None
        assert db.scalar(select(func.count()).select_from(ScheduledTask)) == 1

    def test_different_keys_coexist(self, db: Session):
        add(db, "score:job-1")
        add(db, "score:job-2")
        assert db.scalar(select(func.count()).select_from(ScheduledTask)) == 2

    def test_idempotency_key_distinguishes_prompt_versions(self, db: Session):
        """A prompt change must produce new work, not silently reuse the old result."""
        v1 = idempotency_key(TaskType.SCORE_JOB, "job-1", "hash", "v1")
        v2 = idempotency_key(TaskType.SCORE_JOB, "job-1", "hash", "v2")
        assert add(db, v1) is not None
        assert add(db, v2) is not None

    def test_idempotency_key_components_cannot_collide(self):
        assert idempotency_key(TaskType.SCORE_JOB, "a", None, "b") != idempotency_key(
            TaskType.SCORE_JOB, "a", "b"
        )


class TestClaim:
    def test_claims_a_due_task(self, db: Session):
        add(db, "k1")
        task = not_none(claim(db, worker_id="w1", now=NOW))
        assert task is not None
        assert task.status == TaskStatus.RUNNING
        assert task.locked_by == "w1"
        assert task.attempt_count == 1

    def test_does_not_claim_a_future_task(self, db: Session):
        add(db, "k1", run_at=NOW + timedelta(hours=1))
        assert claim(db, worker_id="w1", now=NOW) is None

    def test_respects_priority_then_age(self, db: Session):
        add(db, "low", priority=0, run_at=NOW - timedelta(hours=2))
        add(db, "high", priority=10, run_at=NOW)
        add(db, "old", priority=0, run_at=NOW - timedelta(hours=3))
        assert not_none(claim(db, worker_id="w", now=NOW)).dedupe_key == "high"
        assert not_none(claim(db, worker_id="w", now=NOW)).dedupe_key == "old"
        assert not_none(claim(db, worker_id="w", now=NOW)).dedupe_key == "low"

    def test_can_filter_by_task_type(self, db: Session):
        add(db, "score", task_type=TaskType.SCORE_JOB)
        add(db, "draft", task_type=TaskType.PREPARE_APPLICATION)
        task = not_none(
            claim(db, worker_id="w", task_types=[TaskType.PREPARE_APPLICATION], now=NOW)
        )
        assert task is not None
        assert task.dedupe_key == "draft"

    def test_empty_queue_returns_none(self, db: Session):
        assert claim(db, worker_id="w", now=NOW) is None

    def test_records_a_task_run(self, db: Session):
        add(db, "k1")
        task = not_none(claim(db, worker_id="w1", now=NOW))
        run = db.scalars(select(TaskRun).where(TaskRun.task_id == task.id)).one()
        assert run.worker_id == "w1"
        assert run.attempt == 1
        assert run.finished_at is None


class TestConcurrency:
    def test_two_workers_never_claim_the_same_task(self, committing_db: sessionmaker[Session]):
        """The property the whole queue design exists to provide.

        Both workers hold open transactions at the same moment, which is exactly
        the race a naive ``SELECT`` then ``UPDATE`` would lose.
        """
        with committing_db() as setup:
            for i in range(4):
                add(setup, f"k{i}")
            setup.commit()

        s1, s2 = committing_db(), committing_db()
        try:
            first = claim(s1, worker_id="w1", now=NOW)
            second = claim(s2, worker_id="w2", now=NOW)

            assert first is not None and second is not None
            assert first.id != second.id, "SKIP LOCKED must hand out different rows"
            s1.commit()
            s2.commit()
        finally:
            s1.close()
            s2.close()

        with committing_db() as check:
            running = check.scalars(
                select(ScheduledTask).where(ScheduledTask.status == TaskStatus.RUNNING.value)
            ).all()
            assert len(running) == 2
            assert {t.locked_by for t in running} == {"w1", "w2"}

    def test_second_worker_gets_nothing_when_only_one_task_exists(
        self, committing_db: sessionmaker[Session]
    ):
        with committing_db() as setup:
            add(setup, "only")
            setup.commit()

        s1, s2 = committing_db(), committing_db()
        try:
            assert claim(s1, worker_id="w1", now=NOW) is not None
            assert claim(s2, worker_id="w2", now=NOW) is None, "must skip, not block"
            s1.commit()
        finally:
            s1.close()
            s2.close()


class TestCompletion:
    def test_complete_clears_the_lock(self, db: Session):
        add(db, "k1")
        task = not_none(claim(db, worker_id="w1", now=NOW))
        complete(db, task)
        assert task.status == TaskStatus.SUCCEEDED
        assert task.locked_by is None
        assert task.locked_at is None

    def test_complete_closes_the_run(self, db: Session):
        add(db, "k1")
        task = not_none(claim(db, worker_id="w1", now=NOW))
        complete(db, task)
        run = db.scalars(select(TaskRun).where(TaskRun.task_id == task.id)).one()
        assert run.finished_at is not None
        assert run.outcome == TaskStatus.SUCCEEDED

    def test_completed_task_is_not_reclaimed(self, db: Session):
        add(db, "k1")
        complete(db, not_none(claim(db, worker_id="w1", now=NOW)))
        assert reclaim_stale(db, now=NOW + timedelta(days=1)) == 0


class TestFailureAndRetry:
    def test_retryable_failure_returns_to_pending_with_backoff(self, db: Session):
        add(db, "k1", max_attempts=3)
        task = not_none(claim(db, worker_id="w1", now=NOW))
        status = fail(db, task, error="timeout", jitter=0.0, now=NOW)
        assert status == TaskStatus.PENDING
        assert task.run_at > NOW
        assert task.locked_by is None

    def test_backoff_grows_between_attempts(self, db: Session):
        add(db, "k1", max_attempts=5)
        delays = []
        for i in range(3):
            moment = NOW + timedelta(hours=i)
            task = not_none(claim(db, worker_id="w", now=moment))
            fail(db, task, error="boom", jitter=0.0, now=moment)
            delays.append(task.run_at - moment)
        assert delays[0] < delays[1] < delays[2]

    def test_exhausting_attempts_buries_the_task(self, db: Session):
        """§16.6: no unbounded retry loops.

        A broken adapter retrying all night would quietly spend the LLM budget.
        """
        add(db, "k1", max_attempts=2)
        for i in range(2):
            moment = NOW + timedelta(hours=i)
            task = not_none(claim(db, worker_id="w", now=moment))
            status = fail(db, task, error="boom", jitter=0.0, now=moment)
        assert status == TaskStatus.DEAD
        assert claim(db, worker_id="w", now=NOW + timedelta(days=1)) is None

    def test_non_retryable_failure_buries_immediately(self, db: Session):
        """CAPTCHA, manual login, revoked token: waiting will not help (§16.6)."""
        add(db, "k1", max_attempts=5)
        task = not_none(claim(db, worker_id="w", now=NOW))
        assert fail(db, task, error="captcha", retry=False) == TaskStatus.DEAD
        assert task.attempt_count == 1

    def test_error_message_is_truncated(self, db: Session):
        add(db, "k1")
        task = not_none(claim(db, worker_id="w", now=NOW))
        fail(db, task, error="x" * 10_000, jitter=0.0, now=NOW)
        assert len(not_none(task.last_error)) == 2000


class TestCrashRecovery:
    def test_stale_lock_is_reclaimed(self, db: Session):
        """A worker killed mid-task must not strand it forever (§9.1)."""
        add(db, "k1", max_attempts=5)
        claim(db, worker_id="dead-worker", now=NOW)

        assert reclaim_stale(db, now=NOW + timedelta(minutes=20)) == 1
        recovered = not_none(claim(db, worker_id="w2", now=NOW + timedelta(minutes=21)))
        assert recovered.locked_by == "w2"

    def test_lock_within_the_lease_is_left_alone(self, db: Session):
        """A slow task is not a dead worker."""
        add(db, "k1")
        claim(db, worker_id="w1", now=NOW)
        assert reclaim_stale(db, now=NOW + timedelta(minutes=5)) == 0

    def test_attempt_count_survives_reclaim_so_crash_loops_terminate(self, db: Session):
        """Otherwise a task that kills its worker would be retried forever."""
        add(db, "k1", max_attempts=2)
        claim(db, worker_id="w1", now=NOW)
        reclaim_stale(db, now=NOW + timedelta(minutes=20))
        task = not_none(claim(db, worker_id="w2", now=NOW + timedelta(minutes=21)))
        assert task.attempt_count == 2

        assert fail(db, task, error="crashed again", jitter=0.0, now=NOW) == TaskStatus.DEAD

    def test_pending_tasks_are_untouched(self, db: Session):
        add(db, "k1")
        assert reclaim_stale(db, now=NOW + timedelta(days=1)) == 0


class TestBackoffDelay:
    def test_grows_exponentially(self):
        delays = [backoff_delay(a, jitter=0.0) for a in range(1, 6)]
        assert delays == sorted(delays)
        assert delays[1] == delays[0] * 2

    def test_is_capped(self):
        assert backoff_delay(50, jitter=0.0) == timedelta(hours=1)

    def test_jitter_stays_within_bounds(self):
        base = backoff_delay(3, jitter=0.0)
        assert base <= backoff_delay(3, jitter=0.99) <= base * 1.25

    def test_rejects_attempt_zero(self):
        with pytest.raises(ValueError, match="must be >= 1"):
            backoff_delay(0)
