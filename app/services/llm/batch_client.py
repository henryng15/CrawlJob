"""Talking to the Anthropic Batch API (spec §7.7).

Thin on purpose. Everything that decides anything — what a batch costs, whether
it is affordable, which result belongs to which application — lives in
:mod:`app.services.llm.batch` where it can be tested without a network. This
module only turns those decisions into calls, so the part that cannot be tested
against the real service is the part with no logic in it.

The SDK is imported lazily, like the synchronous provider, so an install running
``LLM_PROVIDER=null`` never needs the package.
"""

from __future__ import annotations

import logging
from typing import Any, Final

from app.services.llm.base import LLMError
from app.services.llm.batch import (
    BatchOutcome,
    BatchRequest,
    BatchStatus,
    build_requests,
    outcome_from,
)

__all__ = ["TOOL_NAME", "AnthropicBatchClient"]

log = logging.getLogger(__name__)

TOOL_NAME: Final = "record_result"


class AnthropicBatchClient:
    """Submit, poll and retrieve. Nothing else."""

    def __init__(self, *, api_key: str, max_retries: int = 2) -> None:
        self._api_key = api_key
        self._max_retries = max_retries
        self._client: Any = None

    @property
    def client(self) -> Any:
        if self._client is None:
            try:
                from anthropic import Anthropic
            except ImportError as exc:  # pragma: no cover - depends on install
                raise LLMError(
                    "The anthropic package is not installed. Run: uv sync --extra llm"
                ) from exc
            self._client = Anthropic(api_key=self._api_key, max_retries=self._max_retries)
        return self._client

    def submit(
        self,
        requests: list[BatchRequest],
        *,
        model: str,
        schema: dict[str, Any],
        system: list[dict[str, Any]] | None = None,
    ) -> str:
        """Create a batch and return its id.

        ``system`` is passed through as a content-block list so the caller can
        mark the shared part of the prompt with ``cache_control``. Caching is
        best-effort by design (§26.2): a cache miss costs the full rate and the
        batch still succeeds, so nothing here depends on getting a hit.
        """
        build_requests(requests)  # validates the custom_ids before anything is sent

        payload = [
            {
                "custom_id": item.custom_id,
                "params": {
                    "model": model,
                    "max_tokens": item.max_tokens,
                    **({"system": system} if system else {}),
                    "messages": item.messages,
                    "tools": [
                        {
                            "name": TOOL_NAME,
                            "description": "Record the tailoring plan.",
                            "input_schema": schema,
                        }
                    ],
                    # Forced, so there is no path where the model writes prose and
                    # the caller has to guess whether that counts as a plan.
                    "tool_choice": {"type": "tool", "name": TOOL_NAME},
                },
            }
            for item in requests
        ]

        batch = self.client.messages.batches.create(requests=payload)
        batch_id = str(getattr(batch, "id", "") or "")
        if not batch_id:
            raise LLMError("the Batch API accepted the request but returned no batch id")
        log.info("submitted a tailoring batch of %d request(s)", len(requests))
        return batch_id

    def status(self, batch_id: str) -> BatchStatus:
        batch = self.client.messages.batches.retrieve(batch_id)
        counts = getattr(batch, "request_counts", None)
        return BatchStatus(
            batch_id=batch_id,
            processing_status=str(getattr(batch, "processing_status", "unknown")),
            succeeded=int(getattr(counts, "succeeded", 0) or 0),
            errored=int(getattr(counts, "errored", 0) or 0),
            canceled=int(getattr(counts, "canceled", 0) or 0),
            expired=int(getattr(counts, "expired", 0) or 0),
        )

    def results(self, batch_id: str) -> BatchOutcome:
        """Everything the batch produced, folded and keyed by ``custom_id``.

        The iterator is consumed whole rather than zipped against anything: the
        order it yields in is not the order the requests went out in.
        """
        return outcome_from(self.client.messages.batches.results(batch_id))

    def cancel(self, batch_id: str) -> str:
        batch = self.client.messages.batches.cancel(batch_id)
        return str(getattr(batch, "processing_status", "unknown"))
