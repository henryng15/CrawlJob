"""Worker loop tests (spec §16, §9.1)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import ScheduledTask, TaskRun
from app.domain.tasks import TaskStatus, TaskType
from app.services.queue import enqueue
from app.worker.runtime import (
    HandlerResult,
    PermanentFailure,
    Registry,
    Worker,
    health,
)
from tests.helpers import not_none

pytestmark = pytest.mark.db

NOW = datetime(2026, 7, 28, 12, 0, tzinfo=UTC)


@pytest.fixture
def registry() -> Registry:
    return Registry()


@pytest.fixture
def worker(committing_db: sessionmaker[Session], registry: Registry) -> Worker:
    return Worker(
        session_factory=committing_db,
        worker_id="test-worker",
        registry=registry,
        poll_interval=0.0,
    )


def add(factory: sessionmaker[Session], key: str, **kw: object) -> None:
    with factory() as session:
        enqueue(
            session,
            task_type=kw.pop("task_type", TaskType.SCORE_JOB),  # type: ignore[arg-type]
            dedupe_key=key,
            run_at=NOW,
            **kw,  # type: ignore[arg-type]
        )
        session.commit()


def statuses(factory: sessionmaker[Session]) -> list[str]:
    with factory() as session:
        return list(session.scalars(select(ScheduledTask.status)).all())


class TestDispatch:
    def test_a_registered_handler_runs(self, worker: Worker, registry: Registry, committing_db):
        seen: list[str] = []

        @registry.register(TaskType.SCORE_JOB)
        def handle(session: Session, task: ScheduledTask) -> HandlerResult:
            seen.append(task.dedupe_key)
            return HandlerResult(detail="scored")

        add(committing_db, "score:1")
        assert worker.run_once(now=NOW)
        assert seen == ["score:1"]
        assert statuses(committing_db) == [TaskStatus.SUCCEEDED]

    def test_an_empty_queue_reports_no_work(self, worker: Worker):
        assert worker.run_once(now=NOW) is False

    def test_only_the_requested_task_types_are_claimed(
        self, worker: Worker, registry: Registry, committing_db
    ):
        ran: list[str] = []

        for task_type in (TaskType.SCORE_JOB, TaskType.PREPARE_APPLICATION):

            @registry.register(task_type)
            def handle(session, task, _t=task_type) -> HandlerResult:
                ran.append(_t.value)
                return HandlerResult()

        add(committing_db, "score", task_type=TaskType.SCORE_JOB)
        add(committing_db, "prepare", task_type=TaskType.PREPARE_APPLICATION)

        worker.task_types = [TaskType.PREPARE_APPLICATION]
        worker.run_once(now=NOW)
        assert ran == [TaskType.PREPARE_APPLICATION.value]

    def test_a_handler_may_return_none(self, worker: Worker, registry: Registry, committing_db):
        @registry.register(TaskType.SCORE_JOB)
        def handle(session: Session, task: ScheduledTask) -> None:
            return None

        add(committing_db, "score:1")
        assert worker.run_once(now=NOW)
        assert statuses(committing_db) == [TaskStatus.SUCCEEDED]


class TestUnknownTaskTypes:
    def test_a_task_with_no_handler_is_buried_not_retried(self, worker: Worker, committing_db):
        """Waiting does not teach the worker a handler it lacks."""
        add(committing_db, "orphan")
        worker.run_once(now=NOW)

        assert statuses(committing_db) == [TaskStatus.DEAD]

    def test_the_reason_is_recorded(self, worker: Worker, committing_db):
        add(committing_db, "orphan")
        worker.run_once(now=NOW)

        with committing_db() as session:
            task = not_none(session.scalars(select(ScheduledTask)).first())
            assert "no handler" in not_none(task.last_error)

    def test_the_registry_reports_what_is_missing(self, registry: Registry):
        @registry.register(TaskType.SCORE_JOB)
        def handle(session, task):
            return None

        missing = registry.missing()
        assert TaskType.SCORE_JOB not in missing
        assert TaskType.PREPARE_APPLICATION in missing

    def test_registering_twice_is_an_error(self, registry: Registry):
        @registry.register(TaskType.SCORE_JOB)
        def first(session, task):
            return None

        with pytest.raises(ValueError, match="already has a handler"):

            @registry.register(TaskType.SCORE_JOB)
            def second(session, task):
                return None


class TestFailures:
    def test_a_raising_handler_is_retried(self, worker: Worker, registry: Registry, committing_db):
        @registry.register(TaskType.SCORE_JOB)
        def handle(session: Session, task: ScheduledTask) -> HandlerResult:
            raise RuntimeError("upstream timeout")

        add(committing_db, "score:1", max_attempts=3)
        worker.run_once(now=NOW)

        assert statuses(committing_db) == [TaskStatus.PENDING]

    def test_a_permanent_failure_is_not_retried(
        self, worker: Worker, registry: Registry, committing_db
    ):
        """§16.6: a CAPTCHA or a revoked token will not fix itself."""

        @registry.register(TaskType.PREPARE_APPLICATION)
        def handle(session: Session, task: ScheduledTask) -> HandlerResult:
            raise PermanentFailure("a CAPTCHA is present; a human must take over")

        add(committing_db, "prepare:1", task_type=TaskType.PREPARE_APPLICATION, max_attempts=5)
        worker.run_once(now=NOW)

        assert statuses(committing_db) == [TaskStatus.DEAD]

    def test_exhausting_attempts_buries_the_task(
        self, worker: Worker, registry: Registry, committing_db
    ):
        @registry.register(TaskType.SCORE_JOB)
        def handle(session: Session, task: ScheduledTask) -> HandlerResult:
            raise RuntimeError("still broken")

        add(committing_db, "score:1", max_attempts=2)
        for hour in range(2):
            worker.run_once(now=NOW + timedelta(hours=hour + 2))

        assert statuses(committing_db) == [TaskStatus.DEAD]

    def test_a_failed_handler_does_not_leave_a_lock(
        self, worker: Worker, registry: Registry, committing_db
    ):
        @registry.register(TaskType.SCORE_JOB)
        def handle(session: Session, task: ScheduledTask) -> HandlerResult:
            raise RuntimeError("boom")

        add(committing_db, "score:1")
        worker.run_once(now=NOW)

        with committing_db() as session:
            task = not_none(session.scalars(select(ScheduledTask)).first())
            assert task.locked_by is None


class TestFollowUps:
    def test_a_handler_can_enqueue_the_next_stage(
        self, worker: Worker, registry: Registry, committing_db
    ):
        @registry.register(TaskType.SCORE_JOB)
        def handle(session: Session, task: ScheduledTask) -> HandlerResult:
            return HandlerResult(
                follow_ups=((TaskType.SCORE_JOB, "score:job-1", {"job_id": "job-1"}),)
            )

        add(committing_db, "sponsorship:job-1", task_type=TaskType.SCORE_JOB)
        worker.run_once(now=NOW)

        with committing_db() as session:
            keys = set(session.scalars(select(ScheduledTask.dedupe_key)).all())
            assert "score:job-1" in keys

    def test_a_failing_handler_enqueues_nothing(
        self, worker: Worker, registry: Registry, committing_db
    ):
        """The work and its consequences commit together, or not at all."""

        @registry.register(TaskType.SCORE_JOB)
        def handle(session: Session, task: ScheduledTask) -> HandlerResult:
            raise RuntimeError("failed after deciding to fan out")

        add(committing_db, "sponsorship:job-1", task_type=TaskType.SCORE_JOB)
        worker.run_once(now=NOW)

        with committing_db() as session:
            keys = set(session.scalars(select(ScheduledTask.dedupe_key)).all())
            assert keys == {"sponsorship:job-1"}


class TestCrashRecovery:
    def test_a_stale_lease_is_reclaimed_before_claiming(
        self, worker: Worker, registry: Registry, committing_db
    ):
        """§9.1: a worker killed mid-task must not strand it."""
        ran: list[str] = []

        @registry.register(TaskType.SCORE_JOB)
        def handle(session: Session, task: ScheduledTask) -> HandlerResult:
            ran.append(task.dedupe_key)
            return HandlerResult()

        add(committing_db, "score:1")
        with committing_db() as session:
            from app.services.queue import claim

            claim(session, worker_id="dead-worker", now=NOW)
            session.commit()

        assert worker.run_once(now=NOW + timedelta(minutes=20))
        assert ran == ["score:1"]


class TestRunForever:
    def test_it_drains_a_backlog_without_sleeping_between_tasks(
        self, worker: Worker, registry: Registry, committing_db
    ):
        @registry.register(TaskType.SCORE_JOB)
        def handle(session: Session, task: ScheduledTask) -> HandlerResult:
            return HandlerResult()

        for index in range(3):
            add(committing_db, f"score:{index}")

        assert worker.run_forever(max_tasks=3) == 3

    def test_a_stop_request_ends_the_loop(self, worker: Worker, registry: Registry, committing_db):
        @registry.register(TaskType.SCORE_JOB)
        def handle(session: Session, task: ScheduledTask) -> HandlerResult:
            worker.request_stop()
            return HandlerResult()

        add(committing_db, "score:1")
        add(committing_db, "score:2")

        assert worker.run_forever() == 1, "the task in hand finishes; the next does not start"


class TestAuditTrail:
    def test_each_attempt_is_recorded(self, worker: Worker, registry: Registry, committing_db):
        @registry.register(TaskType.SCORE_JOB)
        def handle(session: Session, task: ScheduledTask) -> HandlerResult:
            return HandlerResult()

        add(committing_db, "score:1")
        worker.run_once(now=NOW)

        with committing_db() as session:
            run = not_none(session.scalars(select(TaskRun)).first())
            assert run.worker_id == "test-worker"
            assert run.finished_at is not None
            assert run.outcome == TaskStatus.SUCCEEDED


class TestHealth:
    def test_it_counts_by_status(self, worker: Worker, registry: Registry, committing_db):
        @registry.register(TaskType.SCORE_JOB)
        def handle(session: Session, task: ScheduledTask) -> HandlerResult:
            return HandlerResult()

        add(committing_db, "score:1")
        add(committing_db, "score:2")
        worker.run_once(now=NOW)

        with committing_db() as session:
            report = health(session)
        assert report["succeeded"] == 1
        assert report["pending"] == 1
