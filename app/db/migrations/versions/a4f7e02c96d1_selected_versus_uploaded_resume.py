"""selected versus uploaded resume

Splits one flag into two facts (§7.7).

``is_uploaded`` used to be set when the build *chose* a PDF, which meant the
Resume Versions screen said "uploaded" for applications no browser had ever
opened. The distinction matters precisely when something went wrong — a slot that
died, a file input that was never found — and those are the applications a person
most needs to see as unfinished.

So ``is_selected`` now records the build's choice, and ``is_uploaded`` with
``uploaded_at`` records what a browser actually attached.

Existing rows are migrated on the assumption that a flag set by the old code meant
"selected": that is what it was written by, and claiming those documents reached an
employer would be inventing a fact about the outside world. They keep the selected
flag and lose the uploaded one.

Revision ID: a4f7e02c96d1
Revises: e5b1c93a7f20
Create Date: 2026-07-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a4f7e02c96d1"
down_revision: str | None = "e5b1c93a7f20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "resume_versions",
        sa.Column("is_selected", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "resume_versions", sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=True)
    )

    # What the old flag actually meant. Carried across, then cleared: nothing in
    # the database records whether these ever reached a form, and a guess in the
    # optimistic direction is the one that misleads.
    op.execute("UPDATE resume_versions SET is_selected = is_uploaded WHERE is_uploaded")
    op.execute("UPDATE resume_versions SET is_uploaded = false")

    op.create_index(
        "ix_resume_versions_selected",
        "resume_versions",
        ["application_id"],
        unique=False,
        postgresql_where=sa.text("is_selected"),
    )


def downgrade() -> None:
    # The old column carried the selection, so put it back there. An application
    # whose resume was selected but never uploaded would otherwise lose the only
    # record of which PDF was chosen.
    op.execute("UPDATE resume_versions SET is_uploaded = true WHERE is_selected")

    op.drop_index(
        "ix_resume_versions_selected",
        table_name="resume_versions",
        postgresql_where=sa.text("is_selected"),
    )
    op.drop_column("resume_versions", "uploaded_at")
    op.drop_column("resume_versions", "is_selected")
