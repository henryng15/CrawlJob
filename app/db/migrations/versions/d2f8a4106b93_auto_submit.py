"""the system submits

Collapses the prepare-and-hand-over model into two lanes. Applications either get
submitted by the browser or land in NEEDS_ME for the user to finish in their own
browser, so the five states that meant "waiting for a person, in one of five
different ways" become one, and everything built to keep a human working inside
our browser — live-review sessions, replay packages, prepared-application TTLs —
goes with them. Recruiter outreach and the Gmail drafts go too; they were a
separate product.

Nothing is lost that the user can see: every application that was waiting for
them is still waiting for them, with a reason attached.

Revision ID: d2f8a4106b93
Revises: c7d4e1b93f52
Create Date: 2026-08-05
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d2f8a4106b93"
down_revision: str | None = "c7d4e1b93f52"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_TASK_TYPES_AFTER = (
    "DISCOVER_SOURCE, SCORE_JOB, PREPARE_APPLICATION, SUBMIT_APPLICATION, "
    "BACKUP_DATABASE, BACKUP_ARTIFACTS"
)

_APP_STATES_AFTER = (
    "CREATED, MATERIALS_READY, BROWSER_QUEUED, BROWSER_FILLING, "
    "SUBMITTED, NEEDS_ME, FAILED, SKIPPED"
)

_JOB_STATES_AFTER = (
    "DISCOVERED, ENRICHED, DUPLICATE_EXACT, DUPLICATE_PROBABLE, "
    "ELIGIBILITY_REJECTED, SCORED, SELECTED, CLOSED, ARCHIVED"
)

#: Every state that meant "a person has to do something with this" becomes the
#: one state that means exactly that. The reason column carries what used to be
#: encoded in the state name.
#:
#: The two browser states are in here as well, and that is not a category error.
#: Their queued work is deleted below — the task type it was filed under has
#: changed meaning — so a row left in BROWSER_QUEUED would wait for a task that
#: is never coming. Handing it to the user is the only honest end for it.
_TO_NEEDS_ME = (
    "BROWSER_QUEUED",
    "BROWSER_FILLING",
    "READY_FOR_REVIEW",
    "LIVE_REVIEW_READY",
    "MANUAL_LOGIN_REQUIRED",
    "MANUAL_FIELD_REQUIRED",
    "SUBMISSION_PENDING_CONFIRMATION",
    "SUBMISSION_UNCERTAIN",
    "READY_FOR_REPLAY",
    "REPLAYING",
    "EXPIRED",
    "RESTORE_BLOCKED",
)

_REASON_BY_OLD_STATE = {
    "READY_FOR_REVIEW": "prepared before the switch to auto-submit — open the link and finish it",
    "LIVE_REVIEW_READY": "prepared before the switch to auto-submit — open the link and finish it",
    "MANUAL_LOGIN_REQUIRED": "this employer wanted a login or showed a challenge",
    "MANUAL_FIELD_REQUIRED": "some questions could not be answered from your locked facts",
    "SUBMISSION_PENDING_CONFIRMATION": (
        "this was awaiting confirmation — check whether it went through before resubmitting"
    ),
    "SUBMISSION_UNCERTAIN": (
        "it was never confirmed submitted — check your email before resubmitting"
    ),
    "BROWSER_QUEUED": "queued for a browser before the upgrade — open the link and apply yourself",
    "BROWSER_FILLING": "a browser was filling this at the upgrade — check it, then apply yourself",
    "READY_FOR_REPLAY": "the prepared session was lost — open the link and apply yourself",
    "REPLAYING": "the prepared session was lost — open the link and apply yourself",
    "EXPIRED": "this expired while waiting for you; the link still works",
    "RESTORE_BLOCKED": "this could not be restored — open the link and apply yourself",
}


def upgrade() -> None:
    # ---- applications: the new shape ------------------------------------
    op.add_column("applications", sa.Column("needs_me_at", sa.DateTime(timezone=True)))
    op.add_column("applications", sa.Column("needs_me_reason", sa.Text()))
    op.add_column(
        "applications",
        sa.Column(
            "missing_fields",
            sa.dialects.postgresql.JSONB(),
            nullable=False,
            server_default="[]",
        ),
    )
    op.add_column(
        "applications",
        sa.Column("was_dry_run", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    # Carried over before the old columns go: ready_for_review_at is the closest
    # thing to "when did this start waiting for you", and losing it would reorder
    # the queue the user already knows.
    op.execute("UPDATE applications SET needs_me_at = ready_for_review_at")

    for old in _TO_NEEDS_ME:
        op.execute(
            sa.text(
                "UPDATE applications SET needs_me_reason = :reason "
                "WHERE status = :old AND needs_me_reason IS NULL"
            ).bindparams(reason=_REASON_BY_OLD_STATE[old], old=old)
        )

    op.drop_constraint("status_valid", "applications", type_="check")
    op.execute(  # noqa: S608 — the list is a module constant, not input
        "UPDATE applications SET status = 'NEEDS_ME' WHERE status IN ("
        + ", ".join(repr(s) for s in _TO_NEEDS_ME)
        + ")"
    )
    op.execute(
        "UPDATE applications SET status = 'MATERIALS_READY' WHERE status = 'MATERIALS_PREPARING'"
    )
    op.execute("UPDATE applications SET status = 'SKIPPED' WHERE status = 'WITHDRAWN'")
    op.execute(
        "UPDATE applications SET needs_me_at = updated_at "
        "WHERE status = 'NEEDS_ME' AND needs_me_at IS NULL"
    )
    op.create_check_constraint(
        "status_valid", "applications", f"status IN ({_quoted(_APP_STATES_AFTER)})"
    )

    op.drop_index("ix_applications_status_ready", table_name="applications")
    op.drop_index("ix_applications_expires_at", table_name="applications")
    op.drop_index("ix_applications_outreach_due", table_name="applications")
    op.create_index("ix_applications_status_needs_me", "applications", ["status", "needs_me_at"])
    op.create_index("ix_applications_submitted_at", "applications", ["submitted_at"])

    # The partial unique index names the closed states, so it has to be rebuilt
    # around the ones that still exist.
    op.drop_index("uq_applications_active_job", table_name="applications")
    op.create_index(
        "uq_applications_active_job",
        "applications",
        ["job_id"],
        unique=True,
        postgresql_where=sa.text("status NOT IN ('SKIPPED', 'FAILED')"),
    )

    for column in (
        "expires_at",
        "restore_blocked_reason",
        "restored_at",
        "ready_for_review_at",
        "outreach_due_at",
        "base_tex_sha256",
        "browser_slot_id",
    ):
        op.drop_column("applications", column)

    # ---- tables that served subsystems now gone --------------------------
    op.drop_table("browser_sessions")
    op.drop_table("outreach_tasks")
    op.drop_table("suppression_entries")
    op.drop_table("recruiters")

    # ---- job scores: nothing cites a model any more -----------------------
    for column in ("fact_references", "model_name", "prompt_version"):
        op.drop_column("job_scores", column)

    # ---- jobs: sponsorship review was a model's "ask a human" verdict -----
    op.drop_constraint("status_valid", "jobs", type_="check")
    op.execute("UPDATE jobs SET status = 'ENRICHED' WHERE status = 'SPONSORSHIP_REVIEW'")
    op.create_check_constraint("status_valid", "jobs", f"status IN ({_quoted(_JOB_STATES_AFTER)})")

    # ---- queue: drop the task types that no longer have handlers ----------
    op.drop_constraint("task_type_valid", "scheduled_tasks", type_="check")
    # PREPARE_APPLICATION survives the rename but does not survive the *meaning*:
    # it used to be "fill the form in a browser" and is now "attach the resume".
    # Renaming PREPARE_RESUME onto it would merge two different stages into one
    # queue, so both are deleted and the pipeline re-enqueues what it needs. The
    # idempotency keys embed the task type anyway, so a renamed row would carry a
    # key nothing will ever match.
    op.execute(
        "DELETE FROM scheduled_tasks WHERE task_type IN ('PREPARE_RESUME', 'PREPARE_APPLICATION')"
    )
    # Anything still queued for a stage that no longer exists. Deleting beats
    # leaving rows no worker can ever claim: an unclaimable task is invisible
    # work that makes the queue depth lie for ever.
    op.execute(  # noqa: S608 — the list is a module constant, not input
        "DELETE FROM scheduled_tasks WHERE task_type NOT IN (" + _quoted(_TASK_TYPES_AFTER) + ")"
    )
    op.create_check_constraint(
        "task_type_valid", "scheduled_tasks", f"task_type IN ({_quoted(_TASK_TYPES_AFTER)})"
    )


def _quoted(csv: str) -> str:
    return ", ".join(repr(item.strip()) for item in csv.split(","))


def downgrade() -> None:
    """Not supported.

    Going back means re-creating four tables and inventing which of five waiting
    states each NEEDS_ME row used to be. The honest answer is a restore from the
    backup taken before the upgrade, which is what §24 exists for.
    """
    raise NotImplementedError(
        "No downgrade. Restore the pre-upgrade backup instead — see docs/RUNBOOK.md."
    )
