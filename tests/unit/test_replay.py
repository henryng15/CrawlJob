"""Replay package tests (spec §7.11)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.ats.fields import Answer, FieldSpec, FieldType, SourceType, resolve
from app.ats.replay import (
    ReplayPackage,
    Strategy,
    build_locators,
    build_package,
    check_replayable,
    page_fingerprint,
)

NOW = datetime(2026, 7, 28, tzinfo=UTC)

FACTS = {
    "candidate.first_name": "Hoan",
    "candidate.email": "nguyen15@kenyon.edu",
    "auth.requires_sponsorship": True,
}
LOCKED = frozenset({"auth.requires_sponsorship"})

FORM = [
    FieldSpec("First Name", FieldType.TEXT, name="first_name", required=True),
    FieldSpec("Email", FieldType.EMAIL, name="email", required=True),
    FieldSpec(
        "Will you now or in the future require sponsorship?",
        FieldType.SELECT,
        name="sponsorship",
        required=True,
        options=("Yes", "No"),
    ),
    FieldSpec("Gender", FieldType.SELECT, name="eeo_gender"),
    FieldSpec("Describe your ideal build system", FieldType.TEXTAREA, name="custom_1"),
]


def package(specs: list[FieldSpec] | None = None) -> ReplayPackage:
    specs = specs or FORM
    answers = [resolve(s, facts=FACTS, locked_keys=LOCKED) for s in specs]
    return build_package(
        application_id="app-1",
        application_url="https://boards.greenhouse.io/acme/jobs/1",
        ats_type="GREENHOUSE",
        specs=specs,
        answers=answers,
        created_at=NOW,
    )


class TestLocatorOrdering:
    def test_the_accessible_label_comes_first(self):
        """A CSS selector is the first thing an ATS redesign breaks."""
        locators = build_locators(FORM[0])
        assert locators[0].strategy is Strategy.ACCESSIBLE_LABEL

    def test_locators_are_ordered_by_durability(self):
        spec = FieldSpec(
            "First Name",
            FieldType.TEXT,
            name="first_name",
            locator={"css": "#app > div:nth-child(3) input", "nearby_text": "Your details"},
        )
        strategies = [loc.strategy for loc in build_locators(spec)]
        assert strategies == sorted(strategies)
        assert strategies[-1] is Strategy.CSS_SELECTOR

    def test_a_role_is_derived_for_aria_lookup(self):
        locators = build_locators(FORM[2])
        aria = next(loc for loc in locators if loc.strategy is Strategy.ARIA_ROLE_NAME)
        assert aria.role == "combobox"

    def test_a_field_with_no_label_still_gets_a_name_locator(self):
        locators = build_locators(FieldSpec("", FieldType.TEXT, name="opaque_id"))
        assert [loc.strategy for loc in locators] == [Strategy.NAME_ATTRIBUTE]

    def test_every_field_gets_at_least_one_locator(self):
        for spec in FORM:
            assert build_locators(spec)


class TestPackageAssembly:
    def test_fillable_and_manual_fields_are_separated(self):
        pkg = package()
        fillable = {f.semantic_key for f in pkg.fields}
        manual = {f.semantic_key for f in pkg.manual_fields}

        assert "candidate.first_name" in fillable
        assert "auth.requires_sponsorship" in fillable, "locked facts are fillable"
        assert "eeo.gender" in manual
        assert None in manual, "the unrecognised question needs a human"

    def test_manual_fields_carry_no_value_to_type(self):
        """Replay must not put anything into a field policy reserved for a human."""
        for item in package().manual_fields:
            assert item.value is None

    def test_source_type_survives_into_the_package(self):
        pkg = package()
        sponsorship = next(f for f in pkg.fields if f.semantic_key == "auth.requires_sponsorship")
        assert sponsorship.source_type is SourceType.LOCKED_FACT

    def test_mismatched_specs_and_answers_are_rejected(self):
        with pytest.raises(ValueError, match="parallel"):
            build_package(
                application_id="a",
                application_url="u",
                ats_type="GREENHOUSE",
                specs=FORM,
                answers=[Answer(None, None, SourceType.UNRESOLVED)],
                created_at=NOW,
            )

    def test_the_package_serialises_to_json_safe_types(self):
        import json

        json.dumps(package().to_json())

    def test_serialisation_preserves_locator_order(self):
        data = package().to_json()
        first = data["fields"][0]
        assert first["locators"][0]["strategy"] == "ACCESSIBLE_LABEL"


class TestFingerprint:
    def test_the_same_form_fingerprints_identically(self):
        assert page_fingerprint(FORM) == page_fingerprint(FORM)

    def test_field_order_does_not_change_the_fingerprint(self):
        """A form that reorders its questions is still the same form."""
        assert page_fingerprint(FORM) == page_fingerprint(list(reversed(FORM)))

    def test_adding_a_question_changes_it(self):
        extended = [*FORM, FieldSpec("New question", FieldType.TEXT)]
        assert page_fingerprint(extended) != page_fingerprint(FORM)

    def test_changing_a_field_type_changes_it(self):
        altered = [*FORM[:-1], FieldSpec("Describe your ideal build system", FieldType.SELECT)]
        assert page_fingerprint(altered) != page_fingerprint(FORM)

    def test_renaming_the_name_attribute_alone_does_not(self):
        """The user sees labels, not `name` attributes; a rename is cosmetic."""
        renamed = [
            FieldSpec(s.question_text, s.field_type, name=f"{s.name}_v2", required=s.required)
            for s in FORM
        ]
        assert page_fingerprint(renamed) == page_fingerprint(FORM)


class TestReplayability:
    def test_an_unchanged_form_replays(self):
        check = check_replayable(package(), FORM)
        assert check.can_replay
        assert "unchanged" in check.reason

    def test_a_form_that_gained_a_question_still_replays(self):
        """The stored answers still map; the new question becomes manual work."""
        extended = [*FORM, FieldSpec("Do you have a security clearance?", FieldType.SELECT)]
        check = check_replayable(package(), extended)
        assert check.can_replay
        assert check.changed_fields

    def test_a_form_that_lost_a_question_stops_replay(self):
        """§7.11: a material change requires a human, not a best guess."""
        check = check_replayable(package(), FORM[:-2])
        assert not check.can_replay
        assert "changed materially" in check.reason

    def test_the_missing_questions_are_named(self):
        check = check_replayable(package(), FORM[:2])
        assert len(check.changed_fields) == 3

    def test_a_wholly_different_form_stops_replay(self):
        """The failure this prevents: typing a stored answer into the wrong box."""
        other = [
            FieldSpec("Full legal name", FieldType.TEXT),
            FieldSpec("Postal code", FieldType.TEXT),
        ]
        assert not check_replayable(package(), other).can_replay


class TestRealisticExpiry:
    def test_a_session_expiring_overnight_is_recoverable(self):
        """The scenario the package exists for (§7.11).

        Storage state alone would restore the login and lose every typed answer.
        """
        pkg = package()
        assert pkg.fields, "answers were captured"
        assert check_replayable(pkg, FORM).can_replay

    def test_an_ats_redesign_is_not_silently_replayed(self):
        redesigned = [
            FieldSpec("Given name", FieldType.TEXT, name="given_name"),
            FieldSpec("Email address", FieldType.EMAIL, name="email_address"),
        ]
        check = check_replayable(package(), redesigned)
        assert not check.can_replay
