"""resume build record

Records every tailoring attempt, not just the winner (§7.7).

The columns exist so the Resume Versions screen can answer "why is this the PDF
that went to the employer" — which needs the attempts that did *not* qualify as
much as the one that did.

Revision ID: e5b1c93a7f20
Revises: c2a95f6b81d7
Create Date: 2026-07-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e5b1c93a7f20"
down_revision: str | None = "c2a95f6b81d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("resume_versions", sa.Column("application_id", sa.UUID(), nullable=True))
    op.add_column(
        "resume_versions",
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("resume_versions", sa.Column("page_count", sa.Integer(), nullable=True))
    op.add_column("resume_versions", sa.Column("tex_sha256", sa.Text(), nullable=True))
    op.add_column("resume_versions", sa.Column("log_path", sa.Text(), nullable=True))
    op.add_column("resume_versions", sa.Column("manifest_path", sa.Text(), nullable=True))
    op.add_column("resume_versions", sa.Column("fallback_reason", sa.Text(), nullable=True))
    op.add_column(
        "resume_versions",
        sa.Column("is_uploaded", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "resume_versions",
        sa.Column(
            "facts_used",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
    )

    op.create_foreign_key(
        op.f("fk_resume_versions_application_id_applications"),
        "resume_versions",
        "applications",
        ["application_id"],
        ["id"],
    )
    op.create_index(
        "ix_resume_versions_application",
        "resume_versions",
        ["application_id", "attempt"],
        unique=False,
    )
    # The uploaded version is looked up per application on every review screen.
    op.create_index(
        "ix_resume_versions_uploaded",
        "resume_versions",
        ["application_id"],
        unique=False,
        postgresql_where=sa.text("is_uploaded"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_resume_versions_uploaded",
        table_name="resume_versions",
        postgresql_where=sa.text("is_uploaded"),
    )
    op.drop_index("ix_resume_versions_application", table_name="resume_versions")
    op.drop_constraint(
        op.f("fk_resume_versions_application_id_applications"),
        "resume_versions",
        type_="foreignkey",
    )
    for column in (
        "facts_used",
        "is_uploaded",
        "fallback_reason",
        "manifest_path",
        "log_path",
        "tex_sha256",
        "page_count",
        "attempt",
        "application_id",
    ):
        op.drop_column("resume_versions", column)
