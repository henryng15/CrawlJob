"""Resume tailoring and provenance validation (spec §7.7).

Each test in ``TestForbiddenChanges`` corresponds to one line of §7.7's disallowed
list, and to one thing the user would have to defend in an interview.
"""

from __future__ import annotations

from typing import Any, ClassVar

import pytest

from app.services.llm.base import NullProvider, Task
from app.services.resume import (
    Action,
    Bullet,
    BulletOp,
    ResumeFact,
    TailoringPlan,
    Transformation,
    ViolationKind,
    tailor,
    validate_bullet,
    validate_plan,
)

FACTS = {
    "exp.todd.1": ResumeFact(
        id="exp.todd.1",
        text=(
            "Built a FastAPI service at Todd Labs that cut report generation from 40 minutes to 6."
        ),
        organisation="Todd Labs",
        technologies=frozenset({"fastapi", "python", "postgres"}),
    ),
    "exp.todd.2": ResumeFact(
        id="exp.todd.2",
        text="Contributed to a PostgreSQL migration affecting 12 internal services at Todd Labs.",
        organisation="Todd Labs",
        technologies=frozenset({"postgresql", "python"}),
    ),
    "proj.ledger": ResumeFact(
        id="proj.ledger",
        text="Led ThesisLedger, a DuckDB-backed research tool used by 30 students.",
        organisation="ThesisLedger",
        technologies=frozenset({"duckdb", "python"}),
        kind="project",
    ),
}


def bullet(text: str, *fact_ids: str) -> Bullet:
    return Bullet(text=text, fact_ids=list(fact_ids), transformation=Transformation.REWRITE)


def plan_of(*bullets: Bullet, **kw) -> TailoringPlan:
    """A plan expressed as rewrites, one per bullet.

    Ids are synthetic here: this file tests provenance validation, which cares
    about what a bullet claims rather than where it goes. Placement is
    ``tests/unit/test_resume_edits.py``.
    """
    return TailoringPlan(
        operations=[
            BulletOp(
                bullet_id=f"work-experience.todd.{index}",
                action=Action.REWRITE,
                text=item.text,
                fact_ids=item.fact_ids,
                transformation=item.transformation,
            )
            for index, item in enumerate(bullets, start=1)
        ],
        **kw,
    )


def rewrite(bullet_id: str, text: str, *fact_ids: str) -> dict[str, Any]:
    return {
        "bullet_id": bullet_id,
        "action": "rewrite",
        "text": text,
        "fact_ids": list(fact_ids),
    }


def kinds(violations) -> set[ViolationKind]:
    return {v.kind for v in violations}


class TestAllowedChanges:
    def test_a_verbatim_bullet_passes(self):
        assert validate_bullet(bullet(FACTS["exp.todd.1"].text, "exp.todd.1"), FACTS) == []

    def test_shortening_passes(self):
        """§7.7 allows shortening wording."""
        assert (
            validate_bullet(
                bullet(
                    "Built a FastAPI service cutting report generation to 6 minutes.", "exp.todd.1"
                ),
                FACTS,
            )
            == []
        )

    def test_emphasising_a_supported_technology_passes(self):
        assert (
            validate_bullet(
                bullet("Built Python and FastAPI services at Todd Labs.", "exp.todd.1"), FACTS
            )
            == []
        )

    def test_merging_two_facts_passes(self):
        assert (
            validate_bullet(
                bullet(
                    "Built a FastAPI service and contributed to a PostgreSQL "
                    "migration at Todd Labs.",
                    "exp.todd.1",
                    "exp.todd.2",
                ),
                FACTS,
            )
            == []
        )

    def test_dropping_the_metric_entirely_passes(self):
        """Saying less is always safe; saying more is what needs checking."""
        assert (
            validate_bullet(bullet("Built a FastAPI service at Todd Labs.", "exp.todd.1"), FACTS)
            == []
        )


