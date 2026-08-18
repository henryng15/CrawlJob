"""Which alumni work somewhere an application has already gone.

An alumni directory exported from the college is pasted into its own tab. Every
sync paints the rows whose employer matches one of the applications in the App
tab, so the people worth asking for a referral are the highlighted ones.

Nothing is written but the colour. The tab's text is the operator's; a run that
finds nothing simply clears the tab back to plain.
"""

from __future__ import annotations

from dataclasses import dataclass

from googleapiclient.errors import HttpError

from job_sync.config import Settings
from job_sync.sheet import APP_COMPANY, _quote_tab, _service
from job_sync.sources import company_tokens, same_employer

# Column A of the alumni export, and how wide a row to paint.
ALUMNI_COMPANY = 0
ALUMNI_WIDTH = 6
FIRST_DATA_ROW = 1  # zero-based; row 1 of the sheet is the header
HIGHLIGHT = {"red": 1.0, "green": 0.898, "blue": 0.6}
PLAIN = {"red": 1.0, "green": 1.0, "blue": 1.0}


@dataclass(frozen=True)
class AlumniResult:
    rows: int = 0
    highlighted: int = 0


def _sheet_id(service, spreadsheet_id: str, title: str) -> int | None:
    meta = service.spreadsheets().get(
        spreadsheetId=spreadsheet_id, fields="sheets.properties(sheetId,title)"
    )
    for sheet in meta.execute().get("sheets", []):
        if sheet["properties"]["title"] == title:
            return sheet["properties"]["sheetId"]
    return None


def _runs(rows: list[int]) -> list[tuple[int, int]]:
    """Consecutive row numbers folded into half-open ranges, so a hundred matches
    scattered down the tab still cost a handful of requests rather than a hundred."""
    spans: list[tuple[int, int]] = []
    for row in sorted(rows):
        if spans and spans[-1][1] == row:
            spans[-1] = (spans[-1][0], row + 1)
        else:
            spans.append((row, row + 1))
    return spans


def _paint(sheet_id: int, span: tuple[int, int], colour: dict) -> dict:
    return {
        "repeatCell": {
            "range": {
                "sheetId": sheet_id,
                "startRowIndex": span[0],
                "endRowIndex": span[1],
                "startColumnIndex": 0,
                "endColumnIndex": ALUMNI_WIDTH,
            },
            "cell": {"userEnteredFormat": {"backgroundColor": colour}},
            "fields": "userEnteredFormat.backgroundColor",
        }
    }


def _applied_companies(values_api, settings: Settings) -> set[str]:
    """The employers the App tab says an application has gone to."""
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
        return set()
    return {
        row[APP_COMPANY].strip()
        for row in rows[1:]
        if len(row) > APP_COMPANY and row[APP_COMPANY].strip()
    }


def highlight_alumni(settings: Settings) -> AlumniResult:
    """Paint every alumni row whose employer appears in `applied`.

    The comparison is the loose one from sources.company_tokens, because a
    directory writes "Google Cloud" and "Hakkoda, an IBM Company" where an
    application says "Google" and "IBM". Every pair it matches is named in the log,
    since the same looseness can put two unrelated employers together over one
    shared word."""
    service = _service(settings)
    applied = _applied_companies(service.spreadsheets().values(), settings)
    try:
        rows = (
            service.spreadsheets()
            .values()
            .get(
                spreadsheetId=settings.sheet_id,
                range=f"{_quote_tab(settings.alumni_tab)}!A:F",
            )
            .execute()
            .get("values", [])
        )
    except HttpError as error:
        if error.status_code != 400:
            raise
        # No such tab is not a failure: the alumni list is an optional extra.
        print(f"No tab named {settings.alumni_tab!r}; skipping the alumni highlight.")
        return AlumniResult()

    sheet_id = _sheet_id(service, settings.sheet_id, settings.alumni_tab)
    if sheet_id is None or len(rows) <= FIRST_DATA_ROW:
        return AlumniResult(rows=max(len(rows) - FIRST_DATA_ROW, 0))

    wanted = [(name, company_tokens(name)) for name in applied]
    matched: list[int] = []
    for offset, row in enumerate(rows[FIRST_DATA_ROW:], start=FIRST_DATA_ROW):
        employer = row[ALUMNI_COMPANY] if len(row) > ALUMNI_COMPANY else ""
        tokens = company_tokens(employer)
        hit = next(
            (name for name, applied_tokens in wanted if same_employer(tokens, applied_tokens)), None
        )
        if hit is None:
            continue
        matched.append(offset)
        print(f"Alumni row {offset + 1}: {employer} — applied to {hit}")

    # The whole range is cleared first so that an employer dropped from the App tab,
    # or a row the operator re-pasted, does not keep a colour nothing now justifies.
    requests = [_paint(sheet_id, (FIRST_DATA_ROW, len(rows)), PLAIN)]
    requests += [_paint(sheet_id, span, HIGHLIGHT) for span in _runs(matched)]
    service.spreadsheets().batchUpdate(
        spreadsheetId=settings.sheet_id, body={"requests": requests}
    ).execute()
    return AlumniResult(rows=len(rows) - FIRST_DATA_ROW, highlighted=len(matched))
