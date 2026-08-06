"""Candidate facts and locked-field enforcement (spec §7.1, §2.2).

The tests in ``TestAiCannotWriteLockedFacts`` are the ones that matter. They are
what stands between a prompt injection in a job description and a false statement
on a real application.
"""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.safety import SafetyViolation
from app.services.candidate import (
    ALWAYS_LOCKED_PREFIXES,
    Actor,
    Sensitivity,
    default_sensitivity,
    delete_fact,
    get_fact,
    get_value,
    is_always_locked,
    list_facts,
    set_fact,
)
from tests.helpers import not_none

pytestmark = pytest.mark.db

#: Representative always-locked keys, one per policy prefix.
LEGALLY_SENSITIVE = [
    # Locked because app.ats.fields will only answer these from a locked fact.
    # An unlocked one is not merely unprotected, it is unanswerable — and the
    # application it appears on stops forever.
    "auth.citizenship",
    "background.criminal_history",
    "candidate.legal_name",
    "candidate.date_of_birth",
    "candidate.graduation_date",
    "citizenship.status",
    "education.gpa",
    "education.graduation_date",
    "eeo.gender",
    "employment.history",
    "legal.attestation",
    "export_control.eligible",
    "work_authorization.requires_future_sponsorship",
]


class TestAlwaysLockedPolicy:
    @pytest.mark.parametrize("key", LEGALLY_SENSITIVE)
    def test_policy_keys_are_recognised(self, key):
        assert is_always_locked(key)

    @pytest.mark.parametrize(
        "key", ["candidate.preferred_name", "skills.python", "projects.thesis_ledger"]
    )
    def test_ordinary_keys_are_not(self, key):
        assert not is_always_locked(key)

    @pytest.mark.parametrize("key", LEGALLY_SENSITIVE)
    def test_requesting_unlocked_is_ignored_not_honoured(self, db: Session, key):
        """A caller cannot opt a legally sensitive fact out of protection."""
        fact = set_fact(db, key, "anything", actor=Actor.USER, is_locked=False)
        assert fact.is_locked is True

    def test_every_prefix_has_a_representative_test(self):
        """Guards against a prefix being added without a test alongside it."""
        untested = [
            prefix
            for prefix in ALWAYS_LOCKED_PREFIXES
            if not any(key.startswith(prefix) for key in LEGALLY_SENSITIVE)
        ]
        assert not untested, f"add a LEGALLY_SENSITIVE example for: {untested}"


class TestAiCannotWriteLockedFacts:
    @pytest.mark.parametrize("key", LEGALLY_SENSITIVE)
    def test_ai_is_refused_on_policy_locked_facts(self, db: Session, key):
        with pytest.raises(SafetyViolation, match="may not write the locked fact"):
            set_fact(db, key, "fabricated", actor=Actor.AI)

    def test_ai_is_refused_on_a_user_locked_fact(self, db: Session):
        set_fact(db, "candidate.phone", "+1-555-0100", actor=Actor.USER, is_locked=True)
        with pytest.raises(SafetyViolation):
            set_fact(db, "candidate.phone", "+1-555-9999", actor=Actor.AI)

    def test_ai_may_write_an_unlocked_fact(self, db: Session):
        """Drafting a free-text answer is legitimate model work (§7.8)."""
        fact = set_fact(db, "answers.why_this_company", "Because...", actor=Actor.AI)
        assert fact.value_json["value"] == "Because..."

    def test_a_refused_write_leaves_the_value_untouched(self, db: Session):
        """The check must happen before the update, not after."""
        set_fact(db, "work_authorization.requires_future_sponsorship", True, actor=Actor.USER)
        with pytest.raises(SafetyViolation):
            set_fact(db, "work_authorization.requires_future_sponsorship", False, actor=Actor.AI)
        assert get_value(db, "work_authorization.requires_future_sponsorship") is True

    def test_employer_policy_cannot_flip_the_candidate_answer(self, db: Session):
        """§2.2: a job description saying "no sponsorship" changes nothing here.

        Reading that sentence is a reason to skip or review the job. It is never a
        reason to answer the sponsorship question untruthfully, and there is no
        code path by which a model that read it can rewrite the answer.
        """
        key = "work_authorization.requires_future_sponsorship"
        set_fact(db, key, True, actor=Actor.USER)

        with pytest.raises(SafetyViolation):
            set_fact(db, key, False, actor=Actor.AI)

        assert get_value(db, key) is True


