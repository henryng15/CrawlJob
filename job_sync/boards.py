"""Internships read from the ATS the employer actually runs, not from a tracker.

The five Markdown trackers cover well-known programmes well and startups barely at
all — a company has to already be famous enough for a volunteer to type it in. The
startups themselves publish the same postings, on the applicant-tracking system
they use to receive the applications, over documented JSON endpoints that need no
key. So the gap is not permission. It is knowing which boards exist.

That list lives in data/ats_boards.json and is rebuilt by scripts/discover_boards.py.
This module only reads it and asks each board what it is advertising today.

Three things make these boards better sources than a tracker, not merely more of
them: the link is the employer's own, so it survives after an aggregator's
redirect rots; the posting date is the board's own `first_published` rather than
the day a volunteer noticed; and a startup with four employees is on exactly the
same footing as a company with forty thousand.
"""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from urllib.request import Request, urlopen

from job_sync.places import is_united_states
from job_sync.roles import is_target_role
from job_sync.sources import Job

BOARD_FILE = Path(__file__).resolve().parent / "data" / "ats_boards.json"
USER_AGENT = "internship-sheet-sync/0.1"
TIMEOUT = 15
# One board's reply, capped. A large employer's Ashby board runs to 12 MB because
# it inlines every job description, and thousands of boards are asked in a row —
# read the reply, do not hold on to it. Nothing below the title and the date is used.
CAP = 8 * 1024 * 1024
# Enough to finish a thousand boards inside a runner minute, low enough to stay a
# polite guest on somebody else's API. One request per board, and no retries: a
# board that fails today is asked again tomorrow anyway.
WORKERS = 12


@dataclass(frozen=True)
class BoardResult:
    jobs: list[Job] = field(default_factory=list)
    # Normalised links of matching roles the boards place outside the US. Not rows
    # that were skipped — rows that must be taken out of the sheet if they are in it.
    foreign: set[str] = field(default_factory=set)
    asked: int = 0
    live: int = 0
    quiet: int = 0
    failed: int = 0


def _display(slug: str) -> str:
    """A company name out of a board slug, for the two ATSes that do not send one.

    Only ever a display string. Every comparison in this pipeline runs through
    name_key(), which strips exactly the punctuation this puts back, so a slug and
    a real name reach the dedupe as the same company either way."""
    return re.sub(r"[-_]+", " ", slug).strip().title()


def _from_iso(value: object) -> str:
    """The date half of an ISO timestamp.

    Sliced, not parsed. The sheet sorts date_posted as a string, so what it wants
    is literally the first ten characters; parsing and reformatting could only
    move the value across a day boundary by reinterpreting the offset."""
    return value[:10] if isinstance(value, str) and len(value) >= 10 else ""


def _from_epoch(value: object) -> str:
    """Lever counts milliseconds since the epoch.

    Read as UTC rather than as local time: a runner's clock is UTC and the
    operator's is ET, and one posting must not carry two dates depending on who
    ran the sync."""
    try:
        return datetime.fromtimestamp(int(value) / 1000, tz=UTC).date().isoformat()
    except (TypeError, ValueError, OSError, OverflowError):
        return ""


def _where(row: dict, *keys: str) -> str:
    """Every place this row names, joined into one line for the country reading.

    Joined rather than picked, because a posting open in two offices has to count
    as American if either of them is — Ashby carries the second one in a separate
    list, and reading only the first would drop a job open in London and Boston."""
    found: list[str] = []
    for key in keys:
        value = row.get(key)
        if isinstance(value, str):
            found.append(value)
        elif isinstance(value, dict):
            found.append(str(value.get("name") or value.get("location") or ""))
        elif isinstance(value, list):
            found += [
                item if isinstance(item, str) else str((item or {}).get("location") or "")
                for item in value
            ]
    return "; ".join(part for part in found if part)


def _in_country(code: object) -> bool:
    """Lever carries an ISO-3166 country code, the one unambiguous location field
    any of these three APIs has. Read it in preference to guessing at prose.

    Absent is kept, on the same rule as everywhere else here: a board that has not
    said where the job is has not said it is abroad."""
    if not isinstance(code, str) or not code.strip():
        return True
    return code.strip().upper() in ("US", "USA")


def _greenhouse(slug: str, payload: object) -> list[tuple[Job, bool]]:
    rows = payload.get("jobs", []) if isinstance(payload, dict) else []
    return [
        (
            Job(
                company=row.get("company_name") or _display(slug),
                role=row["title"],
                apply_link=row.get("absolute_url") or "",
                source="Greenhouse",
                # first_published is when the posting went up. updated_at moves
                # every time someone fixes a typo in the description, which would
                # reshuffle the top of the sheet for no reason anyone could act on.
                date_posted=_from_iso(row.get("first_published") or row.get("updated_at")),
            ),
            is_united_states(_where(row, "location")),
        )
        for row in rows
        if isinstance(row, dict) and row.get("title") and is_target_role(row["title"])
    ]


