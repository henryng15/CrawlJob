"""Form field classification and answer resolution (spec §7.8).

``TestManualOnlyQuestions`` is the class that matters. Every question in it is one
where a wrong answer is a false statement on a legal document, and the tests
assert that no amount of available data or model output can produce one.
"""

from __future__ import annotations

import pytest

from app.ats.fields import (
    MANUAL_ONLY_KEYS,
    FieldSpec,
    FieldType,
    SourceType,
    classify,
    resolve,
    unresolved_fields,
)

FACTS = {
    "candidate.first_name": "Hoan",
    "candidate.last_name": "Nguyen",
    "candidate.email": "nguyen15@kenyon.edu",
    "candidate.phone": "+1-555-0100",
    "candidate.github": "https://github.com/Vicientt",
    "education.school": "Kenyon College",
    "auth.work_authorized": True,
    "auth.requires_sponsorship": True,
    "eeo.gender": "Decline to self-identify",
}

LOCKED = frozenset({"auth.work_authorized", "auth.requires_sponsorship", "eeo.gender"})


def ask(question: str, **kw: object) -> FieldSpec:
    return FieldSpec(question_text=question, **kw)  # type: ignore[arg-type]


class TestClassification:
    @pytest.mark.parametrize(
        ("question", "expected"),
        [
            ("First Name", "candidate.first_name"),
            ("Last name", "candidate.last_name"),
            ("Email", "candidate.email"),
            ("Phone number", "candidate.phone"),
            ("LinkedIn Profile", "candidate.linkedin"),
            ("GitHub URL", "candidate.github"),
            ("Personal website", "candidate.portfolio"),
            ("School", "education.school"),
            ("Expected graduation date", "education.graduation_date"),
            ("GPA", "education.gpa"),
            ("Resume/CV", "documents.resume"),
            ("Cover Letter", "documents.cover_letter"),
            ("Why do you want to work here?", "open.why_company"),
            ("How did you hear about us?", "logistics.how_did_you_hear"),
        ],
    )
    def test_common_questions_are_recognised(self, question, expected):
        assert classify(ask(question)) == expected

    def test_falls_back_to_the_field_name(self):
        spec = FieldSpec(question_text="", name="job_application[email]")
        assert classify(spec) == "candidate.email"

    def test_visible_label_wins_over_the_name_attribute(self):
        """The label is what the applicant reads; `name` is often opaque."""
        spec = FieldSpec(question_text="GitHub URL", name="custom_question_12345")
        assert classify(spec) == "candidate.github"

    def test_an_unrecognised_question_returns_none(self):
        assert classify(ask("What is your favourite compiler optimisation?")) is None

    def test_specific_patterns_beat_general_ones(self):
        """ "Preferred name" must not be swallowed by the generic name pattern."""
        assert classify(ask("Preferred name")) == "candidate.preferred_name"


class TestManualOnlyQuestions:
    @pytest.mark.parametrize(
        ("question", "expected"),
        [
            ("Are you legally authorized to work in the US?", "auth.work_authorized"),
            ("Will you now or in the future require sponsorship?", "auth.requires_sponsorship"),
            ("Are you a US citizen?", "auth.citizenship"),
            ("Are you subject to export control regulations?", "auth.export_control"),
            ("Do you hold an active security clearance?", "auth.security_clearance"),
            ("Have you ever been convicted of a felony?", "background.criminal_history"),
            ("Are you subject to a non-compete agreement?", "background.noncompete"),
            ("Disability status", "eeo.disability"),
            ("Are you a protected veteran?", "eeo.veteran_status"),
            ("Race / Ethnicity", "eeo.race_ethnicity"),
            ("Gender", "eeo.gender"),
            ("What are your salary expectations?", "compensation.expected"),
            ("Are you willing to relocate?", "commitment.relocation"),
            ("I certify that the information provided is accurate", "legal.attestation"),
            ("Type your full name to sign", "legal.signature"),
        ],
    )
    def test_they_are_recognised_as_manual_only(self, question, expected):
        assert classify(ask(question)) == expected
        assert expected in MANUAL_ONLY_KEYS

    @pytest.mark.parametrize("key", sorted(MANUAL_ONLY_KEYS))
    def test_a_model_can_never_answer_one(self, key):
        """Even with a drafted answer in hand, policy refuses it."""
        spec = ask(_question_for(key))
        answer = resolve(spec, facts={}, ai_answers={key: "Yes, definitely."})

        assert answer.source_type is SourceType.MANUAL_REQUIRED
        assert answer.value is None

    @pytest.mark.parametrize("key", sorted(MANUAL_ONLY_KEYS))
    def test_an_unlocked_fact_does_not_satisfy_one(self, key):
        """A value the user never deliberately locked is not good enough here."""
        answer = resolve(ask(_question_for(key)), facts={key: "Yes"}, locked_keys=frozenset())
        assert answer.source_type is SourceType.MANUAL_REQUIRED
        assert answer.value is None

    def test_a_locked_fact_does_satisfy_one(self):
        """This is the only path: the user set it deliberately (§7.8)."""
        answer = resolve(
            ask("Will you now or in the future require sponsorship?"),
            facts=FACTS,
            locked_keys=LOCKED,
        )
        assert answer.source_type is SourceType.LOCKED_FACT
        assert answer.value is True
        assert answer.fact_ids == ("auth.requires_sponsorship",)

    def test_eeo_is_never_inferred_only_prefilled_from_a_locked_preference(self):
        """§7.8: the system may prefill a locked EEO answer, never infer one."""
        without = resolve(ask("Gender"), facts={}, locked_keys=frozenset())
        assert without.source_type is SourceType.MANUAL_REQUIRED

        with_locked = resolve(ask("Gender"), facts=FACTS, locked_keys=LOCKED)
        assert with_locked.source_type is SourceType.LOCKED_FACT
        assert with_locked.value == "Decline to self-identify"


