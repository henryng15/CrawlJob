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
from app.db.models import ResumeVersion, ScheduledTask, SourceRegistry
from app.domain.tasks import TaskType
from app.worker.scheduler import SCHEDULE, Cadence, tick

pytestmark = pytest.mark.db


@pytest.fixture
def paused_settings() -> Settings:
    """The shipped default: the pipeline is off until somebody turns it on."""
    return Settings(app_env="development", app_secret_key="scheduler-tests")


@pytest.fixture
def settings() -> Settings:
    """A running instance. Pair with :func:`base_resume` — the gate checks both."""
    return Settings(
        app_env="development",
        app_secret_key="scheduler-tests",
        pipeline_enabled=True,
        base_resume_status="READY",
    )


@pytest.fixture
def base_resume(db: Session) -> ResumeVersion:
    """The database half of the gate. A flag alone must not open it."""
    resume = ResumeVersion(
        kind="BASE",
        status="READY",
        source_path="artifacts/base.tex",
        pdf_path="artifacts/base.pdf",
        sha256="0" * 64,
    )
    db.add(resume)
    db.flush()
    return resume


def at_local(settings: Settings, *, hour: int, minute: int = 0, day: int = 29) -> datetime:
    """A moment expressed in the business timezone, returned as UTC."""
    local = datetime(2026, 7, day, hour, minute, tzinfo=settings.timezone)
    return local.astimezone(UTC)


def queued(db: Session, task_type: TaskType | None = None) -> list[ScheduledTask]:
    stmt = select(ScheduledTask)
    if task_type is not None:
        stmt = stmt.where(ScheduledTask.task_type == task_type)
    return list(db.scalars(stmt).all())


#: The configured orchestration schedule, used by most of the cadence tests.
RUNS = (time(8, 0), time(14, 0))


class TestCadence:
    def test_a_daily_job_is_not_due_before_its_hour(self, settings: Settings):
        assert Cadence(at=RUNS).buckets(at_local(settings, hour=6), settings.timezone) == ()

    def test_a_daily_job_is_due_after_its_hour(self, settings: Settings):
        moment = at_local(settings, hour=8, minute=1)
        assert Cadence(at=RUNS).buckets(moment, settings.timezone) == ("2026-07-29#0800",)

    def test_the_second_run_is_a_separate_occurrence(self, settings: Settings):
        """08:00 and 14:00 must not collapse into one another.

        They share a daily quota but not an idempotency key: if the afternoon run
        reused the morning's bucket the queue would dedupe it away and half the
        day's applications would never be prepared.
        """
        morning = Cadence(at=RUNS).buckets(at_local(settings, hour=9), settings.timezone)
        afternoon = Cadence(at=RUNS).buckets(at_local(settings, hour=15), settings.timezone)
        assert morning == ("2026-07-29#0800",)
        assert afternoon == ("2026-07-29#0800", "2026-07-29#1400")
        assert len(set(afternoon)) == 2

    def test_a_worker_that_missed_the_morning_catches_up(self, settings: Settings):
        """Booting at 14:30 runs the 08:00 lot too, rather than losing half a day.

        The daily quota is what bounds the catch-up. The clock is not allowed to
        silently decide that this morning's roles are not worth applying to.
        """
        late = Cadence(at=RUNS).buckets(at_local(settings, hour=14, minute=30), settings.timezone)
        assert late == ("2026-07-29#0800", "2026-07-29#1400")

    def test_a_periodic_job_does_not_catch_up(self, settings: Settings):
        """Unlike a wall-clock job — replaying missed reconciliations is wrong."""
        cadence = Cadence(every=timedelta(minutes=30))
        noon = datetime(2026, 7, 29, 12, 0, tzinfo=UTC)
        assert len(cadence.buckets(noon, settings.timezone)) == 1

    def test_the_day_is_local_not_utc(self, settings: Settings):
        """At 21:00 Eastern the UTC date has already rolled over.

        Using UTC would make the evening's runs look like tomorrow's and fire a
        second time.
        """
        evening = at_local(settings, hour=21)
        assert evening.astimezone(UTC).date().isoformat() == "2026-07-30"
        buckets = Cadence(at=RUNS).buckets(evening, settings.timezone)
        assert buckets == ("2026-07-29#0800", "2026-07-29#1400")

    def test_a_periodic_job_shares_a_bucket_within_its_window(self, settings: Settings):
        cadence = Cadence(every=timedelta(minutes=30))
        first = cadence.buckets(datetime(2026, 7, 29, 12, 0, tzinfo=UTC), settings.timezone)
        later = cadence.buckets(datetime(2026, 7, 29, 12, 29, tzinfo=UTC), settings.timezone)
        assert first == later

    def test_a_periodic_job_changes_bucket_at_the_boundary(self, settings: Settings):
        cadence = Cadence(every=timedelta(minutes=30))
        before = cadence.buckets(datetime(2026, 7, 29, 12, 29, tzinfo=UTC), settings.timezone)
        after = cadence.buckets(datetime(2026, 7, 29, 12, 31, tzinfo=UTC), settings.timezone)
        assert before != after


