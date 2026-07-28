"""Anthropic provider (spec §11.6, §26.2).

Uses a single forced tool call to get structured output. The alternative — asking
for JSON in the prompt and parsing the reply — fails in exactly the cases that
matter most: a model that hedges, apologises, or wraps its answer in prose still
produces a syntactically valid response, and the parse either throws or, worse,
succeeds on something the model did not mean.

The SDK is imported lazily so the base install stays free of it: development, the
test suite and any deployment running ``LLM_PROVIDER=null`` never need it.
"""

from __future__ import annotations

from typing import Any, Final

from pydantic import BaseModel

from app.services.llm.base import (
    BudgetLedger,
    LLMError,
    LLMProvider,
    Message,
    ModelPricing,
)

__all__ = ["DEFAULT_PRICING", "AnthropicProvider", "build_provider"]

#: USD per million tokens. Prices change; §26.2 requires these be configuration
#: the operator reviews rather than constants buried in logic. They live here as
#: a default so a fresh install reports *some* cost rather than zero, which would
#: read as "free" on the budget page.
DEFAULT_PRICING: Final[dict[str, ModelPricing]] = {
    "claude-haiku-4-5-20251001": ModelPricing(input_per_mtok=1.00, output_per_mtok=5.00),
    "claude-sonnet-5": ModelPricing(input_per_mtok=3.00, output_per_mtok=15.00),
}

_TOOL_NAME: Final = "record_result"


class AnthropicProvider(LLMProvider):
    """Structured generation against the Anthropic Messages API."""

    def __init__(
        self,
        *,
        api_key: str,
        classification_model: str,
        writing_model: str,
        budget: BudgetLedger,
        pricing: dict[str, ModelPricing] | None = None,
        max_retries: int = 2,
    ) -> None:
        super().__init__(
            classification_model=classification_model,
            writing_model=writing_model,
            budget=budget,
            pricing=pricing or DEFAULT_PRICING,
        )
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
            # The SDK retries idempotent failures itself; letting it do so is
            # better than burying a retry inside the task queue, where each
            # attempt would re-run the whole handler.
            self._client = Anthropic(api_key=self._api_key, max_retries=self._max_retries)
        return self._client

    def _generate[T: BaseModel](
        self,
        *,
        model: str,
        schema: type[T],
        messages: list[Message],
        max_tokens: int,
    ) -> tuple[Any, int, int]:
        system = "\n\n".join(m.content for m in messages if m.role == "system")
        turns = [
            {"role": m.role, "content": m.content} for m in messages if m.role != "system"
        ]

        response = self.client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system or "You produce structured results only.",
            messages=turns,
            tools=[
                {
                    "name": _TOOL_NAME,
                    "description": f"Record the result as {schema.__name__}.",
                    "input_schema": schema.model_json_schema(),
                }
            ],
            # Forced, so there is no path where the model answers in prose and
            # the caller has to guess whether that counts as a result.
            tool_choice={"type": "tool", "name": _TOOL_NAME},
        )

        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and block.name == _TOOL_NAME:
                return (
                    block.input,
                    response.usage.input_tokens,
                    response.usage.output_tokens,
                )

        raise LLMError(
            f"{model} returned no {_TOOL_NAME} call "
            f"(stop_reason={getattr(response, 'stop_reason', 'unknown')})"
        )


def build_provider(settings: Any, *, budget: BudgetLedger | None = None) -> LLMProvider:
    """Return the provider named by configuration.

    Defaults to :class:`NullProvider`, so a missing key means "no model calls"
    rather than a crash at the first classification — and so no test run or
    development session can bill the user by accident.
    """
    from app.services.llm.base import NullProvider

    ledger = budget or BudgetLedger(monthly_cap_usd=settings.llm_monthly_budget_usd)

    if settings.llm_provider != "anthropic":
        return NullProvider(budget=ledger)
    if settings.anthropic_api_key is None:
        raise LLMError("llm_provider=anthropic but ANTHROPIC_API_KEY is not set")

    return AnthropicProvider(
        api_key=settings.anthropic_api_key.get_secret_value(),
        classification_model=settings.llm_classification_model,
        writing_model=settings.llm_writing_model,
        budget=ledger,
    )
