from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from time import strptime
from urllib.request import Request, urlopen

from job_sync.roles import is_target_role


@dataclass(frozen=True)
class Source:
    name: str
    url: str


@dataclass(frozen=True)
class Job:
    company: str
    role: str
    apply_link: str
    date_posted: str

    @property
    def dedupe_key(self) -> str:
        return self.apply_link.rstrip("/").casefold()


def load_sources(path: Path) -> list[Source]:
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    return [Source(name=row["name"], url=row["url"]) for row in data.get("sources", [])]


def fetch_source(source: Source) -> str:
    request = Request(source.url, headers={"User-Agent": "internship-sheet-sync/0.1"})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def clean_text(value: str) -> str:
    value = re.sub(
        r"!?(?:\[[^]]*\])\([^)]*\)", lambda m: re.sub(r".*\[([^]]*)\].*", r"\1", m.group(0)), value
    )
    value = re.sub(r"<[^>]+>", "", value)
    return re.sub(r"[*_`✅🆕🆁⏳🛂]", "", value).strip()


def extract_url(value: str) -> str | None:
    links = re.findall(r"\[[^]]*\]\((https?://[^)\s]+)\)", value)
    if links:
        return links[-1]
    html_links = re.findall(r"href=[\"'](https?://[^\"']+)", value, re.IGNORECASE)
    if html_links:
        return html_links[0]
    raw_urls = re.findall(r"(https?://[^\s|]+)", value)
    return raw_urls[-1] if raw_urls else None


def posted_date(value: str, today: date) -> str:
    value = clean_text(value).strip()
    for parser in (date.fromisoformat, _parse_month_date):
        try:
            return parser(value).isoformat()
        except ValueError:
            pass
    age = re.search(r"\b(\d+)\s*(d|day|days|w|week|weeks|mo|month|months)\b", value, re.IGNORECASE)
    if age:
        amount, unit = int(age.group(1)), age.group(2).casefold()
        multiplier = 30 if unit.startswith("m") else 7 if unit.startswith("w") else 1
        return (today - timedelta(days=amount * multiplier)).isoformat()
    # This is the first observed date, not an invented employer posting date.
    return today.isoformat()


def _parse_month_date(value: str) -> date:
    for date_format in ("%b %d, %Y", "%B %d, %Y"):
        try:
            parsed = strptime(value, date_format)
            return date(parsed.tm_year, parsed.tm_mon, parsed.tm_mday)
        except ValueError:
            pass
    raise ValueError(f"Not a month-name date: {value}")


def _header_index(headers: list[str], *names: str) -> int | None:
    for index, header in enumerate(headers):
        if any(name in header for name in names):
            return index
    return None


def parse_jobs(markdown: str, today: date) -> list[Job]:
    lines = markdown.splitlines()
    parsed: list[Job] = []
    seen: set[str] = set()
    for index, line in enumerate(lines[:-2]):
        header_text = line.casefold()
        if (
            "|" not in line
            or "company" not in header_text
            or not any(label in header_text for label in ("role", "position", "title"))
        ):
            continue
        separator = lines[index + 1]
        if "|" not in separator or "---" not in separator:
            continue
        headers = [clean_text(cell).casefold() for cell in line.strip().strip("|").split("|")]
        company_i = _header_index(headers, "company")
        role_i = _header_index(headers, "role", "position", "title")
        link_i = _header_index(headers, "apply", "application", "link", "posting")
        date_i = _header_index(headers, "added", "posted", "date", "age")
        if None in (company_i, role_i, link_i):
            continue
        for row in lines[index + 2 :]:
            if "|" not in row or row.lstrip().startswith("#"):
                break
            cells = [cell.strip() for cell in row.strip().strip("|").split("|")]
            if max(company_i, role_i, link_i) >= len(cells):
                continue
            company, role = clean_text(cells[company_i]), clean_text(cells[role_i])
            link = extract_url(cells[link_i])
            if not company or not link or not is_target_role(role):
                continue
            date_value = cells[date_i] if date_i is not None and date_i < len(cells) else ""
            job = Job(
                company=company,
                role=role,
                apply_link=link,
                date_posted=posted_date(date_value, today),
            )
            if job.dedupe_key not in seen:
                seen.add(job.dedupe_key)
                parsed.append(job)
    # Simplify/Pitt CSC publishes the same logical table as HTML rather than
    # Markdown. Keep this deliberately small instead of adding an HTML package.
    for table in re.findall(
        r"<table[^>]*>(.*?)</table>", markdown, flags=re.IGNORECASE | re.DOTALL
    ):
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", table, flags=re.IGNORECASE | re.DOTALL)
        if not rows:
            continue
        cell_rows = [
            re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", row, flags=re.IGNORECASE | re.DOTALL)
            for row in rows
        ]
        headers = [clean_text(cell).casefold() for cell in cell_rows[0]]
        company_i = _header_index(headers, "company")
        role_i = _header_index(headers, "role", "position", "title")
        link_i = _header_index(headers, "apply", "application", "link", "posting")
        date_i = _header_index(headers, "added", "posted", "date", "age")
        if None in (company_i, role_i, link_i):
            continue
        for cells in cell_rows[1:]:
            if max(company_i, role_i, link_i) >= len(cells):
                continue
            company, role = clean_text(cells[company_i]), clean_text(cells[role_i])
            link = extract_url(cells[link_i])
            if not company or not link or not is_target_role(role):
                continue
            date_value = cells[date_i] if date_i is not None and date_i < len(cells) else ""
            job = Job(
                company=company,
                role=role,
                apply_link=link,
                date_posted=posted_date(date_value, today),
            )
            if job.dedupe_key not in seen:
                seen.add(job.dedupe_key)
                parsed.append(job)
    return parsed


def dedupe_jobs(jobs: list[Job]) -> list[Job]:
    """Keep the first occurrence of an application URL across all sources."""
    seen: set[str] = set()
    unique: list[Job] = []
    for job in jobs:
        if job.dedupe_key not in seen:
            seen.add(job.dedupe_key)
            unique.append(job)
    return unique