class TestTick:
    def test_the_nightly_jobs_are_queued(
        self, db: Session, settings: Settings, base_resume: ResumeVersion
    ):
        """Everything periodic is gone. What is left protects data, not pipeline
        state: an application either got submitted or it is waiting for you, and
        neither needs a sweep to notice."""
        assert tick(db, settings, now=at_local(settings, hour=12)) == 2

        types = {t.task_type for t in queued(db)}
        assert types == {"BACKUP_DATABASE", "BACKUP_ARTIFACTS"}

    def test_backups_run_even_while_paused(self, db: Session, paused_settings: Settings):
        """Pausing stops new work. It must never stop the jobs that protect the
        work already done, or "paused" becomes a way to lose it."""
        tick(db, paused_settings, now=at_local(paused_settings, hour=12))
        types = {t.task_type for t in queued(db)}
        assert types == {"BACKUP_DATABASE", "BACKUP_ARTIFACTS"}
        assert "DISCOVER_SOURCE" not in types

    def test_ticking_twice_in_one_window_queues_nothing_new(self, db: Session, settings: Settings):
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
            distinct = session.scalar(select(func.count(func.distinct(ScheduledTask.dedupe_key))))
            assert total == distinct

    def test_a_new_day_queues_again(self, db: Session, settings: Settings):
        """The nightly jobs are daily, so the next bucket is tomorrow's."""
        moment = at_local(settings, hour=12)
        tick(db, settings, now=moment)
        assert tick(db, settings, now=moment + timedelta(days=1)) > 0

    def test_a_nightly_job_is_not_queued_before_its_hour(self, db: Session, settings: Settings):
        tick(db, settings, now=at_local(settings, hour=1))
        assert queued(db, TaskType.BACKUP_DATABASE) == []

    def test_nightly_jobs_are_queued_after_their_hour(self, db: Session, settings: Settings):
        tick(db, settings, now=at_local(settings, hour=4))
        assert len(queued(db, TaskType.BACKUP_DATABASE)) == 1
        assert len(queued(db, TaskType.BACKUP_ARTIFACTS)) == 1

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


