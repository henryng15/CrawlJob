"""prepared application expiry

Adds the EXPIRED application state, its deadline column, and the sweep task
that applies it (§7.9).

Expiry is a state change rather than a delete, so there is nothing here that
removes a row: the downgrade turns expired applications back into SKIPPED, which
is the closest existing state with the same meaning ("the user let this go"),
rather than dropping them.

Revision ID: 9c4e17b8d2a6
Revises: 4f649a3527f8
Create Date: 2026-07-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "9c4e17b8d2a6"
down_revision: str | None = "4f649a3527f8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_TASK_TYPES_BEFORE = (
    "DISCOVER_SOURCE, ENRICH_JOB, DEDUPE_JOB, ANALYZE_SPONSORSHIP, SCORE_JOB, "
    "TAILOR_RESUME, PREPARE_APPLICATION, REPLAY_APPLICATION, RECONCILE_SUBMISSION, "
    "SCHEDULE_OUTREACH, MATCH_RECRUITER, GENERATE_HOOK, CREATE_GMAIL_DRAFT, "
    "RECONCILE_GMAIL, BACKUP_DATABASE, BACKUP_ARTIFACTS, CLEANUP_EXPIRED_SESSION"
)
_TASK_TYPES_AFTER = _TASK_TYPES_BEFORE + ", EXPIRE_PREPARED_APPLICATIONS"

_APP_STATES_BEFORE = (
    "CREATED, MATERIALS_PREPARING, MATERIALS_READY, BROWSER_QUEUED, BROWSER_FILLING, "
    "MANUAL_LOGIN_REQUIRED, MANUAL_FIELD_REQUIRED, READY_FOR_REVIEW, READY_FOR_REPLAY, "
    "REPLAYING, LIVE_REVIEW_READY, SUBMISSION_PENDING_CONFIRMATION, SUBMITTED, "
    "SUBMISSION_UNCERTAIN, FAILED, SKIPPED, WITHDRAWN"
)
_APP_STATES_AFTER = _APP_STATES_BEFORE + ", EXPIRED"

_CLOSED_BEFORE = "'SKIPPED', 'WITHDRAWN', 'FAILED'"
_CLOSED_AFTER = "'SKIPPED', 'WITHDRAWN', 'FAILED', 'EXPIRED'"


def _quoted(names: str) -> str:
    return ", ".join(f"'{n.strip()}'" for n in names.split(","))


def _swap_check(table: str, column: str, allowed: str) -> None:
    """Replace a value-list CHECK with a wider or narrower one.

    Both sides take the *short* name: the metadata naming convention prefixes
    ``ck_<table>_`` itself, on drops as well as creates, so passing the real
    constraint name produces ``ck_scheduled_tasks_ck_scheduled_tasks_...``.
    """
    short = f"{column}_valid"
    op.drop_constraint(short, table, type_="check")
    op.create_check_constraint(short, table, f"{column} IN ({_quoted(allowed)})")


def upgrade() -> None:
    _swap_check("scheduled_tasks", "task_type", _TASK_TYPES_AFTER)
    _swap_check("applications", "status", _APP_STATES_AFTER)

    op.add_column(
        "applications", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index(
        "ix_applications_expires_at",
        "applications",
        ["expires_at"],
        unique=False,
        postgresql_where=sa.text("expires_at IS NOT NULL"),
    )

    # An expired application must stop holding the job against a fresh attempt.
    op.drop_index(
        "uq_applications_active_job",
        table_name="applications",
        postgresql_where=sa.text(f"status NOT IN ({_CLOSED_BEFORE})"),
    )
    op.create_index(
        "uq_applications_active_job",
        "applications",
        ["job_id"],
        unique=True,
        postgresql_where=sa.text(f"status NOT IN ({_CLOSED_AFTER})"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_applications_active_job",
        table_name="applications",
        postgresql_where=sa.text(f"status NOT IN ({_CLOSED_AFTER})"),
    )
    # Expired rows become SKIPPED before the narrower index is rebuilt: they mean
    # the same thing to the older schema, and unlike a delete this keeps the
    # resume, the answers and the audit trail intact.
    op.execute("UPDATE applications SET status = 'SKIPPED' WHERE status = 'EXPIRED'")
    op.create_index(
        "uq_applications_active_job",
        "applications",
        ["job_id"],
        unique=True,
        postgresql_where=sa.text(f"status NOT IN ({_CLOSED_BEFORE})"),
    )

    op.drop_index(
        "ix_applications_expires_at",
        table_name="applications",
        postgresql_where=sa.text("expires_at IS NOT NULL"),
    )
    op.drop_column("applications", "expires_at")

    op.execute(
        "DELETE FROM scheduled_tasks WHERE task_type = 'EXPIRE_PREPARED_APPLICATIONS'"
    )
    _swap_check("applications", "status", _APP_STATES_BEFORE)
    _swap_check("scheduled_tasks", "task_type", _TASK_TYPES_BEFORE)
