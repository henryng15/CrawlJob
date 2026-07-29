"""Task vocabulary and idempotency keys (spec §16.4, §16.5).

Kept separate from the ORM models so the queue's vocabulary can be imported by
code that has no database connection.
"""

from __future__ import annotations

from enum import StrEnum

__all__ = ["TaskStatus", "TaskType", "idempotency_key"]


class TaskType(StrEnum):
    DISCOVER_SOURCE = "DISCOVER_SOURCE"
    ENRICH_JOB = "ENRICH_JOB"
    DEDUPE_JOB = "DEDUPE_JOB"
    ANALYZE_SPONSORSHIP = "ANALYZE_SPONSORSHIP"
    SCORE_JOB = "SCORE_JOB"
    TAILOR_RESUME = "TAILOR_RESUME"
    PREPARE_APPLICATION = "PREPARE_APPLICATION"
    REPLAY_APPLICATION = "REPLAY_APPLICATION"
    RECONCILE_SUBMISSION = "RECONCILE_SUBMISSION"
    SCHEDULE_OUTREACH = "SCHEDULE_OUTREACH"
    MATCH_RECRUITER = "MATCH_RECRUITER"
    GENERATE_HOOK = "GENERATE_HOOK"
    CREATE_GMAIL_DRAFT = "CREATE_GMAIL_DRAFT"
    RECONCILE_GMAIL = "RECONCILE_GMAIL"
    BACKUP_DATABASE = "BACKUP_DATABASE"
    BACKUP_ARTIFACTS = "BACKUP_ARTIFACTS"
    CLEANUP_EXPIRED_SESSION = "CLEANUP_EXPIRED_SESSION"
    EXPIRE_PREPARED_APPLICATIONS = "EXPIRE_PREPARED_APPLICATIONS"
    RESTORE_APPLICATION = "RESTORE_APPLICATION"


class TaskStatus(StrEnum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    #: Exhausted max_attempts. Requires a human decision; never retried
    #: automatically, so a broken adapter cannot burn the LLM budget overnight.
    DEAD = "DEAD"
    CANCELLED = "CANCELLED"


def idempotency_key(task_type: TaskType, *parts: str | None) -> str:
    """Build the deduplication key for a task (§16.5).

    Every input that changes the *meaning* of the work must appear, or a rerun
    after a prompt change would be silently skipped. Conversely, nothing that
    varies per attempt may appear, or retries would create new rows.

    Empty components are kept as empty segments rather than dropped, so
    ``("a", None, "b")`` and ``("a", "b")`` never collide.
    """
    return ":".join([task_type.value, *(p or "" for p in parts)])
