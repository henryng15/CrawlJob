"""Deduplication engine (spec §7.4).

Runs before scoring, resume generation, browser preparation and outreach, because
every one of those is expensive and none of them should be spent twice on the same
role.

The resolution order below is the spec's, and the order matters: a requisition id
is authoritative, a URL is strong, a fingerprint is a hint. The last one produces
``DUPLICATE_PROBABLE``, which is a question for the user rather than an answer —
silently discarding a role the user wanted is worse than showing them one extra.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.db.models import Company, Job
from app.domain.normalization import (
    AtsType,
    canonicalize_url,
    dedupe_fingerprint,
    detect_ats,
    extract_requisition_id,
    extract_season,
    normalize_company,
    normalize_location,
    normalize_title,
    url_hash,
)
from app.domain.states import JobState

__all__ = ["DedupeResult", "DedupeVerdict", "NormalizedPosting", "resolve", "upsert_job"]


class DedupeVerdict(StrEnum):
    NEW = "NEW"
    DUPLICATE_EXACT = "DUPLICATE_EXACT"
    DUPLICATE_PROBABLE = "DUPLICATE_PROBABLE"
    ALREADY_APPLIED = "ALREADY_APPLIED"
    CLOSED = "CLOSED"


@dataclass(frozen=True, slots=True)
class NormalizedPosting:
    """A role from any source, reduced to comparable form."""

    company: str
    title: str
    application_url: str
    location: str = ""
    description_text: str | None = None
    posted_at: datetime | None = None
    source_season: str | None = None

    @property
    def canonical_url(self) -> str:
        return canonicalize_url(self.application_url)

    @property
    def url_hash(self) -> str:
        return url_hash(self.application_url)

    @property
    def ats(self) -> AtsType:
        return detect_ats(self.application_url)

    @property
    def requisition_id(self) -> str | None:
        return extract_requisition_id(self.application_url, self.ats)

    @property
    def board_id(self) -> str | None:
        """The employer's board slug, e.g. ``acme`` in ``.../acme/jobs/123``.

        Part of the requisition key because requisition ids are only unique within
        a board — two employers can both have job 12345.
        """
        path = canonicalize_url(self.application_url).split("/", 3)
        return path[3].split("/")[0] if len(path) > 3 and path[3] else None

    @property
    def season(self) -> str | None:
        return self.source_season or extract_season(self.title)

    @property
    def fingerprint(self) -> str:
        return dedupe_fingerprint(
            company=self.company,
            title=self.title,
            location=self.location,
            season=self.season,
        )


@dataclass(frozen=True, slots=True)
class DedupeResult:
    verdict: DedupeVerdict
    existing_job_id: Any | None = None
    matched_on: str | None = None

    @property
    def is_new(self) -> bool:
        return self.verdict is DedupeVerdict.NEW


def resolve(session: Session, posting: NormalizedPosting) -> DedupeResult:
    """Decide whether ``posting`` is already known.

    Checks run in decreasing order of confidence and stop at the first hit.
    """
    # Priority 1: ATS + board + requisition id. The employer's own identifier,
    # so three aggregators linking the same job all collapse here.
    if posting.requisition_id and posting.board_id:
        match = session.scalars(
            select(Job).where(
                Job.ats_type == posting.ats.value,
                Job.ats_board_id == posting.board_id,
                Job.requisition_id == posting.requisition_id,
            )
        ).first()
        if match:
            return DedupeResult(DedupeVerdict.DUPLICATE_EXACT, match.id, "requisition_id")

    # Priority 2: canonical URL, tracking parameters removed.
    match = session.scalars(select(Job).where(Job.canonical_url_hash == posting.url_hash)).first()
    if match:
        return DedupeResult(DedupeVerdict.DUPLICATE_EXACT, match.id, "canonical_url")

    # Priority 4: company + title + location + season. Weak. A hit here means
    # "these look like the same role", which is a question, not a conclusion.
    match = session.scalars(
        select(Job).where(
            Job.dedupe_fingerprint == posting.fingerprint,
            Job.status.notin_([JobState.DUPLICATE_EXACT.value, JobState.ARCHIVED.value]),
        )
    ).first()
    if match:
        return DedupeResult(DedupeVerdict.DUPLICATE_PROBABLE, match.id, "fingerprint")

    return DedupeResult(DedupeVerdict.NEW)


def _get_or_create_company(session: Session, raw_name: str) -> Company:
    normalized = normalize_company(raw_name)
    company = session.scalars(select(Company).where(Company.normalized_name == normalized)).first()
    if company is None:
        company = Company(canonical_name=raw_name.strip(), normalized_name=normalized)
        session.add(company)
        session.flush()
    return company


def upsert_job(
    session: Session,
    posting: NormalizedPosting,
    *,
    now: datetime | None = None,
) -> tuple[Job, DedupeResult]:
    """Insert ``posting`` as a job, or return the job it duplicates.

    A probable duplicate is still inserted, flagged ``DUPLICATE_PROBABLE`` and
    linked to its counterpart, so the review screen can show both and let the user
    decide. Dropping it here would lose a role the deduplication only *guessed*
    was redundant.
    """
    result = resolve(session, posting)

    if result.verdict is DedupeVerdict.DUPLICATE_EXACT:
        existing = session.get(Job, result.existing_job_id)
        assert existing is not None
        return existing, result

    company = _get_or_create_company(session, posting.company)
    job = Job(
        company_id=company.id,
        canonical_url=posting.canonical_url,
        canonical_url_hash=posting.url_hash,
        ats_type=posting.ats.value,
        ats_board_id=posting.board_id,
        requisition_id=posting.requisition_id,
        title=posting.title.strip(),
        normalized_title=normalize_title(posting.title),
        location_text=posting.location or None,
        normalized_location=normalize_location(posting.location) or None,
        season=posting.season,
        description_text=posting.description_text,
        posted_at=posting.posted_at,
        discovered_at=now or utcnow(),
        dedupe_fingerprint=posting.fingerprint,
        status=(
            JobState.DUPLICATE_PROBABLE.value
            if result.verdict is DedupeVerdict.DUPLICATE_PROBABLE
            else JobState.DISCOVERED.value
        ),
        duplicate_of_id=result.existing_job_id,
    )
    session.add(job)
    session.flush()
    return job, result
