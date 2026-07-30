"""Resume, application, field and browser-session tables (spec §12.1)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, Integer, Numeric, Text, text
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
from app.domain.states import ApplicationState, BrowserSlotState

__all__ = ["Application", "ApplicationField", "BrowserSession", "ResumeVersion"]

#: Application states that mean "this attempt is over". A new application row may
#: be created for the same job once it reaches one of these (see the partial
#: unique index on Application).
_CLOSED_STATES = (
    ApplicationState.SKIPPED,
    ApplicationState.WITHDRAWN,
    ApplicationState.FAILED,
    # An expired application has been let go, so it must not keep the job locked
    # against a fresh attempt. Restoring one therefore has to check that nothing
    # else has since claimed the job.
    ApplicationState.EXPIRED,
    # Blocked for the same reason: often the block *is* "something else already
    # covers this job", so counting it as active would be circular.
    ApplicationState.RESTORE_BLOCKED,
)


class ResumeVersion(UUIDMixin, CreatedAtMixin, Base):
    """An immutable resume artifact.

    Rows are never updated. Regenerating produces a new row with
    ``parent_resume_id`` set, so the exact PDF uploaded to each application stays
    recoverable years later (§7.7).
    """

    __tablename__ = "resume_versions"

    job_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("jobs.id"))
    parent_resume_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resume_versions.id")
    )
    #: BASE or TAILORED.
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)

    source_path: Mapped[str] = mapped_column(Text, nullable=False)
    pdf_path: Mapped[str] = mapped_column(Text, nullable=False)
    diff_path: Mapped[str | None] = mapped_column(Text)
    validation_path: Mapped[str | None] = mapped_column(Text)
    #: Checksum of the PDF. Proves the artifact on disk is the one that was
    #: validated, and is what the monthly restore test compares (§24.3).
    sha256: Mapped[str] = mapped_column(Text, nullable=False)

    prompt_version: Mapped[str | None] = mapped_column(Text)
    model_name: Mapped[str | None] = mapped_column(Text)

    # ---- build record (§7.7) ----------------------------------------------
    #: Which application this was built for. ``job_id`` alone cannot group the
    #: attempts, because a job may be applied to more than once.
    application_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("applications.id")
    )
    #: 0 for the base resume, 1..3 for tailoring attempts. Every attempt is
    #: stored, including the ones that came out at two pages — the point of the
    #: record is to be able to see why the chosen one was chosen.
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: What the compiler produced. The one-page rule is enforced on this.
    page_count: Mapped[int | None] = mapped_column(Integer)
    #: Checksum of the ``.tex``, alongside ``sha256`` for the PDF.
    tex_sha256: Mapped[str | None] = mapped_column(Text)
    log_path: Mapped[str | None] = mapped_column(Text)
    manifest_path: Mapped[str | None] = mapped_column(Text)
    #: Why the base resume was used instead of a tailored one. Empty when a
    #: tailored build succeeded.
    fallback_reason: Mapped[str | None] = mapped_column(Text)
    #: The version the build chose to send. Set when the PDF is produced, so at
    #: most one row per application carries it. Being selected says nothing about
    #: whether an employer ever received it.
    is_selected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    #: The version a browser actually attached to the employer's form. Set only
    #: after Playwright reports the file input accepted it — never at build time.
    #: An application whose slot died holds a selected version and no uploaded
    #: one, and that difference is the whole reason these are two columns.
    is_uploaded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    uploaded_at: Mapped[datetime | None] = mapped_column()
    #: Ids of the verified facts the tailoring cited.
    facts_used: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list)


class Application(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "applications"
    __table_args__ = (
        enum_check(ApplicationState, "status"),
        enum_check(AtsType, "ats_type"),
        # At most one live application per job. The spec's plain UNIQUE(job_id)
        # would also block re-applying after a skipped or failed attempt, which is
        # a legitimate thing to want; this still satisfies the no-duplicate-
        # submission requirement (G5) because a SUBMITTED row is never "closed".
        Index(
            "uq_applications_active_job",
            "job_id",
            unique=True,
            postgresql_where=text(
                "status NOT IN (" + ", ".join(repr(s.value) for s in _CLOSED_STATES) + ")"
            ),
        ),
        Index("ix_applications_status_ready", "status", "ready_for_review_at"),
        # Partial: only rows that are actually waiting carry a deadline, and the
        # sweep runs every quarter hour forever.
        Index(
            "ix_applications_expires_at",
            "expires_at",
            postgresql_where=text("expires_at IS NOT NULL"),
        ),
        Index("ix_applications_outreach_due", "outreach_due_at"),
    )

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id"), nullable=False
    )
    resume_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resume_versions.id")
    )

    status = enum_column(name="status", default=ApplicationState.CREATED, index=True)
    application_url: Mapped[str] = mapped_column(Text, nullable=False)
    ats_type = enum_column(name="ats_type", nullable=True)
    browser_slot_id: Mapped[str | None] = mapped_column(Text)

    ready_for_review_at: Mapped[datetime | None] = mapped_column()
    #: When this application stops waiting for the user (§7.9). Stamped on the
    #: way into a state that waits for a person, and cleared on the way out, so
    #: the sweep is one indexed comparison rather than a rule reimplemented in
    #: SQL. NULL means "not waiting", which is why the sweep can never expire
    #: work the machine still owns.
    expires_at: Mapped[datetime | None] = mapped_column()
    #: Why a restore was refused, in the user's words. Set with the transition to
    #: RESTORE_BLOCKED and cleared when a restore is attempted again, so the row
    #: never shows a stale explanation for a block that has since lifted.
    restore_blocked_reason: Mapped[str | None] = mapped_column(Text)
    #: When a restore last succeeded. The row is otherwise indistinguishable from
    #: one that was never expired, and "this came back from the dead" is
    #: something the user should be able to see on the list.
    restored_at: Mapped[datetime | None] = mapped_column()
    #: SHA-256 of the base resume this application's tailoring was planned
    #: against. Pinned when the bullet inventory is read, checked before the plan
    #: is applied. The ids in a plan only mean anything relative to one version of
    #: the resume, so a plan and a resume that disagree is not something to
    #: reconcile — it is a plan to throw away (§7.7).
    base_tex_sha256: Mapped[str | None] = mapped_column(Text)

    submitted_at: Mapped[datetime | None] = mapped_column()
    #: How the submission was established: an observed signal, or the user
    #: pressing "Mark Submitted" (§7.10).
    submission_detection_method: Mapped[str | None] = mapped_column(Text)
    submission_confidence: Mapped[float | None] = mapped_column(Numeric(4, 3))
    #: Confirmation URL, matched text, screenshot path. Never raw POST bodies
    #: (§7.10, §23.5).
    confirmation_data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    outreach_due_at: Mapped[datetime | None] = mapped_column()

    fields: Mapped[list[ApplicationField]] = relationship(
        back_populates="application", cascade="all, delete-orphan"
    )


class ApplicationField(UUIDMixin, TimestampMixin, Base):
    """One question on one application form, and how it was answered.

    ``source_type`` is the audit trail the review screen renders: the user must be
    able to see at a glance which answers came from locked facts and which a model
    drafted (§7.8, §22.4).
    """

    __tablename__ = "application_fields"
    __table_args__ = (Index("ix_application_fields_application", "application_id", "page_index"),)

    application_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("applications.id", ondelete="CASCADE"),
        nullable=False,
    )
    #: Stable cross-ATS key such as "candidate.first_name". NULL for questions we
    #: could not map, which are exactly the ones that need a human.
    semantic_key: Mapped[str | None] = mapped_column(Text)
    page_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    field_type: Mapped[str] = mapped_column(Text, nullable=False)
    answer_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    #: LOCKED_FACT | PROFILE_FACT | DERIVED_DETERMINISTIC | AI_DRAFT |
    #: USER_OVERRIDE | MANUAL_REQUIRED | UNRESOLVED (§7.8).
    source_type: Mapped[str] = mapped_column(Text, nullable=False)
    source_fact_ids: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list)
    confidence: Mapped[float | None] = mapped_column(Numeric(4, 3))

    required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    manual_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    user_overridden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    locator_strategy: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    application: Mapped[Application] = relationship(back_populates="fields")


class BrowserSession(UUIDMixin, Base):
    __tablename__ = "browser_sessions"
    __table_args__ = (
        enum_check(BrowserSlotState, "status"),
        Index("ix_browser_sessions_slot_status", "slot_name", "status"),
        Index("ix_browser_sessions_heartbeat", "heartbeat_at"),
    )

    slot_name: Mapped[str] = mapped_column(Text, nullable=False)
    application_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("applications.id")
    )
    status = enum_column(name="status", default=BrowserSlotState.IDLE)

    #: Hash only. A stolen database row must not yield a working review link
    #: (§15.3).
    review_token_hash: Mapped[str | None] = mapped_column(Text)
    profile_path: Mapped[str | None] = mapped_column(Text)
    storage_state_path: Mapped[str | None] = mapped_column(Text)
    replay_package_path: Mapped[str | None] = mapped_column(Text)

    #: Written by the slot itself. A stale heartbeat is how the worker detects a
    #: crashed slot and recovers the lock (§9.1).
    heartbeat_at: Mapped[datetime | None] = mapped_column()
    expires_at: Mapped[datetime | None] = mapped_column()
    started_at: Mapped[datetime | None] = mapped_column()
    ended_at: Mapped[datetime | None] = mapped_column()
    error_summary: Mapped[str | None] = mapped_column(Text)
