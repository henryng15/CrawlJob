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


def test_the_cutoff_keeps_one_posting_year() -> None:
    """Not one month. Boards date a posting from when it went up, and the roles for
    this cycle start appearing in the spring — July was cutting Palantir, Optiver
    and Rippling internships posted in the last week of June, all still open."""
    assert EARLIEST_POSTED == date(2026, 1, 1)


def test_filter_drops_the_previous_cycle_and_keeps_this_one() -> None:
    jobs = [
        _job("2025-12-31"),
        _job("2026-01-01"),
        _job("2026-06-30"),
        _job("2016-10-04"),
        _job("2026-08-06"),
    ]
    kept = [job.date_posted for job in _filter(jobs, EARLIEST_POSTED)]
    assert kept == ["2026-01-01", "2026-06-30", "2026-08-06"]


def test_the_trackers_really_do_reach_back_that_far() -> None:
    """A live crawl turned up a matching role first posted in October 2016. The
    cutoff is not tidiness — without it the sheet takes a decade of history."""
    assert not _filter([_job("2016-10-04")], EARLIEST_POSTED)


def test_cutoff_day_itself_is_included() -> None:
    assert _filter([_job("2026-01-01")], EARLIEST_POSTED)


def test_scheduled_slot_only_on_even_et_hours() -> None:
    kept = [
        hour
        for hour in range(24)
        if is_scheduled_slot(datetime(2026, 8, 6, hour, 30, tzinfo=NEW_YORK))
    ]
    assert kept == [8, 10, 12, 14, 16]


def test_manual_run_at_night_is_not_a_scheduled_slot() -> None:
    assert not is_scheduled_slot(datetime(2026, 8, 6, 21, 22, tzinfo=NEW_YORK))
