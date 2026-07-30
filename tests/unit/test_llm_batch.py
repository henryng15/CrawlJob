"""Batch tailoring, without a network (spec §7.7, §26.2).

The single most important test in this file is
``test_results_are_matched_by_key_not_by_order``. Everything else here protects
money; that one protects the user from applying to a job with somebody else's
resume attached — a failure that produces perfectly plausible output and would
only be discovered by whoever read it.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest

from app.services.llm.base import (
    BudgetExceeded,
    BudgetLedger,
    LLMError,
    ModelPricing,
    Task,
)
from app.services.llm.batch import (
    BATCH_DISCOUNT,
    BatchOutcome,
    BatchRequest,
    BatchStatus,
    build_requests,
    check_affordable,
    estimate_cost,
    is_stale,
    match_results,
    outcome_from,
    parse_results,
)

NOW = datetime(2026, 7, 29, 12, 0, tzinfo=UTC)
PRICING = ModelPricing(input_per_mtok=3.0, output_per_mtok=15.0)


def request(custom_id: str, *, tokens: int = 1000, max_tokens: int = 1000) -> BatchRequest:
    return BatchRequest(
        custom_id=custom_id,
        messages=[{"role": "user", "content": "tailor this"}],
        max_tokens=max_tokens,
        estimated_input_tokens=tokens,
    )


def succeeded(custom_id: str, payload: dict, *, tokens: int = 100) -> dict:
    return {
        "custom_id": custom_id,
        "result": {
            "type": "succeeded",
            "message": {
                "content": [
                    {"type": "tool_use", "name": "record_result", "input": payload}
                ],
                "usage": {"input_tokens": tokens, "output_tokens": tokens},
            },
        },
    }


class TestCustomIds:
    def test_a_missing_custom_id_is_refused(self):
        with pytest.raises(LLMError, match="needs a custom_id"):
            build_requests([request("")])

    def test_a_duplicate_custom_id_is_refused(self):
        """Two requests under one key come back as one result.

        Whichever application lost the race would silently never be tailored, so
        this is caught before submission rather than discovered afterwards.
        """
        with pytest.raises(LLMError, match="duplicate custom_id"):
            build_requests([request("app-1"), request("app-1")])

    def test_distinct_ids_are_accepted(self):
        assert len(build_requests([request("app-1"), request("app-2")])) == 2


class TestMatching:
    def test_results_are_matched_by_key_not_by_order(self):
        """The reason this module exists.

        The API returns results in completion order, which has nothing to do with
        submission order. Pairing them positionally would attach the second
        applicant's tailored resume to the first application — plausible output,
        wrong content, discovered by a human at the worst possible moment.
        """
        requests = [request("app-1"), request("app-2"), request("app-3")]
        # Deliberately reversed, and with a fourth id interleaved.
        outcome = outcome_from(
            [
                succeeded("app-3", {"summary": "third"}),
                succeeded("app-1", {"summary": "first"}),
                succeeded("app-2", {"summary": "second"}),
            ]
        )
        matched, missing = match_results(requests, outcome)

        assert matched["app-1"]["summary"] == "first"
        assert matched["app-2"]["summary"] == "second"
        assert matched["app-3"]["summary"] == "third"
        assert missing == []

    def test_a_request_with_no_result_is_reported_not_dropped(self):
        requests = [request("app-1"), request("app-2")]
        outcome = outcome_from([succeeded("app-1", {"summary": "only one"})])
        matched, missing = match_results(requests, outcome)

        assert set(matched) == {"app-1"}
        assert missing == ["app-2"]

    def test_a_result_for_something_never_requested_is_ignored(self):
        requests = [request("app-1")]
        outcome = outcome_from(
            [succeeded("app-1", {"summary": "mine"}), succeeded("app-99", {"summary": "?"})]
        )
        matched, _ = match_results(requests, outcome)
        assert set(matched) == {"app-1"}

    def test_an_empty_batch_matches_nothing_without_raising(self):
        matched, missing = match_results([], BatchOutcome())
        assert matched == {} and missing == []


class TestParsing:
    def test_usage_is_summed_across_results(self):
        outcome = outcome_from(
            [
                succeeded("a", {"summary": "x"}, tokens=100),
                succeeded("b", {"summary": "y"}, tokens=250),
            ]
        )
        assert outcome.input_tokens == 350
        assert outcome.output_tokens == 350

    def test_an_errored_result_is_recorded_with_its_reason(self):
        outcome = outcome_from(
            [
                {
                    "custom_id": "app-1",
                    "result": {"type": "errored", "error": {"type": "invalid_request"}},
                }
            ]
        )
        assert outcome.results == {}
        assert outcome.errors["app-1"] == "invalid_request"

    def test_expired_and_canceled_results_are_errors_not_successes(self):
        outcome = outcome_from(
            [
                {"custom_id": "a", "result": {"type": "expired"}},
                {"custom_id": "b", "result": {"type": "canceled"}},
            ]
        )
        assert outcome.results == {}
        assert set(outcome.errors) == {"a", "b"}

    def test_a_success_with_no_tool_call_is_an_error(self):
        """A model that answered in prose has not produced a plan."""
        outcome = outcome_from(
            [
                {
                    "custom_id": "app-1",
                    "result": {
                        "type": "succeeded",
                        "message": {"content": [{"type": "text", "text": "Sure!"}]},
                    },
                }
            ]
        )
        assert outcome.results == {}
        assert "no tool call" in outcome.errors["app-1"]

    def test_one_unparseable_line_does_not_cost_the_others(self):
        text = "\n".join(
            [
                json.dumps(succeeded("app-1", {"summary": "kept"})),
                "{not json at all",
                json.dumps(succeeded("app-2", {"summary": "also kept"})),
            ]
        )
        outcome = parse_results(text)
        assert set(outcome.results) == {"app-1", "app-2"}

    def test_a_record_with_no_custom_id_is_skipped(self):
        assert outcome_from([{"result": {"type": "succeeded"}}]).results == {}

    def test_sdk_objects_are_accepted_as_well_as_dictionaries(self):
        """The SDK yields Pydantic models; the result file yields dicts."""

        class Fake:
            def __init__(self, data):
                self._data = data

            def model_dump(self):
                return self._data

        outcome = outcome_from([Fake(succeeded("app-1", {"summary": "x"}))])
        assert outcome.results["app-1"]["summary"] == "x"


class TestCost:
    def test_the_estimate_takes_the_batch_discount(self):
        full = PRICING.cost(1000, 1000)
        assert estimate_cost([request("a")], PRICING) == pytest.approx(full * BATCH_DISCOUNT)

    def test_output_is_estimated_at_the_worst_case(self):
        """max_tokens, not a guess.

        Under-estimating would let a batch through that takes the month past its
        cap, and a batch cannot be un-submitted.
        """
        cheap = estimate_cost([request("a", max_tokens=100)], PRICING)
        dear = estimate_cost([request("a", max_tokens=4000)], PRICING)
        assert dear > cheap

    def test_no_pricing_means_no_estimate_rather_than_a_guess(self):
        assert estimate_cost([request("a")], None) == 0.0

    def test_the_actual_cost_also_takes_the_discount(self):
        outcome = BatchOutcome(input_tokens=1_000_000, output_tokens=0)
        assert outcome.cost(PRICING) == pytest.approx(3.0 * BATCH_DISCOUNT)


class TestTheCapBeforeSubmitting:
    def test_a_batch_that_fits_is_allowed(self):
        ledger = BudgetLedger(monthly_cap_usd=15.0, spent_usd=0.0)
        assert check_affordable(ledger, [request("a")], PRICING) > 0

    def test_a_batch_that_does_not_fit_is_refused(self):
        """The whole point of checking first.

        $10 of $15 spent leaves the budget healthy, so the per-call check is
        happy to let tailoring run. A batch estimated at $6 still must not go,
        because a batch is billed as one thing and cannot be un-submitted once
        accepted.
        """
        ledger = BudgetLedger(monthly_cap_usd=15.0, spent_usd=10.0)
        assert ledger.state.value == "OK", "the per-call check would allow this"
        ledger.check(Task.RESUME_PLAN)  # and here it is, allowing it
        with pytest.raises(BudgetExceeded, match="was not submitted"):
            check_affordable(ledger, [request("a", tokens=4_000_000)], PRICING)

    def test_the_refusal_says_what_it_would_have_cost_and_what_is_left(self):
        ledger = BudgetLedger(monthly_cap_usd=15.0, spent_usd=10.0)
        with pytest.raises(BudgetExceeded) as caught:
            check_affordable(ledger, [request("a", tokens=4_000_000)], PRICING)
        message = str(caught.value)
        assert "would cost about" in message
        assert "$5.00" in message, "the user needs to see what is left"
        assert "$15.00" in message, "and what the cap was"

    def test_an_exhausted_budget_refuses_before_the_estimate_matters(self):
        ledger = BudgetLedger(monthly_cap_usd=15.0, spent_usd=15.0)
        with pytest.raises(BudgetExceeded):
            check_affordable(ledger, [request("a", tokens=1)], PRICING)

    def test_at_ninety_percent_a_small_affordable_batch_still_goes(self):
        """§26.2's RESTRICTED tier rations tailoring rather than stopping it.

        The narrowing happens in the caller, which asks ``tailoring_limit`` how
        many to select. What must not happen here is a blanket refusal of a batch
        that comfortably fits in what is left.
        """
        ledger = BudgetLedger(monthly_cap_usd=15.0, spent_usd=13.6)
        assert ledger.state.value == "RESTRICTED"
        assert check_affordable(ledger, [request("a", tokens=1)], PRICING) >= 0
        assert ledger.tailoring_limit(30) == 5

    def test_nothing_is_charged_by_the_check_itself(self):
        ledger = BudgetLedger(monthly_cap_usd=15.0, spent_usd=1.0)
        check_affordable(ledger, [request("a")], PRICING)
        assert ledger.spent_usd == 1.0


class TestStatusAndStaleness:
    def test_only_ended_counts_as_finished(self):
        assert BatchStatus("b", "ended").finished
        assert not BatchStatus("b", "in_progress").finished
        assert not BatchStatus("b", "canceling").finished

    def test_a_batch_inside_its_window_is_not_stale(self):
        assert not is_stale(NOW - timedelta(hours=3), now=NOW, timeout_hours=24)

    def test_a_batch_past_its_window_is(self):
        """Polling forever would leave the applications waiting on it unprepared."""
        assert is_stale(NOW - timedelta(hours=25), now=NOW, timeout_hours=24)
