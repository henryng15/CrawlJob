"""Sponsorship analysis tests (spec §7.5, §2.2).

``TestFabricatedEvidenceIsRejected`` is the important class. A model asked to find
sponsorship language will occasionally produce a fluent sentence the posting does
not contain, and acting on that costs the user a job they were eligible for.
"""

from __future__ import annotations

import pytest

from app.services.llm.base import NullProvider
from app.services.sponsorship import (
    Classification,
    Evidence,
    RecommendedAction,
    SponsorshipAnalysis,
    WorkAuthRestriction,
    analyze,
    deterministic_prepass,
    enforce_evidence,
    recommend,
    verify_evidence,
)

NO_SPONSORSHIP_JD = (
    "About the role. You will build backend services in Python. "
    "Please note that we are unable to provide visa sponsorship for this position. "
    "Applicants must be authorized to work in the US."
)

SPONSORS_JD = (
    "We are hiring interns for summer 2027. Visa sponsorship is available for qualified candidates."
)

SILENT_JD = "Join our platform team. You will work on distributed systems in Go."

CITIZEN_JD = (
    "This position supports federal contracts. "
    "Applicants must be a US citizen due to contractual requirements."
)


def make(
    classification: Classification,
    restriction: WorkAuthRestriction = WorkAuthRestriction.UNKNOWN,
    quotes: list[str] | None = None,
    confidence: float = 0.9,
) -> SponsorshipAnalysis:
    return SponsorshipAnalysis(
        classification=classification,
        work_authorization_restriction=restriction,
        evidence=[Evidence(quote=q) for q in (quotes or [])],
        confidence=confidence,
    )


class TestDeterministicPrepass:
    def test_detects_explicit_refusal(self):
        hit = deterministic_prepass(NO_SPONSORSHIP_JD)
        assert hit.classification is Classification.SPONSORSHIP_NOT_AVAILABLE
        assert hit.evidence

    def test_quotes_the_whole_sentence(self):
        """A fragment like "not sponsor" is not something the user can act on."""
        hit = deterministic_prepass(NO_SPONSORSHIP_JD)
        assert "unable to provide visa sponsorship" in hit.evidence[0].quote
        assert hit.evidence[0].quote.endswith(".")

    def test_detects_offered_sponsorship(self):
        hit = deterministic_prepass(SPONSORS_JD)
        assert hit.classification is Classification.SPONSORSHIP_AVAILABLE

    def test_silence_yields_nothing(self):
        hit = deterministic_prepass(SILENT_JD)
        assert hit.classification is None
        assert hit.restriction is None
        assert hit.evidence == []

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("Applicants must be a US citizen.", WorkAuthRestriction.US_CITIZENSHIP_REQUIRED),
            (
                "Open to US citizens or lawful permanent residents.",
                WorkAuthRestriction.PERMANENT_RESIDENCY_OR_CITIZENSHIP_REQUIRED,
            ),
            (
                "This role is subject to export control regulations.",
                WorkAuthRestriction.EXPORT_CONTROL_REVIEW,
            ),
            (
                "You must be legally authorized to work in the US.",
                WorkAuthRestriction.US_WORK_AUTHORIZATION_REQUIRED,
            ),
        ],
    )
    def test_detects_work_authorization_restrictions(self, text, expected):
        assert deterministic_prepass(text).restriction is expected

    def test_citizenship_outranks_plain_work_authorization(self):
        """The stricter reading must win when both appear."""
        text = "Must be authorized to work in the US. Applicants must be a US citizen."
        assert (
            deterministic_prepass(text).restriction is WorkAuthRestriction.US_CITIZENSHIP_REQUIRED
        )


class TestVerifyEvidence:
    def test_real_quote_is_verified_and_located(self):
        analysis = make(
            Classification.SPONSORSHIP_NOT_AVAILABLE,
            quotes=["we are unable to provide visa sponsorship for this position"],
        )
        verified, rejected = verify_evidence(analysis, NO_SPONSORSHIP_JD)
        assert len(verified) == 1
        assert not rejected
        assert verified[0].is_located

    def test_absent_quote_is_rejected(self):
        analysis = make(
            Classification.SPONSORSHIP_NOT_AVAILABLE,
            quotes=["we categorically refuse to sponsor anyone, ever"],
        )
        verified, rejected = verify_evidence(analysis, NO_SPONSORSHIP_JD)
        assert not verified
        assert len(rejected) == 1

    @pytest.mark.parametrize(
        "quote",
        [
            "WE ARE UNABLE TO PROVIDE VISA SPONSORSHIP FOR THIS POSITION",
            "we  are   unable to provide\nvisa sponsorship for this position",
            "we are unable to provide visa sponsorship for this position",
        ],
    )
    def test_cosmetic_differences_still_verify(self, quote):
        """Normalising whitespace or case is not fabrication."""
        analysis = make(Classification.SPONSORSHIP_NOT_AVAILABLE, quotes=[quote])
        verified, _ = verify_evidence(analysis, NO_SPONSORSHIP_JD)
        assert len(verified) == 1

    def test_smart_punctuation_still_verifies(self):
        jd = "We don't offer sponsorship."
        analysis = make(Classification.SPONSORSHIP_NOT_AVAILABLE, quotes=["We don’t offer"])
        verified, _ = verify_evidence(analysis, jd)
        assert len(verified) == 1


