"""Tests for deduplication primitives (spec §7.4)."""

from __future__ import annotations

from typing import Any, ClassVar

import pytest

from app.domain.normalization import (
    AtsType,
    canonicalize_url,
    dedupe_fingerprint,
    detect_ats,
    extract_requisition_id,
    extract_season,
    normalize_company,
    normalize_location,
    normalize_title,
    url_hash,
)


class TestNormalizeCompany:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("Stripe", "stripe"),
            ("Stripe, Inc.", "stripe"),
            ("STRIPE INC", "stripe"),
            ("  stripe  ", "stripe"),
            ("Databricks, Inc", "databricks"),
            ("Palantir Technologies Inc.", "palantir technologies"),
            ("Acme Holdings Ltd", "acme"),
            ("Foo Co Ltd", "foo"),
            ("Zalando SE", "zalando se"),
            ("SAP GmbH", "sap"),
            ("Société Générale", "societe generale"),
            ("AT&T", "at t"),
        ],
    )
    def test_folding(self, raw, expected):
        assert normalize_company(raw) == expected

    def test_variants_of_one_company_agree(self):
        variants = ["Stripe", "Stripe, Inc.", "stripe inc", "STRIPE  INC."]
        assert len({normalize_company(v) for v in variants}) == 1

    def test_distinct_companies_stay_distinct(self):
        assert normalize_company("Meta") != normalize_company("Meta Platforms Technologies")

    def test_empty_input(self):
        assert normalize_company("") == ""
        assert normalize_company("   ") == ""

    def test_company_named_only_a_suffix_is_not_erased(self):
        """A company literally called "Co" must not normalize to nothing."""
        assert normalize_company("Co") == "co"
        assert normalize_company("Ltd.") == "ltd"


class TestNormalizeTitle:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("Software Engineer Intern", "software engineer intern"),
            ("SWE Intern", "software engineer intern"),
            ("SDE Intern", "software engineer intern"),
            ("Software Engineering Internship", "software engineering intern"),
            ("Backend Engineer Intern", "back end engineer intern"),
            ("Full-Stack Engineer Intern", "full stack engineer intern"),
            ("Software Engineer Co-op", "software engineer intern"),
        ],
    )
    def test_folding(self, raw, expected):
        assert normalize_title(raw) == expected

    def test_season_and_year_are_removed(self):
        """Season is fingerprinted separately, so it must not split the title."""
        assert normalize_title("Software Engineer Intern, Summer 2027") == normalize_title(
            "Software Engineer Intern"
        )

    def test_different_functions_stay_distinct(self):
        assert normalize_title("Backend Engineer Intern") != normalize_title(
            "Frontend Engineer Intern"
        )

    def test_seniority_is_preserved(self):
        """A senior role must never collapse into an intern role."""
        assert normalize_title("Senior Software Engineer") != normalize_title("Software Engineer")


class TestExtractSeason:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("Software Engineer Intern, Summer 2027", "SUMMER_2027"),
            ("2027 Summer Internship", "SUMMER_2027"),
            ("Fall 2026 Co-op", "FALL_2026"),
            ("Autumn 2026 Internship", "FALL_2026"),
            ("Winter 2027 Intern", "WINTER_2027"),
        ],
    )
    def test_extraction(self, raw, expected):
        assert extract_season(raw) == expected

    @pytest.mark.parametrize(
        "raw", ["Software Engineer Intern", "Summer Internship", "2027 Intern"]
    )
    def test_returns_none_without_both_parts(self, raw):
        assert extract_season(raw) is None


class TestNormalizeLocation:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("San Francisco, CA", "san francisco ca"),
            ("San Francisco, California", "san francisco ca"),
            ("New York, New York", "new york ny"),
            ("Seattle, WA, USA", "seattle wa usa"),
            ("Remote", "remote"),
            ("Remote - US", "remote"),
            ("Remote (San Francisco)", "remote"),
            ("Work From Home", "remote"),
            ("", ""),
        ],
    )
    def test_folding(self, raw, expected):
        assert normalize_location(raw) == expected

    def test_state_name_and_code_agree(self):
        assert normalize_location("Austin, Texas") == normalize_location("Austin, TX")

    def test_different_cities_stay_distinct(self):
        assert normalize_location("Austin, TX") != normalize_location("Dallas, TX")


