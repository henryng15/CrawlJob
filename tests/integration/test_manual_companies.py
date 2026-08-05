"""The manual-only company list.

The list decides whether an application is submitted automatically or handed to
the user, so the tests that matter are the ones about the *direction of failure*:
what happens when there is nothing to match on. The answer must always be
"manual". A test here that asserts ``False`` is asserting that a browser may
click Submit, and each one says why it is safe to.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.models import ManualOnlyCompany
from app.services.manual_companies import (
    import_csv,
    is_manual_only,
    normalize_domain,
    preview_import,
)
from tests.helpers import not_none

pytestmark = pytest.mark.db

CSV = """company_name,domain
Stripe,https://www.Stripe.com/
Databricks,databricks.com
X,x.com
"""

#: Four rows are exact duplicates of earlier ones, as in the user's own seed file.
DUPLICATED_CSV = """company_name,domain
Rippling,rippling.com
Cruise,getcruise.com
Rippling,rippling.com
Cruise,getcruise.com
"""

SEED = Path.home() / "VSCode" / "projects" / "ColdEmail" / "data" / "seed_manual.csv"


def write(tmp_path: Path, text: str, name: str = "manual.csv") -> Path:
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


def count(db: Session) -> int:
    return not_none(db.scalar(select(func.count()).select_from(ManualOnlyCompany)))


class TestDomainNormalization:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("https://www.Stripe.com/", "stripe.com"),
            ("  STRIPE.com  ", "stripe.com"),
            ("http://stripe.com", "stripe.com"),
            ("www.stripe.com", "stripe.com"),
            ("stripe.com/careers?utm_source=x", "stripe.com"),
            ("stripe.com:443", "stripe.com"),
            ("nubank.com.br", "nubank.com.br"),
        ],
    )
    def test_folds_to_the_bare_host(self, raw, expected):
        assert normalize_domain(raw) == expected

    @pytest.mark.parametrize("raw", ["", "   ", "https://", "/"])
    def test_nothing_usable_is_not_a_key(self, raw):
        assert normalize_domain(raw) == ""


class TestImport:
    def test_preview_writes_nothing(self, db: Session, tmp_path: Path):
        report = preview_import(db, write(tmp_path, CSV), source="manual.csv")
        assert report.added == 3
        assert count(db) == 0

    def test_rows_are_written(self, db: Session, tmp_path: Path):
        report = import_csv(db, write(tmp_path, CSV), source="seed_manual.csv")
        assert report.added == 3
        assert count(db) == 3
        assert db.scalars(select(ManualOnlyCompany.source)).first() == "seed_manual.csv"

    def test_domains_are_stored_normalized(self, db: Session, tmp_path: Path):
        import_csv(db, write(tmp_path, CSV), source="seed_manual.csv")
        domains = set(db.scalars(select(ManualOnlyCompany.domain)).all())
        assert "stripe.com" in domains
        assert all(d == d.lower() and "/" not in d for d in domains)

    def test_reimport_changes_nothing(self, db: Session, tmp_path: Path):
        path = write(tmp_path, CSV)
        import_csv(db, path, source="seed_manual.csv")

        second = import_csv(db, path, source="seed_manual.csv")
        assert second.added == 0
        assert second.skipped == 3
        assert count(db) == 3

    def test_duplicate_rows_collapse(self, db: Session, tmp_path: Path):
        report = import_csv(db, write(tmp_path, DUPLICATED_CSV), source="seed_manual.csv")
        assert report.added == 2
        assert report.duplicates == 2
        assert count(db) == 2

    def test_a_row_with_no_domain_is_reported_not_guessed_at(self, db: Session, tmp_path: Path):
        path = write(tmp_path, "company_name,domain\nMystery Corp,\n")
        report = import_csv(db, path, source="seed_manual.csv")
        assert report.invalid == 1
        assert count(db) == 0

    def test_the_summary_counts_every_row(self, db: Session, tmp_path: Path):
        report = import_csv(db, write(tmp_path, DUPLICATED_CSV), source="seed_manual.csv")
        assert report.total == 4
        assert "2 added" in report.summary()


class TestIsManualOnly:
    @pytest.fixture(autouse=True)
    def listed(self, db: Session, tmp_path: Path):
        import_csv(db, write(tmp_path, CSV), source="seed_manual.csv")

    def test_a_listed_domain_matches(self, db: Session):
        assert is_manual_only(db, domain="stripe.com", company_name=None) is True

    def test_a_listed_domain_matches_however_it_is_written(self, db: Session):
        assert is_manual_only(db, domain="https://WWW.Stripe.com/jobs", company_name=None) is True

    def test_a_subdomain_of_a_listed_domain_matches(self, db: Session):
        """Discovery yields ``careers.stripe.com``; the list says ``stripe.com``.

        Treating those as different strings would clear Stripe for
        auto-submission on a technicality.
        """
        assert is_manual_only(db, domain="careers.stripe.com", company_name=None) is True
        assert is_manual_only(db, domain="jobs.eu.databricks.com", company_name=None) is True

    def test_a_parent_of_a_listed_domain_is_not_a_match(self, db: Session):
        """Listing ``stripe.com`` must not list every ``.com``."""
        assert is_manual_only(db, domain="notstripe.com", company_name=None) is False
        assert is_manual_only(db, domain="com", company_name=None) is False

    def test_an_unlisted_domain_with_an_unlisted_name_is_automatable(self, db: Session):
        """The one route to ``False``, and the only one there is."""
        assert is_manual_only(db, domain="figma.com", company_name="Figma") is False
        assert is_manual_only(db, domain="figma.com", company_name=None) is False


class TestNoDomainIsAlwaysManual:
    """The inversion. Absence of evidence is never evidence of automatability."""

    @pytest.fixture(autouse=True)
    def listed(self, db: Session, tmp_path: Path):
        import_csv(db, write(tmp_path, CSV), source="seed_manual.csv")

    @pytest.mark.parametrize("domain", [None, "", "   ", "https://", "/"])
    def test_no_usable_domain_means_manual(self, db: Session, domain):
        assert is_manual_only(db, domain=domain, company_name="Definitely Not Listed") is True

    def test_nothing_to_match_on_at_all_means_manual(self, db: Session):
        assert is_manual_only(db, domain=None, company_name=None) is True

    def test_an_empty_list_still_holds_undomained_employers_back(self, db: Session):
        """Nothing imported yet is the state a fresh install is in."""
        db.execute(delete(ManualOnlyCompany))
        db.flush()
        assert is_manual_only(db, domain=None, company_name="Figma") is True
        assert is_manual_only(db, domain="figma.com", company_name="Figma") is False


class TestTheNameOnlyEverSaysYes:
    @pytest.fixture(autouse=True)
    def listed(self, db: Session, tmp_path: Path):
        import_csv(db, write(tmp_path, CSV), source="seed_manual.csv")

    def test_a_listed_name_under_an_unlisted_domain_is_manual(self, db: Session):
        """A second chance at "yes", not a second opinion overturning one."""
        assert is_manual_only(db, domain="stripe-careers.example", company_name="Stripe") is True

    def test_a_name_that_misses_cannot_overturn_a_listed_domain(self, db: Session):
        assert is_manual_only(db, domain="stripe.com", company_name="Figma") is True

    def test_a_one_character_name_key_is_never_matched(self, db: Session):
        """The name "X" folds to "x", which must not put a company on the list."""
        assert is_manual_only(db, domain="unlisted.example", company_name="X") is False
        assert is_manual_only(db, domain="x.com", company_name=None) is True

    @pytest.mark.parametrize(
        ("listed_as", "asked_about"),
        [
            ("D. E. Shaw & Co.", "DE Shaw"),
            ("RTX", "Raytheon"),
            ("The Coca-Cola Company", "Coca-Cola"),
            ("Boston Consulting Group", "BCG"),
        ],
    )
    def test_the_name_check_misses_real_pairs(self, db: Session, listed_as, asked_about):
        """Documented in ``is_manual_only``: this is why the domain is the key.

        The pairs still miss, so a *right* domain is what protects these
        employers. What has changed is that a missing domain no longer lands
        here at all — it is answered "manual" before the name is consulted.
        """
        db.add(
            ManualOnlyCompany(
                domain=f"{asked_about.lower().replace(' ', '')}.example",
                company_name=listed_as,
                source="test",
            )
        )
        db.flush()
        assert is_manual_only(db, domain="unrelated.example", company_name=asked_about) is False
        assert is_manual_only(db, domain=None, company_name=asked_about) is True


@pytest.mark.skipif(not SEED.exists(), reason=f"seed list not available at {SEED}")
class TestTheRealSeedList:
    def test_every_row_parses(self, db: Session):
        """All 247 rows are usable: nothing is silently dropped as unparseable."""
        report = import_csv(db, SEED, source="seed_manual.csv")
        assert report.total == 247
        assert report.added == 243
        assert report.duplicates == 4, "Rippling, Cruise, Nuro and Nubank appear twice"
        assert report.invalid == 0
        assert count(db) == 243

    def test_reimporting_the_real_list_changes_nothing(self, db: Session):
        import_csv(db, SEED, source="seed_manual.csv")
        second = import_csv(db, SEED, source="seed_manual.csv")
        assert second.added == 0
        assert count(db) == 243

    def test_a_company_on_the_list_is_manual_only(self, db: Session):
        import_csv(db, SEED, source="seed_manual.csv")
        assert is_manual_only(db, domain="https://www.google.com/", company_name=None) is True

    def test_a_multi_label_suffix_survives_the_parent_walk(self, db: Session):
        """``nubank.com.br`` must be reached, and ``com.br`` must not be a hit."""
        import_csv(db, SEED, source="seed_manual.csv")
        assert is_manual_only(db, domain="careers.nubank.com.br", company_name=None) is True
        assert is_manual_only(db, domain="unrelated.com.br", company_name=None) is False
