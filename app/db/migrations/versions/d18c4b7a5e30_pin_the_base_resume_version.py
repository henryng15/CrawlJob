"""pin the base resume version

Records which base resume a tailoring plan was made against (§7.7).

Bullet ids — ``work-experience.todd.2`` — are addresses into one particular
version of one particular ``.tex``. Edit that file and the same id can name a
different sentence, or none. A batch may sit for up to a day between being
submitted and being collected, so this is not a theoretical window.

Without the pin, a plan collected after an edit would splice text into whatever
now occupies those positions: plausible output, wrong content, and no signal that
anything went wrong. With it, the plan is rejected and the application is tailored
again against what the resume now says.

Revision ID: d18c4b7a5e30
Revises: a4f7e02c96d1
Create Date: 2026-07-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d18c4b7a5e30"
down_revision: str | None = "a4f7e02c96d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("applications", sa.Column("base_tex_sha256", sa.Text(), nullable=True))
    op.add_column("llm_batches", sa.Column("base_tex_sha256", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("llm_batches", "base_tex_sha256")
    op.drop_column("applications", "base_tex_sha256")
