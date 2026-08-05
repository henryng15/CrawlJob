"""rename TAILOR_RESUME to PREPARE_RESUME

The resume is no longer rewritten per job. The user keeps one PDF and every
application uploads it unchanged, so the stage that used to call a model, splice
LaTeX and compile now copies a file and records a row. A task type called
``TAILOR_RESUME`` that tailors nothing is the kind of name that makes the next
bug take a day to find.

In-flight rows are renamed rather than deleted: an application waiting for its
resume should still get one.

Revision ID: a91e4d7c05b3
Revises: f3c81d902b47
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "a91e4d7c05b3"
down_revision: str | None = "f3c81d902b47"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_OTHERS = (
    "DISCOVER_SOURCE, ANALYZE_SPONSORSHIP, SCORE_JOB, "
    "PREPARE_APPLICATION, REPLAY_APPLICATION, RECONCILE_SUBMISSION, "
    "SCHEDULE_OUTREACH, MATCH_RECRUITER, GENERATE_HOOK, CREATE_GMAIL_DRAFT, "
    "RECONCILE_GMAIL, BACKUP_DATABASE, BACKUP_ARTIFACTS, CLEANUP_EXPIRED_SESSION, "
    "EXPIRE_PREPARED_APPLICATIONS, RESTORE_APPLICATION"
)


def _quoted(names: str) -> str:
    return ", ".join(f"'{n.strip()}'" for n in names.split(","))


def _swap_check(allowed: str) -> None:
    op.drop_constraint("task_type_valid", "scheduled_tasks", type_="check")
    op.create_check_constraint(
        "task_type_valid", "scheduled_tasks", f"task_type IN ({_quoted(allowed)})"
    )


def _rename(before: str, after: str, allowed: str) -> None:
    # Widen first, move the rows, then narrow. Renaming under a CHECK that
    # forbids the new value fails on the first row.
    _swap_check(f"{allowed}, {before}, {after}")
    op.execute(
        f"UPDATE scheduled_tasks SET task_type = '{after}' WHERE task_type = '{before}'"
    )
    _swap_check(f"{allowed}, {after}")


def upgrade() -> None:
    _rename("TAILOR_RESUME", "PREPARE_RESUME", _OTHERS)


def downgrade() -> None:
    _rename("PREPARE_RESUME", "TAILOR_RESUME", _OTHERS)