class TestForbiddenChanges:
    def test_an_invented_metric_is_caught(self):
        """The rounding-up failure: 40-to-6 becomes "by 90%"."""
        violations = validate_bullet(
            bullet("Cut report generation by 95% at Todd Labs.", "exp.todd.1"), FACTS
        )
        assert ViolationKind.INVENTED_METRIC in kinds(violations)

    def test_an_inflated_count_is_caught(self):
        violations = validate_bullet(
            bullet("Migrated 120 internal services to PostgreSQL.", "exp.todd.2"), FACTS
        )
        assert ViolationKind.INVENTED_METRIC in kinds(violations)

    def test_an_invented_technology_is_caught(self):
        """The interview question the user cannot answer."""
        violations = validate_bullet(
            bullet("Built a FastAPI service on Kubernetes at Todd Labs.", "exp.todd.1"), FACTS
        )
        assert ViolationKind.INVENTED_TECHNOLOGY in kinds(violations)

    def test_an_invented_employer_is_caught(self):
        violations = validate_bullet(
            bullet("Built a FastAPI service at Stripe.", "exp.todd.1"), FACTS
        )
        assert ViolationKind.INVENTED_ORGANISATION in kinds(violations)

    def test_inflated_ownership_is_caught(self):
        """§7.7: a contributor must not become a lead."""
        violations = validate_bullet(
            bullet("Led a PostgreSQL migration across 12 services.", "exp.todd.2"), FACTS
        )
        assert ViolationKind.INFLATED_OWNERSHIP in kinds(violations)

    def test_genuine_ownership_is_not_flagged(self):
        """The fact says "Led", so the bullet may too."""
        violations = validate_bullet(
            bullet("Led ThesisLedger, used by 30 students.", "proj.ledger"), FACTS
        )
        assert ViolationKind.INFLATED_OWNERSHIP not in kinds(violations)

    def test_an_uncited_bullet_is_rejected(self):
        violations = validate_bullet(bullet("Did impressive things."), FACTS)
        assert kinds(violations) == {ViolationKind.NO_CITATION}

    def test_citing_a_fact_that_does_not_exist_is_rejected(self):
        violations = validate_bullet(bullet("Built things.", "exp.nonexistent"), FACTS)
        assert ViolationKind.UNKNOWN_FACT in kinds(violations)

    def test_borrowing_a_metric_from_an_uncited_fact_is_caught(self):
        """Citing one fact does not license figures from another."""
        violations = validate_bullet(
            bullet("Built a service used by 30 students.", "exp.todd.1"), FACTS
        )
        assert ViolationKind.INVENTED_METRIC in kinds(violations)

    @pytest.mark.parametrize(
        "text",
        [
            "Builds Python and FastAPI services at Todd Labs.",
            "Delivers FastAPI services at Todd Labs.",
            "Maintains a FastAPI service at Todd Labs.",
        ],
    )
    def test_a_sentence_initial_verb_is_not_an_organisation(self, text):
        """Regression: a capitalised first word is grammar, not a company name.

        The validator briefly read "Builds Python services" as naming a company
        called Builds, which no stopword list of English verbs would have fixed.
        """
        violations = validate_bullet(bullet(text, "exp.todd.1"), FACTS)
        assert ViolationKind.INVENTED_ORGANISATION not in kinds(violations)

    def test_a_company_name_mid_sentence_is_still_caught(self):
        """The rule must not weaken the check it exists to make workable."""
        violations = validate_bullet(
            bullet("Builds FastAPI services at Datadog.", "exp.todd.1"), FACTS
        )
        assert ViolationKind.INVENTED_ORGANISATION in kinds(violations)

    def test_years_are_not_treated_as_metrics(self):
        """ "since 2024" is a date, not a claim about scale."""
        violations = validate_bullet(
            bullet("Built a FastAPI service at Todd Labs in 2025.", "exp.todd.1"), FACTS
        )
        assert ViolationKind.INVENTED_METRIC not in kinds(violations)


class TestPlanValidation:
    def test_a_clean_plan_passes(self):
        plan = plan_of(
            bullet("Built a FastAPI service at Todd Labs.", "exp.todd.1"),
            bullet("Led ThesisLedger, used by 30 students.", "proj.ledger"),
        )
        result = validate_plan(plan, FACTS)
        assert result.passed
        assert len(result.validated) == 2

    def test_one_bad_bullet_fails_the_whole_plan(self):
        """§7.7: an unsupported claim blocks the resume.

        The user cannot be asked to spot which of eight lines was invented.
        """
        plan = plan_of(
            bullet("Built a FastAPI service at Todd Labs.", "exp.todd.1"),
            bullet("Scaled the platform to 4 million users.", "exp.todd.1"),
        )
        result = validate_plan(plan, FACTS)
        assert not result.passed
        assert len(result.validated) == 1

    def test_the_summary_is_validated_too(self):
        plan = TailoringPlan(
            summary="Senior engineer at Google with 10 years of experience.",
            summary_fact_ids=["exp.todd.1"],
        )
        result = validate_plan(plan, FACTS)
        assert not result.passed

    def test_an_empty_summary_is_not_validated(self):
        plan = plan_of(bullet("Built a FastAPI service.", "exp.todd.1"))
        assert validate_plan(plan, FACTS).passed

    def test_a_summary_grounded_in_facts_passes(self):
        plan = TailoringPlan(
            summary="Builds Python and FastAPI services at Todd Labs.",
            summary_fact_ids=["exp.todd.1"],
        )
        assert validate_plan(plan, FACTS).passed

    def test_the_summary_names_the_violation_kinds(self):
        plan = plan_of(bullet("Scaled to 4 million users.", "exp.todd.1"))
        assert "INVENTED_METRIC" in validate_plan(plan, FACTS).summary()


