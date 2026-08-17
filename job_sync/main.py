from __future__ import annotations

import argparse
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from job_sync.config import load_settings
from job_sync.sheet import append_new_jobs
from job_sync.sources import dedupe_jobs, fetch_source, load_sources, parse_jobs

NEW_YORK = ZoneInfo("America/New_York")
SCHEDULED_HOURS = {8, 10, 12, 14, 16}
# The trackers carry a year of history. The first sync would otherwise backfill all
# of it, so the sheet starts at July 2026. Later runs re-apply the same cutoff,
# which costs nothing: anything newly posted is already past it.
EARLIEST_POSTED = date(2026, 7, 1)


def is_scheduled_slot(now: datetime) -> bool:
    local = now.astimezone(NEW_YORK)
    return local.hour in SCHEDULED_HOURS


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync target internships to a Google Sheet")
    parser.add_argument("--sources", type=Path, default=Path("sources.toml"))
    parser.add_argument(
        "--scheduled", action="store_true", help="exit outside 08:00–16:59 ET even hours"
    )
    parser.add_argument(
        "--skip-link-check",
        action="store_true",
        help="do not ask each board whether its posting is still open",
    )
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="discard existing rows and write the sheet from the sources alone",
    )
    parser.add_argument(
        "--since",
        type=date.fromisoformat,
        default=EARLIEST_POSTED,
        help=f"skip roles posted before this date (default: {EARLIEST_POSTED.isoformat()})",
    )
    args = parser.parse_args()
    now = datetime.now(NEW_YORK)
    if args.scheduled and not is_scheduled_slot(now):
        print("Outside scheduled 2-hour ET window; nothing to do.")
        return

    jobs = []
    failures = []
    for source in load_sources(args.sources):
        try:
            parsed = parse_jobs(fetch_source(source), now.date())
            print(f"{source.name}: {len(parsed)} matching roles")
            jobs.extend(parsed)
        except Exception as error:  # noqa: BLE001 - a tracker must not block the others.
            failures.append(f"{source.name}: {error}")
    if not jobs:
        raise RuntimeError("No jobs parsed. " + "; ".join(failures))
    jobs = dedupe_jobs(jobs)
    # ISO-8601 dates compare correctly as strings, which is why date_posted is one.
    cutoff = args.since.isoformat()
    recent = [job for job in jobs if job.date_posted >= cutoff]
    print(f"{len(recent)} of {len(jobs)} deduped roles posted on or after {cutoff}")
    result = append_new_jobs(
        load_settings(), recent, rebuild=args.rebuild, verify_links=not args.skip_link_check
    )
    already = len(recent) - result.appended
    print(f"Appended {result.appended} new jobs; {already} already in the sheet.")
    print(f"Dropped {result.dead} rows whose posting the board reports as gone.")
    print(f"Dropped {result.blocked} rows from employers this tracker no longer follows.")
    print(f"Merged {result.duplicate} rows repeating a company and role already listed.")
    print(
        f"Ticked Applied on {result.ticked_link} rows matching a tracked link "
        f"and {result.ticked_name} matching a tracked company and role."
    )
    for failure in failures:
        print(f"WARNING: {failure}")


if __name__ == "__main__":
    main()
