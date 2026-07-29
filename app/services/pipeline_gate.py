"""Whether the pipeline may run at all.

Two switches guard everything that discovers, scores, tailors, fills a form or
drafts an email. Both must be open, and one of them is not a switch at all:

* ``PIPELINE_ENABLED`` is the operator's intent — off by default, so a freshly
  deployed instance sits still until somebody turns it on.
* ``BASE_RESUME_STATUS=READY`` is a *declaration* that there is a resume worth
  tailoring from, and it is checked against the database rather than believed.
  A flag can be set by someone who did not look; the database cannot be.

Anything that protects data — backups, cleanup, expiry — is deliberately outside
this gate. Pausing the pipeline must never pause the jobs that keep what already
exists safe, or "paused" becomes a way to lose work.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import ResumeVersion
from app.domain.tasks import TaskType

__all__ = ["PIPELINE_TASKS", "GateResult", "check_gate", "is_pipeline_task"]


#: Task types that move an application towards a recruiter and therefore wait
#: for the gate.
#:
#: Three kinds of work are deliberately *not* here. Backups, cleanup and expiry
#: protect data that already exists — pausing must never become a way to lose
#: it. Restore is something you asked for by hand. And reconciliation only
#: observes: if you submitted a prepared application yourself and then paused
#: the system, the record of that submission must still be picked up. Pausing
#: stops new work, not the truth about work already done.
PIPELINE_TASKS: frozenset[TaskType] = frozenset(
    {
        TaskType.DISCOVER_SOURCE,
        TaskType.ENRICH_JOB,
        TaskType.DEDUPE_JOB,
        TaskType.ANALYZE_SPONSORSHIP,
        TaskType.SCORE_JOB,
        TaskType.TAILOR_RESUME,
        TaskType.PREPARE_APPLICATION,
        TaskType.SCHEDULE_OUTREACH,
        TaskType.MATCH_RECRUITER,
        TaskType.GENERATE_HOOK,
        TaskType.CREATE_GMAIL_DRAFT,
    }
)


def is_pipeline_task(task_type: TaskType) -> bool:
    return task_type in PIPELINE_TASKS


@dataclass(frozen=True, slots=True)
class GateResult:
    """Why the pipeline is or is not allowed to run."""

    open: bool
    #: Human-readable, shown on the dashboard. Empty when the gate is open.
    reason: str = ""

    def __bool__(self) -> bool:
        return self.open


def check_gate(session: Session, settings: Settings) -> GateResult:
    """Whether pipeline work may proceed right now."""
    if not settings.pipeline_enabled:
        return GateResult(False, "PIPELINE_ENABLED is false — the pipeline is paused.")

    if settings.base_resume_status != "READY":
        return GateResult(
            False,
            "BASE_RESUME_STATUS is not READY — set it once a base resume is imported.",
        )

    # The declaration above says a resume is ready; this asks the database
    # whether one exists. Both have to agree. Specifically a BASE resume: a
    # TAILORED row is an output of the pipeline, not something to tailor from,
    # and counting one would let the gate open on its own past work.
    base = session.scalars(
        select(ResumeVersion).where(ResumeVersion.kind == "BASE").limit(1)
    ).first()
    if base is None:
        return GateResult(
            False,
            "BASE_RESUME_STATUS says READY but no base resume has been imported. "
            "Run: internship-ops import-resume",
        )

    return GateResult(True)
