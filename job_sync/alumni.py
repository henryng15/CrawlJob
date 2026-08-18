"""Where an application and an alumnus meet.

Two lists that only matter together: the alumni directory the college exports,
and the applications already sent. The overlap is who to ask for a referral, and
it is painted into both tabs — yellow on the alumni sitting at a company applied
to, and yellow on the application that has someone inside.

Only the tool's own yellow is ever cleared. A cell the operator coloured by hand
is left exactly as it was, so a run can be repeated without eating anyone's marks.
"""

from __future__ import annotations

from dataclasses import dataclass

from googleapiclient.errors import HttpError

from job_sync.config import Settings
from job_sync.sheet import APP_COMPANY, _quote_tab, _service
from job_sync.sources import company_tokens, same_employer

ALUMNI_COMPANY = 0
ALUMNI_WIDTH = 6
APP_WIDTH = 8
FIRST_DATA_ROW = 1  # zero-based; row 1 of the sheet is the header
HIGHLIGHT = {"red": 1.0, "green": 0.898, "blue": 0.6}
PLAIN = {"red": 1.0, "green": 1.0, "blue": 1.0}
# Sheets returns the colour it stored, not the float that was sent.
TOLERANCE = 0.02


@dataclass(frozen=True)
class AlumniResult:
    alumni_rows: int = 0
    alumni_lit: int = 0
    app_rows: int = 0
    app_lit: int = 0


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


def _is_highlight(colour: dict | None) -> bool:
    if not colour:
        return False
    return all(
        abs(colour.get(channel, 0.0) - HIGHLIGHT[channel]) < TOLERANCE
        for channel in ("red", "green", "blue")
    )


def _sheet_state(service, settings: Settings, tab: str, rows: int) -> tuple[int, set[int]] | None:
    """The tab's id, and which of its rows this tool has already painted.

    Column A alone is read: the tool paints whole rows, so one cell says whether
    the row is its work. Reading it back is what makes the clear surgical instead
    of wiping every background on the tab."""
    result = (
        service.spreadsheets()
        .get(
            spreadsheetId=settings.sheet_id,
            ranges=[f"{_quote_tab(tab)}!A1:A{max(rows, 1)}"],
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
    painted = set()
    for index, row in enumerate(data):
        cells = row.get("values", [])
        colour = cells[0].get("userEnteredFormat", {}).get("backgroundColor") if cells else None
        if _is_highlight(colour):
            painted.add(index)
    return sheet_id, painted


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


def _paint(sheet_id: int, span: tuple[int, int], width: int, colour: dict) -> dict:
    return {
        "repeatCell": {
            "range": {
                "sheetId": sheet_id,
                "startRowIndex": span[0],
                "endRowIndex": span[1],
                "startColumnIndex": 0,
                "endColumnIndex": width,
            },
            "cell": {"userEnteredFormat": {"backgroundColor": colour}},
            "fields": "userEnteredFormat.backgroundColor",
        }
    }


def _requests(sheet_id: int, matched: set[int], painted: set[int], width: int) -> list[dict]:
    """Only the difference. A row already the right colour is left alone, so a run
    that changes nothing sends nothing."""
    requests = [_paint(sheet_id, span, width, PLAIN) for span in _runs(painted - matched)]
    requests += [_paint(sheet_id, span, width, HIGHLIGHT) for span in _runs(matched - painted)]
    return requests


def highlight_alumni(settings: Settings) -> AlumniResult:
    """Paint both sides of the overlap.

    The comparison is the loose one from sources.company_tokens: a directory writes
    the registered name and an application writes whatever the careers page called
    it, so "Hakkoda, an IBM Company" has to reach "IBM". Every matched pair is named
    in the log, because the same looseness can join two unrelated employers over a
    single shared word."""
    service = _service(settings)
    values_api = service.spreadsheets().values()

    alumni = _values(values_api, settings, settings.alumni_tab, "A:F")
    if alumni is None:
        print(f"No tab named {settings.alumni_tab!r}; skipping the alumni highlight.")
        return AlumniResult()
    app = _values(values_api, settings, settings.app_tab, "A:H") or []

    directory = [
        (row[ALUMNI_COMPANY], company_tokens(row[ALUMNI_COMPANY]))
        for row in alumni[FIRST_DATA_ROW:]
        if len(row) > ALUMNI_COMPANY and row[ALUMNI_COMPANY].strip()
    ]
    applications = [
        (row[APP_COMPANY], company_tokens(row[APP_COMPANY]))
        for row in app[FIRST_DATA_ROW:]
        if len(row) > APP_COMPANY and row[APP_COMPANY].strip()
    ]

    alumni_rows: set[int] = set()
    app_rows: set[int] = set()
    for index, row in enumerate(alumni[FIRST_DATA_ROW:], start=FIRST_DATA_ROW):
        tokens = company_tokens(row[ALUMNI_COMPANY]) if len(row) > ALUMNI_COMPANY else frozenset()
        hit = next((name for name, other in applications if same_employer(tokens, other)), None)
        if hit is not None:
            alumni_rows.add(index)
            print(f"Alumni row {index + 1}: {row[ALUMNI_COMPANY]} — applied to {hit}")
    for index, row in enumerate(app[FIRST_DATA_ROW:], start=FIRST_DATA_ROW):
        tokens = company_tokens(row[APP_COMPANY]) if len(row) > APP_COMPANY else frozenset()
        if any(same_employer(tokens, other) for _, other in directory):
            app_rows.add(index)

    result = AlumniResult(
        alumni_rows=len(alumni) - FIRST_DATA_ROW if alumni else 0,
        alumni_lit=len(alumni_rows),
        app_rows=len(app) - FIRST_DATA_ROW if app else 0,
        app_lit=len(app_rows),
    )
    requests: list[dict] = []
    for tab, rows, matched, width in (
        (settings.alumni_tab, alumni, alumni_rows, ALUMNI_WIDTH),
        (settings.app_tab, app, app_rows, APP_WIDTH),
    ):
        if not rows:
            continue
        state = _sheet_state(service, settings, tab, len(rows))
        if state is None:
            continue
        sheet_id, painted = state
        requests += _requests(sheet_id, matched, painted, width)
    if requests:
        service.spreadsheets().batchUpdate(
            spreadsheetId=settings.sheet_id, body={"requests": requests}
        ).execute()
    return result
