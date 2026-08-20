from datetime import UTC, date, datetime

from job_sync.main import EARLIEST_POSTED, NEW_YORK, in_working_window
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


def test_the_window_is_the_working_day_not_the_schedule() -> None:
    """The seven run times live in sync.yml's cron. All this has to do is let the
    working day through, an hour wider than the schedule at each end."""
    kept = [
        hour
        for hour in range(24)
        if in_working_window(datetime(2026, 8, 6, hour, 30, tzinfo=NEW_YORK))
    ]
    assert kept == list(range(8, 19))


def test_a_run_actions_started_late_still_counts() -> None:
    """Measured across one day, the cron fired between 16 and 36 minutes behind
    its slot. Matching an exact time is what this window replaced: the 18:00 run
    arriving at 18:36 has to survive, and on a half-hour schedule so does 16:30
    arriving at 17:06."""
    assert in_working_window(datetime(2026, 8, 6, 18, 36, tzinfo=NEW_YORK))
    assert in_working_window(datetime(2026, 8, 6, 17, 6, tzinfo=NEW_YORK))


def test_the_window_survives_the_dst_shift() -> None:
    """Actions cron is UTC only, so the same two lines land an hour earlier once
    EST starts in November. Both ends of the shifted day still pass, which is why
    a forgotten cron edit costs an hour of timing rather than a whole run."""
    for utc_hour, expected in ((13, 8), (22, 17)):
        run = datetime(2026, 12, 1, utc_hour, 20, tzinfo=UTC)
        assert run.astimezone(NEW_YORK).hour == expected
        assert in_working_window(run)


def test_manual_run_at_night_is_outside_the_window() -> None:
    assert not in_working_window(datetime(2026, 8, 6, 21, 22, tzinfo=NEW_YORK))
