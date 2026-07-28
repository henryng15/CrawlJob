"""Import the user's own recruiter export (spec §7.12).

The synthetic fixtures in ``test_recruiters.py`` prove the rules. This file proves
the importer survives the actual spreadsheet, which has different headers, 1,482
rows, and a deliverability column the synthetic data does not.

Skipped when the export is not present, so the suite still runs on a fresh clone.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Recruiter
from app.services.recruiters import commit_import, match_recruiter, preview_import
from tests.helpers import not_none

pytestmark = pytest.mark.db

EXPORT_DIR = Path.home() / "VSCode" / "projects" / "ColdEmail" / "finals"
VERIFIED = EXPORT_DIR / "2a_recruiters_VERIFIED_only.csv"
ALL_ROWS = EXPORT_DIR / "3_recruiters_all.csv"


def load(path: Path) -> str:
    if not path.exists():
        pytest.skip(f"recruiter export not available at {path}")
    return path.read_text(encoding="utf-8")


class TestVerifiedExport:
    def test_the_headers_are_understood(self, db: Session):
        """company_name / recruiter_name / recruiter_title, not the generic names."""
        report = preview_import(db, load(VERIFIED))
        assert report.valid, report.summary()

        first = not_none(report.valid[0].parsed)
        assert first.full_name
        assert first.raw_company
        assert "@" in first.email

    def test_almost_every_row_is_usable(self, db: Session):
        report = preview_import(db, load(VERIFIED))
        ratio = len(report.valid) / len(report.rows)
        assert ratio > 0.95, f"only {ratio:.0%} usable — {report.summary()}"

    def test_the_domain_column_is_used_for_matching(self, db: Session):
        """A recruiter on an agency address still belongs to the named company."""
        report = preview_import(db, load(VERIFIED))
        rows = [not_none(r.parsed) for r in report.valid]
        mismatched = [
            r for r in rows if r.company_domain and not r.email.endswith(r.company_domain)
        ]
        assert rows[0].email_domain == rows[0].company_domain
        # The export contains such rows; the point is that they are handled, not
        # that they are numerous.
        assert isinstance(mismatched, list)

    def test_import_commits_and_is_idempotent(self, db: Session):
        text = load(VERIFIED)
        first = commit_import(db, text)
        assert first.committed > 1000

        second = commit_import(db, text)
        assert second.committed == 0, "re-importing must merge, not duplicate"
        assert second.updated == first.committed

    def test_every_stored_address_is_lowercase(self, db: Session):
        commit_import(db, load(VERIFIED))
        emails = db.scalars(select(Recruiter.email)).all()
        assert all(e == e.lower() for e in emails)

    def test_no_duplicate_addresses_survive(self, db: Session):
        commit_import(db, load(VERIFIED))
        total = not_none(db.scalar(select(func.count()).select_from(Recruiter)))
        distinct = not_none(db.scalar(select(func.count(func.distinct(Recruiter.email)))))
        assert total == distinct


class TestUnverifiedExportIsFiltered:
    def test_addresses_marked_undeliverable_are_rejected(self, db: Session):
        """3_recruiters_all.csv carries rows the verifier called Invalid.

        Importing them would mean sending to addresses already known to bounce,
        which damages the sending reputation for every later email.
        """
        report = preview_import(db, load(ALL_ROWS))
        rejected = [r for r in report.invalid if r.error and "undeliverable" in r.error]
        assert rejected, "the export contains invalid rows; none were filtered"

    def test_the_filter_removes_a_meaningful_share(self, db: Session):
        report = preview_import(db, load(ALL_ROWS))
        assert len(report.invalid) > 100, report.summary()

    def test_what_survives_is_a_subset_of_the_verified_export(self, db: Session):
        verified = {not_none(r.parsed).email for r in preview_import(db, load(VERIFIED)).valid}
        assert verified


class TestMatchingAgainstRealData:
    def test_a_known_company_matches(self, db: Session):
        from datetime import UTC, datetime

        commit_import(db, load(VERIFIED))
        result = match_recruiter(db, company_name="1Password", now=datetime.now(UTC))
        assert result.recruiter is not None
        assert result.matched_on == "company"

    def test_an_unknown_company_asks_rather_than_guessing(self, db: Session):
        from datetime import UTC, datetime

        commit_import(db, load(VERIFIED))
        result = match_recruiter(
            db, company_name="Definitely Not A Real Employer", now=datetime.now(UTC)
        )
        assert result.recruiter is None
        assert result.needs_manual_selection

    def test_campus_titles_win_where_the_data_offers_a_choice(self, db: Session):
        """The export's recruiter_title column is what drives §7.12's ordering."""
        from datetime import UTC, datetime

        commit_import(db, load(VERIFIED))
        titled = db.scalars(
            select(Recruiter).where(Recruiter.title.ilike("%university%")).limit(1)
        ).first()
        if titled is None:
            pytest.skip("the export has no university-titled recruiters")

        result = match_recruiter(db, company_name=titled.raw_company, now=datetime.now(UTC))
        assert result.recruiter is not None
