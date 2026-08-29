from __future__ import annotations

import argparse
from dataclasses import replace
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from job_sync.boards import harvest, load_boards
from job_sync.config import load_settings
from job_sync.highlight import highlight
from job_sync.sheet import append_new_jobs, audit_app
from job_sync.sources import dedupe_jobs, fetch_source, load_sources, parse_jobs

NEW_YORK = ZoneInfo("America/New_York")
# The working day as a window, not a list of slots. The seventeen run times live in
# the cron of sync.yml — every 45 minutes from 09:00 to 21:00 ET — and this only
# refuses a run that arrives outside those hours at all.
#
# The day runs to 21:00 rather than 18:00 because of what an 18:00 finish costs.
# Databricks published a Software Engineering Intern role at 19:40 ET, an hour and
# a half after the last run of the day, and it sat unseen until 09:00 the next
# morning. Two more runs close most of that gap.
#
# It used to name five exact hours, which was a bug waiting for a slow day.
# Actions does not start a scheduled run on time: measured across one day, the
# hourly cron fired between 16 and 36 minutes late, once at :36. Matching an
# exact slot would have thrown away whichever run was unluckiest, and a
# 45-minute schedule makes that near-certain.
#
# The window is also an hour wider than the schedule at each end, which is what
# carries it through the November DST change: the same UTC cron lands an hour
# earlier once EST starts, and every run still passes.
WORKING_HOURS = frozenset(range(8, 23))
# One posting year, not one month. The cutoff exists because the trackers carry a
# decade of history — there are still-reachable listings here from 2016 — and the
# first sync would otherwise pour all of it into the sheet.
#
# July was too tight. Boards date a posting from when it went up, and the roles
# that matter for this cycle — Fall 2026, Spring 2027, Summer 2027 — start
# appearing in the spring. At July it was cutting Palantir, Optiver and Rippling
# internships posted in the last week of June, all of them still open.
#
# January keeps the whole 2026 posting year and drops everything from the previous
# cycle. It admits some listings a board never took down; the Expired checkbox is
# what those are for, and a stale row you can tick is better than an open role you
# never saw.
EARLIEST_POSTED = date(2026, 1, 1)


