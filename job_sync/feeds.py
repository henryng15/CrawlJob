"""Optional job feeds outside the Markdown trackers and the three core ATS APIs.

The feeds in this module are deliberately isolated from the main crawl. A missing
credential, a broken company feed, or an aggregator outage becomes a warning and
does not turn an otherwise healthy sync into an empty sheet.

Some ATSes expose one public endpoint per company, not a global directory. Their
company identifiers live in ``data/public_feeds.toml`` so adding a board is a data
change and not a code change. Credentials are read only from the environment.
"""

from __future__ import annotations

import json
import os
import tomllib
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from xml.etree import ElementTree

from job_sync.places import is_united_states
from job_sync.roles import is_target_role
from job_sync.sources import Job

CONFIG_FILE = Path(__file__).resolve().parent / "data" / "public_feeds.toml"
USER_AGENT = "internship-sheet-sync/0.1"
TIMEOUT = 30
CAP = 16 * 1024 * 1024


@dataclass(frozen=True)
class FeedResult:
    jobs: list[Job] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)
    skipped: int = 0


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _date(value: object, today: date) -> str:
    raw = _text(value)
    if not raw:
        return today.isoformat()
    try:
        return date.fromisoformat(raw[:10]).isoformat()
    except ValueError:
        pass
    try:
        return parsedate_to_datetime(raw).date().isoformat()
    except (TypeError, ValueError, OverflowError):
        return today.isoformat()


def _fetch(url: str, headers: dict[str, str] | None = None) -> bytes:
    request_headers = {"User-Agent": USER_AGENT, **(headers or {})}
    request = Request(url, headers=request_headers)
    with urlopen(request, timeout=TIMEOUT) as response:
        return response.read(CAP)


def _json(url: str, headers: dict[str, str] | None = None) -> object:
    return json.loads(_fetch(url, headers).decode("utf-8"))


def _companies(config: dict[str, object], name: str) -> list[str]:
    section = config.get(name, {})
    values = section.get("companies", []) if isinstance(section, dict) else []
    return [str(value).strip() for value in values if str(value).strip()]


def _smartrecruiters(config: dict[str, object], today: date) -> list[Job]:
    jobs: list[Job] = []
    for company_id in _companies(config, "smartrecruiters"):
        offset = 0
        while True:
            url = (
                f"https://api.smartrecruiters.com/v1/companies/{company_id}/postings"
                f"?limit=100&offset={offset}"
            )
            payload = _json(url)
            rows = payload.get("content", []) if isinstance(payload, dict) else []
            for row in rows:
                if not isinstance(row, dict) or not is_target_role(_text(row.get("name"))):
                    continue
                location = row.get("location", {})
                location_text = (
                    location
                    if isinstance(location, str)
                    else " ".join(
                        _text(location.get(key))
                        for key in ("city", "region", "country")
                        if isinstance(location, dict)
                    )
                )
                if not is_united_states(location_text):
                    continue
                posting_id = _text(row.get("id"))
                if not posting_id:
                    continue
                company = row.get("company") or {}
                company_name = _text(company.get("name")) if isinstance(company, dict) else ""
                jobs.append(
                    Job(
                        company=company_name or company_id,
                        role=_text(row.get("name")),
                        apply_link=f"https://careers.smartrecruiters.com/{company_id}/{posting_id}",
                        date_posted=_date(row.get("releasedDate"), today),
                        source="SmartRecruiters",
                    )
                )
            if not isinstance(rows, list) or not rows:
                break
            total = payload.get("totalFound") if isinstance(payload, dict) else None
            if not isinstance(total, int) or offset + len(rows) >= total:
                break
            offset += len(rows)
    return jobs


def _personio(config: dict[str, object], today: date) -> list[Job]:
    jobs: list[Job] = []
    for company_id in _companies(config, "personio"):
        url = f"https://{company_id}.jobs.personio.de/xml?language=en"
        root = ElementTree.fromstring(_fetch(url))
        for row in root.findall(".//position"):
            role = _text(row.findtext("name"))
            if not role or not is_target_role(role):
                continue
            location = _text(row.findtext("office"))
            if not is_united_states(location):
                continue
            job_id = _text(row.findtext("id"))
            if not job_id:
                continue
            jobs.append(
                Job(
                    company=company_id.replace("-", " ").title(),
                    role=role,
                    apply_link=f"https://{company_id}.jobs.personio.de/job/{job_id}",
                    date_posted=today.isoformat(),
                    source="Personio",
                )
            )
    return jobs


def _recruitee(config: dict[str, object], today: date) -> list[Job]:
    jobs: list[Job] = []
    for company_id in _companies(config, "recruitee"):
        payload = _json(f"https://{company_id}.recruitee.com/api/offers")
        rows = payload.get("offers", []) if isinstance(payload, dict) else payload
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, dict):
                continue
            role = _text(row.get("title"))
            if not role or not is_target_role(role):
                continue
            location = row.get("location") or row.get("city") or ""
            location_text = location if isinstance(location, str) else str(location)
            if not is_united_states(location_text):
                continue
            slug = _text(row.get("slug"))
            link = _text(row.get("careers_apply_url")) or _text(row.get("careers_url"))
            if not link and slug:
                link = f"https://{company_id}.recruitee.com/o/{slug}"
            if not link:
                continue
            jobs.append(
                Job(
                    company=company_id.replace("-", " ").title(),
                    role=role,
                    apply_link=link,
                    date_posted=_date(row.get("created_at"), today),
                    source="Recruitee",
                )
            )
    return jobs


