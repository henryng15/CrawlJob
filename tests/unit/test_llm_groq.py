"""The Groq provider and task routing (spec §11.6).

Every call here goes through an ``httpx.MockTransport``. Nothing reaches the
network, and no key is needed — so a test run can never bill anybody.
"""

from __future__ import annotations

import json

import httpx
import pytest
from pydantic import BaseModel

from app.services.llm.base import (
    BudgetLedger,
    LLMError,
    Message,
    ModelPricing,
    NullProvider,
    SchemaValidationError,
    Task,
)
from app.services.llm.groq import GROQ_TASKS, GroqProvider
from app.services.llm.router import RoutingProvider, provider_for


class Verdict(BaseModel):
    label: str
    confidence: float = 0.5


def reply(payload: dict, *, prompt_tokens: int = 120, completion_tokens: int = 30) -> dict:
    return {
        "choices": [
            {
                "message": {
                    "tool_calls": [
                        {
                            "function": {
                                "name": "record_result",
                                "arguments": json.dumps(payload),
                            }
                        }
                    ]
                }
            }
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
        },
    }


def provider(handler, *, budget: BudgetLedger | None = None) -> GroqProvider:
    return GroqProvider(
        api_key="test-key-not-a-real-one",
        model="llama-3.3-70b-versatile",
        budget=budget or BudgetLedger(monthly_cap_usd=15.0),
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        pricing={"llama-3.3-70b-versatile": ModelPricing(1.0, 2.0)},
    )


def ask(p: GroqProvider):
    return p.structured_generate(
        task=Task.SPONSORSHIP,
        schema=Verdict,
        messages=[Message(role="user", content="classify this")],
    )


class TestASuccessfulCall:
    def test_the_tool_arguments_become_the_validated_result(self):
        response = ask(provider(lambda _: httpx.Response(200, json=reply({"label": "NONE"}))))
        assert response.value.label == "NONE"

    def test_token_usage_is_read_from_the_response(self):
        """Actual usage, not an estimate — the cap has to track what was billed."""
        response = ask(
            provider(
                lambda _: httpx.Response(
                    200, json=reply({"label": "NONE"}, prompt_tokens=1000, completion_tokens=500)
                )
            )
        )
        assert response.input_tokens == 1000
        assert response.output_tokens == 500

    def test_cost_is_computed_from_that_usage(self):
        response = ask(
            provider(
                lambda _: httpx.Response(
                    200,
                    json=reply(
                        {"label": "NONE"}, prompt_tokens=1_000_000, completion_tokens=1_000_000
                    ),
                )
            )
        )
        assert response.cost_usd == pytest.approx(3.0)

    def test_the_charge_lands_on_the_ledger(self):
        ledger = BudgetLedger(monthly_cap_usd=15.0)
        ask(
            provider(
                lambda _: httpx.Response(
                    200,
                    json=reply({"label": "NONE"}, prompt_tokens=1_000_000, completion_tokens=0),
                ),
                budget=ledger,
            )
        )
        assert ledger.spent_usd == pytest.approx(1.0)


class TestTheRequest:
    def test_the_key_is_sent_as_a_bearer_token(self):
        seen: dict[str, str] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen.update(request.headers)
            return httpx.Response(200, json=reply({"label": "NONE"}))

        ask(provider(handler))
        assert seen["authorization"].startswith("Bearer ")

    def test_the_tool_call_is_forced(self):
        """Otherwise a model that answers in prose looks like a valid result."""
        seen: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen.update(json.loads(request.content))
            return httpx.Response(200, json=reply({"label": "NONE"}))

        ask(provider(handler))
        assert seen["tool_choice"]["function"]["name"] == "record_result"

    def test_classification_is_deterministic(self):
        """The same posting scored twice should not give two answers."""
        seen: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen.update(json.loads(request.content))
            return httpx.Response(200, json=reply({"label": "NONE"}))

        ask(provider(handler))
        assert seen["temperature"] == 0.0