def in_working_window(now: datetime) -> bool:
    local = now.astimezone(NEW_YORK)
    return local.hour in WORKING_HOURS


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync target internships to a Google Sheet")
    parser.add_argument("--sources", type=Path, default=Path("sources.toml"))
    parser.add_argument(
        "--scheduled", action="store_true", help="exit outside the 08:00–22:59 ET working window"
    )
    parser.add_argument(
        "--skip-link-check",
        action="store_true",
        help="do not ask each board whether its posting is still open",
    )
    parser.add_argument(
        "--no-boards",
        action="store_true",
        help="skip the ATS job boards and read only the Markdown trackers",
    )
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="discard existing rows and write the sheet from the sources alone",
    )
    parser.add_argument(
        "--audit-app",
        action="store_true",
        help="report what is wrong with the application tracker, and sync nothing",
    )
    parser.add_argument(
        "--since",
        type=date.fromisoformat,
        default=EARLIEST_POSTED,
        help=f"skip roles posted before this date (default: {EARLIEST_POSTED.isoformat()})",
    )
    args = parser.parse_args()
    if args.audit_app:
        audit_app(load_settings())
        return
    now = datetime.now(NEW_YORK)
    if args.scheduled and not in_working_window(now):
        print("Outside the 08:00–22:59 ET working window; nothing to do.")
        return

    jobs = []
    failures = []
    for source in load_sources(args.sources):
        try:
            parsed = [
                replace(job, source=source.label)
                for job in parse_jobs(fetch_source(source), now.date())
            ]
            print(f"{source.name}: {len(parsed)} matching roles")
            jobs.extend(parsed)
        except Exception as error:  # noqa: BLE001 - a tracker must not block the others.
            failures.append(f"{source.name}: {error}")
    if not jobs:
        raise RuntimeError("No jobs parsed. " + "; ".join(failures))

    # After the check above, not before it: the trackers are the floor this stands
    # on, and every tracker failing is an outage worth stopping for even if a few
    # hundred boards happen to answer.
    # Every run asks the boards, not a chosen two of them. The trackers are five
    # Markdown files a volunteer edits once or twice a day, so asking them every
    # ninety minutes turns up nothing the run before did not already have. The
    # boards are the half that changes hourly, and the only half that reports the
    # date a posting went up — gating them would have made the tighter schedule a
    # gesture. It costs 903 requests nine times a day, and roughly 1,350 of the
    # 2,000 free Actions minutes a month. --no-boards is how you dial it back.
    boards = [] if args.no_boards else load_boards()
    abroad: set[str] = set()
    if boards:
        found = harvest(boards)
        print(
            f"ATS boards: asked {found.asked}, {found.live} were advertising something, "
            f"{found.quiet} had nothing open, {found.failed} did not answer; "
            f"{len(found.jobs)} matching roles in the US, "
            f"{len(found.foreign)} elsewhere"
        )
        # In front of the trackers, not behind them. dedupe_jobs keeps whichever
        # copy of a link it meets first, so this decides which of the two gets to
        # describe every posting that appears in both — and the board is the better
        # describer on both counts that matter. Its date is when the employer
        # published the role rather than when a volunteer noticed it, and its name
        # in the Source column says where the posting actually lives.
        jobs = found.jobs + jobs
        abroad = found.foreign

    jobs = dedupe_jobs(jobs)
    # ISO-8601 dates compare correctly as strings, which is why date_posted is one.
    cutoff = args.since.isoformat()
    recent = [job for job in jobs if job.date_posted >= cutoff]
    print(f"{len(recent)} of {len(jobs)} deduped roles posted on or after {cutoff}")
    result = append_new_jobs(
        load_settings(),
        recent,
        rebuild=args.rebuild,
        verify_links=not args.skip_link_check,
        foreign=abroad,
    )
    already = len(recent) - result.appended
    print(f"Appended {result.appended} new jobs; {already} already in the sheet.")
    print(f"Dropped {result.dead} rows whose posting the board reports as gone.")
    print(f"Dropped {result.blocked} rows from employers this tracker no longer follows.")
    print(f"Dropped {result.abroad} rows the boards place outside the US.")
    print(f"Named the source of {result.sourced} rows that did not carry one.")
    print(f"Merged {result.duplicate} rows repeating a company and role already listed.")
    # One of these is usually last run's divider, which is rebuilt rather than junk.
    print(f"Dropped {result.empty} blank rows before sorting.")
    print(
        f"Ticked Applied on {result.ticked_link} rows matching a tracked link "
        f"and {result.ticked_name} matching a tracked company and role."
    )
    print(
        f"{result.applied} rows ticked Applied and {result.expired} ticked Expired; "
        f"{result.open_} postings still to apply to."
    )
    print("Rewrote the sheet." if result.wrote else "Sheet already correct; nothing written.")
    # Printed on both paths. A run that wrote nothing still moved the caption, and
    # that is the run where a reader most wants to see the sync is alive.
    print(f"H1 now reads {result.stamped!r}.")
    if result.separator:
        print(f"Row {result.separator} divides what is left from what is done.")
    marks = highlight(load_settings(), result.separator, result.written_rows)
    print(
        f"Highlighted {marks.alumni_lit} of {marks.alumni_rows} alumni rows; of "
        f"{marks.app_rows} applications, {marks.app_lit} have an alumnus and "
        f"{marks.recruiter_lit} have a recruiter contact."
    )
    print(f"Marked {marks.h1b_lit} Jobs company cells as FY2024–FY2025 SWE H-1B sponsors.")
    print(
        "Restated the Alumni and Recruiter checkboxes."
        if marks.ticked
        else "Checkboxes already correct; nothing written."
    )
    for failure in failures:
        print(f"WARNING: {failure}")


if __name__ == "__main__":
    main()
