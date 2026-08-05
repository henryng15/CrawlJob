"""Discovery adapter protocol and shared source-record handling (spec §7.2).

Every adapter turns some external feed into ``NormalizedPosting`` objects plus a
verbatim ``JobSourceRecord``. Keeping the raw payload matters: when a role turns
out to have been mis-parsed months later, the original response is the only way to
tell a bad parser from a changed feed.

Adapters do not deduplicate, score, or decide eligibility. They fetch and shape.
"""

from __future__ import annotations

import hashlib
import json
from abc import ABC, abstractmethod
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Final
from urllib.parse import urlsplit

import httpx

from app.db.base import utcnow
from app.services.dedupe import NormalizedPosting

__all__ = [
    "DiscoveryAdapter",
    "RawPosting",
    "SourceType",
    "content_hash",
    "employer_host",
    "website_domain",
]


class SourceType:
    ATS_API = "ATS_API"
    GITHUB_FEED = "GITHUB_FEED"
    MANUAL = "MANUAL"


def content_hash(payload: Any) -> str:
    """Stable hash of a raw payload.

    Sorted keys so that a feed reordering its JSON does not read as a change and
    create a spurious source record.
    """
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode()).hexdigest()


# ------------------------------------------------------------ company domain

#: Hosts that belong to an applicant-tracking system or a job aggregator rather
#: than to an employer. None of these may ever become a company domain.
#:
#: ``boards.greenhouse.io`` is one hostname shared by every Greenhouse employer,
#: so deriving it would hand thousands of unrelated companies a single identity —
#: and ``Company.domain`` is what the manual-only list is joined on to decide
#: whether an application may be submitted without a person. One employer on that
#: list would then make every Greenhouse employer manual, or worse, one absent
#: from it would clear all of them for auto-submission. A missing domain is
#: recoverable (the gate treats it as manual); a wrong one shared by everybody is
#: not.
#:
#: Over-inclusion here is safe by construction: the only thing an entry can do is
#: withhold a domain, and a withheld domain routes the application to a human.
_NOT_EMPLOYER_HOSTS: Final[frozenset[str]] = frozenset(
    {
        # Applicant tracking systems.
        "greenhouse.io",
        "lever.co",
        "ashbyhq.com",
        "myworkdayjobs.com",
        "myworkdaysite.com",
        "workday.com",
        "icims.com",
        "smartrecruiters.com",
        "jobvite.com",
        "workable.com",
        "bamboohr.com",
        "breezy.hr",
        "recruitee.com",
        "teamtailor.com",
        "applytojob.com",
        "jazzhr.com",
        "taleo.net",
        "successfactors.com",
        "oraclecloud.com",
        "eightfold.ai",
        "phenompeople.com",
        "avature.net",
        "rippling-ats.com",
        "paylocity.com",
        "dayforcehcm.com",
        "trakstar.com",
        "join.com",
        # Aggregators and link shorteners: never the employer either.
        "linkedin.com",
        "indeed.com",
        "glassdoor.com",
        "ziprecruiter.com",
        "wellfound.com",
        "angel.co",
        "builtin.com",
        "simplify.jobs",
        "bit.ly",
        "tinyurl.com",
    }
)

#: Payload keys that carry the employer's *own* website. Preferred over anything
#: inferred from a URL, because it is the feed stating the employer's domain
#: rather than us guessing at one. The spellings differ per provider and cost
#: nothing to check for.
_WEBSITE_KEYS: Final[tuple[str, ...]] = (
    "company_website",
    "companyWebsite",
    "organizationWebsite",
    "company_url",
    "companyUrl",
    "organizationUrl",
    "websiteUrl",
    "website",
)


def employer_host(url: str | None) -> str | None:
    """The employer's own host from ``url``, or ``None`` if it is not one.

    Returns ``None`` — never a guess — for an ATS or aggregator host, for a bare
    word with no dot in it, and for anything unparseable. The caller is expected
    to leave ``company_domain`` unset in that case and let the manual-only gate
    route the application to a human, which is the cheap failure.
    """
    if not url:
        return None
    candidate = url.strip()
    if not candidate:
        return None
    if "//" not in candidate:
        candidate = f"//{candidate}"
    try:
        host = urlsplit(candidate).netloc.lower()
    except ValueError:
        return None
    host = host.split("@")[-1].split(":")[0].removeprefix("www.").strip(" .")
    if not host or "." not in host:
        return None
    if any(host == known or host.endswith(f".{known}") for known in _NOT_EMPLOYER_HOSTS):
        return None
    return host


def website_domain(*payloads: Mapping[str, Any] | None) -> str | None:
    """Employer domain from an explicit website field in any of ``payloads``.

    Payloads are searched in the order given, so an adapter passes the most
    specific one first. A field that turns out to hold an ATS link is rejected by
    :func:`employer_host` like any other.
    """
    for payload in payloads:
        if not payload:
            continue
        for key in _WEBSITE_KEYS:
            value = payload.get(key)
            if isinstance(value, str):
                host = employer_host(value)
                if host:
                    return host
    return None


@dataclass(frozen=True, slots=True)
class RawPosting:
    """One posting as fetched, before deduplication."""

    posting: NormalizedPosting
    source_type: str
    source_name: str
    source_url: str
    external_id: str | None
    raw_payload: dict[str, Any] = field(default_factory=dict)
    fetched_at: datetime = field(default_factory=utcnow)

    @property
    def content_hash(self) -> str:
        return content_hash(self.raw_payload)


class DiscoveryAdapter(ABC):
    """Base class for job sources.

    Subclasses implement :meth:`fetch`. The HTTP client is injected so tests can
    supply a transport without patching module globals, and so every adapter gets
    the same timeout and user agent.
    """

    source_type: str = SourceType.ATS_API

    def __init__(self, client: httpx.Client | None = None, *, timeout: float = 20.0) -> None:
        self._owns_client = client is None
        self._client = client or httpx.Client(
            timeout=timeout,
            follow_redirects=True,
            headers={"User-Agent": "internship-ops/0.1 (personal job search tool)"},
        )

    def __enter__(self) -> DiscoveryAdapter:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    @property
    @abstractmethod
    def source_name(self) -> str:
        """Identifier recorded on every source record, e.g. ``greenhouse:acme``."""

    @abstractmethod
    def fetch(self) -> Sequence[RawPosting]:
        """Retrieve current postings. Raises on transport or parse failure."""

    def _get_json(self, url: str) -> Any:
        response = self._client.get(url)
        response.raise_for_status()
        return response.json()

    def _make(
        self,
        posting: NormalizedPosting,
        *,
        external_id: str | None,
        source_url: str,
        raw: dict[str, Any],
    ) -> RawPosting:
        return RawPosting(
            posting=posting,
            source_type=self.source_type,
            source_name=self.source_name,
            source_url=source_url,
            external_id=external_id,
            raw_payload=raw,
        )


def iter_valid(postings: Iterable[RawPosting]) -> list[RawPosting]:
    """Drop postings whose URL cannot be canonicalized.

    A feed occasionally emits a relative or empty link. Skipping is right here:
    the posting is unusable and the alternative is aborting an otherwise good
    fetch of several hundred roles.
    """
    kept = []
    for item in postings:
        try:
            _ = item.posting.canonical_url
        except ValueError:
            continue
        kept.append(item)
    return kept
