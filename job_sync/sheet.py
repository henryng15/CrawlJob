from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from job_sync.config import Settings
from job_sync.liveness import dead_links
from job_sync.sources import (
    Job,
    company_identity,
    is_aggregator_link,
    is_blocked_company,
    name_key,
    normalize_link,
    role_identity,
    role_tokens,
)

# Source sits inside the tool's own block, before the checkboxes, and that is
# forced rather than chosen: every column past Expired is read as an operator's
# note, and a note is the only way to tell the auto-tick to leave a row alone. A
# Source column written past F would look like a note on every row and silence the
# tick everywhere.
HEADERS = ["Company", "Role", "Link Apply", "Date Posted", "Source"]
SOURCE = 4
# What column E holds in a sheet built before Source existed. Finding this is what
# tells a run it has an old layout in front of it rather than a broken new one.
OLD_FIFTH = "Applied"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
# Columns F and G, the two past the five this tool owns. Both are checkboxes the
# operator ticks; a free-text note starts at H, past both of them.
APPLIED = len(HEADERS)
EXPIRED = APPLIED + 1
# Column H of the header row, and only of the header row: the caption saying when
# the sheet was last written. H is where an operator's free-text notes begin, so
# this takes the one cell of it that no row will ever want — H1 sits beside the
# column names, not beside a job.
#
# The caption went here rather than into a row of its own beneath the header. A
# banner at row 2 would push every job down one, and three Apps Script files index
# the Jobs tab from a shared FIRST_ROW = 2 that the App and Outreach tabs use too.
# The two halves cannot ship together either — the Python lands on the next run,
# the .gs files only when someone pastes them — so between the two there would be a
# window where the scripts read the caption as a job.
STAMP = EXPIRED + 1
# The application tracker: Property | Company | Application Link | Date Applied |
# Location (State) | Process | Role | Note | Alumni | Recruiter | Update.
#
# Named, never numbered — and the numbers that used to live here are gone rather
# than kept alongside. This layout is about to gain an Official column at position
# 9, holding a URL pasted by hand, which pushes Alumni, Recruiter and Update each
# one to the right. The two halves cannot land together, for the reason written
# above STAMP: the Python arrives on the next cron run, the .gs only when someone
# pastes it. So any number written down here is wrong on one side of that window
# whichever value it holds, and wrong for the checkbox columns means a run writes
# FALSE over the URLs somebody pasted into Official and ticks Alumni from the
# Recruiter data. Reading row 1 is right on both sides and costs nothing: the
# header arrives in the same response as the rows.
#
# It has gone wrong the numbered way once already. Alumni and Recruiter were
# background colours occupying no column of their own; turning them into real
# checkbox columns moved Update from J to K and the constant did not follow, so
# audit_app read the Recruiter checkbox as the stage history — _last_stage("FALSE")
# is "" — and reported every staged row UNLOGGED.
APP_COMPANY_HEADER = "Company"
APP_LINK_HEADER = "Application Link"
APP_PROCESS_HEADER = "Process"
APP_ROLE_HEADER = "Role"
# Where sync_applied_to_app.gs appends one "<Stage>: <date>" line per stage the
# application has passed through.
APP_UPDATE_HEADER = "Update"


@dataclass(frozen=True)
class SyncResult:
    """What one run changed, so the log can say which rows left and why."""

    appended: int = 0
    dead: int = 0
    blocked: int = 0
    abroad: int = 0
    sourced: int = 0
    duplicate: int = 0
    empty: int = 0
    ticked_link: int = 0
    ticked_name: int = 0
    # The state of the Applied column once this run is done. `open_` is the count
    # that matters day to day: the postings still to be applied to.
    applied: int = 0
    expired: int = 0
    open_: int = 0
    # 1-based sheet row of the blank divider, or 0 where there is nothing to
    # divide. The colour on it is painted later, by highlight.
    separator: int = 0
    written_rows: int = 0
    # Whether the sheet was actually written. A run that changes nothing looks the
    # same in every other count, and a silent no-op is the failure worth naming.
    wrote: bool = False
    # What H1 was set to. Written on every run, including the ones that change
    # nothing else, because "nothing has changed" and "nothing has run" are the two
    # states the caption exists to tell apart.
    stamped: str = ""


def _service(settings: Settings):
    info = json.loads(settings.service_account_json)
    credentials = Credentials.from_service_account_info(info, scopes=SCOPES)
    return build("sheets", "v4", credentials=credentials, cache_discovery=False)


def _quote_tab(tab: str) -> str:
    """A1 notation needs the sheet name quoted; anything with a space or a digit
    at the front is otherwise unparseable. Inside quotes, ' doubles to ''."""
    return "'" + tab.replace("'", "''") + "'"


def _whole_tab(tab: str) -> str:
    """The A1 range that is a tab and no column letters at all.

    Every read of App goes through this instead of naming a width. A width is a
    second claim about where the columns are, and it is the claim that rots: A:K
    was the tracker's full span right up until Official was inserted, after which
    Update sits in L, outside the read, and audit_app reads an empty string for a
    history it never asked for — reporting every staged row UNLOGGED, which is the
    exact failure the numbered constants caused the last time this tab grew.

    A header that falls outside the range is indistinguishable from a header that
    is not there, so a short range does not merely lose a column, it turns into a
    refusal for a reason that is not true. Asking for the tab asks for whatever the
    used width is this week, and costs a few columns of blanks at worst."""
    return _quote_tab(tab)


