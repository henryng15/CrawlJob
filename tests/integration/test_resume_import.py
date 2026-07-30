"""Resume import and the facts registry (spec §7.7).

The property under test throughout: a fact a model extracted is not usable until
the user has confirmed it. Provenance validation is only as good as the facts it
validates against, and those come out of a PDF reader.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from app.config import Settings
from app.services.candidate import Actor, set_fact
from app.services.llm.base import NullProvider
from app.services.resume_import import (
    ExtractedFacts,
    extract_text,
    import_resume,
    load_facts,
    propose_facts,
    store_facts,
    unverified,
)

pytestmark = pytest.mark.db

RESUME_MD = """\
# Hoan Nguyen

## Experience
Todd Labs — Software Engineering Intern (Summer 2026)
- Built a FastAPI service that cut report generation from 40 minutes to 6.
- Contributed to a PostgreSQL migration affecting 12 internal services.

## Projects
ThesisLedger — led a DuckDB-backed research tool used by 30 students.
"""

EXTRACTED = {
    "facts": [
        {
            "id": "exp.todd.1",
            "text": "Built a FastAPI service at Todd Labs that cut report generation "
            "from 40 minutes to 6.",
            "organisation": "Todd Labs",
            "technologies": ["FastAPI", "Python"],
            "kind": "experience",
        },
        {
            "id": "proj.ledger",
            "text": "Led ThesisLedger, a DuckDB-backed research tool used by 30 students.",
            "organisation": "ThesisLedger",
            "technologies": ["DuckDB"],
            "kind": "project",
        },
    ]
}


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        app_env="development",
        app_secret_key="resume-import-tests",
        data_dir=tmp_path / "data",
    )


@pytest.fixture
def resume_file(tmp_path: Path) -> Path:
    path = tmp_path / "resume.md"
    path.write_text(RESUME_MD, encoding="utf-8")
    return path


class TestExtraction:
    def test_markdown_is_read_directly(self, resume_file: Path):
        assert "Todd Labs" in extract_text(resume_file)

    def test_an_unsupported_format_says_what_is_supported(self, tmp_path: Path):
        odd = tmp_path / "resume.pages"
        odd.write_text("x")
        with pytest.raises(ValueError, match=r"\.pdf"):
            extract_text(odd)

    def test_a_pdf_with_no_text_is_named_as_a_scan(self, tmp_path: Path):
        """The commonest real failure: a resume exported as an image.

        Extracting zero facts and saying nothing would leave the user wondering
        why their resume "did not work".
        """
        from pypdf import PdfWriter

        empty = tmp_path / "scan.pdf"
        writer = PdfWriter()
        writer.add_blank_page(width=612, height=792)
        with empty.open("wb") as handle:
            writer.write(handle)

        with pytest.raises(ValueError, match="no extractable text"):
            extract_text(empty)

    @pytest.mark.latex
    def test_a_real_pdf_round_trips(self, tmp_path: Path):
        """Built with the same compiler the tailoring path uses."""
        from app.services.latex import compile_pdf, engine_available

        if engine_available() is None:  # pragma: no cover - depends on the machine
            pytest.skip("no LaTeX engine installed")

        result = compile_pdf(
            r"\documentclass{article}\begin{document}Hoan Nguyen\end{document}",
            work_dir=tmp_path / "round-trip",
        )
        assert result.ok and result.pdf_path is not None
        assert "Hoan Nguyen" in extract_text(result.pdf_path)


class TestProposal:
    def test_the_model_is_asked_with_the_resume_text(self):
        provider = NullProvider([EXTRACTED])
        propose_facts(RESUME_MD, provider=provider)
        assert "Todd Labs" in provider.calls[0][2][1].content

    def test_the_result_is_schema_checked(self):
        """A fact with no text is not a fact."""
        from app.services.llm.base import SchemaValidationError

        provider = NullProvider([{"facts": [{"id": "x", "text": ""}]}])
        with pytest.raises(SchemaValidationError):
            propose_facts(RESUME_MD, provider=provider)


class TestVerification:
    def test_an_imported_fact_starts_unverified(self, db: Session):
        store_facts(db, ExtractedFacts.model_validate(EXTRACTED), actor=Actor.IMPORT)
        assert sorted(unverified(db)) == ["exp.todd.1", "proj.ledger"]

    def test_an_unverified_fact_is_not_offered_to_tailoring(self, db: Session):
        """The whole point: provenance validation is only as good as its facts."""
        store_facts(db, ExtractedFacts.model_validate(EXTRACTED), actor=Actor.IMPORT)
        assert load_facts(db) == {}

    def test_a_fact_the_user_wrote_is_verified_immediately(self, db: Session):
        store_facts(db, ExtractedFacts.model_validate(EXTRACTED), actor=Actor.USER)
        assert unverified(db) == []
        assert set(load_facts(db)) == {"exp.todd.1", "proj.ledger"}

    def test_confirming_promotes_the_fact(self, db: Session):
        from app.services.candidate import get_fact
        from app.services.resume_import import FACT_PREFIX

        store_facts(db, ExtractedFacts.model_validate(EXTRACTED), actor=Actor.IMPORT)
        stored = get_fact(db, f"{FACT_PREFIX}exp.todd.1")
        assert stored is not None
        set_fact(db, stored.key, stored.value, actor=Actor.USER, verified=True)

        assert "exp.todd.1" in load_facts(db)
        assert unverified(db) == ["proj.ledger"]

    def test_the_stored_shape_matches_what_the_validator_needs(self, db: Session):
        store_facts(db, ExtractedFacts.model_validate(EXTRACTED), actor=Actor.USER)
        fact = load_facts(db)["exp.todd.1"]
        assert fact.organisation == "Todd Labs"
        assert "fastapi" in fact.technologies
        assert "40" in fact.numbers

    def test_technologies_are_lowercased_for_matching(self, db: Session):
        """The validator compares case-insensitively; storing both cases would
        make the comparison depend on how the model happened to capitalise."""
        store_facts(db, ExtractedFacts.model_validate(EXTRACTED), actor=Actor.USER)
        assert all(t == t.lower() for t in load_facts(db)["exp.todd.1"].technologies)


class TestImport:
    def test_the_original_is_kept_verbatim(
        self, db: Session, settings: Settings, resume_file: Path
    ):
        """A tailored resume is only auditable against the document it came from."""
        result = import_resume(
            db, resume_file, settings=settings, provider=NullProvider([EXTRACTED])
        )
        stored = Path(result.resume.pdf_path)
        assert stored.exists()
        assert stored.read_text(encoding="utf-8") == RESUME_MD

    def test_the_checksum_matches_the_stored_file(
        self, db: Session, settings: Settings, resume_file: Path
    ):
        import hashlib

        result = import_resume(
            db, resume_file, settings=settings, provider=NullProvider([EXTRACTED])
        )
        digest = hashlib.sha256(Path(result.resume.pdf_path).read_bytes()).hexdigest()
        assert result.resume.sha256 == digest

    def test_facts_land_unverified_and_the_summary_says_so(
        self, db: Session, settings: Settings, resume_file: Path
    ):
        result = import_resume(
            db, resume_file, settings=settings, provider=NullProvider([EXTRACTED])
        )
        assert result.facts_found == 2
        assert len(result.needs_verification) == 2
        assert "Confirm them in Settings" in result.summary()

    def test_a_hand_written_facts_file_skips_the_model_entirely(
        self, db: Session, settings: Settings, resume_file: Path, tmp_path: Path
    ):
        """A user who writes this file has verified it by construction."""
        facts_file = tmp_path / "facts.json"
        facts_file.write_text(json.dumps(EXTRACTED), encoding="utf-8")

        provider = NullProvider()  # no queued responses: a call would raise
        result = import_resume(
            db, resume_file, settings=settings, provider=provider, facts_file=facts_file
        )
        assert result.needs_verification == []
        assert provider.calls == []
        assert len(load_facts(db)) == 2

    def test_a_bare_list_facts_file_is_accepted(
        self, db: Session, settings: Settings, resume_file: Path, tmp_path: Path
    ):
        facts_file = tmp_path / "facts.json"
        facts_file.write_text(json.dumps(EXTRACTED["facts"]), encoding="utf-8")

        result = import_resume(
            db, resume_file, settings=settings, facts_file=facts_file
        )
        assert result.facts_found == 2

    def test_importing_twice_updates_rather_than_duplicates(
        self, db: Session, settings: Settings, resume_file: Path
    ):
        import_resume(db, resume_file, settings=settings, provider=NullProvider([EXTRACTED]))
        import_resume(db, resume_file, settings=settings, provider=NullProvider([EXTRACTED]))
        assert len(unverified(db)) == 2