class TestFabricatedEvidenceIsRejected:
    def test_restrictive_claim_without_evidence_is_downgraded(self):
        """§7.5: a restrictive classification with no quote must not stand."""
        analysis = make(Classification.SPONSORSHIP_NOT_AVAILABLE, quotes=[])
        result = enforce_evidence(analysis, SILENT_JD)
        assert result.classification is Classification.SPONSORSHIP_AMBIGUOUS
        assert result.work_authorization_restriction is WorkAuthRestriction.UNKNOWN

    def test_restrictive_claim_with_a_fabricated_quote_is_downgraded(self):
        analysis = make(
            Classification.SPONSORSHIP_NOT_AVAILABLE,
            restriction=WorkAuthRestriction.US_CITIZENSHIP_REQUIRED,
            quotes=["This role is open only to United States citizens."],
        )
        result = enforce_evidence(analysis, SILENT_JD)
        assert result.classification is Classification.SPONSORSHIP_AMBIGUOUS
        assert "not found in the job description" in result.reasoning_summary

    def test_downgrade_lowers_confidence(self):
        analysis = make(
            Classification.SPONSORSHIP_NOT_AVAILABLE, quotes=["invented"], confidence=0.99
        )
        assert enforce_evidence(analysis, SILENT_JD).confidence <= 0.3

    def test_a_downgrade_routes_to_manual_review_not_to_skip(self):
        """Uncertainty must reach a human, not silently drop the job."""
        analysis = make(Classification.SPONSORSHIP_NOT_AVAILABLE, quotes=["invented"])
        downgraded = enforce_evidence(analysis, SILENT_JD)
        assert (
            recommend(downgraded, candidate_needs_sponsorship=True)
            is RecommendedAction.MANUAL_REVIEW
        )

    def test_genuine_restrictive_claim_survives(self):
        analysis = make(
            Classification.SPONSORSHIP_NOT_AVAILABLE,
            quotes=["we are unable to provide visa sponsorship for this position"],
        )
        assert (
            enforce_evidence(analysis, NO_SPONSORSHIP_JD).classification
            is Classification.SPONSORSHIP_NOT_AVAILABLE
        )

    def test_non_restrictive_claims_are_not_downgraded(self):
        """NOT_MENTIONED needs no evidence — it is a statement about absence."""
        analysis = make(Classification.SPONSORSHIP_NOT_MENTIONED)
        result = enforce_evidence(analysis, SILENT_JD)
        assert result.classification is Classification.SPONSORSHIP_NOT_MENTIONED

    def test_fabricated_quotes_are_stripped_even_when_one_is_real(self):
        analysis = make(
            Classification.SPONSORSHIP_NOT_AVAILABLE,
            quotes=[
                "we are unable to provide visa sponsorship for this position",
                "and we never will, under any circumstances",
            ],
        )
        result = enforce_evidence(analysis, NO_SPONSORSHIP_JD)
        assert len(result.evidence) == 1


class TestRecommend:
    def test_citizen_only_role_is_skipped_for_a_non_citizen(self):
        analysis = make(
            Classification.SPONSORSHIP_NOT_MENTIONED, WorkAuthRestriction.US_CITIZENSHIP_REQUIRED
        )
        assert recommend(analysis, candidate_needs_sponsorship=True) is RecommendedAction.SKIP

    def test_citizen_only_role_continues_for_a_citizen(self):
        analysis = make(
            Classification.SPONSORSHIP_NOT_MENTIONED, WorkAuthRestriction.US_CITIZENSHIP_REQUIRED
        )
        result = recommend(
            analysis, candidate_needs_sponsorship=False, candidate_is_us_citizen=True
        )
        assert result is RecommendedAction.CONTINUE

    def test_permanent_resident_satisfies_the_pr_or_citizen_requirement(self):
        analysis = make(
            Classification.SPONSORSHIP_NOT_MENTIONED,
            WorkAuthRestriction.PERMANENT_RESIDENCY_OR_CITIZENSHIP_REQUIRED,
        )
        assert (
            recommend(
                analysis,
                candidate_needs_sponsorship=False,
                candidate_is_permanent_resident=True,
            )
            is RecommendedAction.CONTINUE
        )

    def test_export_control_always_asks_a_human(self):
        """§3.2 and §27 forbid inferring export-control eligibility."""
        analysis = make(
            Classification.SPONSORSHIP_NOT_MENTIONED, WorkAuthRestriction.EXPORT_CONTROL_REVIEW
        )
        for citizen in (True, False):
            assert (
                recommend(
                    analysis,
                    candidate_needs_sponsorship=not citizen,
                    candidate_is_us_citizen=citizen,
                )
                is RecommendedAction.MANUAL_REVIEW
            )

    def test_no_sponsorship_is_review_not_automatic_skip(self):
        """§7.5: the user decides whether to apply anyway."""
        analysis = make(Classification.SPONSORSHIP_NOT_AVAILABLE, quotes=["x" * 10])
        assert (
            recommend(analysis, candidate_needs_sponsorship=True) is RecommendedAction.MANUAL_REVIEW
        )

    def test_silence_does_not_block_the_application(self):
        """Most postings never mention sponsorship; treating that as a refusal
        would reject nearly everything."""
        analysis = make(Classification.SPONSORSHIP_NOT_MENTIONED)
        assert recommend(analysis, candidate_needs_sponsorship=True) is RecommendedAction.CONTINUE

    def test_a_candidate_who_needs_nothing_is_unaffected_by_policy(self):
        analysis = make(Classification.SPONSORSHIP_NOT_AVAILABLE, quotes=["x" * 10])
        assert recommend(analysis, candidate_needs_sponsorship=False) is RecommendedAction.CONTINUE


