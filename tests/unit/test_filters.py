"""Pre-spend screening (spec §7.3).

The screen decides what the system spends money on, so the tests that matter
most here are the ones that prove it says *no*: to a stale posting, to a senior
role wearing an intern title, and to a remote role on another continent.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.domain.normalization import normalize_title
from app.services.filters import (
    ScreenRules,
    ScreenVerdict,
    age_reference,
    classify_us,
    is_fresh,
    location_is_us,
    screen,
    title_matches,
)

NOW = datetime(2026, 7, 29, 12, 0, tzinfo=UTC)


def hours_ago(n: float) -> datetime:
    return NOW - timedelta(hours=n)


class TestFreshness:
    """``posted_at`` when there is one, ``discovered_at`` otherwise. Never both."""

    def test_a_posting_from_this_morning_is_fresh(self):
        assert is_fresh(
            posted_at=hours_ago(23), discovered_at=hours_ago(1), now=NOW, max_age_hours=24
        )

    def test_a_posting_from_two_days_ago_is_not(self):
        assert not is_fresh(
            posted_at=hours_ago(25), discovered_at=hours_ago(1), now=NOW, max_age_hours=24
        )

    def test_exactly_at_the_boundary_is_still_fresh(self):
        assert is_fresh(
            posted_at=hours_ago(24), discovered_at=hours_ago(24), now=NOW, max_age_hours=24
        )

    def test_without_posted_at_it_falls_back_to_first_seen(self):
        assert is_fresh(posted_at=None, discovered_at=hours_ago(2), now=NOW, max_age_hours=24)
        assert not is_fresh(posted_at=None, discovered_at=hours_ago(30), now=NOW, max_age_hours=24)

    def test_a_stale_posting_seen_today_is_still_stale(self):
        """The whole reason ``max()`` is forbidden.

        A role published three months ago that this system first noticed a
        minute ago is three months old. Taking the later of the two timestamps
        would call it one minute old and let every archived posting on a board
        through on the day the board was first added.
        """
        old = NOW - timedelta(days=90)
        assert age_reference(old, hours_ago(0.01)) == old
        assert not is_fresh(posted_at=old, discovered_at=hours_ago(0.01), now=NOW, max_age_hours=24)

    def test_the_reference_is_never_the_later_of_the_two(self):
        recent, old = hours_ago(1), NOW - timedelta(days=90)
        assert age_reference(old, recent) is old
        assert age_reference(None, recent) is recent


class TestTitle:
    """Each variant the user listed must be accepted, in the form boards use."""

    @pytest.mark.parametrize(
        "title",
        [
            "Software Engineer Intern",
            "Software Engineering Intern",
            "SWE Intern",
            "Backend Engineer Intern",
            "Backend Software Engineer Intern",
            "Backend Developer Intern",
            "Infrastructure Engineer Intern",
            "Software Infrastructure Intern",
            "Systems Infrastructure Intern",
            "Platform Engineer Intern",
            "Cloud Engineer Intern",
            "Cloud Software Engineer Intern",
            "Cloud Infrastructure Intern",
            "DevOps Intern",
            "Site Reliability Engineer Intern",
            "SRE Intern",
        ],
    )
    def test_every_targeted_variant_is_accepted(self, title):
        assert title_matches(normalize_title(title)), title

    @pytest.mark.parametrize(
        "title",
        [
            "Software Engineer Internship, Summer 2027",
            "Software Engineer Intern - Fall 2026",
            "Intern, Software Engineer",
            "SDE Intern",
            "Software Engineer Co-op",
        ],
    )
    def test_the_forms_boards_actually_publish_are_accepted(self, title):
        """Season, word order and abbreviation must not decide eligibility."""
        assert title_matches(normalize_title(title)), title

    @pytest.mark.parametrize(
        "term",
        ["Senior", "Staff", "Principal", "Lead", "Manager", "Contract"],
    )
    def test_a_seniority_term_overrules_a_matching_variant(self, term):
        assert not title_matches(normalize_title(f"{term} Software Engineer Intern"))

    @pytest.mark.parametrize(
        "title",
        [
            "New Grad Software Engineer",
            "Software Engineer, Full-Time",
            "Software Engineer",
            "Data Analyst Intern",
            "Marketing Intern",
            "Mechanical Engineer Intern",
        ],
    )
    def test_roles_the_user_is_not_applying_for_are_rejected(self, title):
        assert not title_matches(normalize_title(title))

    def test_a_reject_term_does_not_match_inside_a_longer_word(self):
        """ "Lead" must not reject "Leadership", nor "contract" "Contractor"."""
        assert title_matches(normalize_title("Software Engineer Intern, Leadership Program"))

    def test_the_variant_list_is_configurable(self):
        rules = ScreenRules(role_titles=("security engineer intern",))
        assert title_matches("security engineer intern", rules)
        assert not title_matches("software engineer intern", rules)

    @pytest.mark.parametrize(
        "title",
        [
            "Software Engineer Intern",
            "SWE Intern",
            "Software Developer Intern",
            "Software Development Intern",
            "Full Stack Intern",
            "Front End Engineer Intern",
            "Backend Developer Intern",
            "Firmware Engineer Intern",
            "Embedded Systems Intern",
            "Android Developer Intern",
            "Web Application Developer Intern",
            "Intern, Software Developer",
            "Site Reliability Engineer Intern",
            "DevOps Intern",
            "Platform Engineer Intern",
            "Cloud Infrastructure Intern",
            "Machine Learning Engineer Intern",
            "Game Development Intern",
        ],
    )
    def test_the_shapes_boards_actually_publish_are_accepted(self, title: str):
        """Every one of these was turned away by the old whole-title allowlist."""
        assert title_matches(normalize_title(title))

    @pytest.mark.parametrize(
        "title",
        [
            # The neighbours of a SWE internship: same skills, different label.
            "Forward Deployed Engineer Intern",
            "FDE Intern",
            "SDE Intern",
            "SDET Intern",
            "Backend Engineer Intern",
            "Cloud Engineer Intern",
            "Cloud Platform Intern",
            "Cloud Architect Intern",
            "DevOps Engineer Intern",
            "SRE Intern",
            "Infrastructure Engineer Intern",
            "Systems Engineer Intern",
            "Distributed Systems Intern",
            "Solutions Engineer Intern",
            "Solutions Architect Intern",
            "Technical Solutions Intern",
            "Data Engineer Intern",
            "ML Intern",
            "AI Engineer Intern",
            "Security Engineer Intern",
            "Network Engineer Intern",
            "QA Engineer Intern",
            "Test Engineer Intern",
            "Compiler Engineer Intern",
            "Mobile Engineer Intern",
        ],
    )
    def test_the_neighbouring_roles_are_accepted_too(self, title: str):
        """FDE, SWE, backend, cloud, DevOps and the rest of that family.

        The same skills under a different label. Most reach the screen through
        the word "engineer"; the acronyms and the architect titles would not,
        and are the reason those entries exist.
        """
        assert title_matches(normalize_title(title))

    @pytest.mark.parametrize(
        "title",
        [
            "Electrical Engineer Intern",
            "Mechanical Engineering Intern",
            "Intern, Software Product Management",
            "Software Engineering PhD Internship",
            "Marketing Intern",
            "Sales Intern",
            "Software Engineer",  # not an internship at all
            "Data Analyst Intern",  # no software word
        ],
    )
    def test_off_target_titles_are_still_turned_away(self, title: str):
        assert not title_matches(normalize_title(title))

    @pytest.mark.parametrize(
        "title",
        [
            "Front Desk Intern",
            "Back Office Intern",
            "Business Development Intern",
            "Corporate Development Intern",
            "Talent Development Intern",
            "Learning and Development Intern",
            "Business Systems Analyst Intern",
            "Architect Intern",
            "Interior Architect Intern",
            "HR Solutions Intern",
            "Client Solutions Intern",
        ],
    )
    def test_words_that_only_mean_software_in_context_do_not_leak(self, title: str):
        """ "front", "back" and "development" are ordinary English.

        Matching them as bare words is what turns a screen for software
        internships into a screen for internships — every one of these is a real
        posting that would then take one of the day's ten slots.
        """
        assert not title_matches(normalize_title(title))


class TestLocation:
    """Read from the raw text, because normalization throws the country away."""

    @pytest.mark.parametrize(
        "text",
        [
            "San Francisco, CA",
            "New York, NY",
            "Seattle, Washington",
            "Remote - US",
            "Remote (USA)",
            "US Remote",
            "Remote, United States",
            "Austin, TX (Hybrid)",
        ],
    )
    def test_us_and_remote_us_are_accepted(self, text):
        assert location_is_us(text), text

    @pytest.mark.parametrize(
        "text",
        [
            "Remote (EU)",
            "Remote - Europe",
            "London, UK",
            "Toronto, Canada",
            "Bangalore, India",
            "Remote - EMEA",
            "Remote (Worldwide)",
            "Berlin, Germany",
        ],
    )
    def test_other_countries_and_regions_are_rejected(self, text):
        assert not location_is_us(text), text
        assert classify_us(text) is False, text

    def test_a_bare_remote_is_unknown_and_therefore_not_accepted(self):
        assert classify_us("Remote") is None
        assert not location_is_us("Remote")

    def test_a_role_open_to_the_us_and_canada_is_not_a_us_role(self):
        """The non-US marker is checked first, deliberately."""
        assert not location_is_us("Remote - US or Canada")

    def test_a_lowercase_english_word_is_not_a_state_code(self):
        """ "Remote or Hybrid" is not Oregon; "Work in office" is not Indiana."""
        assert not location_is_us("Remote or Hybrid")
        assert not location_is_us("Work in office")

    def test_an_empty_location_is_unknown(self):
        assert classify_us(None) is None
        assert classify_us("   ") is None
        assert not location_is_us(None)


class TestScreen:
    """Order matters: the cheapest rejection must come first."""

    def _screen(self, **over):
        args = {
            "normalized_title": normalize_title("Software Engineer Intern"),
            "location_text": "San Francisco, CA",
            "posted_at": hours_ago(2),
            "discovered_at": hours_ago(1),
            "now": NOW,
        }
        return screen(**{**args, **over})

    def test_a_fresh_targeted_us_internship_passes(self):
        assert self._screen().verdict is ScreenVerdict.PASS

    def test_a_stale_posting_is_rejected_with_its_age(self):
        result = self._screen(posted_at=hours_ago(200))
        assert result.verdict is ScreenVerdict.REJECT
        assert "200h ago" in result.reason
        assert "posted" in result.reason

    def test_the_reason_says_first_seen_when_there_was_no_posted_at(self):
        result = self._screen(posted_at=None, discovered_at=hours_ago(200))
        assert "first seen" in result.reason

    def test_an_untargeted_title_is_rejected_by_name(self):
        result = self._screen(normalized_title=normalize_title("Product Manager Intern"))
        assert result.verdict is ScreenVerdict.REJECT
        assert "not a targeted role variant" in result.reason

    def test_a_non_us_location_is_rejected_by_name(self):
        result = self._screen(location_text="Remote (EU)")
        assert result.verdict is ScreenVerdict.REJECT
        assert "Remote (EU)" in result.reason

    def test_freshness_is_checked_before_the_title(self):
        """A stale, off-target role must report the cheaper reason."""
        result = self._screen(
            posted_at=hours_ago(200), normalized_title=normalize_title("Marketing Intern")
        )
        assert "older than" in result.reason

    def test_the_title_is_checked_before_the_location(self):
        result = self._screen(
            normalized_title=normalize_title("Marketing Intern"), location_text="Remote (EU)"
        )
        assert "not a targeted role variant" in result.reason

    def test_the_us_requirement_can_be_turned_off(self):
        rules = ScreenRules(require_us=False)
        assert self._screen(location_text="London, UK", rules=rules).passed

    def test_the_freshness_window_is_configurable(self):
        rules = ScreenRules(max_role_age_hours=72)
        assert self._screen(posted_at=hours_ago(48), rules=rules).passed
