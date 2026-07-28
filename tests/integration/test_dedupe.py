"""Deduplication engine tests (spec §7.4)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Company, Job
from app.domain.states import JobState
from app.services.dedupe import DedupeVerdict, NormalizedPosting, resolve, upsert_job
from tests.helpers import not_none

pytestmark = pytest.mark.db

NOW = datetime(2026, 7, 28, tzinfo=UTC)

GREENHOUSE = NormalizedPosting(
    company="Acme, Inc.",
    title="Software Engineer Intern, Summer 2027",
    application_url="https://boards.greenhouse.io/acme/jobs/4567890",
    location="San Francisco, CA",
)


def count(db: Session, model: type) -> int:
    return not_none(db.scalar(select(func.count()).select_from(model)))


class TestNormalizedPosting:
    def test_derives_ats_and_requisition(self):
        assert GREENHOUSE.ats == "GREENHOUSE"
        assert GREENHOUSE.requisition_id == "4567890"
        assert GREENHOUSE.board_id == "acme"

    def test_derives_season_from_title(self):
        assert GREENHOUSE.season == "SUMMER_2027"

    def test_explicit_season_overrides_the_title(self):
        posting = NormalizedPosting(
            company="Acme",
            title="Software Engineer Intern",
            application_url="https://a.com/1",
            source_season="FALL_2026",
        )
        assert posting.season == "FALL_2026"

    def test_tracking_parameters_do_not_change_the_hash(self):
        tracked = NormalizedPosting(
            company=GREENHOUSE.company,
            title=GREENHOUSE.title,
            application_url=GREENHOUSE.application_url + "?utm_source=simplify",
            location=GREENHOUSE.location,
        )
        assert tracked.url_hash == GREENHOUSE.url_hash


class TestResolveOnEmptyDatabase:
    def test_everything_is_new(self, db: Session):
        assert resolve(db, GREENHOUSE).verdict is DedupeVerdict.NEW


class TestRequisitionMatching:
    def test_same_requisition_via_a_different_url_is_an_exact_duplicate(self, db: Session):
        """Priority 1: the strongest signal, and the one aggregators defeat.

        The user finds the same Acme job on two GitHub lists and the company's own
        careers page. All three must resolve to one job.
        """
        first, _ = upsert_job(db, GREENHOUSE, now=NOW)

        via_careers_page = NormalizedPosting(
            company="Acme",
            title="SWE Intern",
            application_url="https://boards.greenhouse.io/acme/jobs/4567890?gh_src=abc",
            location="SF",
        )
        result = resolve(db, via_careers_page)
        assert result.verdict is DedupeVerdict.DUPLICATE_EXACT
        assert result.existing_job_id == first.id

    def test_same_requisition_number_on_a_different_board_is_not_a_duplicate(self, db: Session):
        """Requisition ids are only unique within a board — two firms can both have job 1."""
        upsert_job(db, GREENHOUSE, now=NOW)
        other_employer = NormalizedPosting(
            company="Globex",
            title="Software Engineer Intern",
            application_url="https://boards.greenhouse.io/globex/jobs/4567890",
            location="Austin, TX",
        )
        assert resolve(db, other_employer).verdict is DedupeVerdict.NEW

    def test_upsert_returns_the_existing_row_without_inserting(self, db: Session):
        first, _ = upsert_job(db, GREENHOUSE, now=NOW)
        again, result = upsert_job(db, GREENHOUSE, now=NOW)
        assert again.id == first.id
        assert result.verdict is DedupeVerdict.DUPLICATE_EXACT
        assert count(db, Job) == 1


class TestUrlMatching:
    def test_urls_differing_only_by_tracking_collapse(self, db: Session):
        """Priority 2, for postings with no extractable requisition id."""
        plain = NormalizedPosting(
            company="Acme",
            title="Software Engineer Intern",
            application_url="https://acme.com/careers/swe-intern",
            location="Remote",
        )
        upsert_job(db, plain, now=NOW)

        tracked = NormalizedPosting(
            company="Acme",
            title="Software Engineer Intern",
            application_url="http://www.acme.com/careers/swe-intern/?utm_campaign=x#apply",
            location="Remote",
        )
        assert resolve(db, tracked).verdict is DedupeVerdict.DUPLICATE_EXACT


class TestFingerprintMatching:
    def test_same_role_at_a_different_url_is_only_probable(self, db: Session):
        """Priority 4. The company reposted; it may or may not be the same role."""
        upsert_job(db, GREENHOUSE, now=NOW)
        reposted = NormalizedPosting(
            company="Acme Inc",
            title="SWE Internship, Summer 2027",
            application_url="https://jobs.lever.co/acme/aaaaaaaa-1111-4222-8333-444444444444",
            location="san francisco, california",
        )
        result = resolve(db, reposted)
        assert result.verdict is DedupeVerdict.DUPLICATE_PROBABLE
        assert result.matched_on == "fingerprint"

    def test_probable_duplicates_are_kept_for_review_not_dropped(self, db: Session):
        """§7.4 forbids silent deletion — the user decides."""
        original, _ = upsert_job(db, GREENHOUSE, now=NOW)
        reposted = NormalizedPosting(
            company="Acme Inc",
            title="SWE Internship, Summer 2027",
            application_url="https://jobs.lever.co/acme/aaaaaaaa-1111-4222-8333-444444444444",
            location="San Francisco, California",
        )
        job, result = upsert_job(db, reposted, now=NOW)

        assert result.verdict is DedupeVerdict.DUPLICATE_PROBABLE
        assert count(db, Job) == 2, "the second role must survive for review"
        assert job.status == JobState.DUPLICATE_PROBABLE
        assert job.duplicate_of_id == original.id

    def test_a_different_season_is_a_different_role(self, db: Session):
        upsert_job(db, GREENHOUSE, now=NOW)
        next_year = NormalizedPosting(
            company="Acme, Inc.",
            title="Software Engineer Intern, Summer 2028",
            application_url="https://boards.greenhouse.io/acme/jobs/9999999",
            location="San Francisco, CA",
        )
        assert resolve(db, next_year).verdict is DedupeVerdict.NEW

    def test_a_different_location_is_a_different_role(self, db: Session):
        upsert_job(db, GREENHOUSE, now=NOW)
        nyc = NormalizedPosting(
            company="Acme, Inc.",
            title="Software Engineer Intern, Summer 2027",
            application_url="https://boards.greenhouse.io/acme/jobs/1111111",
            location="New York, NY",
        )
        assert resolve(db, nyc).verdict is DedupeVerdict.NEW

    def test_archived_jobs_do_not_trigger_probable_duplicates(self, db: Session):
        """Last year's archived posting must not block this year's."""
        old, _ = upsert_job(db, GREENHOUSE, now=NOW)
        old.status = JobState.ARCHIVED
        db.flush()

        reposted = NormalizedPosting(
            company="Acme Inc",
            title="SWE Internship, Summer 2027",
            application_url="https://jobs.lever.co/acme/aaaaaaaa-1111-4222-8333-444444444444",
            location="San Francisco, CA",
        )
        assert resolve(db, reposted).verdict is DedupeVerdict.NEW


class TestCompanyHandling:
    def test_company_is_created_once_and_reused(self, db: Session):
        upsert_job(db, GREENHOUSE, now=NOW)
        second = NormalizedPosting(
            company="ACME INC.",
            title="Backend Engineer Intern",
            application_url="https://boards.greenhouse.io/acme/jobs/2222222",
            location="Austin, TX",
        )
        upsert_job(db, second, now=NOW)
        assert count(db, Company) == 1
        assert count(db, Job) == 2

    def test_canonical_name_keeps_the_original_spelling(self, db: Session):
        job, _ = upsert_job(db, GREENHOUSE, now=NOW)
        company = not_none(db.get(Company, job.company_id))
        assert company.canonical_name == "Acme, Inc."
        assert company.normalized_name == "acme"


class TestUpsertFields:
    def test_populates_normalized_columns(self, db: Session):
        job, _ = upsert_job(db, GREENHOUSE, now=NOW)
        assert job.normalized_title == "software engineer intern"
        assert job.normalized_location == "san francisco ca"
        assert job.season == "SUMMER_2027"
        assert job.requisition_id == "4567890"
        assert job.ats_board_id == "acme"
        assert job.status == JobState.DISCOVERED

    def test_stores_the_canonical_url_not_the_raw_one(self, db: Session):
        tracked = NormalizedPosting(
            company="Acme",
            title="SWE Intern",
            application_url="https://boards.greenhouse.io/acme/jobs/1?utm_source=x",
            location="Remote",
        )
        job, _ = upsert_job(db, tracked, now=NOW)
        assert "utm_source" not in job.canonical_url


class TestThreeAggregatorsOneJob:
    def test_end_to_end(self, db: Session):
        """The scenario deduplication exists for: one role, four feed entries."""
        feeds = [
            "https://boards.greenhouse.io/acme/jobs/4567890",
            "https://boards.greenhouse.io/acme/jobs/4567890?utm_source=simplify",
            "http://www.boards.greenhouse.io/acme/jobs/4567890/",
            "https://job-boards.greenhouse.io/acme/jobs/4567890?gh_src=listing",
        ]
        for url in feeds:
            upsert_job(
                db,
                NormalizedPosting(
                    company="Acme",
                    title="Software Engineer Intern, Summer 2027",
                    application_url=url,
                    location="San Francisco, CA",
                ),
                now=NOW,
            )
        assert count(db, Job) == 1
        assert count(db, Company) == 1