class TestSetAndGet:
    def test_round_trip(self, db: Session):
        set_fact(db, "candidate.preferred_name", "Henry", actor=Actor.USER)
        fact = not_none(get_fact(db, "candidate.preferred_name"))
        assert fact.value == "Henry"
        assert fact.source == Actor.USER

    def test_missing_fact_returns_none(self, db: Session):
        assert get_fact(db, "nope") is None
        assert get_value(db, "nope", default="fallback") == "fallback"

    def test_update_replaces_the_value(self, db: Session):
        set_fact(db, "candidate.phone", "old", actor=Actor.USER)
        set_fact(db, "candidate.phone", "new", actor=Actor.USER)
        assert get_value(db, "candidate.phone") == "new"
        assert len(list_facts(db, prefix="candidate.phone")) == 1

    @pytest.mark.parametrize("value", [True, False, 42, 3.5, "text", ["a", "b"], {"k": "v"}, None])
    def test_json_types_survive(self, db: Session, value):
        set_fact(db, "test.value", value, actor=Actor.USER)
        assert get_value(db, "test.value") == value

    def test_false_is_not_confused_with_missing(self, db: Session):
        """A sponsorship answer of False must not read as "unanswered"."""
        set_fact(db, "work_authorization.currently_authorized", False, actor=Actor.USER)
        assert get_value(db, "work_authorization.currently_authorized") is False
        assert not_none(get_fact(db, "work_authorization.currently_authorized")).value is False

    def test_empty_key_is_rejected(self, db: Session):
        with pytest.raises(ValueError, match="must not be empty"):
            set_fact(db, "   ", "x", actor=Actor.USER)

    def test_verification_is_recorded(self, db: Session):
        set_fact(db, "candidate.email", "a@b.com", actor=Actor.USER, verified=True)
        assert not_none(get_fact(db, "candidate.email")).is_verified

    def test_unverified_by_default(self, db: Session):
        set_fact(db, "candidate.email", "a@b.com", actor=Actor.IMPORT)
        assert not not_none(get_fact(db, "candidate.email")).is_verified


class TestSensitivity:
    @pytest.mark.parametrize(
        ("key", "expected"),
        [
            ("candidate.github", Sensitivity.PUBLIC),
            ("skills.python", Sensitivity.PUBLIC),
            ("candidate.address.street", Sensitivity.RESTRICTED),
            ("work_authorization.status", Sensitivity.RESTRICTED),
            ("eeo.veteran_status", Sensitivity.RESTRICTED),
            ("candidate.phone", Sensitivity.PERSONAL),
        ],
    )
    def test_derived_from_prefix(self, key, expected):
        assert default_sensitivity(key) == expected

    def test_unknown_keys_default_to_personal_not_public(self):
        """The cautious default: an unclassified fact is probably sensitive."""
        assert default_sensitivity("something.entirely.new") == Sensitivity.PERSONAL

    def test_explicit_sensitivity_wins(self, db: Session):
        set_fact(
            db, "skills.python", "expert", actor=Actor.USER, sensitivity=Sensitivity.RESTRICTED
        )
        assert not_none(get_fact(db, "skills.python")).sensitivity == Sensitivity.RESTRICTED


class TestListFacts:
    def test_filters_by_prefix(self, db: Session):
        set_fact(db, "skills.python", 1, actor=Actor.USER)
        set_fact(db, "skills.sql", 1, actor=Actor.USER)
        set_fact(db, "candidate.email", "a@b.com", actor=Actor.USER)
        assert {f.key for f in list_facts(db, prefix="skills.")} == {"skills.python", "skills.sql"}

    def test_returns_everything_without_a_prefix(self, db: Session):
        set_fact(db, "a.one", 1, actor=Actor.USER)
        set_fact(db, "b.two", 2, actor=Actor.USER)
        assert len(list_facts(db)) == 2


class TestDelete:
    def test_user_may_delete_a_locked_fact(self, db: Session):
        set_fact(db, "work_authorization.status", "x", actor=Actor.USER)
        assert delete_fact(db, "work_authorization.status", actor=Actor.USER)
        assert get_fact(db, "work_authorization.status") is None

    @pytest.mark.parametrize("actor", [Actor.AI, Actor.SYSTEM, Actor.IMPORT])
    def test_nobody_else_may_delete_a_locked_fact(self, db: Session, actor):
        set_fact(db, "work_authorization.status", "x", actor=Actor.USER)
        with pytest.raises(SafetyViolation, match="Only the user"):
            delete_fact(db, "work_authorization.status", actor=actor)

    def test_unlocked_facts_may_be_deleted_by_anyone(self, db: Session):
        set_fact(db, "answers.draft", "x", actor=Actor.AI)
        assert delete_fact(db, "answers.draft", actor=Actor.SYSTEM)

    def test_deleting_a_missing_fact_returns_false(self, db: Session):
        assert delete_fact(db, "nope", actor=Actor.USER) is False
