from __future__ import annotations

import json
from dataclasses import dataclass
from urllib.parse import urlsplit

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from job_sync.config import Settings
from job_sync.liveness import dead_links
from job_sync.sources import (
    Job,
    is_aggregator_link,
    is_blocked_company,
    name_key,
    normalize_link,
    role_key,
    role_tokens,
)

HEADERS = ["Company", "Role", "Link Apply", "Date Posted"]
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
# Columns E and F, the first two past the four this tool owns. Both are checkboxes
# the operator ticks; a free-text note starts at G, past both of them.
APPLIED = len(HEADERS)
EXPIRED = APPLIED + 1
# The application tracker: Property | Company | Application Link | Date Applied |
# Location (State) | Process | Role | Note | (recruiter mark) | Update.
APP_COMPANY, APP_LINK, APP_PROCESS, APP_ROLE = 1, 2, 5, 6
# Column J, where sync_applied_to_app.gs appends one "<Stage>: <date>" line per
# stage the application has passed through. Column I is skipped on purpose: it
# carries the recruiter mark, which is a background colour and no text.
APP_UPDATE = 9


@dataclass(frozen=True)
class SyncResult:
    """What one run changed, so the log can say which rows left and why."""

    appended: int = 0
    dead: int = 0
    blocked: int = 0
    abroad: int = 0
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


def _service(settings: Settings):
    info = json.loads(settings.service_account_json)
    credentials = Credentials.from_service_account_info(info, scopes=SCOPES)
    return build("sheets", "v4", credentials=credentials, cache_discovery=False)


def _quote_tab(tab: str) -> str:
    """A1 notation needs the sheet name quoted; anything with a space or a digit
    at the front is otherwise unparseable. Inside quotes, ' doubles to ''."""
    return "'" + tab.replace("'", "''") + "'"


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


def _identity(row: list[str]) -> tuple[str, str]:
    """One posting, for deciding what leaves the sheet. Strict on purpose: merging
    two rows here deletes an opening, so the intake stays part of the role."""
    company = name_key(row[0]) if row else ""
    role = role_key(row[1]) if len(row) > 1 else ""
    return (company, role)


def _loose_identity(company: str, role: str) -> tuple[str, frozenset[str]]:
    """One posting, for asking whether it has already been applied to. Loose on
    purpose: a wrong answer here ticks a checkbox, which a note in column F undoes,
    while the strict reading misses a job the App tab plainly records."""
    return (name_key(company), role_tokens(role))


def _drop_empty_rows(rows: list[list[str]]) -> tuple[list[list[str]], int]:
    """A row with nothing in the four columns this tool owns is not a job.

    The sheet is full of them and none were typed. Checkbox validation covers
    E2:F500 whether or not there is a job on the row, and a cleared checkbox reads
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
    """Someone has written past the four columns this tool owns — a tick in the
    Applied checkbox in column E, a note in F.

    An unticked checkbox reads back as "FALSE" rather than as an empty cell, and
    an unticked box is precisely the absence of an annotation. Without this every
    row in the sheet would count as annotated and the tier would say nothing."""
    return any(cell.strip().casefold() not in ("", "false") for cell in row[len(HEADERS) :])


def _preference(rows: list[list[str]], position: int) -> tuple[int, int, int]:
    """Which of two rows describing one job to keep, smallest first.

    An annotation outranks everything: whoever wrote "applied" in column E
    applied through that link, and no better link is worth losing the note for.

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
        if not company or not role:
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
    open last week is exactly the one that goes stale in the sheet."""
    gone = dead_links([row[2] for row in rows if len(row) > 2 and row[2].strip()])
    if not gone:
        return rows, 0
    live = [row for row in rows if not (len(row) > 2 and row[2] in gone)]
    return live, len(rows) - len(live)


def _already_applied(
    values_api, settings: Settings
) -> tuple[set[str], set[tuple[str, frozenset[str]]]]:
    """What the application tracker says has already been sent, read two ways.

    By link first, which is exact. Then by company and role, because the two tabs
    routinely hold different URLs for one job: an application was sent through the
    employer's own board months ago, while the Jobs row still carries whichever
    aggregator link the trackers last published. Without the second reading those
    rows never match and the checkbox stays empty on a job already applied to."""
    try:
        rows = (
            values_api.get(
                spreadsheetId=settings.sheet_id, range=f"{_quote_tab(settings.app_tab)}!A:H"
            )
            .execute()
            .get("values", [])
        )
    except HttpError as error:
        if error.status_code != 400:
            raise
        # No such tab. Nothing to compare against is not a reason to fail the sync.
        print(f"WARNING: no tab named {settings.app_tab!r}; skipping the applied check.")
        return set(), set()
    links: set[str] = set()
    identities: set[tuple[str, frozenset[str]]] = set()
    for row in rows[1:]:
        link = row[APP_LINK] if len(row) > APP_LINK else ""
        if link.strip():
            links.add(normalize_link(link))
        identity = _loose_identity(
            row[APP_COMPANY] if len(row) > APP_COMPANY else "",
            row[APP_ROLE] if len(row) > APP_ROLE else "",
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
    column F as a note would freeze the whole sheet the moment Expired exists."""
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


