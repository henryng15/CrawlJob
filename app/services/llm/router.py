"""Sending each task to the provider that should answer it (spec §11.6).

Two providers, one rule: classification goes to Groq, writing goes to Anthropic.
The reason is not that Groq is worse — it is that resume prose is the only output
the user reads word for word, and the monthly cap is small enough that spending
it on "does this posting mention sponsorship" would leave nothing for the part
that matters.

**Failure here is not an error.** When Groq is down, over budget, or returns
something unparseable, the router raises :class:`LLMError` like any provider
would, and the call sites — :func:`app.services.scoring.score`,
:func:`app.services.sponsorship.analyze` — already answer deterministically from
their own rules. That is the fallback: not a second model, but the code that was
always there to run without one. A degraded answer the user can see is worth more
than a retry loop against a provider that is not coming back.
"""

from __future__ import annotations

import logging

from pydantic import BaseModel

from app.services.llm.base import (
    BudgetLedger,
    LLMProvider,
    LLMResponse,
    Message,
    Task,
)
from app.services.llm.groq import GROQ_TASKS

__all__ = ["RoutingProvider", "provider_for"]

log = logging.getLogger(__name__)


def provider_for(task: Task) -> str:
    """Which provider should answer ``task``. Names, not objects, so this is
    testable without constructing either provider."""
    return "groq" if task.value in GROQ_TASKS else "anthropic"


class RoutingProvider(LLMProvider):
    """Delegates each call to the provider chosen for its task.

    Both providers share one :class:`BudgetLedger`, so the cap is a cap on total
    spend rather than per-provider — which is what the user set when they said
    fifteen dollars a month.
    """

    def __init__(
        self,
        *,
        classification: LLMProvider,
        writing: LLMProvider,
        budget: BudgetLedger,
    ) -> None:
        super().__init__(
            classification_model=classification.classification_model,
            writing_model=writing.writing_model,
            budget=budget,
        )
        self._classification = classification
        self._writing = writing
        # One ledger, shared. Two would each think they had the whole cap.
        self._classification.budget = budget
        self._writing.budget = budget

    def delegate_for(self, task: Task) -> LLMProvider:
        return self._classification if provider_for(task) == "groq" else self._writing

    def model_for(self, task: Task) -> str:
        return self.delegate_for(task).model_for(task)

    def structured_generate[T: BaseModel](
        self,
        *,
        task: Task,
        schema: type[T],
        messages: list[Message],
        max_tokens: int = 2048,
    ) -> LLMResponse[T]:
        return self.delegate_for(task).structured_generate(
            task=task, schema=schema, messages=messages, max_tokens=max_tokens
        )

    def _generate[T: BaseModel](
        self,
        *,
        model: str,
        schema: type[T],
        messages: list[Message],
        max_tokens: int,
    ) -> tuple[object, int, int]:
        """Never called: :meth:`structured_generate` delegates before reaching here."""
        raise NotImplementedError("RoutingProvider delegates whole calls, not generations")
