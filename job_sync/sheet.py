from __future__ import annotations

import json

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from job_sync.config import Settings
from job_sync.sources import Job, normalize_link

HEADERS = ["Company", "Role", "Link Apply", "Date Posted"]
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


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


def _sort_key(row: list[str]) -> tuple[str, str]:
    """Newest posting first. Dates are ISO-8601, so a plain string sort is a date
    sort; the company breaks ties so that a run never reshuffles equal dates."""
    date_posted = row[3].strip() if len(row) > 3 else ""
    company = row[0].strip().casefold() if row else ""
    return (date_posted, company)


def _sorted_rows(rows: list[list[str]]) -> list[list[str]]:
    return sorted(rows, key=_sort_key, reverse=True)


def append_new_jobs(settings: Settings, jobs: list[Job]) -> int:
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
    known = {key for row in data if (key := _key(row))}
    fresh = [job for job in jobs if job.dedupe_key not in known]
    if not fresh and existing:
        return 0
    data = _sorted_rows(
        data + [[job.company, job.role, job.apply_link, job.date_posted] for job in fresh]
    )
    _write(values_api, settings, tab, [header] + data)
    return len(fresh)


def _write(values_api, settings: Settings, tab: str, rows: list[list[str]]) -> None:
    """Rewriting beats appending because the whole sheet has to end up sorted.
    Every row is padded to one width so a sorted row can never leave a stale cell
    behind from the longer row that used to sit in its place."""
    width = max(len(row) for row in rows)
    padded = [row + [""] * (width - len(row)) for row in rows]
    last_column = chr(ord("A") + width - 1)
    values_api.update(
        spreadsheetId=settings.sheet_id,
        range=f"{tab}!A1:{last_column}{len(padded)}",
        valueInputOption="RAW",
        body={"values": padded},
    ).execute()
