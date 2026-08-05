"""LLM provider abstraction and budget enforcement (spec §11.6, §26.2).

Three rules shape this module.

**Structured output only.** Every call names a Pydantic schema and gets back a
validated instance. Free-form text from a model is never trusted (§0.9): if it
does not parse, it did not happen.

**The budget is a hard stop.** §26.2 sets thresholds at 70%, 90% and 100% of a
monthly cap. At 100% the provider refuses rather than degrading, because the
failure this prevents — a retry loop quietly spending the month's budget
overnight — is silent by nature.

**A null provider is the default.** Development and the entire test suite run
without an API key, so nothing can accidentally bill the user during a test run.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ValidationError

__all__ = [
    "BudgetExceeded",
    "BudgetLedger",
    "BudgetState",
    "LLMError",
    "LLMProvider",
    "LLMResponse",
    "Message",
    "ModelPricing",
    "NullProvider",
    "SchemaValidationError",
    "Task",
    "TokenCounts",
    "Usage",
]


class LLMError(RuntimeError):
    """Any provider-side failure."""


class SchemaValidationError(LLMError):
    """The model returned something that does not match the requested schema."""


class BudgetExceeded(LLMError):
    """The monthly cap has been reached. Requires a human decision to continue."""


class Task(StrEnum):
    """What a call is for. Drives model selection (§11.6) and cost attribution."""

    JD_EXTRACTION = "JD_EXTRACTION"
    SPONSORSHIP = "SPONSORSHIP"
    SCORING = "SCORING"
    RESUME_PLAN = "RESUME_PLAN"
    EMAIL_HOOK = "EMAIL_HOOK"
    EMAIL_BODY = "EMAIL_BODY"
    VALIDATION = "VALIDATION"


#: Which model class each task uses. Cheap models for classification, a stronger
#: one only for resume writing, per §11.6.
_WRITING_TASKS = frozenset({Task.RESUME_PLAN, Task.EMAIL_BODY})


@dataclass(frozen=True, slots=True)
class Message:
    role: str
    content: str


@dataclass(frozen=True, slots=True)
class ModelPricing:
    """USD per million tokens.

    Prices change and must never be hard-coded into logic (§26.2); this is
    configuration that the caller supplies and the operator reviews.
    """

    input_per_mtok: float
    output_per_mtok: float

    def cost(self, input_tokens: int, output_tokens: int) -> float:
        return (
            input_tokens * self.input_per_mtok + output_tokens * self.output_per_mtok
        ) / 1_000_000


@dataclass(frozen=True, slots=True)
class TokenCounts:
    """What one call consumed.

    Cache figures are best-effort (§26.2): providers that do not report them
    leave the fields at zero, and nothing in the budget depends on a cache hit
    ever happening. They are recorded so the saving can be *observed* rather than
    assumed.
    """

    input_tokens: int = 0
    output_tokens: int = 0
    #: Input tokens served from a prompt cache, billed at a fraction of the rate.
    cache_read_tokens: int = 0
    #: Input tokens written into the cache, billed at slightly above the rate.
    cache_write_tokens: int = 0


@dataclass(frozen=True, slots=True)
class Usage:
    """A single charge, in enough detail to answer "where did the money go".

    Recorded per call so the monthly total can be broken down by task and model
    rather than being one opaque number.
    """

    model: str
    task: Task
    tokens: TokenCounts
    cost_usd: float
    #: True when this came from the Batch API, which bills at half rate.
    batch: bool = False


@dataclass(frozen=True, slots=True)
class LLMResponse[T: BaseModel]:
    value: T
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: float
    tokens: TokenCounts = TokenCounts()


class BudgetState(StrEnum):
    OK = "OK"
    #: 70%: warn on the dashboard (§26.2).
    WARNING = "WARNING"
    #: 90%: stop optional work such as regenerating a resume the user already has.
    RESTRICTED = "RESTRICTED"
    #: 100%: stop entirely.
    EXHAUSTED = "EXHAUSTED"


@dataclass(slots=True)
class BudgetLedger:
    """Tracks spend against a monthly cap.

    Deliberately in-memory-plus-callback rather than reading the database on every
    call: the ledger is consulted before each request, and a query there would put
    the database on the critical path of every classification.
    """

    monthly_cap_usd: float
    spent_usd: float = 0.0
    month: date | None = None
    #: Called after each charge so the caller can persist the running total.
    on_charge: Any = None
    #: Tasks still permitted at RESTRICTED. Anything the user is waiting on.
    essential_tasks: frozenset[Task] = field(
        default_factory=lambda: frozenset(
            {Task.SPONSORSHIP, Task.SCORING, Task.JD_EXTRACTION, Task.VALIDATION}
        )
    )
    #: Permitted at RESTRICTED but *rationed* — the caller narrows how much work
    #: it does rather than being refused outright. §26.2's 90% tier is "tailor
    #: only the top-scoring roles", not "stop tailoring": a user at 91% of their
    #: cap still wants their three best applications written.
    rationed_tasks: frozenset[Task] = field(
        default_factory=lambda: frozenset({Task.RESUME_PLAN})
    )
    #: How many applications may still be tailored at RESTRICTED.
    restricted_tailoring_limit: int = 5

    @property
    def fraction_used(self) -> float:
        if self.monthly_cap_usd <= 0:
            return 1.0
        return self.spent_usd / self.monthly_cap_usd

    @property
    def state(self) -> BudgetState:
        used = self.fraction_used
        if used >= 1.0:
            return BudgetState.EXHAUSTED
        if used >= 0.9:
            return BudgetState.RESTRICTED
        if used >= 0.7:
            return BudgetState.WARNING
        return BudgetState.OK

    def check(self, task: Task) -> None:
        """Raise if ``task`` may not run under the current budget state."""
        state = self.state
        if state is BudgetState.EXHAUSTED:
            raise BudgetExceeded(
                f"Monthly LLM budget of ${self.monthly_cap_usd:.2f} is spent "
                f"(${self.spent_usd:.2f}). Raise the cap or wait for the next month."
            )
        if (
            state is BudgetState.RESTRICTED
            and task not in self.essential_tasks
            and task not in self.rationed_tasks
        ):
            raise BudgetExceeded(
                f"At {self.fraction_used:.0%} of the monthly budget, only essential "
                f"tasks run. {task.value} was deferred."
            )

    def tailoring_limit(self, default: int) -> int:
        """How many applications may be tailored right now.

        The whole degradation ladder in one function, so the tiers cannot be
        re-implemented differently in two places:

        * **OK / WARNING** — the caller's own limit. 70% is a warning on the
          dashboard, not a change in behaviour.
        * **RESTRICTED** — a handful, and the caller is expected to pick the
          highest-scoring ones. Spending the last tenth of the budget on the ten
          best roles is worth more than spreading it over thirty.
        * **EXHAUSTED** — none. Everything downstream still runs deterministically;
          it just runs without a model.
        """
        state = self.state
        if state is BudgetState.EXHAUSTED:
            return 0
        if state is BudgetState.RESTRICTED:
            return min(default, self.restricted_tailoring_limit)
        return default

    @property
    def remaining_usd(self) -> float:
        return max(0.0, self.monthly_cap_usd - self.spent_usd)

    def charge(self, amount_usd: float, usage: Usage | None = None) -> None:
        """Record a charge, and hand the detail to whatever persists it.

        ``usage`` is optional so a caller that only knows the amount can still
        charge — but every provider in this codebase supplies it, because
        "$4.20 this month" is not an answer to "on what?".
        """
        self.spent_usd += amount_usd
        if self.on_charge is not None:
            self.on_charge(amount_usd, self.spent_usd, usage)


class LLMProvider(ABC):
    """Base provider. Subclasses implement :meth:`_generate`."""

    def __init__(
        self,
        *,
        classification_model: str,
        writing_model: str,
        budget: BudgetLedger,
        pricing: dict[str, ModelPricing] | None = None,
    ) -> None:
        self.classification_model = classification_model
        self.writing_model = writing_model
        self.budget = budget
        self.pricing = pricing or {}

    def model_for(self, task: Task) -> str:
        return self.writing_model if task in _WRITING_TASKS else self.classification_model

    def structured_generate[T: BaseModel](
        self,
        *,
        task: Task,
        schema: type[T],
        messages: list[Message],
        max_tokens: int = 2048,
    ) -> LLMResponse[T]:
        """Run one call and return a validated instance of ``schema``.

        Raises:
            BudgetExceeded: before contacting the provider, so a spent budget
                costs nothing.
            SchemaValidationError: when the response does not match the schema.
        """
        self.budget.check(task)
        model = self.model_for(task)

        raw, input_tokens, output_tokens, *rest = self._generate(
            model=model, schema=schema, messages=messages, max_tokens=max_tokens
        )
        # A provider that reports cache figures returns them as a fourth element.
        # Optional so the three-tuple contract older providers use still holds.
        tokens: TokenCounts = (
            rest[0]
            if rest and isinstance(rest[0], TokenCounts)
            else TokenCounts(input_tokens=input_tokens, output_tokens=output_tokens)
        )

        pricing = self.pricing.get(model)
        cost = pricing.cost(input_tokens, output_tokens) if pricing else 0.0
        self.budget.charge(
            cost, Usage(model=model, task=task, tokens=tokens, cost_usd=cost)
        )

        try:
            value = schema.model_validate(raw)
        except ValidationError as exc:
            raise SchemaValidationError(
                f"{model} returned a payload that does not match {schema.__name__}: {exc}"
            ) from exc

        return LLMResponse(
            value=value,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost,
            tokens=tokens,
        )

    @abstractmethod
    def _generate[T: BaseModel](
        self,
        *,
        model: str,
        schema: type[T],
        messages: list[Message],
        max_tokens: int,
    ) -> tuple[Any, ...]:
        """Return ``(raw_payload, input_tokens, output_tokens)``.

        A provider that knows its cache figures may append a fourth element, a
        :class:`TokenCounts`. Optional because not every provider reports them,
        and a cache is a saving rather than a requirement.
        """


class NullProvider(LLMProvider):
    """A provider that makes no network calls.

    The default outside production. Returns queued canned payloads, so pipeline
    code can be exercised end to end without an API key and without cost. Running
    out of canned responses raises rather than inventing one, which keeps a test
    from passing on data nobody wrote.
    """

    def __init__(
        self,
        responses: list[Any] | None = None,
        *,
        classification_model: str = "null-classification",
        writing_model: str = "null-writing",
        budget: BudgetLedger | None = None,
    ) -> None:
        super().__init__(
            classification_model=classification_model,
            writing_model=writing_model,
            budget=budget or BudgetLedger(monthly_cap_usd=1_000.0),
        )
        self.responses = list(responses or [])
        self.calls: list[tuple[Task, str, list[Message]]] = []

    def queue(self, payload: Any) -> None:
        self.responses.append(payload)

    def _generate[T: BaseModel](
        self,
        *,
        model: str,
        schema: type[T],
        messages: list[Message],
        max_tokens: int,
    ) -> tuple[Any, ...]:
        if not self.responses:
            raise LLMError(
                f"NullProvider has no queued response for {schema.__name__}. "
                "Queue one with .queue(payload) before the call under test."
            )
        payload = self.responses.pop(0)
        return payload, 0, 0

    def structured_generate[T: BaseModel](
        self,
        *,
        task: Task,
        schema: type[T],
        messages: list[Message],
        max_tokens: int = 2048,
    ) -> LLMResponse[T]:
        self.calls.append((task, self.model_for(task), list(messages)))
        return super().structured_generate(
            task=task, schema=schema, messages=messages, max_tokens=max_tokens
        )
