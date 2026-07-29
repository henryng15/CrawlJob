"""Adding one posting by URL (spec §7.2).

For the role a friend forwards you, which no feed carries. It goes through the
same deduplication, the same sponsorship analysis and the same scoring as a
discovered one — a job added by hand is not a job exempt from the rules, and
short-cutting that is how an ineligible role ends up in the pipeline because
somebody was enthusiastic about it.

The page is fetched for its title and description. That fetch is the one thing
here that touches the open web, so it is bounded: a size limit, a timeout, and a
refusal to follow a URL that is not a public job posting.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from app.db.models import Job
from app.domain.normalization import AtsType, detect_ats
from app.services.dedupe import DedupeResult, NormalizedPosting, upsert_job
from app.services.discovery.ats import strip_html

__all__ = ["MAX_BYTES", "fetch_posting", "import_url"]

log = logging.getLogger(__name__)

#: A job description is a few kilobytes. Anything much larger is a mistake, a
#: redirect to a homepage, or something hostile.
MAX_BYTES = 2_000_000
TIMEOUT_SECONDS = 20.0

_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
_H1 = re.compile(r"<h1[^>]*>(.*?)</h1>", re.I | re.S)

#: Schemes and hosts that are never a public job posting. Blocking them stops a
#: pasted URL from becoming a request to something on the internal network.
_PRIVATE_HOSTS = (
    "localhost",
    "127.",
    "0.0.0.0",  # noqa: S104 - matched against, never bound to
    "169.254.",
    "10.",
    "192.168.",
    "[::1]",
)


def _check_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(f"{url!r} is not an http(s) URL")
    host = (parsed.hostname or "").lower()
    if not host or host.startswith(_PRIVATE_HOSTS):
        # Server-side request forgery: without this, pasting a URL is a way to
        # make this server fetch something only it can reach.
        raise ValueError("That address is not reachable from the public internet")
    return url


def fetch_posting(url: str, *, client: Any | None = None) -> tuple[str, str]:
    """Return ``(title, description_text)`` for a posting page.

    Best effort by design. A page this cannot parse still yields a job row with
    its URL, which the user can then read for themselves — better than refusing
    to record a role because its markup was unusual.
    """
    import httpx

    _check_url(url)
    owned = client is None
    http = client or httpx.Client(
        timeout=TIMEOUT_SECONDS,
        follow_redirects=True,
        headers={"User-Agent": "InternshipOps/1.0 (personal job application assistant)"},
    )
    try:
        response = http.get(url)
        response.raise_for_status()
        html = response.text[:MAX_BYTES]
    except Exception as exc:
        log.info("could not fetch %s: %s", url, exc)
        return "", ""
    finally:
        if owned:
            http.close()

    title = ""
    for pattern in (_H1, _TITLE):
        found = pattern.search(html)
        if found:
            title = (strip_html(found.group(1)) or "").strip()
            if title:
                break

    return title, strip_html(html) or ""


def import_url(
    session: Session,
    url: str,
    *,
    now: datetime,
    company: str = "",
    title: str = "",
    client: Any | None = None,
) -> tuple[Job, DedupeResult]:
    """Store a posting given only its URL.

    Args:
        company: overrides what the page says. The user usually knows better
            than a ``<title>`` that reads "Careers | Acme — Apply Now".
        title: same, for the role.
    """
    _check_url(url)
    fetched_title, description = fetch_posting(url, client=client)

    resolved_title = title.strip() or fetched_title or "Untitled role"
    resolved_company = company.strip() or _company_from(url, fetched_title)
    if not resolved_company:
        raise ValueError(
            "Could not work out the company from that URL. Add it by hand, or use "
            "a link to the employer's own job board."
        )

    posting = NormalizedPosting(
        company=resolved_company,
        title=resolved_title,
        application_url=url,
        description_text=description or None,
    )
    return upsert_job(session, posting, now=now)


def _company_from(url: str, page_title: str) -> str:
    """Guess the employer from an ATS URL, then from the page title.

    ATS URLs carry the board slug, which is the employer — that is the whole
    point of a board. Falling back to the title is a guess, and a guess the user
    can correct on the job page.
    """
    ats = detect_ats(url)
    parsed = urlparse(url)
    parts = [p for p in parsed.path.split("/") if p]

    match ats:
        case AtsType.GREENHOUSE | AtsType.LEVER | AtsType.ASHBY if parts:
            return parts[0].replace("-", " ").title()
        case _:
            pass

    if " at " in page_title:
        return page_title.split(" at ")[-1].strip()
    for separator in ("|", "-", "—", "·"):
        if separator in page_title:
            tail = page_title.split(separator)[-1].strip()
            if tail and len(tail) < 60:
                return tail

    host = (parsed.hostname or "").removeprefix("www.")
    return host.split(".")[0].title() if host else ""
