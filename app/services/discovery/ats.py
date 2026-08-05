"""Public ATS job-board adapters (spec §5.6, §7.2).

All three use the employers' *public* posting endpoints, which need no
authentication and are intended for exactly this: listing open roles.

None of them submit anything. Greenhouse, Lever and Ashby all have application
submission APIs, and all three require employer-side credentials an applicant does
not and should not have (§5.6). Applications go through the hosted form in a
browser, and stop before Submit.
"""

from __future__ import annotations

import html
import re
from datetime import UTC, datetime
from typing import Any

from app.services.dedupe import NormalizedPosting
from app.services.discovery.base import DiscoveryAdapter, RawPosting, iter_valid

__all__ = ["AshbyAdapter", "GreenhouseAdapter", "LeverAdapter", "strip_html"]

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"[ \t]*\n\s*\n\s*")

#: A payload whose tags are themselves escaped: ``&lt;p&gt;`` rather than ``<p>``.
#: Greenhouse's ``content`` field arrives this way.
_ESCAPED_TAG = re.compile(r"&lt;/?[a-zA-Z]")


def strip_html(markup: str | None) -> str | None:
    """Plain text from an ATS description field.

    Job descriptions arrive as HTML. Sponsorship analysis quotes exact excerpts
    from this text and records character offsets (§7.5), so the conversion has to
    be stable — the same input must always give the same offsets.

    Greenhouse escapes its markup, so the field contains ``&lt;p&gt;`` rather
    than ``<p>``. Stripping tags first therefore finds none, and the unescape
    afterwards turns the entities *into* tags — handing sponsorship analysis a
    description made of markup, with offsets pointing into ``<div class=...>``.
    Live validation against three Greenhouse boards found this on 100% of 1,522
    postings.

    So a payload that is escaped is unescaped first. The check is deliberately
    narrow — escaped tags present and no real ones — because unescaping
    unconditionally would turn a literal "salary &lt; 100k" in an ordinary HTML
    description into an unterminated tag and eat the rest of the sentence.
    """
    if not markup:
        return None
    text = markup
    if _ESCAPED_TAG.search(text) and not _TAG.search(text):
        text = html.unescape(text)
    text = _TAG.sub(" ", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    return _WS.sub("\n\n", text).strip() or None


def _epoch_ms(value: Any) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(value) / 1000, tz=UTC)
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def _iso(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


class GreenhouseAdapter(DiscoveryAdapter):
    """Greenhouse Job Board API.

    https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true
    """

    def __init__(self, board: str, **kw: Any) -> None:
        super().__init__(**kw)
        self.board = board

    @property
    def source_name(self) -> str:
        return f"greenhouse:{self.board}"

    @property
    def url(self) -> str:
        return f"https://boards-api.greenhouse.io/v1/boards/{self.board}/jobs?content=true"

    def fetch(self) -> list[RawPosting]:
        payload = self._get_json(self.url)
        company = payload.get("name") or self.board
        return iter_valid(
            self._parse(job, company) for job in payload.get("jobs", []) if job.get("absolute_url")
        )

    def _parse(self, job: dict[str, Any], company: str) -> RawPosting:
        return self._make(
            NormalizedPosting(
                company=company,
                title=job.get("title", ""),
                application_url=job.get("absolute_url", ""),
                location=(job.get("location") or {}).get("name", ""),
                description_text=strip_html(job.get("content")),
                posted_at=_iso(job.get("updated_at") or job.get("first_published")),
            ),
            external_id=str(job.get("id")) if job.get("id") is not None else None,
            source_url=self.url,
            raw=job,
        )


class LeverAdapter(DiscoveryAdapter):
    """Lever Postings API.

    https://api.lever.co/v0/postings/{company}?mode=json
    """

    def __init__(self, company_slug: str, **kw: Any) -> None:
        super().__init__(**kw)
        self.company_slug = company_slug

    @property
    def source_name(self) -> str:
        return f"lever:{self.company_slug}"

    @property
    def url(self) -> str:
        return f"https://api.lever.co/v0/postings/{self.company_slug}?mode=json"

    def fetch(self) -> list[RawPosting]:
        payload = self._get_json(self.url)
        return iter_valid(self._parse(job) for job in payload if job.get("hostedUrl"))

    def _parse(self, job: dict[str, Any]) -> RawPosting:
        categories = job.get("categories") or {}
        # Lever splits the description across `description` and `lists`; only the
        # former reliably carries the sponsorship language we need to quote.
        body = job.get("descriptionPlain") or strip_html(job.get("description"))
        return self._make(
            NormalizedPosting(
                company=job.get("categories", {}).get("team") or self.company_slug,
                title=job.get("text", ""),
                application_url=job.get("hostedUrl", ""),
                location=categories.get("location", "") or "",
                description_text=body,
                posted_at=_epoch_ms(job.get("createdAt")),
            ),
            external_id=job.get("id"),
            source_url=self.url,
            raw=job,
        )


class AshbyAdapter(DiscoveryAdapter):
    """Ashby public job posting API.

    https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=false
    """

    def __init__(self, board: str, **kw: Any) -> None:
        super().__init__(**kw)
        self.board = board

    @property
    def source_name(self) -> str:
        return f"ashby:{self.board}"

    @property
    def url(self) -> str:
        return f"https://api.ashbyhq.com/posting-api/job-board/{self.board}"

    def fetch(self) -> list[RawPosting]:
        payload = self._get_json(self.url)
        return iter_valid(self._parse(job) for job in payload.get("jobs", []) if job.get("jobUrl"))

    def _parse(self, job: dict[str, Any]) -> RawPosting:
        return self._make(
            NormalizedPosting(
                company=job.get("organizationName") or self.board,
                title=job.get("title", ""),
                application_url=job.get("applyUrl") or job.get("jobUrl", ""),
                location=job.get("location", "") or "",
                description_text=job.get("descriptionPlain")
                or strip_html(job.get("descriptionHtml")),
                posted_at=_iso(job.get("publishedAt")),
            ),
            external_id=job.get("id"),
            source_url=self.url,
            raw=job,
        )
