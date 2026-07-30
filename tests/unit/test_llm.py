"""LLM provider abstraction and budget enforcement (spec §11.6, §26.2)."""

from __future__ import annotations

import pytest
from pydantic import BaseModel

from app.services.llm.base import (
    BudgetExceeded,
    BudgetLedger,
    BudgetState,
    LLMError,
    Message,
    ModelPricing,
    NullProvider,
    SchemaValidationError,
    Task,
)


class Answer(BaseModel):
    verdict: str
    score: int


def ledger(cap: float = 10.0, spent: float = 0.0) -> BudgetLedger:
    return BudgetLedger(monthly_cap_usd=cap, spent_usd=spent)


class TestBudgetState:
    @pytest.mark.parametrize(
        ("spent", "expected"),
        [
            (0.0, BudgetState.OK),
            (6.9, BudgetState.OK),
            (7.0, BudgetState.WARNING),
            (8.9, BudgetState.WARNING),
            (9.0, BudgetState.RESTRICTED),
            (9.9, BudgetState.RESTRICTED),
            (10.0, BudgetState.EXHAUSTED),
            (99.0, BudgetState.EXHAUSTED),
        ],
    )
    def test_thresholds_match_the_spec(self, spent, expected):
        """§26.2: warn at 70%, restrict at 90%, stop at 100%."""
        assert ledger(spent=spent).state is expected

    def test_a_zero_cap_is_exhausted_not_unlimited(self):
        """Fail closed: a misconfigured cap must not read as infinite budget."""
        assert BudgetLedger(monthly_cap_usd=0.0).state is BudgetState.EXHAUSTED


class TestBudgetCheck:
    def test_everything_runs_when_under_budget(self):
        book = ledger(spent=1.0)
        for task in Task:
            book.check(task)

    def test_nothing_runs_when_exhausted(self):
        book = ledger(spent=10.0)
        for task in Task:
            with pytest.raises(BudgetExceeded, match="is spent"):
                book.check(task)

    def test_restricted_defers_optional_work(self):
        """At 90% the user's queue still moves; optional writing waits."""
        book = ledger(spent=9.5)
        book.check(Task.SPONSORSHIP)
        book.check(Task.SCORING)
        with pytest.raises(BudgetExceeded, match="deferred"):
            book.check(Task.EMAIL_BODY)

    def test_restricted_rations_tailoring_rather_than_stopping_it(self):
        """§26.2's 90% tier is "tailor only the top-scoring", not "stop".

        A user at 91% of their cap still wants their best few applications
        written, so RESUME_PLAN passes the check and the *caller* narrows how
        many it does.
        """
        book = ledger(spent=9.5)
        book.check(Task.RESUME_PLAN)  # allowed
        assert book.tailoring_limit(30) == book.restricted_tailoring_limit

    def test_the_ladder_narrows_in_three_steps(self):
        assert ledger(spent=0.0).tailoring_limit(30) == 30, "OK: the whole quota"
        assert ledger(spent=7.5).tailoring_limit(30) == 30, "WARNING: still the whole quota"
        assert ledger(spent=9.5).tailoring_limit(30) == 5, "RESTRICTED: the best few"
        assert ledger(spent=10.0).tailoring_limit(30) == 0, "EXHAUSTED: none"

    def test_the_limit_never_exceeds_what_the_caller_asked_for(self):
        """A cap of three applications a day stays three at every tier."""
        for spent in (0.0, 7.5, 9.5):
            assert ledger(spent=spent).tailoring_limit(3) <= 3

    def test_charging_moves_the_state(self):
        book = ledger()
        assert book.state is BudgetState.OK
        book.charge(9.99)
        assert ledger(spent=book.spent_usd).state is BudgetState.RESTRICTED

    def test_charge_notifies_the_caller_for_persistence(self):
        seen: list[tuple[float, float]] = []
        book = BudgetLedger(
            monthly_cap_usd=10.0, on_charge=lambda a, t, u=None: seen.append((a, t))
        )
        book.charge(1.5)
        book.charge(2.5)
        assert seen == [(1.5, 1.5), (2.5, 4.0)]

    def test_the_charge_carries_its_detail(self):
        """"$4.20 this month" is not an answer to "on what?"."""
        from app.services.llm.base import TokenCounts, Usage

        seen: list[Usage | None] = []
        book = BudgetLedger(
            monthly_cap_usd=10.0, on_charge=lambda a, t, u=None: seen.append(u)
        )
        book.charge(
            1.0,
            Usage(
                model="claude-sonnet-5",
                task=Task.RESUME_PLAN,
                tokens=TokenCounts(input_tokens=100, output_tokens=50),
                cost_usd=1.0,
            ),
        )
        assert seen[0] is not None
        assert seen[0].task is Task.RESUME_PLAN
        assert seen[0].tokens.input_tokens == 100


