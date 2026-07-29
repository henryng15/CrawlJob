"""Recurring work (spec §16.2).

The property that makes the design work: the idempotency key carries the time
bucket, so any number of workers may tick concurrently and the queue collapses
the duplicates. These tests assert that directly rather than trusting it.
"""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import ScheduledTask, SourceRegistry
from app.domain.tasks import TaskType
from app.worker.scheduler import SCHEDULE, Cadence, tick

pytestmark = pytest.mark.db


@pytest.fixture
def settings() -> Settings:
    return Settings(app_env="development", app_secret_key="scheduler-tests")


def at_local(settings: Settings, *, hour: int, minute: int = 0, day: int = 29) -> datetime:
    """A moment expressed in the business timezone, returned as UTC."""
    local = datetime(2026, 7, day, hour, minute, tzinfo=settings.timezone)
    return local.astimezone(UTC)


def queued(db: Session, task_type: TaskType | None = None) -> list[ScheduledTask]:
    stmt = select(ScheduledTask)
    if task_type is not None:
        stmt = stmt.where(ScheduledTask.task_type == task_type)
    return list(db.scalars(stmt).all())


class TestCadence:
    def test_a_daily_job_is_not_due_before_its_hour(self, settings: Settings):
        assert Cadence(at=time(7, 0)).bucket(at_local(settings, hour=6), settings.timezone) is None

    def test_a_daily_job_is_due_after_its_hour(self, settings: Settings):
        moment = at_local(settings, hour=7, minute=1)
        bucket = Cadence(at=time(7, 0)).bucket(moment, settings.timezone)
        assert bucket == "2026-07-29"

    def test_a_daily_job_started_late_still_runs_today(self, settings: Settings):
        """A worker that boots at 09:00 must not skip the 07:00 discovery."""
        bucket = Cadence(at=time(7, 0)).bucket(at_local(settings, hour=9), settings.timezone)
        assert bucket == "2026-07-29"

    def test_the_day_is_local_not_utc(self, settings: Settings):
        """At 21:00 Eastern the UTC date has already rolled over.

        Using UTC would make the evening's discovery look like tomorrow's and run
        a second time.
        """
        evening = at_local(settings, hour=21)
        assert evening.astimezone(UTC).date().isoformat() == "2026-07-30"
        assert Cadence(at=time(7, 0)).bucket(evening, settings.timezone) == "2026-07-29"

    def test_a_periodic_job_shares_a_bucket_within_its_window(self, settings: Settings):
        cadence = Cadence(every=timedelta(minutes=30))
        first = cadence.bucket(datetime(2026, 7, 29, 12, 0, tzinfo=UTC), settings.timezone)
        later = cadence.bucket(datetime(2026, 7, 29, 12, 29, tzinfo=UTC), settings.timezone)
        assert first == later

    def test_a_periodic_job_changes_bucket_at_the_boundary(self, settings: Settings):
        cadence = Cadence(every=timedelta(minutes=30))
        before = cadence.bucket(datetime(2026, 7, 29, 12, 29, tzinfo=UTC), settings.timezone)
        after = cadence.bucket(datetime(2026, 7, 29, 12, 31, tzinfo=UTC), settings.timezone)
        assert before != after