class AppLayoutError(LookupError):
    """A column the run needs is not named in the App tab's first row.

    Raised, and never resolved to a remembered position, because the position is
    precisely the thing that moves. Falling back to "Alumni was column I last time"
    is how a run writes checkbox booleans across the URLs pasted into Official: the
    guess is always available and always plausible, and it is wrong exactly on the
    runs that matter. A stopped sync is repaired by looking at row 1; a sync that
    guessed is repaired by finding out what the cells used to say."""


def _header_key(text: str) -> str:
    """One header cell reduced to what identifies the column.

    Case and surrounding space are noise. A header retyped as " alumni " is the
    same column to everyone reading the sheet, and stopping the sync over a
    cosmetic edit would train whoever runs it to reach for the fallback this module
    refuses to have.

    Everything else is signal: the comparison is on the whole reduced string, so
    "Alumni Notes" is a different column from "Alumni" and can never stand in for
    it. Someone adding a notes column beside the checkbox is the likeliest next
    edit to this tab, and a prefix or substring match would hand them the same
    corruption the numbering did, reached by a different route."""
    return " ".join(text.split()).casefold()


def app_columns(header: list[str], *wanted: str) -> tuple[int, ...]:
    """Where each named column sits, read off the App tab's own header row.

    Returns zero-based indices in the order asked for, so a caller unpacks them
    positionally and never has to say a number out loud.

    Every missing name is collected before anything is raised, so a tab that has
    not been set up at all reports the whole list rather than one header per run —
    and an empty tab, whose header row is nothing, says so by naming everything it
    could not find. The first cell wins where a name somehow appears twice: a
    duplicate is a mistake in the sheet, and the leftmost is the one the older
    Apps Script writes and reads."""
    seen: dict[str, int] = {}
    for index, cell in enumerate(header):
        seen.setdefault(_header_key(cell), index)
    places: list[int] = []
    missing: list[str] = []
    for name in wanted:
        index = seen.get(_header_key(name))
        if index is None:
            missing.append(name)
        else:
            places.append(index)
    if missing:
        raise AppLayoutError(
            f"the App tab's header row names no column {', '.join(repr(n) for n in missing)}; "
            f"row 1 reads {', '.join(repr(cell) for cell in header) or '(nothing)'}"
        )
    return tuple(places)


def _tab_names(service, sheet_id: str) -> list[str]:
    meta = service.spreadsheets().get(spreadsheetId=sheet_id, fields="sheets.properties.title")
    return [sheet["properties"]["title"] for sheet in meta.execute().get("sheets", [])]


def _key(row: list[str]) -> str | None:
    if len(row) >= 3 and row[2].strip():
        return normalize_link(row[2])
    return None


def _sort_key(row: list[str]) -> tuple[int, str, str]:
    """Everything still to do first, newest posting first within that.

    A row ticked Applied or Expired has been dealt with, and the whole point of
    the checkbox is that what is left unticked is the work. Sinking those rows to
    the bottom makes the top of the sheet the list to work down, without hiding
    anything: they are still there, still holding the link that stops the job
    being appended again.

    Dates are ISO-8601, so a plain string sort is a date sort; the company breaks
    ties so that a run never reshuffles equal dates. Sorted in reverse, so the
    leading flag is 1 for the rows that should come first."""
    settled = _ticked(row, APPLIED) or _ticked(row, EXPIRED)
    date_posted = row[3].strip() if len(row) > 3 else ""
    company = row[0].strip().casefold() if row else ""
    return (0 if settled else 1, date_posted, company)


def _sorted_rows(rows: list[list[str]]) -> list[list[str]]:
    return sorted(rows, key=_sort_key, reverse=True)


def _divided(rows: list[list[str]]) -> tuple[list[list[str]], int]:
    """One blank row between what is still to do and what has been dealt with.

    Part of the layout rather than of the data: it holds nothing, so the next read
    cannot tell it from the checkbox-only rows and drops it either way. Rebuilding
    it every run is also what keeps it in place as the two halves change size."""
    settled = sum(1 for row in rows if _ticked(row, APPLIED) or _ticked(row, EXPIRED))
    if not settled or settled == len(rows):
        return rows, 0
    split = len(rows) - settled
    width = max(len(row) for row in rows)
    # +2 for the header row and for 1-based row numbering.
    return rows[:split] + [[""] * width] + rows[split:], split + 2


def _stamp() -> str:
    """The caption H1 carries: when this run wrote the sheet.

    Not when the run finished, which it cannot know — it is still going when it
    writes, and the workflow takes another three or four seconds to wind up after
    this. Naming it "last updated" rather than "last run" is the honest reading:
    the sheet is what was updated, and this is when.

    Eastern, because every other time in this tracker is Eastern — the crawl
    window, the schedule that fires it, the dates on the postings. A runner with no
    tzdata would otherwise take the whole sync down for the sake of a caption, so
    the fallback says UTC instead of quietly printing the wrong hour."""
    try:
        now, zone = datetime.now(ZoneInfo("America/New_York")), "ET"
    except ZoneInfoNotFoundError:  # a runner shipped without tzdata
        now, zone = datetime.now(UTC), "UTC"
    return f"Last updated: {now:%H:%M} {zone}, {now:%-d %b %Y}"


