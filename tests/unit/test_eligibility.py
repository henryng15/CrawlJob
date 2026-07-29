"""Deterministic eligibility filter tests (spec §7.3).

This filter decides what the LLM budget is spent on and what the user ever sees,
so both directions matter: a false reject silently costs an application, and a
false pass costs money and review time.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

from app.domain.normalization import normalize_location, normalize_title
from app.services.eligibility import (
    EligibilityRules,
    Verdict,
    evaluate,
    graduation_year_fits,
    is_internship_title,
    seniority_of,
)

NOW = datetime(2026, 7, 28, tzinfo=UTC)


def check(title: str, location: str = "San Francisco, CA", **kw: object):
    """Evaluate a raw title and location the way the pipeline would."""
    return evaluate(
        normalized_title=normalize_title(title),
        normalized_location=normalize_location(location),
        now=NOW,
        **kw,  # type: ignore[arg-type]
    )


class TestSeniority:
    @pytest.mark.parametrize(
        "title",
        [
            "Software Engineer Intern",
            "SWE Intern",
            "Software Engineering Internship",
            "Software Engineer Co-op",
            "Backend Engineer Intern",
        ],
    )
    def test_internships_are_recognised(self, title):
        assert is_internship_title(normalize_title(title))

    @pytest.mark.parametrize(
        "title",
        [
            "Senior Software Engineer",
            "Staff Software Engineer",
            "Principal Engineer",
            "Engineering Manager",
            "Director of Engineering",
            "Software Architect",
        ],
    )
    def test_senior_roles_are_recognised(self, title):
        assert seniority_of(normalize_title(title)) == "SENIOR"

    def test_senior_wins_over_intern(self):
        """ "Senior Manager, Intern Programs" is not an internship."""
        assert seniority_of(normalize_title("Senior Manager, Intern Programs")) == "SENIOR"
        assert not is_internship_title(normalize_title("Senior Manager, Intern Programs"))

    def test_new_grad_is_entry_not_intern(self):
        assert seniority_of(normalize_title("New Grad Software Engineer")) == "ENTRY"


class TestAcceptedRoles:
    @pytest.mark.parametrize(
        "title",
        [
            "Software Engineer Intern",
            "SWE Intern",
            "Backend Engineer Intern",
            "Full Stack Engineer Intern",
            "Platform Engineer Intern",
            "Infrastructure Engineer Intern",
            "Site Reliability Engineer Intern",
            "Data Engineering Intern",
            "Mobile Engineer Intern",
            "Security Engineer Intern",
            "Software Engineer Co-op",
        ],
    )
    def test_targeted_functions_pass(self, title):
        assert check(title).passed, title


class TestRejectedRoles:
    @pytest.mark.parametrize(
        ("title", "fragment"),
        [
            ("Senior Software Engineer", "SENIOR"),
            ("Software Engineer", "not an internship"),
            ("New Grad Software Engineer", "ENTRY"),
            ("Marketing Intern", "not a software engineering function"),
            ("Mechanical Engineering Intern", "not a software engineering function"),
            ("Data Analyst Intern", "not a software engineering function"),
            ("Business Analyst Intern", "not a software engineering function"),
            ("Hardware Engineering Intern", "not a software engineering function"),
            ("Finance Intern", "not a software engineering function"),
        ],
    )
    def test_rejections_explain_themselves(self, title, fragment):
        result = check(title)
        assert result.rejected, title
        assert any(fragment in reason for reason in result.reasons), result.reasons

    def test_unrelated_title_is_rejected(self):
        result = check("Barista")
        assert result.rejected


class TestLocation:
    @pytest.mark.parametrize(
        "location",
        ["San Francisco, CA", "New York, NY", "Austin, Texas", "Seattle, WA, USA"],
    )
    def test_us_locations_pass(self, location):
        assert check("Software Engineer Intern", location).passed

    def test_a_bare_remote_is_asked_about_rather_than_assumed_to_be_us(self):
        """It used to pass, and that was wrong.

        ``normalize_location`` folds every remote posting to the bare string
        "remote", so "Remote (EMEA)" arrived here indistinguishable from
        "Remote - US". Treating that as a US hint accepted roles on other
        continents. Unknown is now unknown, and the caller decides.
        """
        result = check("Software Engineer Intern", "Remote")
        assert result.verdict is Verdict.REVIEW
        assert any("could not be classified" in w for w in result.warnings)

    @pytest.mark.parametrize(
        "location_text", ["Remote - US", "Remote (USA)", "Remote, United States"]
    )
    def test_remote_us_passes_when_the_raw_text_is_supplied(self, location_text):
        """The country survives only in the text the board wrote."""
        assert check("Software Engineer Intern", "Remote", location_text=location_text).passed

    @pytest.mark.parametrize("location_text", ["Remote (EU)", "Remote - EMEA", "Remote, Canada"])
    def test_remote_abroad_is_rejected_when_the_raw_text_is_supplied(self, location_text):
        result = check("Software Engineer Intern", "Remote", location_text=location_text)
        assert result.rejected
        assert any("outside the United States" in r for r in result.reasons)

    @pytest.mark.parametrize(
        "location",
        ["Toronto, Canada", "London, UK", "Bangalore, India", "Berlin, Germany", "Tokyo, Japan"],
    )
    def test_non_us_locations_are_rejected(self, location):
        result = check("Software Engineer Intern", location)
        assert result.rejected
        assert any("outside the United States" in r for r in result.reasons)

    def test_unclassifiable_location_asks_rather_than_rejects(self):
        """A blank location is not evidence the role is abroad."""
        result = check("Software Engineer Intern", "")
        assert result.verdict is Verdict.REVIEW
        assert any("could not be classified" in w for w in result.warnings)

    def test_us_requirement_can_be_disabled(self):
        result = check(
            "Software Engineer Intern", "London, UK", rules=EligibilityRules(require_us=False)
        )
        assert result.passed


class TestGraduateDegreeRequirement:
    @pytest.mark.parametrize(
        "text",
        [
            "Applicants must have a PhD in Computer Science.",
            "A Master's degree is required for this role.",
            "Requires a graduate degree in a related field.",
            "Currently enrolled in a PhD program.",
        ],
    )
    def test_hard_requirements_reject(self, text):
        result = check("Software Engineer Intern", description_text=text)
        assert result.rejected
        assert any("graduate degree" in r for r in result.reasons)

    @pytest.mark.parametrize(
        "text",
        [
            "PhD preferred but not required.",
            "Bachelor's degree required.",
            "Master's degree a plus.",
            "Pursuing a Bachelor's or Master's degree in Computer Science.",
            "Our team includes several PhDs.",
        ],
    )
    def test_soft_preferences_do_not_reject(self, text):
        """A false reject here silently costs an application the user could have had."""
        assert check("Software Engineer Intern", description_text=text).passed, text

    def test_can_be_disabled_for_a_graduate_applicant(self):
        result = check(
            "Software Engineer Intern",
            description_text="A Master's degree is required.",
            rules=EligibilityRules(exclude_graduate_only=False),
        )
        assert result.passed


class TestRoleAge:
    def test_fresh_posting_passes(self):
        assert check("Software Engineer Intern", posted_at=NOW - timedelta(days=3)).passed

    def test_stale_posting_is_rejected(self):
        result = check("Software Engineer Intern", posted_at=NOW - timedelta(days=60))
        assert result.rejected
        assert any("older than" in r for r in result.reasons)

    def test_missing_date_does_not_reject(self):
        assert check("Software Engineer Intern", posted_at=None).passed

    def test_limit_is_configurable(self):
        old = NOW - timedelta(days=60)
        assert check(
            "Software Engineer Intern",
            posted_at=old,
            rules=EligibilityRules(max_role_age_days=None),
        ).passed


class TestSeason:
    RULES = EligibilityRules(allowed_seasons=frozenset({"SUMMER_2027"}))

    def test_matching_season_passes(self):
        assert check("Software Engineer Intern", season="SUMMER_2027", rules=self.RULES).passed

    def test_other_season_is_rejected(self):
        result = check("Software Engineer Intern", season="SUMMER_2026", rules=self.RULES)
        assert result.rejected

    def test_missing_season_asks_rather_than_rejects(self):
        """Most postings never state a season; rejecting them all would be wrong."""
        result = check("Software Engineer Intern", season=None, rules=self.RULES)
        assert result.verdict is Verdict.REVIEW


class TestClosedPostings:
    def test_closed_postings_are_rejected(self):
        result = check("Software Engineer Intern", is_closed=True)
        assert result.rejected
        assert any("closed" in r for r in result.reasons)


class TestMultipleReasons:
    def test_all_failures_are_reported_not_just_the_first(self):
        """The user should see every reason at once, not one per run."""
        result = check("Senior Marketing Manager", "London, UK", is_closed=True)
        assert len(result.reasons) >= 3


class TestGraduationFit:
    GRAD = date(2028, 5, 1)

    def test_season_before_graduation_fits(self):
        assert graduation_year_fits(self.GRAD, "SUMMER_2027") is True

    def test_season_after_graduation_does_not(self):
        assert graduation_year_fits(self.GRAD, "SUMMER_2029") is False

    def test_unparseable_season_returns_none(self):
        assert graduation_year_fits(self.GRAD, None) is None
        assert graduation_year_fits(self.GRAD, "SOMETIME") is None
