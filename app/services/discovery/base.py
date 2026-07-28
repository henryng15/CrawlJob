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
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx

from app.db.base import utcnow
from app.services.dedupe import NormalizedPosting

__all__ = ["DiscoveryAdapter", "RawPosting", "SourceType", "content_hash"]


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
