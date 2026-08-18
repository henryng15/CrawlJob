from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    sheet_id: str
    sheet_tab: str
    app_tab: str
    alumni_tab: str
    service_account_json: str


def load_settings() -> Settings:
    required = ("GOOGLE_SHEET_ID", "GOOGLE_SERVICE_ACCOUNT_JSON")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise RuntimeError(f"Missing required environment variable(s): {', '.join(missing)}")
    # `or` rather than a getenv default: a GitHub Actions secret that was never set
    # arrives as an empty string, which would name a tab that cannot exist.
    return Settings(
        sheet_id=os.environ["GOOGLE_SHEET_ID"],
        sheet_tab=os.getenv("GOOGLE_SHEET_TAB") or "Jobs",
        app_tab=os.getenv("GOOGLE_SHEET_APP_TAB") or "App",
        alumni_tab=os.getenv("GOOGLE_SHEET_ALUMNI_TAB") or "Alumni",
        service_account_json=os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"],
    )
