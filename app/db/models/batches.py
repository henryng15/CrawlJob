"""Submitted tailoring batches (spec §7.7, §26.2).

The row exists so that submitting is idempotent. A ``SUBMIT_TAILORING_BATCH``
task that is retried — because the worker was killed after the API accepted the
batch but before the transaction committed — must adopt the batch that is
already running rather than paying for a second one. The unique ``dedupe_key``
is what makes that a database guarantee instead of a hope.

It is also the only durable record of what a batch cost. The estimate is stored
at submit time and the actual is written when results are retrieved, so a
divergence between what the cap check believed and what was billed is visible
rather than inferred.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Float, Index, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDMixin

__all__ = ["BatchState", "LLMBatch"]


class BatchState:
    """Lifecycle of a batch, as this system sees it.

    Not a StrEnum with a CHECK constraint because the interesting values come
    from the provider (``in_progress``, ``ended``) and a constraint here would
    turn a new provider status into a crash rather than a row to look at.
    """

    SUBMITTED = "SUBMITTED"
    ENDED = "ENDED"
    #: Results retrieved and applied. Terminal.
    APPLIED = "APPLIED"
    #: Ran past the timeout, or the provider gave up. Terminal.
    ABANDONED = "ABANDONED"


class LLMBatch(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "llm_batches"
    __table_args__ = (
        # The guarantee that one logical submission produces one batch, however
        # many times its task is retried.
        Index("uq_llm_batches_dedupe_key", "dedupe_key", unique=True),
        Index("ix_llm_batches_state", "state"),
    )

    #: Derived from what is being tailored and when — the same inputs that make
    #: the queue's idempotency key, so a retry lands on this row.
    dedupe_key: Mapped[str] = mapped_column(Text, nullable=False)
    #: The provider's id. Null only in the window between reserving the row and
    #: the API answering, which is exactly the window this row exists to cover.
    provider_batch_id: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str] = mapped_column(Text, nullable=False, default=BatchState.SUBMITTED)
    model: Mapped[str] = mapped_column(Text, nullable=False)

    #: The ``custom_id`` of every request in the batch, in submission order.
    #: Results are matched against this by key, never by position.
    custom_ids: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list)

    #: SHA-256 of the base resume the bullet ids in this batch's prompts came
    #: from. A batch can sit for up to a day; if the canonical resume is edited in
    #: the meantime, every id the model was shown may now mean a different
    #: sentence — or nothing. Applying the results anyway would splice text into
    #: whatever now happens to occupy those positions. Checked before the plan is
    #: applied, and a mismatch rejects the plan rather than guessing (§7.7).
    base_tex_sha256: Mapped[str | None] = mapped_column(Text)

    submitted_at: Mapped[datetime | None] = mapped_column()
    completed_at: Mapped[datetime | None] = mapped_column()

    #: What the cap check believed before submitting.
    estimated_cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    #: What it actually came to, from the usage the results carry.
    actual_cost_usd: Mapped[float | None] = mapped_column(Float)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    #: Per-``custom_id`` failure reasons, and the ids that never came back. Never
    #: the prompts or the results themselves — those carry the user's CV (§23.5).
    failures: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    def applications(self) -> list[uuid.UUID]:
        """The application ids this batch was tailoring for."""
        out: list[uuid.UUID] = []
        for raw in self.custom_ids or []:
            try:
                out.append(uuid.UUID(str(raw)))
            except ValueError:
                continue
        return out