class TestFailuresDegradeRatherThanCrash:
    """Every one of these raises ``LLMError``, which ``scoring`` and
    ``sponsorship`` already catch and answer deterministically."""

    def test_a_non_200_is_an_llm_error(self):
        with pytest.raises(LLMError, match="HTTP 503"):
            ask(provider(lambda _: httpx.Response(503, json={})))

    def test_a_transport_failure_is_an_llm_error(self):
        def handler(_):
            raise httpx.ConnectError("no route to host")

        with pytest.raises(LLMError, match="Groq request failed"):
            ask(provider(handler))

    def test_no_choices_is_an_llm_error(self):
        with pytest.raises(LLMError, match="no choices"):
            ask(provider(lambda _: httpx.Response(200, json={"choices": []})))

    def test_a_missing_tool_call_is_an_llm_error(self):
        body = {"choices": [{"message": {"content": "Sure thing!"}}], "usage": {}}
        with pytest.raises(LLMError, match="no record_result call"):
            ask(provider(lambda _: httpx.Response(200, json=body)))

    def test_unparseable_arguments_are_an_llm_error(self):
        body = {
            "choices": [
                {
                    "message": {
                        "tool_calls": [
                            {"function": {"name": "record_result", "arguments": "{oops"}}
                        ]
                    }
                }
            ],
            "usage": {},
        }
        with pytest.raises(LLMError, match="unparseable arguments"):
            ask(provider(lambda _: httpx.Response(200, json=body)))

    def test_a_payload_that_does_not_match_the_schema_is_refused(self):
        with pytest.raises(SchemaValidationError):
            ask(provider(lambda _: httpx.Response(200, json=reply({"wrong": "shape"}))))


class TestNothingLeaksIntoErrors:
    def test_a_transport_error_does_not_carry_the_url_or_the_key(self):
        """httpx puts the request URL in its message, and the URL is the one
        place a key could surface."""

        def handler(_):
            raise httpx.ConnectError("failed connecting to https://api.groq.com?key=SECRET")

        with pytest.raises(LLMError) as caught:
            ask(provider(handler))
        assert "SECRET" not in str(caught.value)
        assert "api.groq.com" not in str(caught.value)

    def test_an_http_error_does_not_echo_the_prompt(self):
        with pytest.raises(LLMError) as caught:
            ask(provider(lambda _: httpx.Response(500, text="the job description was ...")))
        assert "job description" not in str(caught.value)


class TestRouting:
    @pytest.mark.parametrize(
        "task",
        [Task.JD_EXTRACTION, Task.SPONSORSHIP, Task.SCORING, Task.FORM_ANSWER, Task.VALIDATION],
    )
    def test_the_high_volume_tasks_go_to_groq(self, task):
        assert provider_for(task) == "groq"

    @pytest.mark.parametrize("task", [Task.RESUME_PLAN, Task.EMAIL_HOOK, Task.EMAIL_BODY])
    def test_the_writing_tasks_stay_with_anthropic(self, task):
        """Resume prose is the only output the user reads word for word."""
        assert provider_for(task) == "anthropic"

    def test_every_task_is_routed_somewhere(self):
        for task in Task:
            assert provider_for(task) in {"groq", "anthropic"}

    def test_the_groq_task_list_and_the_router_agree(self):
        assert {t.value for t in Task if provider_for(t) == "groq"} == set(GROQ_TASKS)

    def test_the_router_delegates_by_task(self):
        classification = NullProvider([{"label": "from-groq"}])
        writing = NullProvider([{"label": "from-anthropic"}])
        router = RoutingProvider(
            classification=classification,
            writing=writing,
            budget=BudgetLedger(monthly_cap_usd=15.0),
        )

        assert (
            router.structured_generate(
                task=Task.SPONSORSHIP, schema=Verdict, messages=[]
            ).value.label
            == "from-groq"
        )
        assert (
            router.structured_generate(
                task=Task.RESUME_PLAN, schema=Verdict, messages=[]
            ).value.label
            == "from-anthropic"
        )

    def test_both_delegates_share_one_cap(self):
        """Two ledgers would each believe they had the whole fifteen dollars."""
        shared = BudgetLedger(monthly_cap_usd=15.0)
        classification = NullProvider(budget=BudgetLedger(monthly_cap_usd=999.0))
        writing = NullProvider(budget=BudgetLedger(monthly_cap_usd=999.0))
        RoutingProvider(classification=classification, writing=writing, budget=shared)

        assert classification.budget is shared
        assert writing.budget is shared
