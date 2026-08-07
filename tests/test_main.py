from datetime import date, datetime

from job_sync.main import EARLIEST_POSTED, NEW_YORK, is_scheduled_slot
from job_sync.sources import Job


def _job(date_posted: str) -> Job:
    return Job(
        company="Acme",
        role="Software Engineer Intern",
        apply_link=f"https://jobs.example/{date_posted}",
        date_posted=date_posted,
    )


def _filter(jobs: list[Job], since: date) -> list[Job]:
    cutoff = since.isoformat()
    return [job for job in jobs if job.date_posted >= cutoff]


def test_cutoff_is_july_2026() -> None:
    assert EARLIEST_POSTED == date(2026, 7, 1)


def test_filter_drops_anything_before_the_cutoff() -> None:
    jobs = [
        _job("2026-06-30"),
        _job("2026-07-01"),
        _job("2026-07-15"),
        _job("2025-12-01"),
        _job("2026-08-06"),
    ]
    kept = [job.date_posted for job in _filter(jobs, EARLIEST_POSTED)]
    assert kept == ["2026-07-01", "2026-07-15", "2026-08-06"]


def test_cutoff_day_itself_is_included() -> None:
    assert _filter([_job("2026-07-01")], EARLIEST_POSTED)


def test_scheduled_slot_only_on_even_et_hours() -> None:
    kept = [
        hour
        for hour in range(24)
        if is_scheduled_slot(datetime(2026, 8, 6, hour, 30, tzinfo=NEW_YORK))
    ]
    assert kept == [8, 10, 12, 14, 16]


def test_manual_run_at_night_is_not_a_scheduled_slot() -> None:
    assert not is_scheduled_slot(datetime(2026, 8, 6, 21, 22, tzinfo=NEW_YORK))
