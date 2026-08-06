"""Form field classification and answer resolution (spec §7.8).

``TestManualOnlyQuestions`` is the class that matters. Every question in it is one
where a wrong answer is a false statement on a legal document, and the tests
assert that no amount of available data or model output can produce one.

``TestTheManualOnlySplit`` guards the line drawn inside that set: a locked fact
may answer a question whose truthful answer never changes, and may not answer one
that is per-application or that is a legal act.
"""

from __future__ import annotations

import pytest

from app.ats.fields import (
    ALWAYS_MANUAL_KEYS,
    LOCKED_FACT_ANSWERABLE_KEYS,
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
    "candidate.github": "https://github.com/henryng15",
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
            ("Are you at least 18 years of age?", "background.age_18_or_over"),
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
        """This is the only path: the user set it deliberately (§7.8).

        Shown with EEO rather than sponsorship, which is now never auto-filled at
        all — see ``tests/unit/test_work_authorization.py``.
        """
        answer = resolve(ask("Gender"), facts=FACTS, locked_keys=LOCKED)
        assert answer.source_type is SourceType.LOCKED_FACT
        assert answer.value == "Decline to self-identify"
        assert answer.fact_ids == ("eeo.gender",)

    def test_sponsorship_reads_the_fact_that_matches_the_question(self):
        """The wording decides which fact answers, because it decides what was
        asked. "For this role" and "now or in the future" are two questions, and
        a student on CPT answers them opposite ways — both truthfully."""
        facts = {
            "work_authorization.requires_sponsorship_now": False,
            "work_authorization.requires_future_sponsorship": True,
        }
        locked = frozenset(facts)

        now = resolve(
            ask("Do you require sponsorship for this role?"), facts=facts, locked_keys=locked
        )
        later = resolve(
            ask("Will you now or in the future require sponsorship?"),
            facts=facts,
            locked_keys=locked,
        )

        assert now.value is False
        assert later.value is True
        assert now.source_type is SourceType.LOCKED_FACT

    def test_sponsorship_is_left_blank_when_its_fact_is_unset(self):
        """Nothing is assumed. An unset fact is a question for the user."""
        answer = resolve(
            ask("Will you now or in the future require sponsorship?"),
            facts={},
            locked_keys=frozenset(),
        )
        assert answer.source_type is SourceType.MANUAL_REQUIRED
        assert answer.value is None

    def test_eeo_is_never_inferred_only_prefilled_from_a_locked_preference(self):
        """§7.8: the system may prefill a locked EEO answer, never infer one."""
        without = resolve(ask("Gender"), facts={}, locked_keys=frozenset())
        assert without.source_type is SourceType.MANUAL_REQUIRED

        with_locked = resolve(ask("Gender"), facts=FACTS, locked_keys=LOCKED)
        assert with_locked.source_type is SourceType.LOCKED_FACT
        assert with_locked.value == "Decline to self-identify"


#: The locked fact that answers each auto-answerable key. A table rather than
#: ``{key: "Yes"}`` because the work-authorization keys read facts of their own
#: (:mod:`app.services.work_authorization`), which is the whole point of them.
_LOCKED_FACT_FOR: dict[str, dict[str, object]] = {
    "auth.work_authorized": {"work_authorization.is_authorized": True},
    "auth.requires_sponsorship": {"work_authorization.requires_future_sponsorship": True},
    "auth.citizenship": {"auth.citizenship": "Yes"},
    "background.criminal_history": {"background.criminal_history": "No"},
    "background.previously_employed": {"background.previously_employed": "No"},
    "background.noncompete": {"background.noncompete": "No"},
    "eeo.disability": {"eeo.disability": "Decline to self-identify"},
    "eeo.veteran_status": {"eeo.veteran_status": "Decline to self-identify"},
    "eeo.race_ethnicity": {"eeo.race_ethnicity": "Decline to self-identify"},
    "eeo.gender": {"eeo.gender": "Decline to self-identify"},
    "background.age_18_or_over": {"background.age_18_or_over": True},
    "background.previously_applied": {"background.previously_applied": False},
    "background.related_to_employee": {"background.related_to_employee": False},
    "background.referred_by_someone": {"background.referred_by_someone": False},
    "background.business_relationship": {"background.business_relationship": False},
    "legal.attestation": {"legal.attestation": True},
    "legal.signature": {"legal.signature": "Viet Hoan Nguyen"},
}


class TestDisclosureQuestions:
    """ "Is there anyone already connecting you to us?" — asked three ways.

    The operator's standing answer to all three is No, which is exactly why they
    have to stay distinguishable: three keys answered from three locked facts,
    not one pattern quietly answering questions it was not written for.
    """

    @pytest.mark.parametrize(
        ("question", "expected"),
        [
            # Relatives, friends, anyone already inside.
            (
                "Do you have any relatives currently employed by the Company?",
                "background.related_to_employee",
            ),
            (
                "Are you related to any employee, officer, or director of the firm?",
                "background.related_to_employee",
            ),
            (
                "Do you have a close personal relationship with anyone here?",
                "background.related_to_employee",
            ),
            (
                "Is your spouse or domestic partner employed by us?",
                "background.related_to_employee",
            ),
            # Someone put you forward.
            (
                "Were you referred to this role by a recruiting agency?",
                "background.referred_by_someone",
            ),
            (
                "Are you currently represented by a third-party recruiter?",
                "background.referred_by_someone",
            ),
            ("Were you recruited by EY?", "background.referred_by_someone"),
            (
                "Have you been submitted for this position by a staffing agency?",
                "background.referred_by_someone",
            ),
            # A prior commercial tie, through us or through anyone attached to us.
            (
                "Have you ever been employed by a partner firm or affiliate?",
                "background.business_relationship",
            ),
            (
                "Do you have a financial interest in the Company?",
                "background.business_relationship",
            ),
            (
                "Have you worked as a contractor for one of our vendors?",
                "background.business_relationship",
            ),
        ],
    )
    def test_they_are_recognised(self, question, expected):
        assert classify(ask(question)) == expected
        assert expected in LOCKED_FACT_ANSWERABLE_KEYS

    def test_a_relative_question_is_not_filed_under_prior_employment(self):
        """Two different questions, and answering one from the other's fact
        would be answering something the form did not ask."""
        assert (
            classify(ask("Have you or a family member ever worked for us?"))
            == "background.related_to_employee"
        )

    @pytest.mark.parametrize(
        "question",
        [
            "Describe your experience working with a partner team",
            "Tell us about a business problem you solved",
            "What is your search strategy for a hard bug?",
        ],
    )
    def test_free_text_is_not_swallowed(self, question):
        """The disclosure patterns answer Yes/No questions. Writing "No" into a
        "describe your experience" box would be nonsense on a real application,
        so anything they are not sure about stays unrecognised."""
        assert classify(ask(question)) not in LOCKED_FACT_ANSWERABLE_KEYS

    def test_the_standing_answer_is_no(self):
        facts = {
            "background.related_to_employee": False,
            "background.referred_by_someone": False,
            "background.business_relationship": False,
        }
        for key in facts:
            answer = resolve(ask(_question_for(key)), facts=facts, locked_keys=frozenset(facts))
            assert answer.source_type is SourceType.LOCKED_FACT
            assert answer.value is False
            assert answer.is_fillable, "a No must fill the field, not read as unanswered"


class TestCheckboxesAreNotQuestions:
    """A checkbox is one answer, and its label is that answer's name.

    Found on a real Chicago Trading Company form: under "How did you hear about
    us?" the options included "GitHub" and "CTC Website", both of which matched
    the link patterns, and both of which had a stored fact behind them. The
    system was about to tick two boxes claiming a referral source the user never
    had.
    """

    @pytest.mark.parametrize("option", ["GitHub", "CTC Website", "LinkedIn", "Glassdoor"])
    def test_an_option_label_does_not_get_ticked_from_a_url(self, option):
        answer = resolve(
            ask(option, field_type=FieldType.CHECKBOX),
            facts={
                "candidate.github": "https://github.com/henryng15",
                "candidate.portfolio": "https://hoanng.netlify.app/",
                "candidate.linkedin": "https://linkedin.com/in/hoanng15",
            },
        )
        # "Glassdoor" matches nothing and is UNRESOLVED; the other three match a
        # link pattern and are refused by the guard. Either way nobody ticks it.
        assert answer.needs_human
        assert answer.value is None
        assert not answer.is_fillable

    def test_a_real_yes_no_checkbox_still_works(self):
        """The consent box on the same form must keep working."""
        answer = resolve(
            ask(
                "I certify that the information provided is accurate", field_type=FieldType.CHECKBOX
            ),
            facts={"legal.attestation": True},
            locked_keys=frozenset({"legal.attestation"}),
        )
        assert answer.source_type is SourceType.LOCKED_FACT
        assert answer.value is True
        assert answer.is_fillable

    def test_an_unticked_box_is_still_an_answer(self):
        """False means "leave it unticked", not "we have no answer"."""
        answer = resolve(
            ask("Do you have any relatives employed here?", field_type=FieldType.CHECKBOX),
            facts={"background.related_to_employee": False},
            locked_keys=frozenset({"background.related_to_employee"}),
        )
        assert answer.value is False
        assert answer.is_fillable

    def test_the_same_label_as_a_text_field_is_unaffected(self):
        """The guard is about what ticking a box asserts, not about the label."""
        answer = resolve(ask("GitHub"), facts={"candidate.github": "https://github.com/henryng15"})
        assert answer.is_fillable


class TestTheTerm:
    """ "Which term are you applying for" is a question about the posting.

    No profile fact answers it, because the answer changes with the role. The
    caller works it out and passes it in, and the review screen says so.
    """

    @pytest.mark.parametrize(
        "question",
        [
            "Which term are you applying for?",
            "What semester are you applying for?",
            "Which internship season are you interested in?",
            "Internship term",
            "Please select the term you are applying for",
        ],
    )
    def test_it_is_recognised(self, question):
        assert classify(ask(question)) == "logistics.term"

    def test_a_derived_value_fills_it(self):
        answer = resolve(
            ask("Which term are you applying for?"),
            facts={},
            derived={"logistics.term": "Fall 2027"},
        )
        assert answer.source_type is SourceType.DERIVED_DETERMINISTIC
        assert answer.value == "Fall 2027"
        assert answer.is_fillable

    def test_without_one_it_asks_the_user(self):
        answer = resolve(ask("Which term are you applying for?"), facts={})
        assert answer.source_type is SourceType.MANUAL_REQUIRED

    @pytest.mark.parametrize("key", sorted(MANUAL_ONLY_KEYS))
    def test_the_derived_channel_cannot_answer_a_manual_only_question(self, key):
        """A second route for values into a form is a second route around the
        locked-fact rule, so the whitelist is what makes it safe rather than the
        good intentions of whoever populates the dict."""
        answer = resolve(
            ask(_question_for(key)),
            facts={},
            derived={key: "Yes"},
        )
        assert answer.source_type is SourceType.MANUAL_REQUIRED
        assert answer.value is None


class TestTheManualOnlySplit:
    """Which manual-only questions a locked fact may answer, and which it may not.

    The auto lane exists only because the first group can be answered once and
    reused. It stays honest only because the second group cannot.
    """

    def test_the_two_sets_partition_the_manual_only_keys(self):
        """A key in neither set would silently fall through to ordinary handling."""
        assert LOCKED_FACT_ANSWERABLE_KEYS | ALWAYS_MANUAL_KEYS == MANUAL_ONLY_KEYS
        assert not (LOCKED_FACT_ANSWERABLE_KEYS & ALWAYS_MANUAL_KEYS)

    def test_the_always_manual_set_is_exactly_what_policy_names(self):
        """Salary, relocation, the attestation and the signature used to be here.

        The operator was asked about each and gave a standing answer, which makes
        them facts about the operator rather than judgements about the role. What
        is left depends on the employer asking, not on the candidate.
        """
        assert set(ALWAYS_MANUAL_KEYS) == {
            "auth.security_clearance",
            "auth.export_control",
        }

    @pytest.mark.parametrize("key", sorted(ALWAYS_MANUAL_KEYS))
    def test_a_locked_fact_does_not_unlock_an_always_manual_question(self, key):
        """A clearance or export-control answer depends on which employer asks,
        and a signature is an act rather than a fact. A stored answer to any of
        them would be an answer to a different question than the one on the form.
        """
        answer = resolve(ask(_question_for(key)), facts={key: "Yes"}, locked_keys=frozenset({key}))
        assert answer.source_type is SourceType.MANUAL_REQUIRED
        assert answer.value is None

    @pytest.mark.parametrize("key", sorted(_LOCKED_FACT_FOR))
    def test_a_locked_fact_answers_a_constant_question(self, key):
        facts = _LOCKED_FACT_FOR[key]
        answer = resolve(ask(_question_for(key)), facts=facts, locked_keys=frozenset(facts))

        assert answer.source_type is SourceType.LOCKED_FACT
        assert answer.value is not None
        assert answer.is_fillable

    def test_the_fact_table_covers_every_answerable_key(self):
        """So a key added to the answerable set cannot skip the test above."""
        assert set(_LOCKED_FACT_FOR) | {"auth.work_authorized_without_sponsorship"} == (
            LOCKED_FACT_ANSWERABLE_KEYS
        )

    def test_the_combined_question_is_refused_even_with_every_fact_locked(self):
        """Listed as answerable, and still never answered.

        "Authorized to work without sponsorship" is one Yes/No spanning two
        questions whose polarity does not compose — see
        ``app/services/work_authorization.py``.
        """
        facts = {
            "work_authorization.is_authorized": True,
            "work_authorization.requires_future_sponsorship": True,
            "auth.work_authorized_without_sponsorship": True,
        }
        answer = resolve(
            ask(_question_for("auth.work_authorized_without_sponsorship")),
            facts=facts,
            locked_keys=frozenset(facts),
        )
        assert answer.source_type is SourceType.MANUAL_REQUIRED
        assert answer.value is None


def _question_for(key: str) -> str:
    """A question text that classifies to ``key``."""
    return {
        "auth.work_authorized": "Are you legally authorized to work in the US?",
        "auth.requires_sponsorship": "Will you now or in the future require sponsorship?",
        "auth.work_authorized_without_sponsorship": (
            "Are you legally authorized to work in the US without sponsorship?"
        ),
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
        "background.age_18_or_over": "Are you at least 18 years of age?",
        "background.previously_applied": "Have you previously applied to this company?",
        "background.related_to_employee": (
            "Do you have any relatives currently employed by the Company?"
        ),
        "background.referred_by_someone": (
            "Were you referred to this role by a recruiting agency?"
        ),
        "background.business_relationship": (
            "Do you have a business relationship with the Company?"
        ),
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
            ask("Are you legally authorized to work in the US?"),
            facts={"work_authorization.is_authorized": False},
            locked_keys=frozenset({"work_authorization.is_authorized"}),
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