def _question_for(key: str) -> str:
    """A question text that classifies to ``key``."""
    return {
        "auth.work_authorized": "Are you legally authorized to work in the US?",
        "auth.requires_sponsorship": "Will you now or in the future require sponsorship?",
        "auth.citizenship": "Are you a US citizen?",
        "auth.export_control": "Are you subject to export control regulations?",
        "auth.security_clearance": "Do you hold a security clearance?",
        "background.criminal_history": "Have you ever been convicted of a felony?",
        "background.previously_employed": "Have you previously worked here?",
        "background.noncompete": "Are you subject to a non-compete agreement?",
        "eeo.disability": "Disability status",
        "eeo.veteran_status": "Are you a protected veteran?",
        "eeo.race_ethnicity": "Race / Ethnicity",
        "eeo.gender": "Gender",
        "compensation.expected": "What are your salary expectations?",
        "commitment.relocation": "Are you willing to relocate?",
        "legal.attestation": "I certify that the information provided is accurate",
        "legal.signature": "Type your full name to sign",
    }[key]


class TestOrdinaryResolution:
    def test_a_profile_fact_fills_the_field(self):
        answer = resolve(ask("Email"), facts=FACTS)
        assert answer.source_type is SourceType.PROFILE_FACT
        assert answer.value == "nguyen15@kenyon.edu"
        assert answer.is_fillable

    def test_a_locked_profile_fact_is_labelled_as_locked(self):
        answer = resolve(ask("Email"), facts=FACTS, locked_keys=frozenset({"candidate.email"}))
        assert answer.source_type is SourceType.LOCKED_FACT

    def test_a_recognised_question_with_no_fact_asks_the_user(self):
        answer = resolve(ask("What is your postal code?"), facts=FACTS)
        assert answer.source_type is SourceType.MANUAL_REQUIRED
        assert "no profile fact covers it" in answer.note

    def test_an_unrecognised_question_asks_the_user(self):
        """Fail closed: never guess at a question we did not understand."""
        answer = resolve(ask("Describe your ideal build system"), facts=FACTS)
        assert answer.source_type is SourceType.UNRESOLVED
        assert answer.semantic_key is None
        assert answer.needs_human

    def test_free_text_may_be_drafted_by_a_model(self):
        answer = resolve(
            ask("Why do you want to work here?"),
            facts={},
            ai_answers={"open.why_company": "Because of your compiler work."},
        )
        assert answer.source_type is SourceType.AI_DRAFT
        assert answer.confidence < 1.0
        assert "review before submitting" in answer.note

    def test_a_model_draft_for_a_non_draftable_field_is_ignored(self):
        """Model text is only accepted where free text is genuinely the answer."""
        answer = resolve(
            ask("What is your GPA?"),
            facts={},
            ai_answers={"education.gpa": "3.9"},
        )
        assert answer.source_type is not SourceType.AI_DRAFT
        assert answer.value is None


class TestFillability:
    def test_manual_and_unresolved_answers_are_not_filled(self):
        for answer in (
            resolve(ask("Gender"), facts={}),
            resolve(ask("Unrecognised question"), facts={}),
        ):
            assert not answer.is_fillable

    def test_a_false_value_is_still_fillable(self):
        """A "No" answer must not be mistaken for a missing one."""
        answer = resolve(
            ask("Will you now or in the future require sponsorship?"),
            facts={"auth.requires_sponsorship": False},
            locked_keys=frozenset({"auth.requires_sponsorship"}),
        )
        assert answer.value is False
        assert answer.is_fillable


class TestUnresolvedReporting:
    def test_collects_everything_a_human_must_answer(self):
        specs = [
            ask("First Name"),
            ask("Email"),
            ask("Are you a US citizen?"),
            ask("Describe your ideal build system"),
        ]
        answers = [resolve(s, facts=FACTS, locked_keys=LOCKED) for s in specs]
        pending = unresolved_fields(answers)

        assert len(pending) == 2
        assert {a.source_type for a in pending} == {
            SourceType.MANUAL_REQUIRED,
            SourceType.UNRESOLVED,
        }


class TestFieldSpec:
    def test_defaults_are_conservative(self):
        spec = FieldSpec(question_text="Anything")
        assert spec.field_type is FieldType.TEXT
        assert spec.required is False
        assert spec.options == ()
