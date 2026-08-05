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
from app.domain.states import ApplicationState

__all__ = ["Application", "ApplicationField", "ResumeVersion"]

#: Application states that mean "this attempt is over". A new application row may
#: be created for the same job once it reaches one of these (see the partial
#: unique index on Application).
_CLOSED_STATES = (
    ApplicationState.SKIPPED,
    ApplicationState.FAILED,
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
        Index("ix_applications_status_needs_me", "status", "needs_me_at"),
        # The daily submit cap is counted off this one, on every auto-submit.
        Index("ix_applications_submitted_at", "submitted_at"),
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

    # ---- handed over to the user -----------------------------------------
    needs_me_at: Mapped[datetime | None] = mapped_column()
    #: One sentence saying why the machine stopped, written for the user rather
    #: than for a log — it is rendered verbatim on the dashboard. The state alone
    #: cannot carry this: "the employer is on your manual list" and "three
    #: required questions had no locked fact" are the same state and completely
    #: different instructions.
    needs_me_reason: Mapped[str | None] = mapped_column(Text)
    #: The exact question texts still to be answered, so the dashboard can tell
    #: the user what to fill in before they open the form. Empty for an
    #: application that stopped for a reason other than missing answers.
    missing_fields: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list)

    # ---- submitted --------------------------------------------------------
    submitted_at: Mapped[datetime | None] = mapped_column()
    #: How the submission was established: the confirmation page we saw after
    #: clicking, or the user pressing "Mark submitted" for one they did by hand.
    submission_detection_method: Mapped[str | None] = mapped_column(Text)
    submission_confidence: Mapped[float | None] = mapped_column(Numeric(4, 3))
    #: Confirmation URL, matched text, screenshot path. Never raw POST bodies.
    confirmation_data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    #: True when the submit path ran to the end with the click suppressed. The
    #: row looks exactly like a real submission otherwise, and telling the two
    #: apart afterwards is the entire value of a dry run.
    was_dry_run: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

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