class TestAnalyze:
    def test_clear_language_never_calls_the_model(self):
        """The deterministic pass exists to keep the budget for hard cases."""
        provider = NullProvider()
        result = analyze(NO_SPONSORSHIP_JD, provider=provider)
        assert provider.calls == []
        assert result.classification is Classification.SPONSORSHIP_NOT_AVAILABLE

    def test_ambiguous_language_falls_back_to_the_model(self):
        provider = NullProvider(
            [
                {
                    "classification": "SPONSORSHIP_AMBIGUOUS",
                    "work_authorization_restriction": "UNKNOWN",
                    "evidence": [],
                    "confidence": 0.5,
                    "reasoning_summary": "Wording is unclear.",
                }
            ]
        )
        result = analyze(SILENT_JD, provider=provider)
        assert len(provider.calls) == 1
        assert result.classification is Classification.SPONSORSHIP_AMBIGUOUS

    def test_model_output_is_evidence_checked(self):
        """The driver must not return a model claim it has not verified."""
        provider = NullProvider(
            [
                {
                    "classification": "SPONSORSHIP_NOT_AVAILABLE",
                    "work_authorization_restriction": "US_CITIZENSHIP_REQUIRED",
                    "evidence": [{"quote": "a sentence this posting does not contain"}],
                    "confidence": 0.95,
                    "reasoning_summary": "",
                }
            ]
        )
        result = analyze(SILENT_JD, provider=provider)
        assert result.classification is Classification.SPONSORSHIP_AMBIGUOUS

    def test_empty_description_is_not_mentioned(self):
        provider = NullProvider()
        result = analyze("", provider=provider)
        assert result.classification is Classification.SPONSORSHIP_NOT_MENTIONED
        assert provider.calls == []

    def test_citizenship_case_is_handled_deterministically(self):
        """A citizenship requirement settles the recommendation on its own.

        The posting says nothing about sponsorship, but it does not need to: a
        non-citizen is ineligible either way, so spending a model call here would
        buy nothing.
        """
        provider = NullProvider()
        result = analyze(CITIZEN_JD, provider=provider)
        assert provider.calls == []
        assert result.work_authorization_restriction is WorkAuthRestriction.US_CITIZENSHIP_REQUIRED
        assert result.evidence

    def test_an_unmatched_half_is_reported_as_unknown_not_asserted(self):
        """The pre-pass must not claim the posting is silent on what it did not scan for."""
        provider = NullProvider()
        result = analyze(CITIZEN_JD, provider=provider)
        assert result.classification is Classification.SPONSORSHIP_NOT_MENTIONED
        assert result.confidence < 0.95, "lower confidence when only one half matched"


class TestWithoutAModel:
    """LLM_PROVIDER=null must not break the pipeline (§26.2, README)."""

    def test_a_posting_the_prepass_cannot_settle_degrades_rather_than_failing(self):
        from app.services.llm.base import NullProvider

        analysis = analyze(
            "Software Engineer Intern. Python and FastAPI work on our platform team.",
            provider=NullProvider(),  # no queued response: any call raises
        )
        assert analysis.classification is Classification.SPONSORSHIP_NOT_MENTIONED
        assert analysis.work_authorization_restriction is WorkAuthRestriction.UNKNOWN

    def test_the_degraded_answer_admits_its_own_weakness(self):
        """A user reading NOT_MENTIONED deserves to know nothing read it."""
        from app.services.llm.base import NullProvider

        analysis = analyze(
            "Software Engineer Intern. You will write Python on the platform team.",
            provider=NullProvider(),
        )
        assert analysis.confidence <= 0.3
        assert "no model was available" in (analysis.reasoning_summary or "")

    def test_degrading_never_makes_a_restrictive_posting_permissive(self):
        """The keyword pre-pass runs first, so an explicit refusal still lands."""
        from app.services.llm.base import NullProvider

        analysis = analyze(
            "We are unable to sponsor or take over sponsorship of an employment visa.",
            provider=NullProvider(),
        )
        assert analysis.classification is Classification.SPONSORSHIP_NOT_AVAILABLE
        assert analysis.evidence
