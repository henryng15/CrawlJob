"""restore expired applications

Adds the RESTORE_BLOCKED state, the reason shown alongside it, and the task type
that drives a restore (§7.9, §7.11).

Revision ID: b7d3f0a51e94
Revises: 9c4e17b8d2a6
Create Date: 2026-07-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7d3f0a51e94"
down_revision: str | None = "9c4e17b8d2a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_TASK_TYPES_BEFORE = (
    "DISCOVER_SOURCE, ENRICH_JOB, DEDUPE_JOB, ANALYZE_SPONSORSHIP, SCORE_JOB, "
    "TAILOR_RESUME, PREPARE_APPLICATION, REPLAY_APPLICATION, RECONCILE_SUBMISSION, "
    "SCHEDULE_OUTREACH, MATCH_RECRUITER, GENERATE_HOOK, CREATE_GMAIL_DRAFT, "
    "RECONCILE_GMAIL, BACKUP_DATABASE, BACKUP_ARTIFACTS, CLEANUP_EXPIRED_SESSION, "
    "EXPIRE_PREPARED_APPLICATIONS"
)
_TASK_TYPES_AFTER = _TASK_TYPES_BEFORE + ", RESTORE_APPLICATION"

_APP_STATES_BEFORE = (
    "CREATED, MATERIALS_PREPARING, MATERIALS_READY, BROWSER_QUEUED, BROWSER_FILLING, "
    "MANUAL_LOGIN_REQUIRED, MANUAL_FIELD_REQUIRED, READY_FOR_REVIEW, READY_FOR_REPLAY, "
    "REPLAYING, LIVE_REVIEW_READY, SUBMISSION_PENDING_CONFIRMATION, SUBMITTED, "
    "SUBMISSION_UNCERTAIN, FAILED, SKIPPED, WITHDRAWN, EXPIRED"
)
_APP_STATES_AFTER = _APP_STATES_BEFORE + ", RESTORE_BLOCKED"

_CLOSED_BEFORE = "'SKIPPED', 'WITHDRAWN', 'FAILED', 'EXPIRED'"
_CLOSED_AFTER = "'SKIPPED', 'WITHDRAWN', 'FAILED', 'EXPIRED', 'RESTORE_BLOCKED'"


def _quoted(names: str) -> str:
    return ", ".join(f"'{n.strip()}'" for n in names.split(","))


def _swap_check(table: str, column: str, allowed: str) -> None:
    """Replace a value-list CHECK. Both sides take the short constraint name —
    the metadata naming convention adds the ``ck_<table>_`` prefix itself."""
    short = f"{column}_valid"
    op.drop_constraint(short, table, type_="check")
    op.create_check_constraint(short, table, f"{column} IN ({_quoted(allowed)})")


def _swap_active_index(from_closed: str, to_closed: str) -> None:
    op.drop_index(
        "uq_applications_active_job",
        table_name="applications",
        postgresql_where=sa.text(f"status NOT IN ({from_closed})"),
    )
    op.create_index(
        "uq_applications_active_job",
        "applications",
        ["job_id"],
        unique=True,
        postgresql_where=sa.text(f"status NOT IN ({to_closed})"),
    )


def upgrade() -> None:
    _swap_check("scheduled_tasks", "task_type", _TASK_TYPES_AFTER)
    _swap_check("applications", "status", _APP_STATES_AFTER)
    op.add_column("applications", sa.Column("restore_blocked_reason", sa.Text(), nullable=True))
    op.add_column(
        "applications", sa.Column("restored_at", sa.DateTime(timezone=True), nullable=True)
    )
    # A blocked restore usually means something else already covers the job, so
    # counting it as active would be circular.
    _swap_active_index(_CLOSED_BEFORE, _CLOSED_AFTER)


def downgrade() -> None:
    # Order matters: the narrower index treats RESTORE_BLOCKED as *active*, so
    # any such row has to become EXPIRED before it is built, or a job with both
    # a blocked restore and a live application would violate uniqueness.
    op.execute("UPDATE applications SET status = 'EXPIRED' WHERE status = 'RESTORE_BLOCKED'")
    _swap_active_index(_CLOSED_AFTER, _CLOSED_BEFORE)
    op.drop_column("applications", "restored_at")
    op.drop_column("applications", "restore_blocked_reason")
    op.execute("DELETE FROM scheduled_tasks WHERE task_type = 'RESTORE_APPLICATION'")
    _swap_check("applications", "status", _APP_STATES_BEFORE)
    _swap_check("scheduled_tasks", "task_type", _TASK_TYPES_BEFORE)