def _unstamped(row: list[str]) -> list[str]:
    """The header with its caption blanked, for the comparison that decides whether
    anything moved. The caption changes every run by construction, so leaving it in
    would make every run find a difference and rewrite eight hundred rows to record
    only that it had run."""
    if len(row) <= STAMP:
        return row
    cleared = list(row)
    cleared[STAMP] = ""
    return cleared


def _trimmed(rows: list[list[str]]) -> list[list[str]]:
    """Rows with trailing blank cells removed, which is how the API hands them back.
    Comparing this way lets a run tell "already correct" from "not written yet"
    without guessing which columns the last write happened to fill."""
    trimmed = []
    for row in rows:
        cells = list(row)
        while cells and not cells[-1].strip():
            cells.pop()
        trimmed.append(cells)
    return trimmed


def _drop_duplicate_rows(rows: list[list[str]]) -> list[list[str]]:
    """The sheet is deduped on the way in, but rows written before the key knew
    to ignore tracking params are already there. Keep the first of each."""
    seen: set[str] = set()
    unique: list[list[str]] = []
    for row in rows:
        key = _key(row)
        if key is not None and key in seen:
            continue
        if key is not None:
            seen.add(key)
        unique.append(row)
    return unique


def _identity(row: list[str]) -> tuple[str, tuple[tuple[str, ...], tuple[str, ...]]]:
    """One posting, for deciding what leaves the sheet. Strict on purpose: merging
    two rows here deletes an opening, so the intake stays part of the role."""
    company = company_identity(row[0]) if row else ""
    role = role_identity(row[1]) if len(row) > 1 else ((), ())
    return (company, role)


def _loose_identity(company: str, role: str) -> tuple[str, frozenset[str]]:
    """One posting, for asking whether it has already been applied to. Loose on
    purpose: a wrong answer here ticks a checkbox, which a note in column H undoes,
    while the strict reading misses a job the App tab plainly records."""
    return (name_key(company), role_tokens(role))


def _drop_empty_rows(rows: list[list[str]]) -> tuple[list[list[str]], int]:
    """A row with nothing in the four columns this tool owns is not a job.

    The sheet is full of them and none were typed. Checkbox validation covers
    F2:G500 whether or not there is a job on the row, and a cleared checkbox reads
    back as FALSE, so a read of A:Z returns every row down to 500 with two FALSEs
    and nothing else. Left in, they sorted as work still to do with no date — which
    put a few hundred blank lines between the open jobs and the settled ones."""
    live = [row for row in rows if any(cell.strip() for cell in row[: len(HEADERS)])]
    return live, len(rows) - len(live)


def _drop_blocked_rows(rows: list[list[str]]) -> tuple[list[list[str]], int]:
    """An employer the tracker has stopped following leaves the sheet, rather
    than merely being left out of what gets written next."""
    live = [row for row in rows if not (row and is_blocked_company(row[0]))]
    return live, len(rows) - len(live)


def _is_annotated(row: list[str]) -> bool:
    """Someone has written past the five columns this tool owns — a tick in the
    Applied checkbox in column F, a note in H.

    An unticked checkbox reads back as "FALSE" rather than as an empty cell, and
    an unticked box is precisely the absence of an annotation. Without this every
    row in the sheet would count as annotated and the tier would say nothing."""
    return any(cell.strip().casefold() not in ("", "false") for cell in row[len(HEADERS) :])


def _preference(rows: list[list[str]], position: int) -> tuple[int, int, int]:
    """Which of two rows describing one job to keep, smallest first.

    An annotation outranks everything: whoever ticked Applied on that row applied
    through that link, and no better link is worth losing the note for.

    Then the employer's own board over an aggregator's redirect, which is what
    replaces a jobright.ai row already in the sheet with the greenhouse or
    workday URL that Simplify carries for the same posting.

    Then whichever came first, which is the sheet's existing rows before the
    newly crawled ones, and among those the order the sources are listed in."""
    row = rows[position]
    link = row[2] if len(row) > 2 else ""
    return (
        0 if _is_annotated(row) else 1,
        1 if is_aggregator_link(link) else 0,
        position,
    )


def _drop_duplicate_identities(rows: list[list[str]]) -> tuple[list[list[str]], int]:
    """One row per company and role, chosen by _preference rather than by
    arrival, so that a better link found later still wins.

    A row missing either field is unjudgeable and always survives: the same rule
    the liveness check follows, that what cannot be read cannot be deleted."""
    best: dict[tuple[str, str], int] = {}
    unjudgeable: list[int] = []
    for position, row in enumerate(rows):
        company, role = _identity(row)
        if not company or not role[1]:
            unjudgeable.append(position)
            continue
        held = best.get((company, role))
        if held is None or _preference(rows, position) < _preference(rows, held):
            best[(company, role)] = position
    # Kept in the order they were read, so the write is stable run to run.
    kept = sorted(set(best.values()).union(unjudgeable))
    return [rows[position] for position in kept], len(rows) - len(kept)


