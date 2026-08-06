from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from job_sync.config import load_settings
from job_sync.sheet import append_new_jobs
from job_sync.sources import dedupe_jobs, fetch_source, load_sources, parse_jobs

NEW_YORK = ZoneInfo("America/New_York")
SCHEDULED_HOURS = {8, 10, 12, 14, 16}


def is_scheduled_slot(now: datetime) -> bool:
    local = now.astimezone(NEW_YORK)
    return local.hour in SCHEDULED_HOURS


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync target internships to a Google Sheet")
    parser.add_argument("--sources", type=Path, default=Path("sources.toml"))
    parser.add_argument(
        "--scheduled", action="store_true", help="exit outside 08:00–16:59 ET even hours"
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
    appended = append_new_jobs(load_settings(), jobs)
    print(f"Appended {appended} new jobs; {len(jobs)} matching rows read.")
    for failure in failures:
        print(f"WARNING: {failure}")


if __name__ == "__main__":
    main()
