"""Who can be asked about an application already sent.

Two questions the App tab cannot answer on its own, and both are about the same
thing — is there a person on the other side of this application.

  * An alumnus works there. A tick in column I of App, and still a yellow row in
    the Alumni tab, where there is no application to hang a checkbox off.
  * A recruiter contact exists. A tick in column J of App, from a list of employer
    names carried in this repo.

Both App marks used to be colours: yellow across the row, red in column I. A
checkbox says the same thing and can be filtered and sorted on, which a
background colour cannot. The paint is lifted on the first run that finds it.

These two columns are the only cells outside the Jobs tab this tool writes, and
it owns them completely — every run states both, so a tick added by hand is gone
by the next sync. Anything you want to keep goes in Note.

Colour that is still colour is only ever cleared where it matches the exact
values below, in the column it was written to. A cell coloured by hand is
invisible to this, so a run can be repeated without eating anyone's marks.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from googleapiclient.errors import HttpError

from job_sync.config import Settings
from job_sync.sheet import APP_COMPANY, _column, _quote_tab, _service
from job_sync.sources import company_tokens, same_employer

ALUMNI_COMPANY = 0
ALUMNI_WIDTH = 6
JOBS_WIDTH = 7
APP_WIDTH = 8
# Columns I and J of App, the two checkboxes this module owns. Zero-based, and
# adjacent so both are stated in one write.
APP_ALUMNI, APP_RECRUITER = 8, 9
# What those two cells have to say in row 1 before anything is written under them.
APP_HEADERS = ("Alumni", "Recruiter")
FIRST_DATA_ROW = 1  # zero-based; row 1 of the sheet is the header
HIGHLIGHT = {"red": 1.0, "green": 0.898, "blue": 0.6}
RECRUITER = {"red": 0.957, "green": 0.8, "blue": 0.8}
# A light green that belongs to this tool alone.  Only Jobs!A is ever painted
# with it, so it can never overwrite an operator's notes, checkbox state, or a
# hand-applied colour elsewhere on the row.
H1B_SPONSOR = {"red": 0.718, "green": 0.882, "blue": 0.804}
PLAIN = {"red": 1.0, "green": 1.0, "blue": 1.0}
# Sheets returns the colour it stored, not the float that was sent.
TOLERANCE = 0.02
# Inside the package, not beside it: pip install . copies job_sync/ and nothing
# else, so a list at the repo root is present in a checkout and absent on a runner.
RECRUITER_COMPANIES = Path(__file__).resolve().parent / "data" / "recruiter_companies.txt"
H1B_SPONSORS = Path(__file__).resolve().parent / "data" / "h1b_software_engineer_sponsors.txt"

# A career page sometimes uses the product or former brand while the DOL LCA
# uses the legal employer.  These are intentionally short, high-confidence
# aliases; everything else is matched through the normalized whole-name tokens
# below rather than an unrestricted fuzzy match that would paint lookalikes.
H1B_ALIASES = {
    "aws": frozenset({"amazon", "web", "services"}),
    "gcp": frozenset({"google"}),
    "facebook": frozenset({"meta", "platforms"}),
    "twitter": frozenset({"x"}),
    "x": frozenset({"twitter"}),
}

# These words occur in enough unrelated registered names that a one-word
# containment match would be misleading (for example, a company named simply
# "Data").  Multi-word matches remain useful and safe, and distinctive
# one-word brands such as Google and Stripe still match their LLC/Inc variants.
H1B_GENERIC_SINGLE_WORDS = frozenset(
    {
        "data",
        "digital",
        "global",
        "health",
        "information",
        "international",
        "services",
        "solutions",
        "systems",
        "ventures",
    }
)


@dataclass(frozen=True)
class _Ticks:
    """What one pass at the two checkbox columns did.

    `ready` is the headers being in place, which is the tool's permission to touch
    the columns at all. It is separate from `wrote` because a run can be allowed to
    write and have nothing to say."""

    ready: bool = False
    wrote: bool = False


@dataclass(frozen=True)
class HighlightResult:
    alumni_rows: int = 0
    alumni_lit: int = 0
    app_rows: int = 0
    app_lit: int = 0
    recruiter_lit: int = 0
    h1b_lit: int = 0
    # Whether the two checkbox columns had to be restated. A run that changes
    # nothing sends nothing, same as the sheet write.
    ticked: bool = False
    # Whether the checkbox rule itself had to be repaired over those columns.
    boxed: bool = False


def recruiter_companies() -> list[frozenset[str]]:
    """Employers with a recruiter contact, as token sets ready to compare.

    Read from a file in the repo rather than over the wire: the list changes when
    the outreach project is re-run, not between syncs, and a missing file is only
    a feature switched off."""
    if not RECRUITER_COMPANIES.exists():
        return []
    lines = RECRUITER_COMPANIES.read_text(encoding="utf-8").splitlines()
    tokens = [company_tokens(line) for line in lines if line.strip() and not line.startswith("#")]
    return [token_set for token_set in tokens if token_set]


def h1b_sponsors() -> list[frozenset[str]]:
    """DOL-certified SWE H-1B sponsors present in both FY2024 and FY2025.

    The file is generated from ColdEmail's DOL extraction and ships with the
    package so GitHub Actions uses precisely the same sponsor list as a local
    run.  A missing list deliberately becomes an empty result: it leaves the
    green paint alone rather than falsely declaring every company a non-sponsor.
    """
    if not H1B_SPONSORS.exists():
        return []
    lines = H1B_SPONSORS.read_text(encoding="utf-8").splitlines()
    tokens = [company_tokens(line) for line in lines if line.strip() and not line.startswith("#")]
    return [token_set for token_set in tokens if token_set]


def _h1b_tokens(company: str) -> frozenset[str]:
    """Normalize a company name and expand only high-confidence brand aliases."""
    tokens = company_tokens(company)
    expanded = set(tokens)
    for alias, legal_name in H1B_ALIASES.items():
        if alias in tokens:
            expanded.update(legal_name)
    return frozenset(expanded)


def is_h1b_sponsor(company: str, sponsors: list[frozenset[str]]) -> bool:
    """Whether a Jobs company sponsored certified SWE H-1B LCAs in both years.

    Legal suffixes, punctuation, and added parent-company wording are ignored.
    Matching remains whole-word and is conservative for generic one-word names,
    avoiding an accidental green mark for an unrelated company with a shared
    word.
    """
    candidate = _h1b_tokens(company)
    if not candidate:
        return False
    for sponsor in sponsors:
        if not same_employer(candidate, _h1b_tokens(" ".join(sponsor))):
            continue
        shared = candidate & sponsor
        if len(shared) != 1 or next(iter(shared)) not in H1B_GENERIC_SINGLE_WORDS:
            return True
    return False


def _values(values_api, settings: Settings, tab: str, columns: str) -> list[list[str]] | None:
    """None where the tab is not there, which is different from a tab with no rows."""
    try:
        return (
            values_api.get(spreadsheetId=settings.sheet_id, range=f"{_quote_tab(tab)}!{columns}")
            .execute()
            .get("values", [])
        )
    except HttpError as error:
        if error.status_code != 400:
            raise
        return None


def _is(colour: dict | None, target: dict) -> bool:
    if not colour:
        return False
    return all(
        abs(colour.get(channel, 0.0) - target[channel]) < TOLERANCE
        for channel in ("red", "green", "blue")
    )


def _painted(
    service, settings: Settings, tab: str, rows: int, letter: str, target: dict
) -> tuple[int, set[int]] | None:
    """The tab's id, and which rows already carry `target` in the probe column.

    One column is enough because each mark is a solid block, and reading it back
    is what makes the clear surgical rather than wiping every background on the
    tab. The two marks probe different columns — A for the row-wide yellow, I for
    the recruiter red — so neither can mistake the other for its own work."""
    result = (
        service.spreadsheets()
        .get(
            spreadsheetId=settings.sheet_id,
            ranges=[f"{_quote_tab(tab)}!{letter}1:{letter}{max(rows, 1)}"],
            includeGridData=True,
            fields="sheets(properties(sheetId),data(rowData(values(userEnteredFormat(backgroundColor)))))",
        )
        .execute()
    )
    sheets = result.get("sheets", [])
    if not sheets:
        return None
    sheet_id = sheets[0]["properties"]["sheetId"]
    data = sheets[0].get("data", [{}])[0].get("rowData", [])
    marked = set()
    for index, row in enumerate(data):
        cells = row.get("values", [])
        colour = cells[0].get("userEnteredFormat", {}).get("backgroundColor") if cells else None
        if _is(colour, target):
            marked.add(index)
    return sheet_id, marked


def _runs(rows: set[int]) -> list[tuple[int, int]]:
    """Consecutive rows folded into half-open ranges, so scattered matches cost a
    handful of requests rather than one each."""
    spans: list[tuple[int, int]] = []
    for row in sorted(rows):
        if spans and spans[-1][1] == row:
            spans[-1] = (spans[-1][0], row + 1)
        else:
            spans.append((row, row + 1))
    return spans


def _paint(sheet_id: int, span: tuple[int, int], columns: tuple[int, int], colour: dict) -> dict:
    return {
        "repeatCell": {
            "range": {
                "sheetId": sheet_id,
                "startRowIndex": span[0],
                "endRowIndex": span[1],
                "startColumnIndex": columns[0],
                "endColumnIndex": columns[1],
            },
            "cell": {"userEnteredFormat": {"backgroundColor": colour}},
            "fields": "userEnteredFormat.backgroundColor",
        }
    }


def _requests(
    sheet_id: int,
    matched: set[int],
    painted: set[int],
    columns: tuple[int, int],
    colour: dict,
) -> list[dict]:
    """Only the difference. A row already the right colour is left alone, so a run
    that changes nothing sends nothing."""
    requests = [_paint(sheet_id, span, columns, PLAIN) for span in _runs(painted - matched)]
    requests += [_paint(sheet_id, span, columns, colour) for span in _runs(matched - painted)]
    return requests


def _boxes(rows: list[list[str]], count: int) -> list[list[str]]:
    """Two checkbox columns, `count` rows deep, every cell reading TRUE or FALSE.

    Both halves of the comparison go through this. A checkbox that has never been
    ticked reads back as FALSE, one on a row the validation has not reached reads
    back as nothing at all, and the API drops trailing blanks from every row it
    returns — three spellings of the same state, which would otherwise make a run
    that changes nothing look like a run with work to do."""
    stated = []
    for index in range(count):
        row = rows[index] if index < len(rows) else []
        stated.append(
            [
                "TRUE"
                if column < len(row) and row[column].strip().casefold() == "true"
                else "FALSE"
                for column in (0, 1)
            ]
        )
    return stated


def _state(matched: set[int] | None, index: int, held: str) -> str:
    """What this run has to say about one checkbox, or what the sheet already says
    where the run has nothing to say. Written as a function rather than a nested
    conditional because the condition has to be read before the membership test —
    `index in matched` on a None set raises before any else branch is reached."""
    if matched is None:
        return held
    return "TRUE" if index in matched else "FALSE"


def _mark_contacts(
    values_api,
    settings: Settings,
    rows: int,
    alumni: set[int] | None,
    recruiters: set[int] | None,
) -> _Ticks:
    """State both checkbox columns, and say whether anything had to be written.

    A None match set means that mark's source was not available this run — no
    Alumni tab, or no recruiter list in the wheel. That is the one case where the
    column is not restated: the tool owns these cells, so computing "no matches"
    from a source that is missing rather than empty would untick the lot.

    Nothing is written until the two headers say so. The sync runs on a cron five
    times a day, and until setupAppColumns has run, column J is whatever it used to
    be — which for one day was the Update history. Writing FALSE down a column on
    that assumption would erase it. Reading the header costs nothing extra: it
    arrives in the same call as the rows.

    USER_ENTERED, not RAW: written raw, the string "TRUE" is laid over the
    checkbox as text instead of ticking it, and reads back next run as untouched."""
    if not rows:
        return _Ticks()
    first, last = _column(APP_ALUMNI), _column(APP_RECRUITER)
    cells = f"{_quote_tab(settings.app_tab)}!{first}2:{last}{rows + FIRST_DATA_ROW}"
    sheet = _values(values_api, settings, settings.app_tab, f"{first}1:{last}") or []
    heading = [cell.strip() for cell in (sheet[0] if sheet else [])]
    if heading[: len(APP_HEADERS)] != list(APP_HEADERS):
        print(
            f"{settings.app_tab}!{first}1:{last}1 does not read "
            f"{' and '.join(APP_HEADERS)}; run setupAppColumns in the Apps Script "
            "editor first. Leaving both columns as they stand."
        )
        return _Ticks()
    current = _boxes(sheet[FIRST_DATA_ROW:], rows)
    wanted = [
        [_state(alumni, index, held[0]), _state(recruiters, index, held[1])]
        for index, held in enumerate(current, start=FIRST_DATA_ROW)
    ]
    if wanted == current:
        return _Ticks(ready=True)
    values_api.update(
        spreadsheetId=settings.sheet_id,
        range=cells,
        valueInputOption="USER_ENTERED",
        body={"values": wanted},
    ).execute()
    return _Ticks(ready=True, wrote=True)


def _boxed(service, settings: Settings, rows: int) -> tuple[int, bool] | None:
    """The App tab's id, and whether every cell the ticks go into is a checkbox.

    This is the question behind the bare word FALSE. A checkbox cell holds a
    boolean and a rule that draws it as a box; write the boolean where the rule
    does not reach and Sheets has nothing to draw, so it prints the value instead.
    Every cell in the range is checked rather than the first, because the gap is
    always at the bottom — the rule was applied when the tab was shorter."""
    first, last = _column(APP_ALUMNI), _column(APP_RECRUITER)
    result = (
        service.spreadsheets()
        .get(
            spreadsheetId=settings.sheet_id,
            ranges=[f"{_quote_tab(settings.app_tab)}!{first}2:{last}{rows + FIRST_DATA_ROW}"],
            includeGridData=True,
            fields=(
                "sheets(properties(sheetId),data(rowData(values(dataValidation(condition(type))))))"
            ),
        )
        .execute()
    )
    sheets = result.get("sheets", [])
    if not sheets:
        return None
    sheet_id = sheets[0]["properties"]["sheetId"]
    grid = sheets[0].get("data", [{}])[0].get("rowData", [])
    if len(grid) < rows:
        return sheet_id, False
    for row in grid:
        cells = row.get("values", [])
        if len(cells) < 2:
            return sheet_id, False
        for cell in cells[:2]:
            if cell.get("dataValidation", {}).get("condition", {}).get("type") != "BOOLEAN":
                return sheet_id, False
    return sheet_id, True


def _checkbox(sheet_id: int, rows: int) -> dict:
    """The checkbox rule over exactly the range the ticks are written to.

    Set from here rather than left to the Apps Script setup, because otherwise the
    two have to agree on how far down the tab reaches — and they cannot. The setup
    is run by hand, once; the tab grows every time an application is sent. Owning
    both ends of it is what makes the mismatch unrepresentable."""
    return {
        "setDataValidation": {
            "range": {
                "sheetId": sheet_id,
                "startRowIndex": FIRST_DATA_ROW,
                "endRowIndex": rows + FIRST_DATA_ROW,
                "startColumnIndex": APP_ALUMNI,
                "endColumnIndex": APP_RECRUITER + 1,
            },
            "rule": {"condition": {"type": "BOOLEAN"}, "showCustomUi": True},
        }
    }


def highlight(settings: Settings, separator: int = 0, jobs_rows: int = 0) -> HighlightResult:
    """Say who can be asked about each application: two checkboxes in App, and the
    yellow that is left, in one batch.

    Company names are compared with the loose reading from sources.company_tokens:
    a directory writes the registered name and an application writes whatever the
    careers page called it, so "Hakkoda, an IBM Company" has to reach "IBM". Every
    alumni pair is named in the log, because the same looseness can join two
    unrelated employers over a single shared word."""
    service = _service(settings)
    values_api = service.spreadsheets().values()

    app = _values(values_api, settings, settings.app_tab, "A:H") or []
    applications = [
        (row[APP_COMPANY], company_tokens(row[APP_COMPANY]))
        for row in app[FIRST_DATA_ROW:]
        if len(row) > APP_COMPANY and row[APP_COMPANY].strip()
    ]
    # A missing tab is not an empty tab. An Alumni tab with no rows in it says
    # truthfully that nobody is anywhere; a tab that is not there says nothing,
    # and stating the column from it would untick every row.
    alumni = _values(values_api, settings, settings.alumni_tab, "A:F")
    known = alumni is not None
    if not known:
        print(f"No tab named {settings.alumni_tab!r}; leaving the Alumni column as it stands.")
        alumni = []

    directory = [
        company_tokens(row[ALUMNI_COMPANY])
        for row in alumni[FIRST_DATA_ROW:]
        if len(row) > ALUMNI_COMPANY and row[ALUMNI_COMPANY].strip()
    ]
    # Empty means the list did not ship, not that no employer has a recruiter —
    # the file is 720 names in a checkout, and it once went missing from the wheel.
    recruiters = recruiter_companies()
    if not recruiters:
        print("No recruiter list in this build; leaving the Recruiter column as it stands.")

    alumni_rows: set[int] = set()
    for index, row in enumerate(alumni[FIRST_DATA_ROW:], start=FIRST_DATA_ROW):
        tokens = company_tokens(row[ALUMNI_COMPANY]) if len(row) > ALUMNI_COMPANY else frozenset()
        hit = next((name for name, other in applications if same_employer(tokens, other)), None)
        if hit is not None:
            alumni_rows.add(index)
            print(f"Alumni row {index + 1}: {row[ALUMNI_COMPANY]} — applied to {hit}")

    app_alumni: set[int] = set()
    app_recruiter: set[int] = set()
    for index, row in enumerate(app[FIRST_DATA_ROW:], start=FIRST_DATA_ROW):
        tokens = company_tokens(row[APP_COMPANY]) if len(row) > APP_COMPANY else frozenset()
        if not tokens:
            continue
        if any(same_employer(tokens, other) for other in directory):
            app_alumni.add(index)
        if any(same_employer(tokens, other) for other in recruiters):
            app_recruiter.add(index)

    requests: list[dict] = []
    # The divider between what is still to do and what is done. Painted here rather
    # than where the row is written, because only this module knows how to clear the
    # last one: the halves change size, so the row moves under it every few runs.
    if jobs_rows:
        state = _painted(service, settings, settings.sheet_tab, jobs_rows, "A", HIGHLIGHT)
        if state is not None:
            sheet_id, already = state
            wanted = {separator - 1} if separator else set()
            requests += _requests(sheet_id, wanted, already, (0, JOBS_WIDTH), HIGHLIGHT)

        # The H-1B indicator belongs solely to the Company cell.  Read and clear
        # only this exact green, which leaves any colours the user added by hand
        # (and the yellow divider in the same column) untouched.
        sponsors = h1b_sponsors()
        if not sponsors:
            print("No H-1B sponsor list in this build; leaving Jobs company colours as they stand.")
        else:
            jobs = _values(values_api, settings, settings.sheet_tab, "A:A") or []
            h1b_rows = {
                index
                for index, row in enumerate(jobs[FIRST_DATA_ROW:], start=FIRST_DATA_ROW)
                if row and is_h1b_sponsor(row[0], sponsors)
            }
            state = _painted(service, settings, settings.sheet_tab, jobs_rows, "A", H1B_SPONSOR)
            if state is not None:
                sheet_id, already = state
                requests += _requests(sheet_id, h1b_rows, already, (0, 1), H1B_SPONSOR)
            print(
                f"Marked {len(h1b_rows)} Jobs companies as SWE H-1B sponsors "
                "in both FY2024 and FY2025."
            )
    else:
        h1b_rows = set()
    marks = (
        # Still a colour, and the only one left on this tab: a row in the alumni
        # directory is a person, not an application, so there is no checkbox of
        # theirs to tick.
        (settings.alumni_tab, alumni, alumni_rows, "A", (0, ALUMNI_WIDTH), HIGHLIGHT),
        # Both App marks are checkboxes now. These two match nothing by
        # construction, so all they can do is lift the paint the earlier version
        # left behind — including the red that sat where the Alumni box now is.
        # Two reads a run, no requests once the tab is clean, and the sheet
        # repairs itself if an older build is ever run against it again.
        (settings.app_tab, app, set(), "A", (0, APP_WIDTH), HIGHLIGHT),
        (
            settings.app_tab,
            app,
            set(),
            _column(APP_ALUMNI),
            (APP_ALUMNI, APP_ALUMNI + 1),
            RECRUITER,
        ),
    )
    for tab, rows, matched, letter, columns, colour in marks:
        if not rows:
            continue
        state = _painted(service, settings, tab, len(rows), letter, colour)
        if state is None:
            continue
        sheet_id, already = state
        requests += _requests(sheet_id, matched, already, columns, colour)
    applied_rows = max(len(app) - FIRST_DATA_ROW, 0)
    ticks = _mark_contacts(
        values_api,
        settings,
        applied_rows,
        app_alumni if known else None,
        app_recruiter if recruiters else None,
    )
    # Only once the headers have said these columns are ours. Laying a checkbox
    # rule over column J while it still holds the Update history would mark every
    # line of it invalid.
    boxed = False
    if ticks.ready and applied_rows:
        state = _boxed(service, settings, applied_rows)
        if state is not None and not state[1]:
            requests.append(_checkbox(state[0], applied_rows))
            boxed = True
            print(f"Repairing the checkbox rule over {settings.app_tab}!I2:J{applied_rows + 1}.")
    if requests:
        service.spreadsheets().batchUpdate(
            spreadsheetId=settings.sheet_id, body={"requests": requests}
        ).execute()

    return HighlightResult(
        alumni_rows=max(len(alumni) - FIRST_DATA_ROW, 0),
        alumni_lit=len(alumni_rows),
        app_rows=applied_rows,
        app_lit=len(app_alumni),
        recruiter_lit=len(app_recruiter),
        h1b_lit=len(h1b_rows),
        ticked=ticks.wrote,
        boxed=boxed,
    )