APP_FIELDS = ("Property", "Company", "Application Link", "Date Applied", None, "Process", "Role")
# The pipeline setup_process_dropdown.gs writes into the Process column.
PROCESS_STAGES = frozenset({"applied", "oa", "interview", "offer", "rejected"})


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
    the sync must not pay it."""
    values_api = _service(settings).spreadsheets().values()
    rows = (
        values_api.get(spreadsheetId=settings.sheet_id, range=f"{_quote_tab(settings.app_tab)}!A:J")
        .execute()
        .get("values", [])
    )
    if not rows:
        print(f"{settings.app_tab} is empty.")
        return 0

    findings: list[str] = []
    seen_link: dict[str, int] = {}
    seen_identity: dict[tuple[str, frozenset[str]], int] = {}
    for offset, row in enumerate(rows[1:]):
        number = offset + 2  # The sheet's own row number, so a finding is clickable.
        cell = [(row[i] if len(row) > i else "").strip() for i in range(APP_UPDATE + 1)]
        empty = [name for i, name in enumerate(APP_FIELDS) if name and not cell[i]]
        if len(empty) == len(list(filter(None, APP_FIELDS))):
            findings.append(f"  row {number:<4} EMPTY      nothing but formatting")
            continue
        if empty:
            findings.append(f"  row {number:<4} MISSING    {', '.join(empty)}")

        link = cell[APP_LINK]
        if link:
            key = normalize_link(link)
            if urlsplit(link).scheme not in ("http", "https"):
                findings.append(f"  row {number:<4} NOT A LINK {link[:60]}")
            elif key in seen_link:
                findings.append(f"  row {number:<4} SAME LINK  as row {seen_link[key]}")
            else:
                seen_link[key] = number
        identity = _loose_identity(cell[APP_COMPANY], cell[APP_ROLE])
        if all(identity):
            if identity in seen_identity:
                findings.append(
                    f"  row {number:<4} SAME JOB   as row {seen_identity[identity]} "
                    f"({cell[APP_COMPANY]} — {cell[APP_ROLE]})"
                )
            else:
                seen_identity[identity] = number
        stage = cell[APP_PROCESS].casefold()
        if stage and stage not in PROCESS_STAGES:
            findings.append(
                f"  row {number:<4} STAGE?     {cell[APP_PROCESS]!r} is not in the pipeline"
            )
        # The Apps Script writes this line the moment Process changes, so the two
        # disagreeing means the change reached the sheet by some route the trigger
        # does not see — an API write, or an edit made while the script was broken.
        recorded = _last_stage(cell[APP_UPDATE])
        if stage in PROCESS_STAGES and recorded and recorded != stage:
            findings.append(
                f"  row {number:<4} UNLOGGED   Process is {cell[APP_PROCESS]!r} but Update "
                f"stops at {recorded!r}"
            )

    live = {row[APP_LINK] for row in rows[1:] if len(row) > APP_LINK and row[APP_LINK].strip()}
    for url in sorted(dead_links(sorted(live))):
        rows_with = [
            offset + 2
            for offset, row in enumerate(rows[1:])
            if len(row) > APP_LINK and row[APP_LINK].strip() == url
        ]
        for number in rows_with:
            findings.append(f"  row {number:<4} DEAD LINK  the board reports it as gone")

    print(f"{settings.app_tab}: {len(rows) - 1} rows")
    for finding in sorted(findings, key=lambda text: int(text.split()[1])):
        print(finding)
    print(f"{len(findings)} findings across {len(rows) - 1} rows.")
    return len(findings)


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
    if header[:4] != HEADERS:
        raise RuntimeError(f"Expected {HEADERS} in {settings.sheet_tab}!A1:D1; found {header[:4]}")
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
    data = data + [[job.company, job.role, job.apply_link, job.date_posted] for job in fresh]
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
    unchanged = _trimmed([header] + laid_out) == _trimmed(existing)
    if unchanged and not rebuild:
        return SyncResult(**standing)
    _write(values_api, settings, tab, [header] + laid_out, clear_to_row=len(existing))
    # A new job whose link is already dead is filtered out here, so the count has
    # to be taken from what survived rather than from what was offered.
    fresh_links = {job.apply_link for job in fresh}
    appended = sum(1 for row in data if len(row) > 2 and row[2] in fresh_links)
    return SyncResult(appended=appended, wrote=True, **standing)


def _column(index: int) -> str:
    """The A1 letter for a zero-based column. Four owned columns plus a handful of
    operator ones never reaches AA, so one letter is enough."""
    return chr(ord("A") + index)


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
