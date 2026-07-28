"""Durable task queue, candidate facts and audit tables (spec §12.1, §11.3)."""

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
from app.domain.tasks import TaskStatus, TaskType

__all__ = ["AuditEvent", "CandidateFact", "ScheduledTask", "TaskRun"]


class CandidateFact(UUIDMixin, TimestampMixin, Base):
    """The single source of truth about the user (§7.1).

    ``is_locked`` is the mechanism behind the rule that no model may alter work
    authorization, graduation date, GPA or employment history. Locked facts are
    writable only through an explicit user action in the settings UI.
    """

    __tablename__ = "candidate_facts"

    #: Dotted path such as "work_authorization.requires_future_sponsorship".
    fact_key: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    value_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    data_type: Mapped[str] = mapped_column(Text, nullable=False)
    #: public | personal | restricted. Drives log redaction (§23.5).
    sensitivity: Mapped[str] = mapped_column(Text, nullable=False)
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column()


class ScheduledTask(UUIDMixin, TimestampMixin, Base):
    """A unit of background work.

    Claimed with ``SELECT ... FOR UPDATE SKIP LOCKED`` (§11.3), so two workers
    never run the same task. ``dedupe_key`` makes enqueueing idempotent: the same
    logical work submitted twice collapses to one row (§16.5).
    """

    __tablename__ = "scheduled_tasks"
    __table_args__ = (
        enum_check(TaskType, "task_type"),
        enum_check(TaskStatus, "status"),
        Index("uq_scheduled_tasks_dedupe_key", "dedupe_key", unique=True),
        # The claim query's covering index: pending tasks due now, best first.
        Index("ix_scheduled_tasks_claim", "status", "run_at", "priority"),
        Index("ix_scheduled_tasks_locked_at", "locked_at"),
    )

    task_type = enum_column(name="task_type")
    dedupe_key: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    run_at: Mapped[datetime] = mapped_column(nullable=False)
    status = enum_column(name="status", default=TaskStatus.PENDING)

    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=3)

    #: Worker identity and claim time. A row whose lock is older than the lease
    #: is reclaimable, which is how a crashed worker's tasks come back (§9.1).
    locked_by: Mapped[str | None] = mapped_column(Text)
    locked_at: Mapped[datetime | None] = mapped_column()
    last_error: Mapped[str | None] = mapped_column(Text)


class TaskRun(UUIDMixin, CreatedAtMixin, Base):
    """One execution attempt. Kept even when the task later succeeds."""

    __tablename__ = "task_runs"
    __table_args__ = (Index("ix_task_runs_task", "task_id", "started_at"),)

    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("scheduled_tasks.id", ondelete="CASCADE"), nullable=False
    )
    worker_id: Mapped[str] = mapped_column(Text, nullable=False)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False)
    started_at: Mapped[datetime] = mapped_column(nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column()
    outcome: Mapped[str | None] = mapped_column(Text)
    #: Redacted before write. Never contains secrets or PII (§23.5).
    error: Mapped[str | None] = mapped_column(Text)


class AuditEvent(UUIDMixin, CreatedAtMixin, Base):
    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_events_entity", "entity_type", "entity_id"),
        Index("ix_audit_events_created", "created_at"),
    )

    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    entity_type: Mapped[str] = mapped_column(Text, nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    #: USER | WORKER | SYSTEM.
    actor_type: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[str | None] = mapped_column(Text)
    event_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict
    )
