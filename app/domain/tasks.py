"""Task vocabulary and idempotency keys (spec §16.4, §16.5).

Kept separate from the ORM models so the queue's vocabulary can be imported by
code that has no database connection.
"""

from __future__ import annotations

from enum import StrEnum

__all__ = ["TaskStatus", "TaskType", "idempotency_key"]


class TaskType(StrEnum):
    DISCOVER_SOURCE = "DISCOVER_SOURCE"
    SCORE_JOB = "SCORE_JOB"
    #: Attach the resume and decide which lane the application takes.
    PREPARE_APPLICATION = "PREPARE_APPLICATION"
    #: Open the form, fill it, and submit it — or hand it over. The only task
    #: type that needs a browser.
    SUBMIT_APPLICATION = "SUBMIT_APPLICATION"
    BACKUP_DATABASE = "BACKUP_DATABASE"
    BACKUP_ARTIFACTS = "BACKUP_ARTIFACTS"


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
