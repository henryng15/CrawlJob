"""Registering the base resume (spec §7.7).

Importing is the step that turns "there is a PDF on my laptop" into something
the pipeline can act on. Two things have to hold: the file is copied so the
pipeline keeps working when the original moves, and the row it writes is the one
the gate looks for — a gate that opened on the pipeline's own output would be no
gate at all.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import ResumeVersion
from app.services.resume_import import base_version, import_resume

pytestmark = pytest.mark.db

NOW = datetime.now(UTC).replace(microsecond=0)


@pytest.fixture
def source_pdf(tmp_path: Path, sample_resume: Path) -> Path:
    pdf = sample_resume
    mine = tmp_path / "my_resume.pdf"
    mine.write_bytes(pdf.read_bytes())
    return mine


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        app_env="development",
        app_secret_key="import-tests",
        data_dir=tmp_path / "data",
    )


@pytest.fixture
def db(committing_db) -> Iterator[Session]:
    session = committing_db()
    try:
        yield session
    finally:
        session.close()


class TestWhatImportingDoes:
    def test_the_file_is_copied_under_the_data_directory(
        self, db: Session, settings: Settings, source_pdf: Path
    ):
        result = import_resume(db, settings, path=source_pdf)

        assert result.stored_at.is_relative_to(settings.artifacts_dir)
        assert result.stored_at.read_bytes() == source_pdf.read_bytes()

    def test_the_copy_survives_the_original_moving(
        self, db: Session, settings: Settings, source_pdf: Path
    ):
        result = import_resume(db, settings, path=source_pdf)
        source_pdf.unlink()

        assert result.stored_at.is_file()

    def test_the_checksum_is_of_the_stored_copy(
        self, db: Session, settings: Settings, source_pdf: Path
    ):
        result = import_resume(db, settings, path=source_pdf)

        expected = hashlib.sha256(result.stored_at.read_bytes()).hexdigest()
        assert result.resume.sha256 == expected

    def test_it_counts_the_pages(self, db: Session, settings: Settings, source_pdf: Path):
        assert import_resume(db, settings, path=source_pdf).pages == 1

    def test_it_remembers_where_the_file_came_from(
        self, db: Session, settings: Settings, source_pdf: Path
    ):
        result = import_resume(db, settings, path=source_pdf)
        assert result.resume.source_path == str(source_pdf)

    def test_the_row_is_approved_because_it_is_the_users_own_document(
        self, db: Session, settings: Settings, source_pdf: Path
    ):
        """Nothing generated it, so there is nothing for a person to approve."""
        result = import_resume(db, settings, path=source_pdf)
        assert result.resume.status == "APPROVED"
        assert result.resume.kind == "BASE"

    def test_a_format_a_form_will_not_take_is_refused(
        self, db: Session, settings: Settings, tmp_path: Path
    ):
        tex = tmp_path / "resume.tex"
        tex.write_text(r"\documentclass{article}\begin{document}hi\end{document}")

        with pytest.raises(ValueError, match="expected one of"):
            import_resume(db, settings, path=tex)


class TestWhatTheGateLooksFor:
    def test_nothing_imported_means_no_base_version(self, db: Session):
        assert base_version(db) is None

    def test_importing_makes_one_findable(self, db: Session, settings: Settings, source_pdf: Path):
        result = import_resume(db, settings, path=source_pdf)
        db.commit()

        found = base_version(db)
        assert found is not None
        assert found.id == result.resume.id

    def test_a_row_belonging_to_an_application_does_not_count(
        self, db: Session, settings: Settings, source_pdf: Path
    ):
        """That is the pipeline's own output — a copy handed to one application.

        Counting it would let the gate open on work it did itself, which is the
        one thing the database check exists to prevent.
        """
        from app.services.resume_artifacts import attach_base
        from tests.integration.test_resume_artifacts import make_application

        settings = settings.model_copy(update={"base_resume_pdf": source_pdf})
        application = make_application(db)
        attached = attach_base(db, settings, application=application, now=NOW)
        db.commit()

        assert attached is not None, "the application did get a copy"
        assert base_version(db) is None, "but the gate must not see it as the base"

    def test_importing_twice_leaves_both_rows_and_the_gate_still_opens(
        self, db: Session, settings: Settings, source_pdf: Path
    ):
        """Re-importing is how the resume is replaced; it is not an error."""
        import_resume(db, settings, path=source_pdf)
        import_resume(db, settings, path=source_pdf)
        db.commit()

        rows = db.scalars(select(ResumeVersion).where(ResumeVersion.application_id.is_(None))).all()
        assert len(rows) == 2
        assert base_version(db) is not None
