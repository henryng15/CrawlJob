"""Work authorization and sponsorship questions (spec §7.8, §2.2).

The property under test is narrow and absolute: this system never puts a claim
about the user's right to work on a form unless the user personally set the
locked fact that says it, and it never answers a question that asks two things at
once.

The combined-question tests are the ones that matter. A question like "authorized
to work *without sponsorship*" can be matched by a sponsorship rule and filled
from a sponsorship fact — and the resulting answer means the opposite of what the
fact says. These tests exist so that cannot come back.
"""

from __future__ import annotations

import pytest

from app.ats.fields import FieldSpec, SourceType, resolve
from app.services.work_authorization import Category, categorize, decide

AUTHORIZED = "work_authorization.is_authorized"
SPONSORSHIP = "work_authorization.requires_future_sponsorship"
SPONSORSHIP_NOW = "work_authorization.requires_sponsorship_now"

#: The shape of a student on CPT: allowed to work, needs nothing filed for the
#: internship itself, needs an H-1B for the job after it. The two sponsorship
#: answers are opposites, and both are true.
FACTS = {AUTHORIZED: True, SPONSORSHIP: True, SPONSORSHIP_NOW: False}
LOCKED = frozenset(FACTS)


def answer(question: str, *, name: str | None = None, facts=None, locked=None):
    return resolve(
        FieldSpec(question_text=question, name=name),
        facts=FACTS if facts is None else facts,
        locked_keys=LOCKED if locked is None else locked,
    )


class TestCategorising:
    @pytest.mark.parametrize(
        "question",
        [
            "Are you legally authorized to work in the United States?",
            "Are you authorized to work in the US for any employer?",
            "Do you have work authorization in the country of employment?",
            "Are you eligible to work in the United States?",
            "Do you have the right to work in the US?",
            "Are you legally able to work in the United States?",
        ],
    )
    def test_authorization_alone_is_recognised(self, question):
        assert categorize(question) is Category.AUTHORIZATION

    @pytest.mark.parametrize(
        "question",
        [
            "Do you require visa sponsorship?",
            "Do you require sponsorship for this position?",
            "What is your current visa status?",
            "Do you hold an H-1B?",
            "Will you need a work permit?",
        ],
    )
    def test_a_sponsorship_question_about_this_role_is_recognised(self, question):
        assert categorize(question) is Category.SPONSORSHIP_NOW

    @pytest.mark.parametrize(
        "question",
        [
            "Will you now or in the future require sponsorship for an employment visa?",
            "Will you require sponsorship to continue working for us?",
            "Will you at any point require visa sponsorship?",
            "Do you now or in the future need sponsorship?",
            "Will you ever require sponsorship?",
        ],
    )
    def test_a_sponsorship_question_reaching_into_the_future_is_recognised(self, question):
        """A different question, and for an intern a different truthful answer.

        Reading "now or in the future" as if it asked only about the internship
        is how a form ends up carrying a false statement.
        """
        assert categorize(question) is Category.SPONSORSHIP_FUTURE

    @pytest.mark.parametrize(
        "question",
        [
            "Are you legally authorized to work in the United States without sponsorship?",
            "Are you authorized to work in the US without requiring visa sponsorship "
            "now or in the future?",
            "Are you eligible to work in the US, and will you require sponsorship?",
            "Do you have work authorization that does not require an H-1B?",
            "Are you legally authorized to work in the US on a permanent basis "
            "without the need for visa sponsorship?",
        ],
    )
    def test_a_question_carrying_both_is_combined(self, question):
        assert categorize(question) is Category.COMBINED

    def test_the_halves_may_be_split_across_the_label_and_the_field_name(self):
        """A strong sign the employer means one question."""
        assert (
            categorize("Are you authorized to work here?", "sponsorship_required")
            is Category.COMBINED
        )

    @pytest.mark.parametrize(
        "question",
        [
            "What is your preferred name?",
            "Have you ever been convicted of a felony?",
            "Are you a US citizen?",
            "",
        ],
    )
    def test_everything_else_is_unrelated(self, question):
        assert categorize(question) is Category.UNRELATED


