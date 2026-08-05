"""manual-only companies

A curated list of employers whose applications are always finished by hand. The
match key is the domain, which is unique: a name column would let "RTX" and
"Raytheon" become two rows for one employer, and the list would quietly stop
covering half of them.

Revision ID: c7d4e1b93f52
Revises: a91e4d7c05b3
Create Date: 2026-08-05 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c7d4e1b93f52"
down_revision: str | None = "a91e4d7c05b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "manual_only_companies",
        sa.Column("domain", sa.Text(), nullable=False),
        sa.Column("company_name", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_manual_only_companies")),
        sa.UniqueConstraint("domain", name=op.f("uq_manual_only_companies_domain")),
    )


def downgrade() -> None:
    op.drop_table("manual_only_companies")
