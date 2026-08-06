from __future__ import annotations

import json

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

from job_sync.config import Settings
from job_sync.sources import Job

HEADERS = ["Company", "Role", "Link Apply", "Date Posted"]
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def _service(settings: Settings):
    info = json.loads(settings.service_account_json)
    credentials = Credentials.from_service_account_info(info, scopes=SCOPES)
    return build("sheets", "v4", credentials=credentials, cache_discovery=False)


def _key(row: list[str]) -> str | None:
    if len(row) >= 3 and row[2].strip():
        return row[2].rstrip("/").casefold()
    return None


def append_new_jobs(settings: Settings, jobs: list[Job]) -> int:
    service = _service(settings)
    values_api = service.spreadsheets().values()
    range_name = f"{settings.sheet_tab}!A:D"
    existing = (
        values_api.get(spreadsheetId=settings.sheet_id, range=range_name)
        .execute()
        .get("values", [])
    )
    if not existing:
        values_api.append(
            spreadsheetId=settings.sheet_id,
            range=range_name,
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": [HEADERS]},
        ).execute()
        existing = [HEADERS]
    if existing[0] != HEADERS:
        raise RuntimeError(f"Expected {HEADERS} in {settings.sheet_tab}!A1:D1; found {existing[0]}")
    known = {key for row in existing[1:] if (key := _key(row))}
    fresh = [job for job in jobs if job.dedupe_key not in known]
    if not fresh:
        return 0
    values_api.append(
        spreadsheetId=settings.sheet_id,
        range=range_name,
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={
            "values": [[job.company, job.role, job.apply_link, job.date_posted] for job in fresh]
        },
    ).execute()
    return len(fresh)
