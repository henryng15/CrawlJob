from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    sheet_id: str
    sheet_tab: str
    service_account_json: str


def load_settings() -> Settings:
    required = ("GOOGLE_SHEET_ID", "GOOGLE_SERVICE_ACCOUNT_JSON")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise RuntimeError(f"Missing required environment variable(s): {', '.join(missing)}")
    return Settings(
        sheet_id=os.environ["GOOGLE_SHEET_ID"],
        sheet_tab=os.getenv("GOOGLE_SHEET_TAB", "Jobs"),
        service_account_json=os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"],
    )