class TestDeciding:
    def test_authorization_is_answered_from_the_locked_fact(self):
        decision = decide(
            "Are you legally authorized to work in the US?", facts=FACTS, locked_keys=LOCKED
        )
        assert decision.value is True
        assert decision.fact_key == AUTHORIZED

    def test_an_unlocked_authorization_fact_is_not_used(self):
        """§7.8: a locked fact or a human. An unlocked fact is neither."""
        decision = decide(
            "Are you legally authorized to work in the US?",
            facts=FACTS,
            locked_keys=frozenset(),
        )
        assert decision.needs_human
        assert "no locked work-authorization fact" in decision.reason

    def test_a_missing_authorization_fact_leaves_it_blank(self):
        decision = decide(
            "Are you legally authorized to work in the US?", facts={}, locked_keys=frozenset()
        )
        assert decision.needs_human

    def test_sponsorship_for_this_role_comes_from_its_own_fact(self):
        decision = decide(
            "Will you require visa sponsorship?", facts=FACTS, locked_keys=LOCKED
        )
        assert decision.value is False
        assert decision.fact_key == SPONSORSHIP_NOW

    def test_sponsorship_reaching_into_the_future_comes_from_the_other_fact(self):
        """Same person, same day, opposite answers — both of them true."""
        decision = decide(
            "Will you now or in the future require visa sponsorship?",
            facts=FACTS,
            locked_keys=LOCKED,
        )
        assert decision.value is True
        assert decision.fact_key == SPONSORSHIP

    def test_an_unlocked_sponsorship_fact_is_not_used(self):
        decision = decide(
            "Will you require visa sponsorship?", facts=FACTS, locked_keys=frozenset()
        )
        assert decision.needs_human
        assert decision.value is None

    def test_a_missing_sponsorship_fact_leaves_it_for_the_user(self):
        """Nothing is guessed. An unset fact is a question, not a default."""
        decision = decide(
            "Will you require visa sponsorship?",
            facts={AUTHORIZED: True},
            locked_keys=frozenset({AUTHORIZED}),
        )
        assert decision.needs_human
        assert decision.value is None

    def test_a_combined_question_is_never_answered(self):
        decision = decide(
            "Are you authorized to work in the US without sponsorship?",
            facts=FACTS,
            locked_keys=LOCKED,
        )
        assert decision.needs_human
        assert "cannot be combined" in decision.reason

    def test_a_combined_question_is_blank_whatever_the_facts_say(self):
        for authorized in (True, False):
            for sponsorship in (True, False):
                decision = decide(
                    "Are you legally authorized to work without sponsorship?",
                    facts={AUTHORIZED: authorized, SPONSORSHIP: sponsorship},
                    locked_keys=frozenset({AUTHORIZED, SPONSORSHIP}),
                )
                assert decision.needs_human, (authorized, sponsorship)


class TestThroughTheResolver:
    """The path the browser worker actually takes."""

    def test_authorization_is_filled_and_marked_as_a_locked_fact(self):
        result = answer("Are you legally authorized to work in the United States?")
        assert result.value is True
        assert result.source_type is SourceType.LOCKED_FACT
        assert result.fact_ids == (AUTHORIZED,)

    def test_sponsorship_now_and_later_resolve_to_different_answers(self):
        now = answer("Do you require sponsorship for this position?")
        later = answer("Will you now or in the future require sponsorship?")

        assert now.value is False
        assert now.semantic_key == "auth.requires_sponsorship_now"
        assert later.value is True
        assert later.semantic_key == "auth.requires_sponsorship"
        assert now.source_type is SourceType.LOCKED_FACT

    def test_a_combined_question_is_left_for_the_user(self):
        result = answer("Are you legally authorized to work in the US without sponsorship?")
        assert result.value is None
        assert result.source_type is SourceType.MANUAL_REQUIRED

    def test_the_combined_case_the_old_code_got_wrong(self):
        """The regression this phase exists for.

        The sponsorship pattern matched this question first, and the fact
        "requires_future_sponsorship = False" was filled in as the answer. But
        the question asks whether the user is authorized *without* sponsorship,
        so False reads as "I am not authorized to work" — a false statement on a
        legal document, assembled from two true facts.
        """
        facts = {AUTHORIZED: True, SPONSORSHIP: False}
        result = answer(
            "Are you legally authorized to work in the United States without sponsorship "
            "now or in the future?",
            facts=facts,
            locked=frozenset(facts),
        )
        assert result.value is None, "this must never be auto-filled"
        assert result.source_type is SourceType.MANUAL_REQUIRED

    def test_a_combined_question_is_not_filed_under_one_of_its_halves(self):
        """The review screen has to be able to say what actually happened."""
        result = answer("Are you authorized to work without visa sponsorship?")
        assert result.semantic_key == "auth.work_authorized_without_sponsorship"

    def test_no_model_answer_can_reach_a_work_authorization_field(self):
        result = resolve(
            FieldSpec(question_text="Are you legally authorized to work in the US?"),
            facts={},
            locked_keys=frozenset(),
            ai_answers={"auth.work_authorized": "Yes of course"},
        )
        assert result.value is None
        assert result.source_type is SourceType.MANUAL_REQUIRED

    def test_an_unlocked_fact_cannot_fill_it_either(self):
        result = answer(
            "Are you legally authorized to work in the US?",
            facts={AUTHORIZED: True},
            locked=frozenset(),
        )
        assert result.value is None

    def test_citizenship_still_goes_through_the_ordinary_manual_path(self):
        """Unchanged by this phase, and it must stay that way."""
        result = answer("Are you a United States citizen?")
        assert result.semantic_key == "auth.citizenship"
        assert result.source_type is SourceType.MANUAL_REQUIRED

    def test_ordinary_fields_are_untouched(self):
        result = resolve(
            FieldSpec(question_text="First name"),
            facts={"candidate.first_name": "Hoan"},
            locked_keys=frozenset(),
        )
        assert result.value == "Hoan"


class TestTheFactIsAlwaysLocked:
    def test_the_authorization_key_is_locked_by_prefix(self):
        """So "only from locked facts" is enforced by the fact store rather than
        by remembering to pass a flag at the call site."""
        from app.services.candidate import is_always_locked
        from app.services.work_authorization import (
            AUTHORIZATION_FACT_KEYS,
            SPONSORSHIP_FACT_KEYS,
        )

        for key in AUTHORIZATION_FACT_KEYS + SPONSORSHIP_FACT_KEYS:
            assert is_always_locked(key), key