def _drop_foreign_rows(rows: list[list[str]], foreign: set[str]) -> tuple[list[list[str]], int]:
    """Rows the boards place somewhere other than the United States.

    The sheet cannot reach this verdict on its own. The Jobs tab has no location
    column, and by the time a posting is a row, all that is left of it is a link —
    so the answer has to be carried in from the crawl, keyed by the same normalised
    link the dedupe already uses. That is what lets a filter added today take back
    what an unfiltered run wrote yesterday.

    Removed rather than kept as a tombstone, unlike an Applied or Expired row. A
    tombstone exists to stop a job being appended a second time; a posting that
    fails the location test is never in the set being appended to begin with.

    A row someone has written on is left alone. Ticking Applied on a job in London
    is a decision, and this has no business overruling it — the same rule that
    makes column G the way to stop the auto-tick."""
    if not foreign:
        return rows, 0
    live = [row for row in rows if _is_annotated(row) or _key(row) not in foreign]
    return live, len(rows) - len(live)


def _drop_dead_rows(rows: list[list[str]]) -> tuple[list[list[str]], int]:
    """Existing rows are checked too, not just the new ones: a posting that was
    open last week is exactly the one that goes stale in the sheet.

    An annotated row is neither asked about nor deleted, and that exception is the
    whole point rather than a detail. Ticking Expired is what you do when a posting
    closes, and the board taking it down is the same event seen from the other
    side — so asking would delete the tombstone at the exact moment it starts
    mattering. Once the row is gone its link leaves `known`, and the next time a
    tracker reposts that job it arrives as fresh, unticked work.

    Expired has no second net the way Applied does. An applied row that gets
    deleted here is ticked again next run from the App tab; an expired row never
    reaches App at all, so nothing would ever tick it back.

    Not asking is also the cheaper half: this is the one step costing a request per
    row, and every settled row is one request that no longer has to be made."""
    asked = [row for row in rows if not _is_annotated(row)]
    gone = dead_links([row[2] for row in asked if len(row) > 2 and row[2].strip()])
    if not gone:
        return rows, 0
    live = [row for row in rows if _is_annotated(row) or not (len(row) > 2 and row[2] in gone)]
    return live, len(rows) - len(live)


def _already_applied(
    values_api, settings: Settings
) -> tuple[set[str], set[tuple[str, frozenset[str]]]]:
    """What the application tracker says has already been sent, read two ways.

    By link first, which is exact. Then by company and role, because the two tabs
    routinely hold different URLs for one job: an application was sent through the
    employer's own board months ago, while the Jobs row still carries whichever
    aggregator link the trackers last published. Without the second reading those
    rows never match and the checkbox stays empty on a job already applied to.

    A tab that cannot be read this way is skipped rather than guessed at. Skipping
    costs a checkbox left unticked on a job already applied to, which an operator
    sees and can fix; guessing the columns would compare the Date Applied column
    against a URL and tick nothing anyway, having said nothing about why."""
    try:
        rows = (
            values_api.get(spreadsheetId=settings.sheet_id, range=_whole_tab(settings.app_tab))
            .execute()
            .get("values", [])
        )
    except HttpError as error:
        if error.status_code != 400:
            raise
        # No such tab. Nothing to compare against is not a reason to fail the sync.
        print(f"WARNING: no tab named {settings.app_tab!r}; skipping the applied check.")
        return set(), set()
    try:
        company, link_column, role = app_columns(
            rows[0] if rows else [], APP_COMPANY_HEADER, APP_LINK_HEADER, APP_ROLE_HEADER
        )
    except AppLayoutError as unreadable:
        print(f"WARNING: {unreadable}. Skipping the applied check.")
        return set(), set()
    links: set[str] = set()
    identities: set[tuple[str, frozenset[str]]] = set()
    for row in rows[1:]:
        link = row[link_column] if len(row) > link_column else ""
        if link.strip():
            links.add(normalize_link(link))
        identity = _loose_identity(
            row[company] if len(row) > company else "",
            row[role] if len(row) > role else "",
        )
        # A half-filled row would otherwise match every row missing the same field.
        if all(identity):
            identities.add(identity)
    return links, identities


def _census(rows: list[list[str]]) -> tuple[int, int, int]:
    """Applied, Expired, and what is left — the postings still worth an application.

    A row can carry both ticks, so the third number is counted from neither being
    set rather than by subtracting the first two."""
    applied = sum(1 for row in rows if _ticked(row, APPLIED))
    expired = sum(1 for row in rows if _ticked(row, EXPIRED))
    open_ = sum(1 for row in rows if not _ticked(row, APPLIED) and not _ticked(row, EXPIRED))
    return applied, expired, open_


def _ticked(row: list[str], column: int) -> bool:
    return len(row) > column and row[column].strip().casefold() == "true"


def _noted(row: list[str]) -> bool:
    """The operator has written on this row past both checkboxes — a note in column
    G or beyond. It is the only way to tell the sync to leave a checkbox alone,
    since an unticked box cannot say so on its own.

    Past *both*: a checkbox column reads FALSE on every row it covers, so counting
    column G as a note would freeze the whole sheet the moment Expired exists."""
    return any(cell.strip() for cell in row[EXPIRED + 1 :])