class TestTick:
    def test_the_periodic_jobs_are_queued(self, db: Session, settings: Settings):
        assert tick(db, settings, now=at_local(settings, hour=12)) >= 3

        types = {t.task_type for t in queued(db)}
        assert "RECONCILE_GMAIL" in types
        assert "RECONCILE_SUBMISSION" in types
        assert "SCHEDULE_OUTREACH" in types

    def test_ticking_twice_in_one_window_queues_nothing_new(
        self, db: Session, settings: Settings
    ):
        """The property the whole design rests on."""
        moment = at_local(settings, hour=12)
        first = tick(db, settings, now=moment)
        second = tick(db, settings, now=moment + timedelta(seconds=5))

        assert first > 0
        assert second == 0

    def test_two_workers_ticking_together_do_not_double_fire(
        self, committing_db, settings: Settings
    ):
        """No lock, no leader election — the dedupe key does the work."""
        moment = at_local(settings, hour=12)
        with committing_db() as a, committing_db() as b:
            tick(a, settings, now=moment)
            a.commit()
            tick(b, settings, now=moment)
            b.commit()

        with committing_db() as session:
            total = session.scalar(select(func.count()).select_from(ScheduledTask))
            distinct = session.scalar(
                select(func.count(func.distinct(ScheduledTask.dedupe_key)))
            )
            assert total == distinct

    def test_a_new_window_queues_again(self, db: Session, settings: Settings):
        moment = at_local(settings, hour=12)
        tick(db, settings, now=moment)
        assert tick(db, settings, now=moment + timedelta(hours=1)) > 0

    def test_a_nightly_job_is_not_queued_before_its_hour(
        self, db: Session, settings: Settings
    ):
        tick(db, settings, now=at_local(settings, hour=1))
        assert queued(db, TaskType.BACKUP_DATABASE) == []

    def test_nightly_jobs_are_queued_after_their_hour(self, db: Session, settings: Settings):
        tick(db, settings, now=at_local(settings, hour=4))
        assert len(queued(db, TaskType.BACKUP_DATABASE)) == 1
        assert len(queued(db, TaskType.CLEANUP_EXPIRED_SESSION)) == 1

    def test_a_worker_started_at_noon_still_runs_the_night_backup(
        self, db: Session, settings: Settings
    ):
        """Deliberate: a day with no backup is worse than a backup at an odd hour.

        The bucket is the local date, so it still runs exactly once.
        """
        tick(db, settings, now=at_local(settings, hour=12))
        tick(db, settings, now=at_local(settings, hour=13))
        assert len(queued(db, TaskType.BACKUP_DATABASE)) == 1

    def test_every_scheduled_job_names_a_real_task_type(self):
        """A job naming a type with no handler would be buried every occurrence."""
        for job in SCHEDULE:
            assert job.task_type in set(TaskType)


class TestDiscoveryScheduling:
    def test_nothing_is_queued_without_sources(self, db: Session, settings: Settings):
        tick(db, settings, now=at_local(settings, hour=8))
        assert queued(db, TaskType.DISCOVER_SOURCE) == []

    def test_one_task_per_enabled_source(self, db: Session, settings: Settings):
        """One per source, so a board returning 500 costs only itself."""
        db.add(SourceRegistry(kind="greenhouse", identifier="stripe"))
        db.add(SourceRegistry(kind="lever", identifier="figma"))
        db.flush()

        tick(db, settings, now=at_local(settings, hour=8))
        tasks = queued(db, TaskType.DISCOVER_SOURCE)
        assert len(tasks) == 2
        assert {t.payload["name"] for t in tasks} == {"stripe", "figma"}

    def test_a_disabled_source_is_skipped(self, db: Session, settings: Settings):
        db.add(SourceRegistry(kind="greenhouse", identifier="stripe", enabled=False))
        db.flush()

        tick(db, settings, now=at_local(settings, hour=8))
        assert queued(db, TaskType.DISCOVER_SOURCE) == []

    def test_discovery_is_queued_once_a_day(self, db: Session, settings: Settings):
        db.add(SourceRegistry(kind="greenhouse", identifier="stripe"))
        db.flush()

        tick(db, settings, now=at_local(settings, hour=8))
        tick(db, settings, now=at_local(settings, hour=15))
        assert len(queued(db, TaskType.DISCOVER_SOURCE)) == 1

    def test_the_payload_matches_what_the_adapter_expects(
        self, db: Session, settings: Settings
    ):
        """A payload the adapter factory cannot read means a task buried daily."""
        from app.worker.sources import adapters_for

        db.add(
            SourceRegistry(
                kind="github_feed",
                identifier="SimplifyJobs/Summer2027-Internships",
                options={"branch": "dev"},
            )
        )
        db.flush()
        tick(db, settings, now=at_local(settings, hour=8))

        payload = queued(db, TaskType.DISCOVER_SOURCE)[0].payload
        adapters = adapters_for(payload, settings=settings)
        assert len(adapters) == 1
        assert adapters[0].branch == "dev"

    def test_an_unknown_kind_is_refused_by_the_database(self, db: Session):
        """A typo would otherwise be scheduled every day and fail every day."""
        from sqlalchemy.exc import IntegrityError

        db.add(SourceRegistry(kind="workday", identifier="acme"))
        with pytest.raises(IntegrityError):
            db.flush()