def _lever(slug: str, payload: object) -> list[tuple[Job, bool]]:
    rows = payload if isinstance(payload, list) else []
    return [
        (
            Job(
                company=_display(slug),
                role=row["text"],
                # hostedUrl, not applyUrl: the posting rather than the form hanging
                # off it. normalize_link folds the two together, so this only decides
                # what a human sees after clicking.
                apply_link=row.get("hostedUrl") or row.get("applyUrl") or "",
                source="Lever",
                date_posted=_from_epoch(row.get("createdAt")),
            ),
            _in_country(row.get("country")) and is_united_states(_where(row, "categories")),
        )
        for row in rows
        if isinstance(row, dict) and row.get("text") and is_target_role(row["text"])
    ]


def _ashby(slug: str, payload: object) -> list[tuple[Job, bool]]:
    rows = payload.get("jobs", []) if isinstance(payload, dict) else []
    return [
        (
            Job(
                company=_display(slug),
                role=row["title"],
                apply_link=row.get("jobUrl") or row.get("applyUrl") or "",
                source="Ashby",
                date_posted=_from_iso(row.get("publishedAt")),
            ),
            is_united_states(_where(row, "location", "secondaryLocations", "address")),
        )
        for row in rows
        # isListed false is a posting the employer has taken off its own board but
        # not deleted. Following it would send an application into a closed role.
        if isinstance(row, dict)
        and row.get("title")
        and row.get("isListed", True)
        and is_target_role(row["title"])
    ]


BOARDS = {
    "greenhouse": ("https://boards-api.greenhouse.io/v1/boards/{}/jobs", _greenhouse),
    "lever": ("https://api.lever.co/v0/postings/{}?mode=json", _lever),
    "ashby": ("https://api.ashbyhq.com/posting-api/job-board/{}", _ashby),
}


def read_board(ats: str, slug: str) -> object | None:
    """One board's JSON, or None for anything that did not come back as JSON.

    Every failure is the same failure here — a slug harvested from an archive that
    has since been renamed, a board made private, a timeout. None of them is worth
    telling apart, and none of them may stop the fifteen thousand others."""
    template, _ = BOARDS[ats]
    request = Request(template.format(slug), headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=TIMEOUT) as response:
            return json.loads(response.read(CAP))
    except Exception:  # noqa: BLE001 - one dead board must not end the crawl
        return None


def split_board(ats: str, slug: str, payload: object) -> tuple[list[Job], set[str]]:
    """The roles to write, and the links of the ones this tracker will not follow
    because the board says they are somewhere other than the United States.

    Both halves are needed, and the second one is why. A row already written to the
    sheet carries no location — the Jobs tab has no such column — so nothing in the
    sheet can work out on its own that it should go. The board is the only thing
    that knows, and it only knows while the posting is still up. Naming the foreign
    links here is what lets the sync take back what an earlier, unfiltered run put
    in."""
    _, parser = BOARDS[ats]
    keep: list[Job] = []
    foreign: set[str] = set()
    for job, in_the_us in parser(slug, payload):
        # A posting with no link cannot be deduped, applied to, or checked for
        # liveness. It is not a row, it is a hole where a row would go.
        if not job.apply_link.strip():
            continue
        if in_the_us:
            keep.append(job)
        else:
            foreign.add(job.dedupe_key)
    return keep, foreign


def parse_board(ats: str, slug: str, payload: object) -> list[Job]:
    return split_board(ats, slug, payload)[0]


def _one(pair: tuple[str, str]) -> tuple[bool, bool, list[Job], set[str]]:
    ats, slug = pair
    payload = read_board(ats, slug)
    if payload is None:
        return False, False, [], set()
    rows = payload.get("jobs", []) if isinstance(payload, dict) else payload
    live = bool(isinstance(rows, list) and rows)
    keep, foreign = split_board(ats, slug, payload)
    return True, live, keep, foreign


def harvest(boards: list[tuple[str, str]], workers: int = WORKERS) -> BoardResult:
    """Ask every board in the list at once, and keep only the roles that match.

    Ordered by the input rather than by whichever reply landed first, so that two
    runs over an unchanged list produce the same rows in the same order and the
    sheet's own change test can tell a real change from a reshuffle."""
    if not boards:
        return BoardResult()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        answers = list(pool.map(_one, boards))
    jobs: list[Job] = []
    foreign: set[str] = set()
    live = failed = 0
    for answered, had_rows, found, elsewhere in answers:
        if not answered:
            failed += 1
            continue
        live += 1 if had_rows else 0
        jobs.extend(found)
        foreign |= elsewhere
    return BoardResult(
        jobs=jobs,
        foreign=foreign,
        asked=len(boards),
        live=live,
        quiet=len(boards) - failed - live,
        failed=failed,
    )


def load_boards(path: Path = BOARD_FILE) -> list[tuple[str, str]]:
    """The boards worth asking every day, as (ats, slug) pairs.

    A missing file is the feature switched off, not an error: the Markdown
    trackers are the floor this sits on top of, and they do not need it."""
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return [
        (ats, slug)
        for ats, slug in (tuple(row) for row in data.get("daily", []))
        if ats in BOARDS and slug
    ]