def _mark_applied(
    rows: list[list[str]], links: set[str], identities: set[tuple[str, frozenset[str]]]
) -> tuple[int, int]:
    """Tick the checkbox on a job already in the tracker, so what is left unticked
    is exactly what there is still to apply to.

    An unticked box is fair game, whether it reads FALSE or reads empty. Sparing
    FALSE was the first attempt, on the theory that it meant a tick someone had
    taken back — but applying checkbox validation writes FALSE across the whole
    range at once, so it is the resting state of every row and carries no intent.
    A column with no blanks in it would have made this a function that can never
    tick anything, which is exactly what the first run reported.

    So a row is skipped when it is already ticked, when Expired says the posting is
    not there to apply to, or when it carries a note past both checkboxes. The note
    is the deliberate act FALSE was mistaken for: write anything in column G and
    this stops touching the row."""
    by_link = 0
    by_name = 0
    for row in rows:
        row.extend([""] * (EXPIRED + 1 - len(row)))
        if _ticked(row, APPLIED) or _ticked(row, EXPIRED) or _noted(row):
            continue
        identity = _loose_identity(row[0] if row else "", row[1] if len(row) > 1 else "")
        if _key(row) in links:
            row[APPLIED] = "TRUE"
            by_link += 1
        elif all(identity) and identity in identities:
            row[APPLIED] = "TRUE"
            by_name += 1
            # The looser of the two readings, so the Actions log has to name what it
            # claimed in order for a wrong match to be findable.
            print(f"Ticked by company and role: {row[0]} — {row[1]}")
    return by_link, by_name


# The columns a row has to fill in to be an application at all. Location (State)
# and Note are left out because a row is not wrong for missing them, and Official
# will not join this list either: it is pasted by hand days after the row is
# written, so requiring it would report every fresh application as MISSING.
#
# A list of names rather than a list of positions, so that a column arriving in
# the middle of the tracker moves the reading with it. The same tuple names the
# columns and finds them, which is what stops the two from drifting apart.
APP_FIELDS = ("Property", "Company", "Application Link", "Date Applied", "Process", "Role")
# The pipeline setup_process_dropdown.gs writes into the Process column.
PROCESS_STAGES = frozenset({"applied", "oa", "completed oa", "interview", "offer", "rejected"})


def _last_stage(cell: str) -> str:
    """The stage named by the bottom line of the Update column, or "".

    Lines are appended in the order the application moved, so the last one that
    names a stage is where the history says it stands. Read bottom-up rather than
    by counting lines: the cell is free text an operator edits by hand, and a
    stray line that names no stage should be stepped over, not believed."""
    for line in reversed(cell.splitlines()):
        stage = line.split(":", 1)[0].strip().casefold()
        if stage in PROCESS_STAGES:
            return stage
    return ""


def audit_app(settings: Settings) -> int:
    """Read every row of the application tracker and say what is wrong with it.

    Five questions, none of which the sheet can ask itself: is a field missing, do
    two rows describe one application, is the Process outside the pipeline, has the
    Update column kept up with it, and does the link still lead anywhere. The last
    one is why this is a separate command — asking every board costs a minute, and
    the sync must not pay it.

    An audit that cannot find its columns reports nothing and says so. There is no
    reading of a header row that is missing which makes the six findings below
    truthful, and an audit that invents them is worse than no audit: every one of
    them names a row number for somebody to go and edit."""
    values_api = _service(settings).spreadsheets().values()
    rows = (
        values_api.get(spreadsheetId=settings.sheet_id, range=_whole_tab(settings.app_tab))
        .execute()
        .get("values", [])
    )
    if not rows:
        print(f"{settings.app_tab} is empty.")
        return 0
    try:
        required = app_columns(rows[0], *APP_FIELDS)
        link_column, company, role, process, update = app_columns(
            rows[0],
            APP_LINK_HEADER,
            APP_COMPANY_HEADER,
            APP_ROLE_HEADER,
            APP_PROCESS_HEADER,
            APP_UPDATE_HEADER,
        )
    except AppLayoutError as unreadable:
        print(f"{settings.app_tab}: {unreadable}. Auditing nothing.")
        return 0

    def read(row: list[str], column: int) -> str:
        """The API drops trailing blanks from every row it hands back, so a short
        row is a blank cell and not a missing column."""
        return (row[column] if len(row) > column else "").strip()

    findings: list[str] = []
    seen_link: dict[str, int] = {}
    seen_identity: dict[tuple[str, frozenset[str]], int] = {}
    for offset, row in enumerate(rows[1:]):
        number = offset + 2  # The sheet's own row number, so a finding is clickable.
        cell = {column: read(row, column) for column in set(required) | {process, update}}
        empty = [name for name, column in zip(APP_FIELDS, required) if not cell[column]]
        if len(empty) == len(APP_FIELDS):
            findings.append(f"  row {number:<4} EMPTY      nothing but formatting")
            continue
        if empty:
            findings.append(f"  row {number:<4} MISSING    {', '.join(empty)}")

        link = cell[link_column]
        if link:
            key = normalize_link(link)
            if urlsplit(link).scheme not in ("http", "https"):
                findings.append(f"  row {number:<4} NOT A LINK {link[:60]}")
            elif key in seen_link:
                findings.append(f"  row {number:<4} SAME LINK  as row {seen_link[key]}")
            else:
                seen_link[key] = number
        identity = _loose_identity(cell[company], cell[role])
        if all(identity):
            if identity in seen_identity:
                findings.append(
                    f"  row {number:<4} SAME JOB   as row {seen_identity[identity]} "
                    f"({cell[company]} — {cell[role]})"
                )
            else:
                seen_identity[identity] = number
        stage = cell[process].casefold()
        if stage and stage not in PROCESS_STAGES:
            findings.append(
                f"  row {number:<4} STAGE?     {cell[process]!r} is not in the pipeline"
            )
        # The Apps Script writes this line the moment Process changes, so the two
        # disagreeing means the change reached the sheet by some route the trigger
        # does not see — an API write, or an edit made while the script was broken.
        recorded = _last_stage(cell[update])
        if stage in PROCESS_STAGES and recorded and recorded != stage:
            findings.append(
                f"  row {number:<4} UNLOGGED   Process is {cell[process]!r} but Update "
                f"stops at {recorded!r}"
            )

    live = {read(row, link_column) for row in rows[1:] if read(row, link_column)}
    for url in sorted(dead_links(sorted(live))):
        rows_with = [
            offset + 2 for offset, row in enumerate(rows[1:]) if read(row, link_column) == url
        ]
        for number in rows_with:
            findings.append(f"  row {number:<4} DEAD LINK  the board reports it as gone")

    print(f"{settings.app_tab}: {len(rows) - 1} rows")
    for finding in sorted(findings, key=lambda text: int(text.split()[1])):
        print(finding)
    print(f"{len(findings)} findings across {len(rows) - 1} rows.")
    return len(findings)


