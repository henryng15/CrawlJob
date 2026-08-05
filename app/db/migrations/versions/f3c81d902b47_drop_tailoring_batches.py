"""drop the tailoring batch table and three unreachable task types

The Batch API path was registered but never reachable: nothing in the
application enqueued ``SUBMIT_TAILORING_BATCH``, it was not in the scheduler,
and its only callers were tests. At ten applications a day the half-price batch
rate saved single-digit dollars a month in exchange for an asynchronous
two-task state machine, a poll loop and a table. Tailoring is synchronous.

``ENRICH_JOB`` and ``DEDUPE_JOB`` go with them for a different reason: both
steps happen inside discovery rather than as tasks of their own, so the two
names only ever appeared in the enum and in the "no handler for" warning the
worker prints at startup.

Reversible: the downgrade recreates the table and widens the CHECK back.

Revision ID: f3c81d902b47
Revises: d18c4b7a5e30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f3c81d902b47"
down_revision: str | None = "d18c4b7a5e30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_TASK_TYPES_AFTER = (
    "DISCOVER_SOURCE, ANALYZE_SPONSORSHIP, SCORE_JOB, "
    "TAILOR_RESUME, PREPARE_APPLICATION, REPLAY_APPLICATION, RECONCILE_SUBMISSION, "
    "SCHEDULE_OUTREACH, MATCH_RECRUITER, GENERATE_HOOK, CREATE_GMAIL_DRAFT, "
    "RECONCILE_GMAIL, BACKUP_DATABASE, BACKUP_ARTIFACTS, CLEANUP_EXPIRED_SESSION, "
    "EXPIRE_PREPARED_APPLICATIONS, RESTORE_APPLICATION"
)
_TASK_TYPES_BEFORE = (
    "DISCOVER_SOURCE, ENRICH_JOB, DEDUPE_JOB, ANALYZE_SPONSORSHIP, SCORE_JOB, "
    "TAILOR_RESUME, PREPARE_APPLICATION, REPLAY_APPLICATION, RECONCILE_SUBMISSION, "
    "SCHEDULE_OUTREACH, MATCH_RECRUITER, GENERATE_HOOK, CREATE_GMAIL_DRAFT, "
    "RECONCILE_GMAIL, BACKUP_DATABASE, BACKUP_ARTIFACTS, CLEANUP_EXPIRED_SESSION, "
    "EXPIRE_PREPARED_APPLICATIONS, RESTORE_APPLICATION, "
    "SUBMIT_TAILORING_BATCH, POLL_TAILORING_BATCH"
)


def _quoted(names: str) -> str:
    return ", ".join(f"'{n.strip()}'" for n in names.split(","))


def _swap_check(table: str, column: str, allowed: str) -> None:
    short = f"{column}_valid"
    op.drop_constraint(short, table, type_="check")
    op.create_check_constraint(short, table, f"{column} IN ({_quoted(allowed)})")


def upgrade() -> None:
    op.drop_index("ix_llm_batches_state", table_name="llm_batches")
    op.drop_index("uq_llm_batches_dedupe_key", table_name="llm_batches")
    op.drop_table("llm_batches")
    # Rows first: the narrowed CHECK is validated against existing data, and a
    # spent batch task left behind would make this migration fail on a database
    # that had ever run one.
    op.execute(
        "DELETE FROM scheduled_tasks WHERE task_type IN "
        "('SUBMIT_TAILORING_BATCH', 'POLL_TAILORING_BATCH', 'ENRICH_JOB', 'DEDUPE_JOB')"
    )
    _swap_check("scheduled_tasks", "task_type", _TASK_TYPES_AFTER)


def downgrade() -> None:
    _swap_check("scheduled_tasks", "task_type", _TASK_TYPES_BEFORE)
    op.create_table(
        "llm_batches",
        sa.Column("dedupe_key", sa.Text(), nullable=False),
        sa.Column("provider_batch_id", sa.Text(), nullable=True),
        sa.Column("state", sa.Text(), nullable=False),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column(
            "custom_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("estimated_cost_usd", sa.Float(), nullable=False),
        sa.Column("actual_cost_usd", sa.Float(), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("failures", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        # Added by d18c4b7a5e30, which runs *before* this one on the way down
        # and drops it again. Recreating the table without it would make that
        # migration's downgrade fail on a column that does not exist.
        sa.Column("base_tex_sha256", sa.Text(), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_llm_batches")),
    )
    op.create_index("uq_llm_batches_dedupe_key", "llm_batches", ["dedupe_key"], unique=True)
    op.create_index("ix_llm_batches_state", "llm_batches", ["state"], unique=False)
