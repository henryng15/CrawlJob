"""Company, source-record and job tables (spec §12.1).

The unique indexes here are the deduplication guarantee. They mirror the priority
order in §7.4: requisition id first, canonical URL second, fingerprint last.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Index, Numeric, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import (
    Base,
    CreatedAtMixin,
    TimestampMixin,
    UUIDMixin,
    enum_check,
    enum_column,
)
from app.domain.normalization import AtsType
from app.domain.states import JobState

__all__ = [
    "Company",
    "Job",
    "JobScore",
    "JobSourceLink",
    "JobSourceRecord",
    "SponsorshipAssessment",
]


class Company(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "companies"

    canonical_name: Mapped[str] = mapped_column(Text, nullable=False)
    #: Output of normalize_company(); the join key for recruiter matching (§7.12).
    normalized_name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    domain: Mapped[str | None] = mapped_column(Text)
    aliases: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list)
    ats_types: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list)

    jobs: Mapped[list[Job]] = relationship(back_populates="company")


class JobSourceRecord(UUIDMixin, Base):
    """One raw observation of a role from one feed, kept verbatim.

    Never mutated. When a feed republishes a changed row the content hash differs
    and a new record is inserted, so provenance stays auditable (§7.2).
    """

    __tablename__ = "job_source_records"
    __table_args__ = (
        UniqueConstraint(
            "source_type", "source_name", "external_id", "content_hash",
            name="uq_job_source_records_identity",
        ),
    )  # fmt: skip

    source_type: Mapped[str] = mapped_column(Text, nullable=False)
    source_name: Mapped[str] = mapped_column(Text, nullable=False)
    external_id: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    raw_payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    content_hash: Mapped[str] = mapped_column(Text, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(nullable=False)


class Job(UUIDMixin, TimestampMixin, Base):
    """A deduplicated role. Many source records may point at one job."""

    __tablename__ = "jobs"
    __table_args__ = (
        enum_check(JobState, "status"),
        enum_check(AtsType, "ats_type"),
        # Priority 1 (§7.4): the employer's own requisition id. Strongest signal.
        Index(
            "uq_jobs_ats_requisition",
            "ats_type", "ats_board_id", "requisition_id",
            unique=True,
            postgresql_where=text("requisition_id IS NOT NULL"),
        ),
        # Priority 2: canonical URL with tracking parameters removed.
        Index("uq_jobs_canonical_url_hash", "canonical_url_hash", unique=True),
        # Priority 4: company+title+location+season. Deliberately NOT unique — a
        # collision here is only *probable* duplication and must reach a human
        # (§7.4). A unique index would raise on INSERT and lose the record.
        Index("ix_jobs_dedupe_fingerprint", "dedupe_fingerprint"),
        Index("ix_jobs_status_discovered", "status", "discovered_at"),
    )  # fmt: skip

    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False
    )

    canonical_url: Mapped[str] = mapped_column(Text, nullable=False)
    canonical_url_hash: Mapped[str] = mapped_column(Text, nullable=False)

    ats_type = enum_column(name="ats_type", nullable=True)
    ats_board_id: Mapped[str | None] = mapped_column(Text)
    requisition_id: Mapped[str | None] = mapped_column(Text)

    title: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_title: Mapped[str] = mapped_column(Text, nullable=False)
    location_text: Mapped[str | None] = mapped_column(Text)
    normalized_location: Mapped[str | None] = mapped_column(Text)
    country_code: Mapped[str | None] = mapped_column(Text)
    employment_type: Mapped[str | None] = mapped_column(Text)
    season: Mapped[str | None] = mapped_column(Text)

    description_html: Mapped[str | None] = mapped_column(Text)
    description_text: Mapped[str | None] = mapped_column(Text)
    description_hash: Mapped[str | None] = mapped_column(Text)

    posted_at: Mapped[datetime | None] = mapped_column()
    discovered_at: Mapped[datetime] = mapped_column(nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column()

    dedupe_fingerprint: Mapped[str] = mapped_column(Text, nullable=False)
    status = enum_column(name="status", default=JobState.DISCOVERED, index=True)

    #: Set when this job was folded into another during deduplication. Keeping the
    #: row rather than deleting it preserves the audit trail.
    duplicate_of_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id")
    )

    company: Mapped[Company] = relationship(back_populates="jobs")
    sponsorship: Mapped[SponsorshipAssessment | None] = relationship(
        back_populates="job", uselist=False
    )
    score: Mapped[JobScore | None] = relationship(back_populates="job", uselist=False)


class JobSourceLink(Base):
    """Which feeds reported which job. Preserves provenance after merging."""

    __tablename__ = "job_source_links"

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), primary_key=True
    )
    source_record_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("job_source_records.id"), primary_key=True
    )


class SponsorshipAssessment(UUIDMixin, CreatedAtMixin, Base):
    """Employer policy read from the job description — never the candidate's answer.

    §2.2 requires these be stored separately. This table records what the employer
    said; ``candidate_facts`` records what is true. Nothing may copy from here to
    there.
    """

    __tablename__ = "sponsorship_assessments"

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id"), nullable=False, unique=True
    )
    classification: Mapped[str] = mapped_column(Text, nullable=False)
    work_authorization_restriction: Mapped[str] = mapped_column(Text, nullable=False)
    #: List of {quote, source_url, start_offset, end_offset}. A restrictive
    #: classification with an empty list is rejected before insert (§7.5).
    evidence: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list)
    confidence: Mapped[float] = mapped_column(Numeric(4, 3), nullable=False)
    recommended_action: Mapped[str] = mapped_column(Text, nullable=False)
    reasoning_summary: Mapped[str | None] = mapped_column(Text)
    model_name: Mapped[str | None] = mapped_column(Text)
    prompt_version: Mapped[str | None] = mapped_column(Text)

    job: Mapped[Job] = relationship(back_populates="sponsorship")


class JobScore(UUIDMixin, CreatedAtMixin, Base):
    __tablename__ = "job_scores"

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id"), nullable=False, unique=True
    )
    total_score: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    #: Per-component breakdown, shown to the user on the job review page (§22.2).
    components: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    #: PASS / REJECT from the deterministic filter, which runs before the model
    #: and which a high AI score may never override (§7.6).
    hard_filter_result: Mapped[str] = mapped_column(Text, nullable=False)
    fact_references: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list)
    model_name: Mapped[str | None] = mapped_column(Text)
    prompt_version: Mapped[str | None] = mapped_column(Text)

    job: Mapped[Job] = relationship(back_populates="score")
