"""Groq provider for the high-volume structured tasks (spec §11.6).

Most of what this system asks a model is classification: does this posting
mention sponsorship, how well does this role fit, what does this form field
want. There are hundreds of those a day and none of them are writing. Sending
them to Groq keeps the Anthropic budget for the one task where the quality of
the prose is the product — tailoring a resume.

Spoken over Groq's OpenAI-compatible endpoint with ``httpx`` rather than through
an SDK. ``httpx`` is already a dependency (the discovery adapters use it), the
request shape is a documented wire format rather than a library's API, and it
keeps one fewer package in an install that has to fit on a free-tier VM.

Structure comes from a forced tool call, the same technique and for the same
reason as the Anthropic provider: asking for JSON in the prompt fails exactly
when it matters, because a model that hedges still returns something that parses.

**No key and no prompt content is ever logged.** Errors carry the status code and
the model name; the request body carries a job description and, for form
answers, the user's own details.
"""

from __future__ import annotations

import json
from typing import Any, Final

import httpx
from pydantic import BaseModel

from app.services.llm.base import (
    BudgetLedger,
    LLMError,
    LLMProvider,
    Message,
    ModelPricing,
)

__all__ = ["DEFAULT_PRICING", "GROQ_TASKS", "GroqProvider"]

#: USD per million tokens. Configuration, not constants (§26.2) — Groq's prices
#: are low enough that the practical effect is to keep the Anthropic cap intact,
#: but a spend the system reports as zero would read as free.
DEFAULT_PRICING: Final[dict[str, ModelPricing]] = {
    "llama-3.3-70b-versatile": ModelPricing(input_per_mtok=0.59, output_per_mtok=0.79),
    "llama-3.1-8b-instant": ModelPricing(input_per_mtok=0.05, output_per_mtok=0.08),
}

#: The tasks routed here: high volume, structured output, no prose worth paying
#: for. RESUME_PLAN, EMAIL_HOOK and EMAIL_BODY are deliberately absent.
GROQ_TASKS: Final[frozenset[str]] = frozenset(
    {"JD_EXTRACTION", "SPONSORSHIP", "SCORING", "FORM_ANSWER", "VALIDATION"}
)

_ENDPOINT: Final = "https://api.groq.com/openai/v1/chat/completions"
_TOOL_NAME: Final = "record_result"


class GroqProvider(LLMProvider):
    """Structured generation against Groq's OpenAI-compatible API."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        budget: BudgetLedger,
        pricing: dict[str, ModelPricing] | None = None,
        timeout: float = 30.0,
        client: httpx.Client | None = None,
    ) -> None:
        super().__init__(
            # One model for every task here: they are all the same kind of work,
            # and a second knob would only be a second thing to get wrong.
            classification_model=model,
            writing_model=model,
            budget=budget,
            pricing=pricing or DEFAULT_PRICING,
        )
        self._api_key = api_key
        self._timeout = timeout
        self._client = client

    @property
    def client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(timeout=self._timeout)
        return self._client

    def _generate[T: BaseModel](
        self,
        *,
        model: str,
        schema: type[T],
        messages: list[Message],
        max_tokens: int,
    ) -> tuple[Any, ...]:
        payload = {
            "model": model,
            "max_tokens": max_tokens,
            # Deterministic by request. These are classifications, and the same
            # posting scored twice should not produce two different answers.
            "temperature": 0.0,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": _TOOL_NAME,
                        "description": f"Record the result as {schema.__name__}.",
                        "parameters": schema.model_json_schema(),
                    },
                }
            ],
            "tool_choice": {"type": "function", "function": {"name": _TOOL_NAME}},
        }

        try:
            response = self.client.post(
                _ENDPOINT,
                json=payload,
                headers={"Authorization": f"Bearer {self._api_key}"},
            )
        except httpx.HTTPError as exc:
            # type(exc) rather than str(exc): httpx puts the request URL in the
            # message, and the URL is the one place the key could surface.
            raise LLMError(f"Groq request failed: {type(exc).__name__}") from exc

        if response.status_code != 200:
            raise LLMError(f"Groq returned HTTP {response.status_code} for {model}")

        return _parse(response.json(), model=model, schema_name=schema.__name__)


def _parse(body: dict[str, Any], *, model: str, schema_name: str) -> tuple[Any, ...]:
    """Pull the tool arguments and the token counts out of a response.

    Every failure here raises :class:`LLMError`, which the call sites already
    treat as "fall back to the deterministic answer" — so a Groq outage degrades
    the pipeline rather than stopping it.
    """
    usage = body.get("usage") or {}
    input_tokens = int(usage.get("prompt_tokens", 0))
    output_tokens = int(usage.get("completion_tokens", 0))

    choices = body.get("choices") or []
    if not choices:
        raise LLMError(f"Groq returned no choices for {model}")

    calls = (choices[0].get("message") or {}).get("tool_calls") or []
    for call in calls:
        function = call.get("function") or {}
        if function.get("name") != _TOOL_NAME:
            continue
        arguments = function.get("arguments")
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except json.JSONDecodeError as exc:
                raise LLMError(
                    f"Groq returned unparseable arguments for {schema_name}"
                ) from exc
        return arguments, input_tokens, output_tokens

    raise LLMError(f"Groq returned no {_TOOL_NAME} call for {schema_name}")