class TestCanonicalizeUrl:
    def test_strips_utm_and_tracking_params(self):
        url = "https://boards.greenhouse.io/acme/jobs/123?utm_source=x&gh_src=abc&utm_medium=y"
        assert canonicalize_url(url) == "https://boards.greenhouse.io/acme/jobs/123"

    def test_keeps_job_identifying_params(self):
        url = "https://acme.com/careers?gh_jid=456&utm_source=linkedin"
        assert canonicalize_url(url) == "https://acme.com/careers?gh_jid=456"

    def test_forces_https_and_drops_www(self):
        assert (
            canonicalize_url("http://www.Boards.Greenhouse.IO/acme/jobs/123")
            == "https://boards.greenhouse.io/acme/jobs/123"
        )

    def test_drops_fragment_and_trailing_slash(self):
        assert (
            canonicalize_url("https://jobs.lever.co/acme/abc/#apply")
            == "https://jobs.lever.co/acme/abc"
        )

    def test_sorts_remaining_params_for_stability(self):
        a = canonicalize_url("https://acme.com/j?token=1&for=acme")
        b = canonicalize_url("https://acme.com/j?for=acme&token=1")
        assert a == b

    def test_preserves_path_case(self):
        """Some ATS slugs are case-sensitive; folding them breaks the link."""
        assert "AbCdEf" in canonicalize_url("https://jobs.ashbyhq.com/Acme/AbCdEf")

    def test_relative_url_is_rejected(self):
        with pytest.raises(ValueError, match="Not an absolute URL"):
            canonicalize_url("/acme/jobs/123")

    def test_same_job_from_three_aggregators_collapses(self):
        urls = [
            "https://boards.greenhouse.io/acme/jobs/123?utm_source=simplify",
            "http://www.boards.greenhouse.io/acme/jobs/123/",
            "https://boards.greenhouse.io/acme/jobs/123?gh_src=abcd#content",
        ]
        assert len({canonicalize_url(u) for u in urls}) == 1
        assert len({url_hash(u) for u in urls}) == 1


class TestDetectAts:
    @pytest.mark.parametrize(
        ("url", "expected"),
        [
            ("https://boards.greenhouse.io/acme/jobs/123", AtsType.GREENHOUSE),
            ("https://job-boards.greenhouse.io/acme/jobs/123", AtsType.GREENHOUSE),
            ("https://jobs.lever.co/acme/uuid", AtsType.LEVER),
            ("https://jobs.eu.lever.co/acme/uuid", AtsType.LEVER),
            ("https://jobs.ashbyhq.com/acme/uuid", AtsType.ASHBY),
            ("https://acme.wd1.myworkdayjobs.com/en-US/careers/job/X_R-123", AtsType.WORKDAY),
            ("https://acme.com/careers?gh_jid=123", AtsType.GREENHOUSE),
            ("https://acme.com/careers?ashby_jid=abc", AtsType.ASHBY),
            ("https://acme.com/careers/swe-intern", AtsType.UNKNOWN),
        ],
    )
    def test_detection(self, url, expected):
        assert detect_ats(url) == expected

    def test_lookalike_domain_is_not_matched(self):
        """`greenhouse.io.evil.com` must not be treated as Greenhouse."""
        assert detect_ats("https://greenhouse.io.evil.com/acme/jobs/1") == AtsType.UNKNOWN


class TestExtractRequisitionId:
    @pytest.mark.parametrize(
        ("url", "expected"),
        [
            ("https://boards.greenhouse.io/acme/jobs/4567890", "4567890"),
            ("https://acme.com/careers?gh_jid=4567890", "4567890"),
            (
                "https://jobs.lever.co/acme/1b1e5b6a-1234-4abc-9def-0123456789ab",
                "1b1e5b6a-1234-4abc-9def-0123456789ab",
            ),
            (
                "https://jobs.ashbyhq.com/acme/1b1e5b6a-1234-4abc-9def-0123456789ab",
                "1b1e5b6a-1234-4abc-9def-0123456789ab",
            ),
            ("https://acme.wd1.myworkdayjobs.com/careers/job/SF/SWE-Intern_R-12345", "r-12345"),
        ],
    )
    def test_extraction(self, url, expected):
        assert extract_requisition_id(url) == expected

    def test_returns_none_for_landing_pages(self):
        assert extract_requisition_id("https://acme.com/careers") is None

    def test_same_requisition_via_different_paths_agrees(self):
        """The strongest dedupe signal: one requisition, three entry points."""
        ids = {
            extract_requisition_id("https://boards.greenhouse.io/acme/jobs/4567890"),
            extract_requisition_id("https://acme.com/careers?gh_jid=4567890&utm_source=x"),
            extract_requisition_id("https://job-boards.greenhouse.io/acme/jobs/4567890"),
        }
        assert ids == {"4567890"}


class TestDedupeFingerprint:
    BASE: ClassVar[dict[str, Any]] = {
        "company": "Stripe, Inc.",
        "title": "Software Engineer Intern",
        "location": "San Francisco, CA",
        "season": "SUMMER_2027",
    }

    def test_is_stable(self):
        assert dedupe_fingerprint(**self.BASE) == dedupe_fingerprint(**self.BASE)

    def test_ignores_cosmetic_differences(self):
        other = {
            "company": "STRIPE INC",
            "title": "SWE Internship, Summer 2027",
            "location": "san francisco, california",
            "season": "SUMMER_2027",
        }
        assert dedupe_fingerprint(**self.BASE) == dedupe_fingerprint(**other)

    @pytest.mark.parametrize(
        "override",
        [
            {"company": "Square"},
            {"title": "Frontend Engineer Intern"},
            {"location": "New York, NY"},
            {"season": "SUMMER_2028"},
        ],
    )
    def test_material_differences_change_the_fingerprint(self, override):
        assert dedupe_fingerprint(**{**self.BASE, **override}) != dedupe_fingerprint(**self.BASE)

    def test_field_boundaries_cannot_be_forged(self):
        """A separator-free join would let one field bleed into the next."""
        a = dedupe_fingerprint(company="ab", title="c", location="d", season=None)
        b = dedupe_fingerprint(company="a", title="bc", location="d", season=None)
        assert a != b
