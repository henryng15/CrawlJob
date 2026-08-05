"""Job fit scoring tests (spec §7.6)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

from app.domain.normalization import normalize_location, normalize_title
from app.services.eligibility import Verdict
from app.services.scoring import (
    WEIGHTS,
    ScoreInput,
    score,
)
from app.services.sponsorship import (
    Classification,
    Evidence,
    SponsorshipAnalysis,
    WorkAuthRestriction,
)

NOW = datetime(2026, 7, 28, tzinfo=UTC)
GRADUATION = date(2028, 5, 1)


def job(title: str = "Software Engineer Intern, Summer 2027", **kw: object) -> ScoreInput:
    defaults = {
        "normalized_title": normalize_title(title),
        "normalized_location": normalize_location(
            kw.pop("location", "San Francisco, CA")  # type: ignore[arg-type]
        ),
        "season": "SUMMER_2027",
        "posted_at": NOW - timedelta(days=2),
        "graduation_date": GRADUATION,
    }
    return ScoreInput(**{**defaults, **kw})  # type: ignore[arg-type]


def sponsorship(
    classification: Classification = Classification.SPONSORSHIP_NOT_MENTIONED,
    restriction: WorkAuthRestriction = WorkAuthRestriction.UNKNOWN,
) -> SponsorshipAnalysis:
    return SponsorshipAnalysis(
        classification=classification,
        work_authorization_restriction=restriction,
        evidence=[Evidence(quote="a quoted sentence")]
        if restriction != WorkAuthRestriction.UNKNOWN
        else [],
        confidence=0.9,
    )


class TestWeights:
    def test_every_component_is_deterministic(self):
        """No component may need a model. Scoring has to stay free to run."""
        assert WEIGHTS == {
            "internship_level_fit": 20.0,
            "graduation_eligibility": 10.0,
            "location_fit": 5.0,
            "sponsorship_compatibility": 10.0,
            "application_freshness": 5.0,
        }

    def test_the_readout_is_still_out_of_one_hundred(self):
        """The components sum to 50, so the total is rescaled rather than reweighted."""
        result = score(
            job(),
            sponsorship=sponsorship(Classification.SPONSORSHIP_AVAILABLE),
            now=NOW,
        )
        assert 0.0 < result.total <= 100.0


class TestHardFilterWins:
    def test_an_ineligible_job_scores_zero(self):
        """§7.6: no AI score may override a hard ineligibility."""
        result = score(job("Senior Software Engineer"), now=NOW)

        assert result.total == 0.0
        assert result.hard_filter_result is Verdict.REJECT
        assert not result.is_eligible

    def test_an_ineligible_job_never_reaches_the_model(self):
        """The cheapest way to guarantee the rule is not to ask."""
        result = score(job("Marketing Intern"), now=NOW)
        assert result.total == 0.0

    def test_rejection_reasons_are_carried_through(self):
        result = score(job("Senior Software Engineer"), now=NOW)
        assert any("SENIOR" in r for r in result.eligibility_reasons)

    @pytest.mark.parametrize(
        "title", ["Senior Software Engineer", "Marketing Intern", "Data Analyst Intern"]
    )
    def test_every_component_is_zeroed(self, title):
        result = score(job(title), now=NOW)
        assert set(result.components) == set(WEIGHTS)
        assert all(v == 0.0 for v in result.components.values())


class TestDeterministicComponents:
    def test_an_internship_earns_full_level_points(self):
        result = score(job(), now=NOW)
        assert result.components["internship_level_fit"] == WEIGHTS["internship_level_fit"]

    def test_a_fresh_posting_beats_a_stale_one(self):
        fresh = score(job(posted_at=NOW - timedelta(days=1)), now=NOW)
        stale = score(job(posted_at=NOW - timedelta(days=20)), now=NOW)
        assert fresh.components["application_freshness"] > stale.components["application_freshness"]

    def test_missing_posting_date_scores_in_the_middle(self):
        """Unknown is not the same as old."""
        unknown = score(job(posted_at=None), now=NOW)
        stale = score(job(posted_at=NOW - timedelta(days=20)), now=NOW)
        assert (
            unknown.components["application_freshness"] > stale.components["application_freshness"]
        )

    def test_graduating_before_the_internship_scores_zero(self):
        result = score(job(graduation_date=date(2026, 5, 1)), now=NOW)
        assert result.components["graduation_eligibility"] == 0.0
        assert any("already have graduated" in r for r in result.reasons)

    def test_still_enrolled_earns_full_points(self):
        result = score(job(graduation_date=GRADUATION), now=NOW)
        assert result.components["graduation_eligibility"] == WEIGHTS["graduation_eligibility"]

    def test_preferred_location_beats_an_unpreferred_one(self):
        preferred = score(job(preferred_locations=frozenset({"san francisco"})), now=NOW)
        other = score(
            job(location="Boise, ID", preferred_locations=frozenset({"san francisco"})), now=NOW
        )
        assert preferred.components["location_fit"] > other.components["location_fit"]

    def test_remote_scores_full_when_the_candidate_is_open_to_it(self):
        result = score(job(location="Remote"), now=NOW)
        assert result.components["location_fit"] == WEIGHTS["location_fit"]

    def test_remote_scores_low_when_the_candidate_is_not(self):
        result = score(job(location="Remote", open_to_remote=False), now=NOW)
        assert result.components["location_fit"] < WEIGHTS["location_fit"]


class TestSponsorshipComponent:
    def test_unanalysed_sponsorship_scores_in_the_middle(self):
        result = score(job(), sponsorship=None, now=NOW)
        assert result.components["sponsorship_compatibility"] == 5.0

    def test_available_sponsorship_scores_full(self):
        result = score(
            job(),
            sponsorship=sponsorship(Classification.SPONSORSHIP_AVAILABLE),
            now=NOW,
        )
        assert result.components["sponsorship_compatibility"] == 10.0

    def test_a_citizenship_requirement_the_candidate_cannot_meet_scores_zero(self):
        result = score(
            job(needs_sponsorship=True),
            sponsorship=sponsorship(restriction=WorkAuthRestriction.US_CITIZENSHIP_REQUIRED),
            now=NOW,
        )
        assert result.components["sponsorship_compatibility"] == 0.0

    def test_the_same_role_scores_full_for_a_citizen(self):
        """The employer's policy is read against the candidate's facts, not instead."""
        result = score(
            job(needs_sponsorship=False, is_us_citizen=True),
            sponsorship=sponsorship(restriction=WorkAuthRestriction.US_CITIZENSHIP_REQUIRED),
            now=NOW,
        )
        assert result.components["sponsorship_compatibility"] == 10.0

    def test_export_control_scores_low_pending_review(self):
        result = score(
            job(),
            sponsorship=sponsorship(restriction=WorkAuthRestriction.EXPORT_CONTROL_REVIEW),
            now=NOW,
        )
        assert result.components["sponsorship_compatibility"] == 3.0


class TestTotals:
    def test_a_strong_match_scores_high(self):
        result = score(
            job(),
            sponsorship=sponsorship(Classification.SPONSORSHIP_AVAILABLE),
            now=NOW,
        )
        assert result.total >= 72.0, "should clear the default minimum_fit_score"
        assert result.is_eligible

    def test_a_weak_match_scores_below_the_threshold(self):
        result = score(
            job(
                "Senior Staff Engineer",
                location="Boise, ID",
                preferred_locations=frozenset({"san francisco"}),
                posted_at=NOW - timedelta(days=25),
            ),
            now=NOW,
        )
        assert result.total < 72.0

    def test_the_total_is_the_components_rescaled_to_one_hundred(self):
        result = score(job(), now=NOW)
        expected = 100.0 * sum(result.components.values()) / sum(WEIGHTS.values())
        assert result.total == pytest.approx(expected, abs=0.01)

    def test_every_component_is_present_in_the_breakdown(self):
        result = score(job(), now=NOW)
        assert set(result.components) == set(WEIGHTS)
