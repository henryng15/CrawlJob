"""Resume tailoring through the Anthropic Batch API (spec §7.7, §26.2).

Tailoring is the only task worth a strong model, and it is also the only one
nobody is waiting on: the user asked for thirty applications by the morning, not
for this one in four seconds. That makes it exactly what a batch is for, and the
50% discount is the difference between fitting in fifteen dollars a month and
not.

Three properties this module exists to guarantee.

**Results are matched by ``custom_id``, never by order.** The API returns
results in whatever order it finishes them, which is not the order they were
submitted. Zipping the two lists would silently give one applicant another's
tailored resume — a failure that produces plausible output and would be found by
the user, at the worst possible moment. Every result is looked up by its key, and
a request whose key never comes back is reported rather than skipped.

**Every step is idempotent.** Submitting is guarded by a stored row, so a retried
task adopts the batch that is already running instead of paying twice. Polling
and retrieval are pure reads. Applying a result checks whether that application
already has its tailored resume.

**The cap is checked before submitting, not after.** A batch is charged as a
whole; discovering it was unaffordable once the results arrive is discovering it
too late.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Final

from app.services.llm.base import (
    BudgetExceeded,
    BudgetLedger,
    LLMError,
    ModelPricing,
    Task,
)

__all__ = [
    "BATCH_DISCOUNT",
    "BatchOutcome",
    "BatchRequest",
    "BatchStatus",
    "estimate_cost",
    "match_results",
    "outcome_from",
    "parse_results",
]

log = logging.getLogger(__name__)

#: The Batch API bills at half the synchronous rate. Applied to the estimate as
#: well as to the charge, so the pre-flight check and the bill agree.
BATCH_DISCOUNT: Final = 0.5

_TOOL_NAME: Final = "record_result"


@dataclass(frozen=True, slots=True)
class BatchRequest:
    """One tailoring job inside a batch.

    ``custom_id`` is the application id. It is the only thing tying a result back
    to the work that asked for it, so it is required to be non-empty and unique
    within a batch — both enforced in :func:`build_requests`.
    """

    custom_id: str
    messages: list[dict[str, str]]
    max_tokens: int = 4096
    #: Rough input size, for the pre-flight estimate only. The real number comes
    #: back with the results.
    estimated_input_tokens: int = 0


@dataclass(frozen=True, slots=True)
class BatchStatus:
    """Where a submitted batch has got to."""

    batch_id: str
    processing_status: str
    succeeded: int = 0
    errored: int = 0
    canceled: int = 0
    expired: int = 0

    @property
    def finished(self) -> bool:
        return self.processing_status == "ended"


@dataclass(frozen=True, slots=True)
class BatchOutcome:
    """What came back, keyed by ``custom_id``."""

    results: dict[str, Any] = field(default_factory=dict)
    errors: dict[str, str] = field(default_factory=dict)
    input_tokens: int = 0
    output_tokens: int = 0

    def cost(self, pricing: ModelPricing | None) -> float:
        if pricing is None:
            return 0.0
        return pricing.cost(self.input_tokens, self.output_tokens) * BATCH_DISCOUNT


# ------------------------------------------------------------------ build


def build_requests(items: list[BatchRequest]) -> list[dict[str, Any]]:
    """Validate the keys and shape the payload the API expects.

    Raises rather than de-duplicating a repeated ``custom_id``: two requests
    sharing a key means the caller has a bug, and the batch would come back with
    one result where two were expected — silently dropping somebody's resume.
    """
    seen: set[str] = set()
    for item in items:
        if not item.custom_id:
            raise LLMError("every batch request needs a custom_id")
        if item.custom_id in seen:
            raise LLMError(f"duplicate custom_id in batch: {item.custom_id}")
        seen.add(item.custom_id)
    return [{"custom_id": item.custom_id} for item in items]


def estimate_cost(
    items: list[BatchRequest], pricing: ModelPricing | None
) -> float:
    """What this batch will cost, at batch rates, before it is submitted.

    Output is estimated at ``max_tokens`` — the worst case. Under-estimating here
    would let a batch through that takes the month past its cap, and the whole
    point of checking first is that a batch cannot be un-submitted.
    """
    if pricing is None:
        return 0.0
    input_tokens = sum(item.estimated_input_tokens for item in items)
    output_tokens = sum(item.max_tokens for item in items)
    return pricing.cost(input_tokens, output_tokens) * BATCH_DISCOUNT


def check_affordable(
    ledger: BudgetLedger, items: list[BatchRequest], pricing: ModelPricing | None
) -> float:
    """Raise unless this whole batch fits inside what is left of the cap.

    Stricter than :meth:`BudgetLedger.check`, which asks whether *a* call may run.
    A batch is charged as one thing, so the question is whether the estimate fits
    in the remaining budget — not whether the budget is merely non-zero.

    Returns the estimate, so the caller can record what it expected to pay
    alongside what it actually paid.
    """
    ledger.check(Task.RESUME_PLAN)
    estimate = estimate_cost(items, pricing)
    remaining = ledger.monthly_cap_usd - ledger.spent_usd
    if estimate > remaining:
        raise BudgetExceeded(
            f"This batch of {len(items)} would cost about ${estimate:.2f}, and only "
            f"${remaining:.2f} of the ${ledger.monthly_cap_usd:.2f} monthly cap is "
            f"left. It was not submitted."
        )
    return estimate


# ---------------------------------------------------------------- results


def match_results(
    requests: list[BatchRequest], outcome: BatchOutcome
) -> tuple[dict[str, Any], list[str]]:
    """Line results up with the requests that asked for them.

    Returns ``(matched, missing)`` where ``matched`` maps ``custom_id`` to its
    payload and ``missing`` lists the ids that never came back.

    This function is the whole reason the module exists. It does the lookup by
    key and nothing else — in particular it never indexes either list by
    position, because the API makes no promise about order and the bug that
    creates is invisible in testing and catastrophic in use.
    """
    matched = {
        item.custom_id: outcome.results[item.custom_id]
        for item in requests
        if item.custom_id in outcome.results
    }
    missing = [
        item.custom_id
        for item in requests
        if item.custom_id not in outcome.results
    ]
    return matched, missing


def parse_results(lines: list[str] | str) -> BatchOutcome:
    """Read the JSONL a completed batch produces.

    Accepts the raw text or the already-split lines. Malformed lines are skipped
    with a warning rather than failing the whole retrieval: one unreadable result
    must not cost the other twenty-nine.
    """
    if isinstance(lines, str):
        lines = lines.splitlines()

    records: list[dict[str, Any]] = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            log.warning("skipping an unparseable line in a batch result file")
    return outcome_from(records)


def outcome_from(records: Iterable[Any]) -> BatchOutcome:
    """Fold result records into one :class:`BatchOutcome`.

    Takes plain dictionaries or the SDK's result objects — anything the SDK
    returns is normalised first — so the parsing rules live in one place rather
    than being written twice and drifting.
    """
    results: dict[str, Any] = {}
    errors: dict[str, str] = {}
    input_tokens = 0
    output_tokens = 0

    for raw in records:
        record = _as_dict(raw)
        custom_id = record.get("custom_id")
        if not custom_id:
            log.warning("skipping a batch result with no custom_id")
            continue

        result = _as_dict(record.get("result"))
        kind = result.get("type")
        if kind != "succeeded":
            errors[custom_id] = str(
                _as_dict(result.get("error")).get("type", kind or "unknown")
            )
            continue

        message = _as_dict(result.get("message"))
        usage = _as_dict(message.get("usage"))
        input_tokens += int(usage.get("input_tokens", 0))
        output_tokens += int(usage.get("output_tokens", 0))

        payload = _tool_input(message)
        if payload is None:
            errors[custom_id] = "no tool call in the response"
            continue
        results[custom_id] = payload

    return BatchOutcome(
        results=results,
        errors=errors,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


def _as_dict(value: Any) -> dict[str, Any]:
    """Normalise an SDK result object into a plain dictionary.

    The SDK returns Pydantic models; the raw result file gives dictionaries. Both
    describe the same thing, and the rest of this module should not have to know
    which one it was handed.
    """
    if isinstance(value, dict):
        return value
    for method in ("model_dump", "to_dict", "dict"):
        dump = getattr(value, method, None)
        if callable(dump):
            result = dump()
            if isinstance(result, dict):
                return result
    return {}


def _tool_input(message: dict[str, Any]) -> Any | None:
    for raw in message.get("content") or []:
        block = _as_dict(raw)
        if block.get("type") == "tool_use" and block.get("name") == _TOOL_NAME:
            return block.get("input")
    return None


def is_stale(submitted_at: datetime, *, now: datetime, timeout_hours: int) -> bool:
    """Whether a batch has been running long enough to give up on.

    A batch that never ends would otherwise be polled forever, and the
    applications waiting on it would never be prepared. Abandoning is a decision
    the user can see, which polling silently is not.
    """
    return now - submitted_at > timedelta(hours=timeout_hours)
