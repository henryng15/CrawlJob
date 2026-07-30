"""tailoring batches

The ``llm_batches`` table and the two task types that drive it (§7.7, §26.2).

The table exists to make submitting idempotent: the unique index on
``dedupe_key`` is what stops a retried submit task from paying for a second
batch, and it has to be a database constraint rather than a check in the handler
because the race it closes is between two workers.

Revision ID: c2a95f6b81d7
Revises: b7d3f0a51e94
Create Date: 2026-07-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c2a95f6b81d7"
down_revision: str | None = "b7d3f0a51e94"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_TASK_TYPES_BEFORE = (
    "DISCOVER_SOURCE, ENRICH_JOB, DEDUPE_JOB, ANALYZE_SPONSORSHIP, SCORE_JOB, "
    "TAILOR_RESUME, PREPARE_APPLICATION, REPLAY_APPLICATION, RECONCILE_SUBMISSION, "
    "SCHEDULE_OUTREACH, MATCH_RECRUITER, GENERATE_HOOK, CREATE_GMAIL_DRAFT, "
    "RECONCILE_GMAIL, BACKUP_DATABASE, BACKUP_ARTIFACTS, CLEANUP_EXPIRED_SESSION, "
    "EXPIRE_PREPARED_APPLICATIONS, RESTORE_APPLICATION"
)
_TASK_TYPES_AFTER = _TASK_TYPES_BEFORE + ", SUBMIT_TAILORING_BATCH, POLL_TAILORING_BATCH"


def _quoted(names: str) -> str:
    return ", ".join(f"'{n.strip()}'" for n in names.split(","))


def _swap_check(table: str, column: str, allowed: str) -> None:
    """Replace a value-list CHECK. Both sides take the short constraint name —
    the metadata naming convention adds the ``ck_<table>_`` prefix itself."""
    short = f"{column}_valid"
    op.drop_constraint(short, table, type_="check")
    op.create_check_constraint(short, table, f"{column} IN ({_quoted(allowed)})")


def upgrade() -> None:
    _swap_check("scheduled_tasks", "task_type", _TASK_TYPES_AFTER)

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
    # The guarantee that one logical submission produces one batch, however many
    # times its task is retried and by however many workers.
    op.create_index("uq_llm_batches_dedupe_key", "llm_batches", ["dedupe_key"], unique=True)
    op.create_index("ix_llm_batches_state", "llm_batches", ["state"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_llm_batches_state", table_name="llm_batches")
    op.drop_index("uq_llm_batches_dedupe_key", table_name="llm_batches")
    op.drop_table("llm_batches")
    op.execute(
        "DELETE FROM scheduled_tasks "
        "WHERE task_type IN ('SUBMIT_TAILORING_BATCH', 'POLL_TAILORING_BATCH')"
    )
    _swap_check("scheduled_tasks", "task_type", _TASK_TYPES_BEFORE)