class TestModelPricing:
    def test_cost_is_per_million_tokens(self):
        pricing = ModelPricing(input_per_mtok=1.0, output_per_mtok=5.0)
        assert pricing.cost(1_000_000, 0) == pytest.approx(1.0)
        assert pricing.cost(0, 1_000_000) == pytest.approx(5.0)
        assert pricing.cost(500_000, 200_000) == pytest.approx(1.5)


class TestNullProvider:
    def test_returns_the_queued_payload_validated(self):
        provider = NullProvider([{"verdict": "PASS", "score": 88}])
        response = provider.structured_generate(
            task=Task.SCORING, schema=Answer, messages=[Message("user", "hi")]
        )
        assert response.value.verdict == "PASS"
        assert response.value.score == 88
        assert response.cost_usd == 0.0

    def test_makes_no_network_calls_and_costs_nothing(self):
        """The default provider, so a test run can never bill the user."""
        provider = NullProvider([{"verdict": "PASS", "score": 1}])
        provider.structured_generate(
            task=Task.SCORING, schema=Answer, messages=[Message("user", "x")]
        )
        assert provider.budget.spent_usd == 0.0

    def test_running_out_of_responses_raises(self):
        """Better a loud failure than a test passing on invented data."""
        with pytest.raises(LLMError, match="no queued response"):
            NullProvider().structured_generate(
                task=Task.SCORING, schema=Answer, messages=[Message("user", "x")]
            )

    def test_records_calls_for_assertions(self):
        provider = NullProvider([{"verdict": "PASS", "score": 1}])
        provider.structured_generate(
            task=Task.SPONSORSHIP, schema=Answer, messages=[Message("user", "x")]
        )
        assert provider.calls[0][0] is Task.SPONSORSHIP


class TestSchemaEnforcement:
    def test_a_payload_that_does_not_match_the_schema_is_rejected(self):
        """§0.9: model output is untrusted until it passes validation."""
        provider = NullProvider([{"verdict": "PASS"}])  # missing `score`
        with pytest.raises(SchemaValidationError, match="Answer"):
            provider.structured_generate(
                task=Task.SCORING, schema=Answer, messages=[Message("user", "x")]
            )

    def test_wrong_types_are_rejected(self):
        provider = NullProvider([{"verdict": "PASS", "score": "not a number"}])
        with pytest.raises(SchemaValidationError):
            provider.structured_generate(
                task=Task.SCORING, schema=Answer, messages=[Message("user", "x")]
            )


class TestModelRouting:
    @pytest.mark.parametrize(
        "task", [Task.SPONSORSHIP, Task.SCORING, Task.JD_EXTRACTION, Task.EMAIL_HOOK]
    )
    def test_classification_tasks_use_the_cheap_model(self, task):
        assert NullProvider().model_for(task) == "null-classification"

    @pytest.mark.parametrize("task", [Task.RESUME_PLAN, Task.EMAIL_BODY])
    def test_writing_tasks_use_the_stronger_model(self, task):
        assert NullProvider().model_for(task) == "null-writing"


class TestBudgetIsCheckedBeforeTheCall:
    def test_an_exhausted_budget_costs_nothing(self):
        """The check must precede the request, or a spent budget still bills."""
        provider = NullProvider([{"verdict": "PASS", "score": 1}])
        provider.budget = ledger(spent=10.0)

        with pytest.raises(BudgetExceeded):
            provider.structured_generate(
                task=Task.SCORING, schema=Answer, messages=[Message("user", "x")]
            )
        assert provider.responses, "the queued response must not have been consumed"