def _fill_source(rows: list[list[str]], sources: dict[str, str]) -> int:
    """Name the tracker or board a row already in the sheet came from.

    Only ever fills a blank. A row that already names its source keeps it, even
    when a different tracker is offering the same posting today — where a job was
    first seen is the answer that stays true, and rewriting it each run would make
    the column flicker between two names for one row that never changed.

    Rows written before the column existed are the reason this exists at all: they
    come back from the migration with an empty cell and nothing but a link to
    recover it from."""
    filled = 0
    for row in rows:
        row.extend([""] * (len(HEADERS) - len(row)))
        # "FALSE" counts as empty. A checkbox rule that reached this column writes
        # that word into every cell it covers, and reading it as a source already
        # recorded is exactly what made the first migration fill 33 rows out of 330.
        if row[SOURCE].strip().casefold() not in ("", "false"):
            continue
        found = sources.get(_key(row) or "")
        if found:
            row[SOURCE] = found
            filled += 1
    return filled


def _layout(header: list[str]) -> str:
    """Which of four shapes the Jobs tab is in, read off its header row.

    "done"    — column E says Source. Nothing to do.
    "old"     — column E says Applied. The sheet predates the column entirely.
    "half"    — E is blank and F says Applied. A column was inserted but never
                claimed: the header was not written, and the insert copied the
                checkbox rule across from what is now F.
    "unknown" — anything else, and the only safe answer is to stop. Inserting a
                column into a sheet whose shape is not understood would move
                somebody's checkboxes away from the rows they were ticked on.
    """

    def cell(index: int) -> str:
        return header[index].strip() if len(header) > index else ""

    if cell(SOURCE) == HEADERS[SOURCE]:
        return "done"
    if cell(SOURCE) == OLD_FIFTH:
        return "old"
    if not cell(SOURCE) and cell(SOURCE + 1) == OLD_FIFTH:
        return "half"
    print(
        f"WARNING: expected {HEADERS[SOURCE]!r} or {OLD_FIFTH!r} in column E; found "
        f"{cell(SOURCE)!r}. Leaving the layout alone."
    )
    return "unknown"


def _insert_source_column(service, settings: Settings) -> None:
    """Push everything from column E one to the right and write the header in.

    Done from here rather than by hand in the Apps Script editor because the sync
    runs on a cron: between a person reading an instruction and acting on it, this
    would run several times, and each of those runs would write company names into
    the Applied checkboxes. There is no safe window to ask for, so there is no
    asking.

    inheritFromBefore is **true**, which reads backwards and is the whole point: a
    new column inherits from the one before it when true and from the one after it
    when false. False made column E inherit the Applied checkbox rule, and a
    checkbox rule writes FALSE into every cell it covers — so the new column came
    up full of the word FALSE, and the fill below read that as a source already
    written and skipped every row.

    The rule is then cleared outright rather than trusted to inheritance, because
    the same mistake is invisible until a whole run has been wasted."""
    sheet_id = _tab_id(service, settings, settings.sheet_tab)
    if sheet_id is None:
        raise RuntimeError(f"No tab named {settings.sheet_tab!r} to insert a column into.")
    service.spreadsheets().batchUpdate(
        spreadsheetId=settings.sheet_id,
        body={
            "requests": [
                {
                    "insertDimension": {
                        "range": {
                            "sheetId": sheet_id,
                            "dimension": "COLUMNS",
                            "startIndex": SOURCE,
                            "endIndex": SOURCE + 1,
                        },
                        "inheritFromBefore": True,
                    }
                }
            ]
        },
    ).execute()
    print(f"Inserted a {HEADERS[SOURCE]} column at {settings.sheet_tab}!E; everything moved right.")


