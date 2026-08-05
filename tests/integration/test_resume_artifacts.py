"""Attaching the base resume to an application (spec §7.7, §23.5).

Preparing a resume is a copy and a row. These tests are about the two things
that makes non-obvious: the copy has to be a *snapshot*, so editing the original
afterwards cannot change what an application says it sent; and exactly one row
per application may claim to be the file that will be uploaded.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import Application, Company, Job, ResumeVersion
from app.domain.normalization import canonicalize_url, url_hash
from app.domain.states import ApplicationState, JobState
from app.services.resume_artifacts import attach_base, resume_dir, selected_version

pytestmark = pytest.mark.db

NOW = datetime.now(UTC).replace(microsecond=0)


@pytest.fixture
def base_pdf(tmp_path: Path, sample_resume: Path) -> Path:
    """A private copy of the sample PDF, so a test may edit it."""
    source = sample_resume
    pdf = tmp_path / "base.pdf"
    pdf.write_bytes(source.read_bytes())
    return pdf


@pytest.fixture
def settings(tmp_path: Path, base_pdf: Path) -> Settings:
    return Settings(
        app_env="development",
        app_secret_key="artifact-tests",
        data_dir=tmp_path / "data",
        base_resume_pdf=base_pdf,
    )


@pytest.fixture
def db(committing_db) -> Iterator[Session]:
    session = committing_db()
    try:
        yield session
    finally:
        session.close()


def make_application(db: Session) -> Application:
    company = Company(
        canonical_name="Acme Inc",
        normalized_name=f"acme-{uuid.uuid4().hex[:6]}",
        domain="a.com",
    )
    db.add(company)
    db.flush()
    url = f"https://boards.greenhouse.io/acme/jobs/{uuid.uuid4().hex[:8]}"
    job = Job(
        company_id=company.id,
        canonical_url=canonicalize_url(url),
        canonical_url_hash=url_hash(url),
        title="Software Engineer Intern",
        normalized_title="software engineer intern",
        dedupe_fingerprint=uuid.uuid4().hex,
        discovered_at=NOW,
        status=JobState.SCORED,
    )
    db.add(job)
    db.flush()
    application = Application(
        job_id=job.id, application_url=url, status=ApplicationState.CREATED
    )
    db.add(application)
    db.commit()
    return application


def versions(db: Session, application: Application) -> list[ResumeVersion]:
    return list(
        db.scalars(
            select(ResumeVersion).where(ResumeVersion.application_id == application.id)
        ).all()
    )


class TestWhatIsRecorded:
    def test_the_pdf_is_copied_into_the_applications_own_folder(
        self, db: Session, settings: Settings, base_pdf: Path
    ):
        application = make_application(db)
        row = attach_base(db, settings, application=application, now=NOW)

        assert row is not None
        path = Path(row.pdf_path)
        assert path.is_relative_to(resume_dir(settings, application.id))
        assert path.read_bytes() == base_pdf.read_bytes()

    def test_the_checksum_is_of_the_copy_on_disk(
        self, db: Session, settings: Settings
    ):
        """The whole point of storing it: proof that the PDF in the folder is the
        one the employer received."""
        application = make_application(db)
        row = attach_base(db, settings, application=application, now=NOW)

        assert row is not None
        on_disk = hashlib.sha256(Path(row.pdf_path).read_bytes()).hexdigest()
        assert row.sha256 == on_disk

    def test_it_records_where_the_copy_came_from(
        self, db: Session, settings: Settings, base_pdf: Path
    ):
        application = make_application(db)
        row = attach_base(db, settings, application=application, now=NOW)

        assert row is not None
        assert row.source_path == str(base_pdf)

    def test_it_counts_the_pages(self, db: Session, settings: Settings):
        application = make_application(db)
        row = attach_base(db, settings, application=application, now=NOW)

        assert row is not None
        assert row.page_count == 1

    def test_the_application_points_at_the_row(self, db: Session, settings: Settings):
        application = make_application(db)
        row = attach_base(db, settings, application=application, now=NOW)

        assert row is not None
        assert application.resume_version_id == row.id
        assert selected_version(db, application.id) is not None


class TestTheCopyIsASnapshot:
    def test_editing_the_original_afterwards_changes_nothing(
        self, db: Session, settings: Settings, base_pdf: Path
    ):
        """Otherwise "which resume went to Amazon in August" has no answer."""
        application = make_application(db)
        row = attach_base(db, settings, application=application, now=NOW)
        assert row is not None
        before = Path(row.pdf_path).read_bytes()

        base_pdf.write_bytes(b"%PDF-1.4 a completely different document\n")

        assert Path(row.pdf_path).read_bytes() == before
        assert row.sha256 == hashlib.sha256(before).hexdigest()

    def test_the_original_is_never_written_to(
        self, db: Session, settings: Settings, base_pdf: Path
    ):
        application = make_application(db)
        before = base_pdf.read_bytes()
        attach_base(db, settings, application=application, now=NOW)
        assert base_pdf.read_bytes() == before


class TestExactlyOneSelectedRow:
    def test_attaching_twice_does_not_produce_a_second_row(
        self, db: Session, settings: Settings
    ):
        """A retried task, or two workers, must not leave two rows both claiming
        to be the thing that will be uploaded."""
        application = make_application(db)
        first = attach_base(db, settings, application=application, now=NOW)
        second = attach_base(db, settings, application=application, now=NOW)

        assert first is not None and second is not None
        assert first.id == second.id
        assert len(versions(db, application)) == 1

    def test_two_applications_get_separate_copies(
        self, db: Session, settings: Settings
    ):
        one, two = make_application(db), make_application(db)
        first = attach_base(db, settings, application=one, now=NOW)
        second = attach_base(db, settings, application=two, now=NOW)

        assert first is not None and second is not None
        assert Path(first.pdf_path) != Path(second.pdf_path)
        assert resume_dir(settings, one.id) != resume_dir(settings, two.id)


class TestRefusingRatherThanInventing:
    def test_no_configured_resume_returns_nothing(self, db: Session, tmp_path: Path):
        settings = Settings(
            app_env="development",
            app_secret_key="artifact-tests",
            data_dir=tmp_path / "data",
            base_resume_pdf=None,
        )
        application = make_application(db)
        assert attach_base(db, settings, application=application, now=NOW) is None
        assert versions(db, application) == []

    def test_a_configured_path_that_is_gone_returns_nothing(
        self, db: Session, settings: Settings, base_pdf: Path
    ):
        """"Unavailable" is not "use whatever else is around"."""
        base_pdf.unlink()
        application = make_application(db)
        assert attach_base(db, settings, application=application, now=NOW) is None
        assert versions(db, application) == []