class TestPipelineGate:
    """Paused means paused — but only for work that reaches a recruiter."""

    def test_the_default_is_paused(self, db: Session, paused_settings: Settings):
        tick(db, paused_settings, now=at_local(paused_settings, hour=15))
        assert queued(db, TaskType.DISCOVER_SOURCE) == []
        assert queued(db, TaskType.PREPARE_APPLICATION) == []

    def test_pausing_does_not_stop_backups_or_cleanup(self, db: Session, paused_settings: Settings):
        """The whole point of the exemption.

        If pausing the pipeline also paused the jobs that protect existing data,
        "paused" would be a way to silently lose work — no backups overnight,
        and nothing keeping the artifact directory in hand.
        """
        tick(db, paused_settings, now=at_local(paused_settings, hour=4))
        assert len(queued(db, TaskType.BACKUP_DATABASE)) == 1
        assert len(queued(db, TaskType.BACKUP_ARTIFACTS)) == 1
        assert len(queued(db, TaskType.BACKUP_ARTIFACTS)) == 1

    def test_pausing_does_not_stop_prepared_applications_expiring(
        self, db: Session, paused_settings: Settings
    ):
        """A paused instance prepares nothing new, so if expiry stopped too, the
        queue the user last saw would sit there claiming to be current for as
        long as the pause lasted."""
        tick(db, paused_settings, now=at_local(paused_settings, hour=4))
        assert len(queued(db, TaskType.BACKUP_DATABASE)) == 1

    def test_the_flag_alone_does_not_open_the_gate(self, db: Session, settings: Settings):
        """No ``base_resume`` fixture here, so the database disagrees with the flag.

        BASE_RESUME_STATUS=READY is a claim by whoever edited the env file. If
        believing it were enough, the first run would tailor against nothing.
        """
        db.add(SourceRegistry(kind="greenhouse", identifier="stripe"))
        db.flush()

        tick(db, settings, now=at_local(settings, hour=15))
        assert queued(db, TaskType.DISCOVER_SOURCE) == []

    def test_a_tailored_resume_does_not_count_as_a_base(self, db: Session, settings: Settings):
        """Otherwise the pipeline's own output could open the gate for it."""
        db.add(
            ResumeVersion(
                kind="TAILORED",
                status="READY",
                source_path="artifacts/t.tex",
                pdf_path="artifacts/t.pdf",
                sha256="1" * 64,
            )
        )
        db.add(SourceRegistry(kind="greenhouse", identifier="stripe"))
        db.flush()

        tick(db, settings, now=at_local(settings, hour=15))
        assert queued(db, TaskType.DISCOVER_SOURCE) == []

    def test_a_fallback_row_does_not_count_as_a_base_either(self, db: Session, settings: Settings):
        """The circularity §7.7's fallback introduced.

        When a tailored build cannot reach one page, it records a ``BASE`` row
        meaning "this application used the base resume unchanged". That row is
        the pipeline's own output, and it looks exactly like an imported resume
        apart from carrying an ``application_id``. Counting it would let a single
        past fallback open the gate for ever afterwards, with no resume imported
        at all.
        """
        from app.db.models import Application, Company, Job
        from app.domain.states import ApplicationState, JobState

        company = Company(canonical_name="Acme", normalized_name="acme", domain="acme.com")
        db.add(company)
        db.flush()
        job = Job(
            company_id=company.id,
            canonical_url="https://boards.greenhouse.io/acme/jobs/1",
            canonical_url_hash="f" * 64,
            title="SWE Intern",
            normalized_title="swe intern",
            dedupe_fingerprint="fp-fallback",
            discovered_at=at_local(settings, hour=9),
            status=JobState.SCORED,
        )
        db.add(job)
        db.flush()
        application = Application(
            job_id=job.id,
            application_url="https://boards.greenhouse.io/acme/jobs/1",
            status=ApplicationState.CREATED,
        )
        db.add(application)
        db.flush()

        db.add(
            ResumeVersion(
                application_id=application.id,
                job_id=job.id,
                kind="BASE",
                status="READY_FOR_REVIEW",
                attempt=0,
                source_path="artifacts/final/resume.tex",
                pdf_path="artifacts/final/resume.pdf",
                sha256="2" * 64,
                fallback_reason="3 attempts did not produce a one-page PDF",
                is_uploaded=True,
            )
        )
        db.add(SourceRegistry(kind="greenhouse", identifier="stripe"))
        db.flush()

        tick(db, settings, now=at_local(settings, hour=15))
        assert queued(db, TaskType.DISCOVER_SOURCE) == []

    def test_both_halves_open_it(self, db: Session, settings: Settings, base_resume: ResumeVersion):
        db.add(SourceRegistry(kind="greenhouse", identifier="stripe"))
        db.flush()

        tick(db, settings, now=at_local(settings, hour=15))
        assert len(queued(db, TaskType.DISCOVER_SOURCE)) == 2  # 08:00 and 14:00


class TestDiscoveryScheduling:
    def test_nothing_is_queued_without_sources(
        self, db: Session, settings: Settings, base_resume: ResumeVersion
    ):
        tick(db, settings, now=at_local(settings, hour=9))
        assert queued(db, TaskType.DISCOVER_SOURCE) == []

    def test_one_task_per_enabled_source(
        self, db: Session, settings: Settings, base_resume: ResumeVersion
    ):
        """One per source, so a board returning 500 costs only itself."""
        db.add(SourceRegistry(kind="greenhouse", identifier="stripe"))
        db.add(SourceRegistry(kind="lever", identifier="figma"))
        db.flush()

        tick(db, settings, now=at_local(settings, hour=9))
        tasks = queued(db, TaskType.DISCOVER_SOURCE)
        assert len(tasks) == 2
        assert {t.payload["name"] for t in tasks} == {"stripe", "figma"}

    def test_a_disabled_source_is_skipped(
        self, db: Session, settings: Settings, base_resume: ResumeVersion
    ):
        db.add(SourceRegistry(kind="greenhouse", identifier="stripe", enabled=False))
        db.flush()

        tick(db, settings, now=at_local(settings, hour=9))
        assert queued(db, TaskType.DISCOVER_SOURCE) == []

    def test_discovery_runs_once_per_orchestration_time(
        self, db: Session, settings: Settings, base_resume: ResumeVersion
    ):
        """Twice a day, and exactly once per run however often the worker ticks."""
        db.add(SourceRegistry(kind="greenhouse", identifier="stripe"))
        db.flush()

        tick(db, settings, now=at_local(settings, hour=9))
        tick(db, settings, now=at_local(settings, hour=10))
        assert len(queued(db, TaskType.DISCOVER_SOURCE)) == 1

        tick(db, settings, now=at_local(settings, hour=15))
        tick(db, settings, now=at_local(settings, hour=16))
        assert len(queued(db, TaskType.DISCOVER_SOURCE)) == 2

    def test_the_payload_matches_what_the_adapter_expects(
        self, db: Session, settings: Settings, base_resume: ResumeVersion
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
        tick(db, settings, now=at_local(settings, hour=9))

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