def _claim_source_column(service, settings: Settings) -> None:
    """Take the checkbox rule off column E, whatever put it there.

    Run after an insert and on a sheet found half-migrated, so that one wrong
    inheritFromBefore does not need a person to go and undo it by hand. A
    setDataValidation request carrying no rule is how the API spells "clear"."""
    sheet_id = _tab_id(service, settings, settings.sheet_tab)
    if sheet_id is None:
        return
    service.spreadsheets().batchUpdate(
        spreadsheetId=settings.sheet_id,
        body={
            "requests": [
                {
                    "setDataValidation": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": 1,
                            "startColumnIndex": SOURCE,
                            "endColumnIndex": SOURCE + 1,
                        }
                    }
                }
            ]
        },
    ).execute()


def _tab_id(service, settings: Settings, tab: str) -> int | None:
    meta = (
        service.spreadsheets()
        .get(spreadsheetId=settings.sheet_id, fields="sheets.properties(sheetId,title)")
        .execute()
    )
    for sheet in meta.get("sheets", []):
        if sheet["properties"]["title"] == tab:
            return sheet["properties"]["sheetId"]
    return None


def _jobs_checkbox_rule(sheet_id: int, rows: int) -> dict:
    """The checkbox validation over exactly the Jobs rows just written.

    Values and validation are separate Sheets API operations.  A boolean written
    below an old, fixed validation range is otherwise displayed as bare TRUE or
    FALSE, even though it carries the same state as a checkbox.
    """
    return {
        "setDataValidation": {
            "range": {
                "sheetId": sheet_id,
                "startRowIndex": 1,  # row 2; row 1 is the header
                "endRowIndex": rows + 1,
                "startColumnIndex": APPLIED,
                "endColumnIndex": EXPIRED + 1,
            },
            "rule": {"condition": {"type": "BOOLEAN"}, "showCustomUi": True},
        }
    }


def _ensure_jobs_checkboxes(service, settings: Settings, rows: int) -> None:
    """Draw Applied and Expired as checkboxes wherever this sync wrote values."""
    if not rows:
        return
    sheet_id = _tab_id(service, settings, settings.sheet_tab)
    if sheet_id is None:
        raise RuntimeError(f"No tab named {settings.sheet_tab!r} to format checkboxes on.")
    service.spreadsheets().batchUpdate(
        spreadsheetId=settings.sheet_id,
        body={"requests": [_jobs_checkbox_rule(sheet_id, rows)]},
    ).execute()


def append_new_jobs(
    settings: Settings,
    jobs: list[Job],
    rebuild: bool = False,
    verify_links: bool = True,
    foreign: set[str] | None = None,
) -> SyncResult:
    service = _service(settings)
    values_api = service.spreadsheets().values()
    tab = _quote_tab(settings.sheet_tab)
    # Read past column D so that any extra column an operator added travels with
    # its own row when the sheet is re-sorted, instead of staying behind.
    try:
        existing = (
            values_api.get(spreadsheetId=settings.sheet_id, range=f"{tab}!A:Z")
            .execute()
            .get("values", [])
        )
    except HttpError as error:
        if error.status_code != 400:
            raise
        # A quoted range only fails to parse when the tab is not there at all.
        found = ", ".join(_tab_names(service, settings.sheet_id)) or "(none)"
        raise RuntimeError(
            f"No tab named {settings.sheet_tab!r} in the spreadsheet. Tabs found: {found}"
        ) from error
    header, data = (existing[0], existing[1:]) if existing else (HEADERS, [])
    shape = _layout(header)
    if shape in ("old", "half"):
        if shape == "old":
            _insert_source_column(service, settings)
        _claim_source_column(service, settings)
        # Re-read rather than shifting the rows in memory. The insert moves values,
        # checkbox validation and cell colours together, and the only way to be sure
        # this run agrees with what is now on the sheet is to look again.
        existing = (
            values_api.get(spreadsheetId=settings.sheet_id, range=f"{tab}!A:Z")
            .execute()
            .get("values", [])
        )
        header, data = (existing[0], existing[1:]) if existing else (HEADERS, [])
        # The header cell is written here rather than left to the sheet's own copy:
        # a column inserted into row 1 arrives blank, and nothing downstream would
        # ever put a name in it.
        header = header + [""] * (len(HEADERS) - len(header))
        header[SOURCE] = HEADERS[SOURCE]
    if header[: len(HEADERS) - 1] != HEADERS[:-1]:
        raise RuntimeError(
            f"Expected {HEADERS[:-1]} in {settings.sheet_tab}!A1:D1; found {header[:4]}"
        )
    if rebuild:
        # Rows written by an earlier, buggier parse cannot be repaired in place —
        # the company they should carry is only knowable from the source.
        header, data = HEADERS, []
    data, empty = _drop_empty_rows(data)
    data = _drop_duplicate_rows(data)
    data, blocked = _drop_blocked_rows(data)
    # Before `known` is taken, so that a row leaving for being abroad does not
    # leave its link behind to block the same posting being re-read later from a
    # board that has since moved it to a US office.
    data, abroad = _drop_foreign_rows(data, foreign or set())
    known = {key for row in data if (key := _key(row))}
    fresh = [job for job in jobs if job.dedupe_key not in known]
    data = data + [
        [job.company, job.role, job.apply_link, job.date_posted, job.source] for job in fresh
    ]
    # Every crawled job, not only the new ones: the rows already in the sheet are
    # exactly the ones with nothing in the column, and the crawl is the only thing
    # that still knows where they came from.
    sourced = _fill_source(data, {job.dedupe_key: job.source for job in jobs if job.source})
    # After the new rows are appended rather than before, so that a new posting
    # repeating a company and role already in the sheet is the one dropped.
    data, duplicate = _drop_duplicate_identities(data)
    dead = 0
    if verify_links:
        data, dead = _drop_dead_rows(data)
    # After the dedupe rather than before: a row ticked here is protected from being
    # merged away from the next run onward, once the sheet has been read back.
    ticked_link, ticked_name = _mark_applied(data, *_already_applied(values_api, settings))
    applied, expired, still_open = _census(data)
    # Reported even on the run that writes nothing: how much is left to apply to is
    # worth knowing whether or not the sheet changed.
    laid_out, separator = _divided(_sorted_rows(data))
    # Every count, not just the standing ones. The early return below reports these
    # too: the work of filtering still happened on a run that had nothing to write,
    # and a log that zeroes it is a log that cannot be read.
    standing = {
        "dead": dead,
        "blocked": blocked,
        "abroad": abroad,
        "sourced": sourced,
        "duplicate": duplicate,
        "empty": empty,
        "ticked_link": ticked_link,
        "ticked_name": ticked_name,
        "applied": applied,
        "expired": expired,
        "open_": still_open,
        "separator": separator,
        "written_rows": len(laid_out) + 1,
    }
    # The whole intended layout against what the sheet already holds, rather than a
    # list of the things that might have changed. Every earlier version of this test
    # named some of them and missed others — first a new sort order, then a divider
    # row — and each time the answer was computed, thrown away, and reported green.
    # Both sides with the caption blanked: it is the one cell guaranteed to differ.
    was = ([_unstamped(existing[0])] + existing[1:]) if existing else []
    unchanged = _trimmed([_unstamped(header)] + laid_out) == _trimmed(was)
    stamp = _stamp()
    header = list(header) + [""] * max(0, STAMP + 1 - len(header))
    header[STAMP] = stamp
    if unchanged and not rebuild:
        # Only the caption moved, so only the caption is written. Rewriting the
        # whole tab here would cost the sheet a revision per run to say that
        # nothing had happened, and would touch every row's formatting to do it.
        _update(values_api, settings, f"{tab}!{_column(STAMP)}1", [[stamp]], "RAW")
        return SyncResult(stamped=stamp, **standing)
    _write(values_api, settings, tab, [header] + laid_out, clear_to_row=len(existing))
    # Keep the validation bound to the same extent as the values.  The old manual
    # setup stopped at row 500 while Jobs grew past it, leaving boolean values
    # below that row to render as bare TRUE/FALSE.
    _ensure_jobs_checkboxes(service, settings, len(laid_out))
    # A new job whose link is already dead is filtered out here, so the count has
    # to be taken from what survived rather than from what was offered.
    fresh_links = {job.apply_link for job in fresh}
    appended = sum(1 for row in data if len(row) > 2 and row[2] in fresh_links)
    return SyncResult(appended=appended, wrote=True, stamped=stamp, **standing)


