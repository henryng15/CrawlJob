"""Recruiter, outreach and suppression tables (spec §12.1, §8)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    Base,
    CreatedAtMixin,
    TimestampMixin,
    UUIDMixin,
    enum_check,
    enum_column,
)
from app.domain.states import OutreachState

__all__ = ["OutreachTask", "Recruiter", "SuppressionEntry"]


class Recruiter(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "recruiters"
    __table_args__ = (Index("ix_recruiters_company_contacted", "company_id", "last_contacted_at"),)

    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id")
    )
    #: The company string exactly as it appeared in the imported spreadsheet,
    #: kept so an incorrect match can be diagnosed later (§7.12).
    raw_company: Mapped[str] = mapped_column(Text, nullable=False)

    #: Lowercased on import. Unique, so re-importing a spreadsheet merges rather
    #: than duplicating.
    email: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    email_domain: Mapped[str | None] = mapped_column(Text, index=True)

    title: Mapped[str | None] = mapped_column(Text)
    linkedin_url: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str | None] = mapped_column(Text)
    verified_at: Mapped[datetime | None] = mapped_column()

    last_contacted_at: Mapped[datetime | None] = mapped_column()
    replied_at: Mapped[datetime | None] = mapped_column()
    do_not_contact: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class OutreachTask(UUIDMixin, TimestampMixin, Base):
    """One recruiter email per application. Draft only — never sent by this system."""

    __tablename__ = "outreach_tasks"
    __table_args__ = (
        enum_check(OutreachState, "status"),
        # One outreach per application (§8.1 max_recruiters_per_application: 1).
        Index("uq_outreach_tasks_application", "application_id", unique=True),
        Index("ix_outreach_tasks_status_due", "status", "due_at"),
    )

    application_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("applications.id"), nullable=False
    )
    recruiter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("recruiters.id")
    )
    status = enum_column(name="status", default=OutreachState.NOT_ELIGIBLE)

    #: Two business days after confirmed submission (§8.1).
    due_at: Mapped[datetime] = mapped_column(nullable=False)

    #: {hook_type, hook, source_url, source_excerpt, confidence, unsupported_claims}.
    #: A hook without a source_url is not written here; the email falls back to a
    #: plain version instead of inventing a fact (§7.13).
    hook_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    subject: Mapped[str | None] = mapped_column(Text)
    body: Mapped[str | None] = mapped_column(Text)

    gmail_draft_id: Mapped[str | None] = mapped_column(Text)
    gmail_message_id: Mapped[str | None] = mapped_column(Text)
    gmail_thread_id: Mapped[str | None] = mapped_column(Text)

    #: Set by reconciliation observing the user's own send, never by this system.
    sent_at: Mapped[datetime | None] = mapped_column()
    replied_at: Mapped[datetime | None] = mapped_column()
    followup_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class SuppressionEntry(UUIDMixin, CreatedAtMixin, Base):
    """Addresses and companies that must never receive another draft (§8.2).

    Retained indefinitely (§23.6). An opt-out that expires is not an opt-out.
    """

    __tablename__ = "suppression_entries"
    __table_args__ = (Index("ix_suppression_entries_email", "email"),)

    email: Mapped[str | None] = mapped_column(Text)
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id")
    )
    #: REPLIED | BOUNCED | OPT_OUT | USER_MARKED | INVALID_ADDRESS.
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False)