class TestTailor:
    CLEAN: ClassVar[dict[str, Any]] = {
        "summary": "",
        "summary_fact_ids": [],
        "operations": [
            rewrite(
                "work-experience.todd.1",
                "Built a FastAPI service at Todd Labs.",
                "exp.todd.1",
            )
        ],
        "section_order": ["experience", "projects"],
    }

    DIRTY: ClassVar[dict[str, Any]] = {
        "summary": "",
        "summary_fact_ids": [],
        "operations": [
            rewrite(
                "work-experience.todd.1",
                "Scaled the platform to 4 million users at Stripe.",
                "exp.todd.1",
            )
        ],
        "section_order": [],
    }

    def test_a_clean_plan_is_returned_validated(self):
        provider = NullProvider([self.CLEAN])
        plan, result = tailor(
            facts=FACTS,
            job_title="Software Engineer Intern",
            job_description="Python backend work.",
            provider=provider,
        )
        assert result.passed
        assert len(plan.bullets) == 1

    def test_the_writing_model_is_used(self):
        """§11.6 routes resume work to the stronger model."""
        provider = NullProvider([self.CLEAN])
        tailor(facts=FACTS, job_title="T", job_description="D", provider=provider)
        assert provider.calls[0][0] is Task.RESUME_PLAN
        assert provider.calls[0][1] == "null-writing"

    def test_a_rejected_plan_is_retried_with_the_violations(self):
        """Models fix a named, specific problem reliably."""
        provider = NullProvider([self.DIRTY, self.CLEAN])
        plan, result = tailor(facts=FACTS, job_title="T", job_description="D", provider=provider)
        assert len(provider.calls) == 2
        assert result.passed
        assert "Todd Labs" in plan.bullets[0].text

    def test_the_retry_prompt_names_the_violations(self):
        provider = NullProvider([self.DIRTY, self.CLEAN])
        tailor(facts=FACTS, job_title="T", job_description="D", provider=provider)
        retry_messages = provider.calls[1][2]
        assert any("INVENTED_METRIC" in m.content for m in retry_messages)


    def test_a_plan_that_fails_twice_is_returned_as_a_failure(self):
        """§7.7: block, do not quietly ship a weakened resume."""
        provider = NullProvider([self.DIRTY, self.DIRTY])
        _, result = tailor(facts=FACTS, job_title="T", job_description="D", provider=provider)
        assert not result.passed

    def test_the_facts_are_supplied_with_their_ids(self):
        """The model can only cite ids it was shown."""
        provider = NullProvider([self.CLEAN])
        tailor(facts=FACTS, job_title="T", job_description="D", provider=provider)
        prompt = provider.calls[0][2][1].content
        for fact_id in FACTS:
            assert f"[{fact_id}]" in prompt


class TestTheModelIsGivenTheBulletIds:
    """It can only address bullets it was shown.

    A model with no inventory can only guess at ids, and every guess is refused —
    so this is not a nicety, it is the difference between tailoring working and
    every application going out unchanged.
    """

    INVENTORY: ClassVar[list[dict[str, str]]] = [
        {
            "bullet_id": "work-experience.todd-labs.1",
            "section": "Work Experience",
            "entry": "Todd Labs",
            "text": "Built a FastAPI service",
        },
        {
            "bullet_id": "projects.thesisledger.1",
            "section": "Projects",
            "entry": "ThesisLedger",
            "text": "A DuckDB-backed research tool",
        },
    ]

    def prompt_of(self, provider: NullProvider) -> str:
        return "\n".join(m.content for m in provider.calls[0][2])

    def test_every_id_reaches_the_prompt(self):
        provider = NullProvider([TestTailor.CLEAN])
        tailor(
            facts=FACTS,
            job_title="T",
            job_description="D",
            provider=provider,
            bullets=self.INVENTORY,
        )
        body = self.prompt_of(provider)
        for item in self.INVENTORY:
            assert item["bullet_id"] in body

    def test_each_id_arrives_with_its_section_and_entry(self):
        """So the model can echo them back as a cross-check."""
        provider = NullProvider([TestTailor.CLEAN])
        tailor(
            facts=FACTS,
            job_title="T",
            job_description="D",
            provider=provider,
            bullets=self.INVENTORY,
        )
        body = self.prompt_of(provider)
        assert "(Work Experience / Todd Labs)" in body
        assert "(Projects / ThesisLedger)" in body

    def test_the_instructions_forbid_inventing_an_id(self):
        from app.services.resume import SYSTEM_PROMPT

        assert "must be one you were given" in SYSTEM_PROMPT
        assert "never use the same" in SYSTEM_PROMPT

    def test_the_instructions_forbid_citing_another_employers_facts(self):
        from app.services.resume import SYSTEM_PROMPT

        assert "same employer or project" in SYSTEM_PROMPT

    def test_the_prompt_version_records_the_new_contract(self):
        """A plan produced under v1 has no bullet ids at all, so a stored artifact
        has to say which contract it came from."""
        from app.services.resume import PROMPT_VERSION

        assert PROMPT_VERSION == "resume/v2"

class TestBulletSchema:
    def test_an_empty_bullet_is_rejected(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            Bullet(text="", fact_ids=["exp.todd.1"])