def _column(index: int) -> str:
    """The A1 letters for a zero-based column.

    The Jobs tab has never reached AA and the tracker is nowhere near it, so this
    was one letter for a long time. It carries the second letter now because the
    index it is given no longer comes from a constant somebody counted out — it
    comes from wherever a header turned up in row 1. Past Z the one-letter version
    returned "[", which is a range the API rejects: an error, not a corruption, but
    an error naming a bracket rather than the column that moved."""
    letters = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(ord("A") + remainder) + letters
    return letters


def _update(values_api, settings: Settings, cells: str, rows: list[list[str]], parse: str) -> None:
    values_api.update(
        spreadsheetId=settings.sheet_id,
        range=cells,
        valueInputOption=parse,
        body={"values": rows},
    ).execute()


def _write(
    values_api, settings: Settings, tab: str, rows: list[list[str]], clear_to_row: int
) -> None:
    """Rewriting beats appending because the whole sheet has to end up sorted.
    Every row is padded to one width so a sorted row can never leave a stale cell
    behind from the longer row that used to sit in its place. A rebuild or a
    duplicate purge shortens the sheet, so whatever sat below the new last row is
    cleared first — otherwise the tail of the old, longer sheet survives.

    The write splits at the four columns this tool owns, because the halves need
    opposite parsing. A:D goes in RAW: Date Posted is an ISO string and the sort
    reads it as one, which USER_ENTERED would turn into a date serial. E onward
    goes in USER_ENTERED so the "TRUE" of a ticked Applied checkbox is stored as
    the boolean the checkbox reads, rather than as text laid over it. The split
    costs one extra API call per run."""
    width = max(len(row) for row in rows)
    padded = [row + [""] * (width - len(row)) for row in rows]
    last_column = _column(width - 1)
    owned = len(HEADERS)
    if clear_to_row > len(padded):
        values_api.clear(
            spreadsheetId=settings.sheet_id,
            range=f"{tab}!A{len(padded) + 1}:{last_column}{clear_to_row}",
            body={},
        ).execute()
    _update(
        values_api,
        settings,
        f"{tab}!A1:{_column(owned - 1)}{len(padded)}",
        [row[:owned] for row in padded],
        "RAW",
    )
    if width > owned:
        _update(
            values_api,
            settings,
            f"{tab}!{_column(owned)}1:{last_column}{len(padded)}",
            [row[owned:] for row in padded],
            "USER_ENTERED",
        )
