"""Recruiter import and matching tests (spec §7.12)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Company, Recruiter
from app.services.recruiters import (
    commit_import,
    match_recruiter,
    normalize_email,
    parse_rows,
    preview_import,
)
from tests.helpers import not_none

pytestmark = pytest.mark.db

NOW = datetime(2026, 7, 28, tzinfo=UTC)

CSV = """name,company,email,title
Alice Nguyen,"Acme, Inc.",Alice.Nguyen@ACME.com,University Recruiter
Bob Chen,Globex,bob@globex.io,Technical Recruiter
Carla Diaz,Initech,carla@initech.dev,
"""

MESSY_CSV = """Full Name,Employer,E-Mail,Job Title
Alice Nguyen,Acme,alice@acme.com,University Recruiter
,Globex,bob@globex.io,Recruiter
Dave Smith,Initech,not-an-email,Recruiter
Erin Blake,Umbrella,erin@umbrella.com,Recruiter
Erin Duplicate,Umbrella,ERIN@umbrella.com,Recruiter

Frank Ross,,frank@nowhere.com,Recruiter
"""


def count(db: Session, model: type) -> int:
    return not_none(db.scalar(select(func.count()).select_from(model)))


def add_recruiter(db: Session, **kw: object) -> Recruiter:
    defaults = {
        "full_name": "Someone",
        "raw_company": "Acme",
        "email": "someone@acme.com",
        "email_domain": "acme.com",
    }
    recruiter = Recruiter(**{**defaults, **kw})
    db.add(recruiter)
    db.flush()
    return recruiter


class TestEmailNormalization:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("Alice@Acme.com", "alice@acme.com"),
            ("  bob@globex.io  ", "bob@globex.io"),
            ("CARLA@INITECH.DEV", "carla@initech.dev"),
        ],
    )
    def test_lowercased_and_trimmed(self, raw, expected):
        assert normalize_email(raw) == expected


class TestParsing:
    def test_reads_the_documented_columns(self):
        rows = parse_rows([(2, {"full_name": "A", "raw_company": "Acme", "email": "a@acme.com"})])
        assert rows[0].ok
        assert not_none(rows[0].parsed).email == "a@acme.com"

    def test_header_aliases_are_accepted(self):
        """Users export from different tools; the headers vary."""
        report = parse_rows([(2, {"full_name": "A", "raw_company": "Acme", "email": "a@acme.com"})])
        assert report[0].ok

    @pytest.mark.parametrize(
        ("row", "fragment"),
        [
            ({"raw_company": "Acme", "email": "a@acme.com"}, "missing name"),
            ({"full_name": "A", "email": "a@acme.com"}, "missing company"),
            ({"full_name": "A", "raw_company": "Acme"}, "missing email"),
            ({"full_name": "A", "raw_company": "Acme", "email": "nope"}, "invalid email"),
            ({"full_name": "A", "raw_company": "Acme", "email": "a@b"}, "invalid email"),
        ],
    )
    def test_invalid_rows_explain_themselves(self, row, fragment):
        parsed = parse_rows([(2, row)])[0]
        assert not parsed.ok
        assert fragment in not_none(parsed.error)

    def test_blank_lines_are_skipped(self):
        assert parse_rows([(2, {}), (3, {"full_name": "", "raw_company": "", "email": ""})]) == []

    def test_duplicates_within_the_file_are_flagged_not_dropped(self):
        """The user should see the collision, not have it silently resolved."""
        rows = parse_rows(
            [
                (2, {"full_name": "A", "raw_company": "Acme", "email": "a@acme.com"}),
                (3, {"full_name": "A Dup", "raw_company": "Acme", "email": "A@ACME.COM"}),
            ]
        )
        assert len(rows) == 2
        assert rows[1].is_duplicate_in_file


class TestPreview:
    def test_preview_writes_nothing(self, db: Session):
        """§7.12: preview before commit, and no email during import."""
        report = preview_import(db, CSV)
        assert len(report.valid) == 3
        assert count(db, Recruiter) == 0
        assert report.committed == 0

    def test_preview_reports_the_messy_cases(self, db: Session):
        report = preview_import(db, MESSY_CSV)
        assert len(report.invalid) == 3, "missing name, bad email, missing company"
        assert len(report.duplicates_in_file) == 1
        assert "invalid" in report.summary()

    def test_preview_flags_rows_already_in_the_database(self, db: Session):
        add_recruiter(db, email="alice.nguyen@acme.com")
        report = preview_import(db, CSV)
        assert len(report.already_known) == 1


class TestCommit:
    def test_valid_rows_are_written(self, db: Session):
        report = commit_import(db, CSV)
        assert report.committed == 3
        assert count(db, Recruiter) == 3

    def test_emails_are_stored_lowercased(self, db: Session):
        commit_import(db, CSV)
        emails = set(db.scalars(select(Recruiter.email)).all())
        assert "alice.nguyen@acme.com" in emails

    def test_email_domain_is_derived(self, db: Session):
        commit_import(db, CSV)
        alice = not_none(
            db.scalars(select(Recruiter).where(Recruiter.email == "alice.nguyen@acme.com")).first()
        )
        assert alice.email_domain == "acme.com"

    def test_reimport_merges_rather_than_duplicating(self, db: Session):
        commit_import(db, CSV)
        second = commit_import(db, CSV)
        assert second.committed == 0
        assert second.updated == 3
        assert count(db, Recruiter) == 3

    def test_reimport_applies_corrections(self, db: Session):
        commit_import(db, CSV)
        corrected = CSV.replace("Alice Nguyen,", "Alice Tran,")
        commit_import(db, corrected)
        alice = not_none(
            db.scalars(select(Recruiter).where(Recruiter.email == "alice.nguyen@acme.com")).first()
        )
        assert alice.full_name == "Alice Tran"

    def test_reimport_does_not_resurrect_a_do_not_contact_flag(self, db: Session):
        """An opt-out must survive the user re-uploading their spreadsheet."""
        commit_import(db, CSV)
        alice = not_none(
            db.scalars(select(Recruiter).where(Recruiter.email == "alice.nguyen@acme.com")).first()
        )
        alice.do_not_contact = True
        db.flush()

        commit_import(db, CSV)
        db.refresh(alice)
        assert alice.do_not_contact is True

    def test_invalid_rows_are_not_written(self, db: Session):
        commit_import(db, MESSY_CSV)
        emails = set(db.scalars(select(Recruiter.email)).all())
        assert "not-an-email" not in emails
        assert count(db, Recruiter) == 2, "Alice and Erin only"

    def test_links_to_a_known_company(self, db: Session):
        company = Company(canonical_name="Acme, Inc.", normalized_name="acme")
        db.add(company)
        db.flush()

        commit_import(db, CSV)
        alice = not_none(
            db.scalars(select(Recruiter).where(Recruiter.email == "alice.nguyen@acme.com")).first()
        )
        assert alice.company_id == company.id


class TestMatching:
    def test_exact_company_match(self, db: Session):
        target = add_recruiter(db, raw_company="Acme, Inc.", email="a@acme.com")
        result = match_recruiter(db, company_name="Acme", now=NOW)
        assert result.recruiter is not None
        assert result.recruiter.id == target.id
        assert result.matched_on == "company"
        assert result.confidence == 1.0

    def test_no_recruiters_means_manual_selection(self, db: Session):
        result = match_recruiter(db, company_name="Nowhere Inc", now=NOW)
        assert result.recruiter is None
        assert result.needs_manual_selection

    def test_campus_titles_are_preferred(self, db: Session):
        """§7.12 title ordering: a university recruiter over a generalist."""
        add_recruiter(db, full_name="Generalist", email="g@acme.com", title="Recruiter")
        campus = add_recruiter(
            db, full_name="Campus", email="c@acme.com", title="University Recruiter"
        )
        result = match_recruiter(db, company_name="Acme", now=NOW)
        assert not_none(result.recruiter).id == campus.id

    def test_do_not_contact_recruiters_are_excluded(self, db: Session):
        add_recruiter(db, email="blocked@acme.com", do_not_contact=True)
        ok = add_recruiter(db, email="ok@acme.com")
        assert not_none(match_recruiter(db, company_name="Acme", now=NOW).recruiter).id == ok.id

    def test_recruiters_who_replied_are_excluded(self, db: Session):
        add_recruiter(db, email="replied@acme.com", replied_at=NOW - timedelta(days=1))
        ok = add_recruiter(db, email="ok@acme.com")
        assert not_none(match_recruiter(db, company_name="Acme", now=NOW).recruiter).id == ok.id

    def test_recruiters_inside_the_cooldown_are_excluded(self, db: Session):
        add_recruiter(db, email="recent@acme.com", last_contacted_at=NOW - timedelta(days=5))
        ok = add_recruiter(db, email="ok@acme.com")
        assert not_none(match_recruiter(db, company_name="Acme", now=NOW).recruiter).id == ok.id

    def test_everyone_on_cooldown_asks_the_user(self, db: Session):
        add_recruiter(db, email="recent@acme.com", last_contacted_at=NOW - timedelta(days=5))
        result = match_recruiter(db, company_name="Acme", now=NOW)
        assert result.recruiter is None
        assert result.needs_manual_selection
        assert "cooldown" in result.reason

    def test_email_domain_match_when_the_name_differs(self, db: Session):
        target = add_recruiter(db, raw_company="ACME Corporation Holdings", email="x@acme.com")
        result = match_recruiter(
            db, company_name="Totally Different Name", company_domain="acme.com", now=NOW
        )
        assert not_none(result.recruiter).id == target.id
        assert result.matched_on == "email_domain"

    def test_a_close_but_inexact_name_always_asks(self, db: Session):
        """A fuzzy match is never acted on silently, however close (§7.12)."""
        add_recruiter(db, raw_company="Databricks", email="d@databricks.com")
        result = match_recruiter(db, company_name="Databrick", now=NOW)
        assert result.matched_on == "fuzzy_company"
        assert result.needs_manual_selection

    def test_an_unrelated_name_matches_nothing(self, db: Session):
        """Emailing the wrong company is worse than emailing nobody."""
        add_recruiter(db, raw_company="Databricks", email="d@databricks.com")
        result = match_recruiter(db, company_name="Snowflake", now=NOW)
        assert result.recruiter is None
        assert result.confidence < 0.88

    def test_empty_company_name_is_rejected(self, db: Session):
        result = match_recruiter(db, company_name="   ", now=NOW)
        assert result.recruiter is None
        assert "empty" in result.reason

    def test_candidates_are_returned_for_the_ui(self, db: Session):
        add_recruiter(db, email="a@acme.com", title="Recruiter")
        add_recruiter(db, email="b@acme.com", title="Recruiter")
        result = match_recruiter(db, company_name="Acme", now=NOW)
        assert len(result.candidates) == 2