def _adzuna(today: date) -> list[Job]:
    app_id, app_key = os.getenv("ADZUNA_APP_ID"), os.getenv("ADZUNA_APP_KEY")
    if not app_id or not app_key:
        raise LookupError("ADZUNA_APP_ID/ADZUNA_APP_KEY are not configured")
    jobs: list[Job] = []
    for query in ("software engineer intern", "software engineering intern", "SWE intern"):
        params = urlencode(
            {
                "app_id": app_id,
                "app_key": app_key,
                "what": query,
                "results_per_page": 100,
                "content-type": "application/json",
            }
        )
        payload = _json(f"https://api.adzuna.com/v1/api/jobs/us/search/1?{params}")
        rows = payload.get("results", []) if isinstance(payload, dict) else []
        for row in rows:
            if not isinstance(row, dict) or not is_target_role(_text(row.get("title"))):
                continue
            company = row.get("company") or {}
            location = row.get("location") or {}
            location_text = (
                location.get("display_name", "") if isinstance(location, dict) else str(location)
            )
            if not is_united_states(location_text):
                continue
            link = _text(row.get("redirect_url"))
            if not link:
                continue
            jobs.append(
                Job(
                    company=_text(company.get("display_name"))
                    if isinstance(company, dict)
                    else str(company),
                    role=_text(row.get("title")),
                    apply_link=link,
                    date_posted=_date(row.get("created"), today),
                    source="Adzuna",
                )
            )
    return jobs


def _usajobs(today: date) -> list[Job]:
    api_key = os.getenv("USAJOBS_API_KEY")
    if not api_key:
        raise LookupError("USAJOBS_API_KEY is not configured")
    jobs: list[Job] = []
    for query in ("software intern", "software engineering intern"):
        params = urlencode(
            {
                "Keyword": query,
                "DatePosted": 60,
                "ResultsPerPage": 500,
                "Fields": "Full",
            }
        )
        payload = _json(
            f"https://data.usajobs.gov/api/Search?{params}",
            {
                "Authorization-Key": api_key,
                "User-Agent": os.getenv("USAJOBS_USER_AGENT", USER_AGENT),
            },
        )
        result = payload.get("SearchResult", {}) if isinstance(payload, dict) else {}
        rows = result.get("SearchResultItems", []) if isinstance(result, dict) else []
        for item in rows:
            descriptor = item.get("MatchedObjectDescriptor", {}) if isinstance(item, dict) else {}
            role = _text(descriptor.get("PositionTitle"))
            if not role or not is_target_role(role):
                continue
            locations = descriptor.get("PositionLocation", [])
            location_text = "; ".join(
                _text(location.get("LocationName"))
                for location in locations
                if isinstance(location, dict)
            )
            if not is_united_states(location_text):
                continue
            organization = descriptor.get("OrganizationName", [])
            company = "; ".join(
                _text(row.get("Name")) if isinstance(row, dict) else str(row)
                for row in organization
            )
            link = _text(descriptor.get("PositionURI")) or _text(descriptor.get("ApplyURI"))
            if not link:
                continue
            jobs.append(
                Job(
                    company=company,
                    role=role,
                    apply_link=link,
                    date_posted=_date(descriptor.get("PublicationStartDate"), today),
                    source="USAJOBS",
                )
            )
    return jobs


def harvest_feeds(config_path: Path = CONFIG_FILE, today: date | None = None) -> FeedResult:
    """Fetch configured optional feeds; isolate failures and remove URL duplicates."""
    today = today or datetime.now(UTC).date()
    try:
        config = tomllib.loads(config_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        config = {}

    jobs: list[Job] = []
    failures: list[str] = []
    skipped = 0
    configured = (
        (
            "SmartRecruiters",
            lambda: _smartrecruiters(config, today),
            bool(_companies(config, "smartrecruiters")),
        ),
        ("Personio", lambda: _personio(config, today), bool(_companies(config, "personio"))),
        ("Recruitee", lambda: _recruitee(config, today), bool(_companies(config, "recruitee"))),
        (
            "Adzuna",
            lambda: _adzuna(today),
            bool(os.getenv("ADZUNA_APP_ID") and os.getenv("ADZUNA_APP_KEY")),
        ),
        ("USAJOBS", lambda: _usajobs(today), bool(os.getenv("USAJOBS_API_KEY"))),
    )
    for name, fetch, enabled in configured:
        if not enabled:
            skipped += 1
            continue
        try:
            jobs.extend(fetch())
        except Exception as error:  # noqa: BLE001 - one feed must not stop the others
            failures.append(f"{name}: {error}")

    seen: set[str] = set()
    unique: list[Job] = []
    for job in jobs:
        if job.dedupe_key not in seen:
            seen.add(job.dedupe_key)
            unique.append(job)
    return FeedResult(jobs=unique, failures=failures, skipped=skipped)
