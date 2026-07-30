"""Selected is not uploaded (spec §7.7, §22.4).

Building a resume picks the PDF that *should* go to the employer. Whether it went
is a separate fact, and it can only be established by the browser that attached
it. These tests are about keeping those two apart, because the case where they
differ is the case that needs a person:

* a slot that died before the form loaded,
* a file input the extractor never found,
* a form that asks for the resume on a page nobody reached.

In every one of those the pipeline has produced a perfectly good PDF and the
employer has nothing. If ``/resumes`` said "uploaded" for them, the screen would
be describing the failures as done.

The real browser half — that ``FillReport.resume_uploaded`` is only set when
Playwright's ``set_input_files`` returned — is in ``tests/e2e/test_browser_fill.py``.
Here the report is a stand-in, so the recording logic can be tested without
Chromium.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import Application, Company, Job, ResumeVersion
from app.domain.normalization import canonicalize_url, url_hash
from app.domain.states import ApplicationState, JobState
from app.services.resume_artifacts import (
    mark_uploaded,
    selected_version,
    uploaded_version,
)

pytestmark = pytest.mark.db

NOW = datetime.now(UTC).replace(microsecond=0)
LATER = NOW + timedelta(minutes=5)


@dataclass
class Report:
    """Stands in for the browser's ``FillReport``."""

    resume_uploaded: Path | None = None


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        app_env="development",
        app_secret_key="upload-state",
        data_dir=tmp_path / "data",
    )


@pytest.fixture
def application(db: Session) -> Application:
    company = Company(
        canonical_name="Acme Inc",
        normalized_name=f"acme-{uuid.uuid4().hex[:6]}",
        domain="acme.com",
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

    row = Application(job_id=job.id, application_url=url, status=ApplicationState.CREATED)
    db.add(row)
    db.flush()
    return row


@pytest.fixture
def pdf(tmp_path: Path) -> Path:
    path = tmp_path / "resume.pdf"
    path.write_bytes(b"%PDF-1.7\nselected build\n")
    return path


@pytest.fixture
def version(db: Session, application: Application, pdf: Path) -> ResumeVersion:
    """A build that chose this PDF. Nothing has sent it anywhere."""
    row = ResumeVersion(
        application_id=application.id,
        job_id=application.job_id,
        kind="TAILORED",
        status="READY_FOR_REVIEW",
        attempt=1,
        source_path=str(pdf.with_suffix(".tex")),
        pdf_path=str(pdf),
        sha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),
        page_count=1,
        is_selected=True,
    )
    db.add(row)
    db.flush()
    application.resume_version_id = row.id
    return row


def record(db: Session, application: Application, report: Report) -> None:
    """The glue the browser worker runs after a fill pass."""
    from app.worker.browser_slot import _mark_resume_uploaded

    _mark_resume_uploaded(db, application, report, now=LATER)


class TestSelectedButNotUploaded:
    def test_a_freshly_built_resume_is_selected_only(
        self, db: Session, application: Application, version: ResumeVersion
    ):
        assert version.is_selected is True
        assert version.is_uploaded is False
        assert version.uploaded_at is None

    def test_the_lookups_disagree_as_they_should(
        self, db: Session, application: Application, version: ResumeVersion
    ):
        assert selected_version(db, application.id) is not None
        assert uploaded_version(db, application.id) is None

    def test_the_screen_shows_it_as_awaiting_upload(
        self, db: Session, settings: Settings, application: Application, version: ResumeVersion
    ):
        from app.web.queries import resume_groups

        group = next(g for g in resume_groups(db) if g.application_id == application.id)
        assert group.selected is not None
        assert group.uploaded is None
        assert group.awaiting_upload is True

    def test_a_pass_that_attached_nothing_records_nothing(
        self, db: Session, application: Application, version: ResumeVersion
    ):
        """The slot ran, the resume field was never found. Still not uploaded."""
        record(db, application, Report(resume_uploaded=None))
        db.flush()
        assert version.is_uploaded is False
        assert uploaded_version(db, application.id) is None


class TestASuccessfulUpload:
    def test_the_version_is_marked_with_the_time(
        self, db: Session, application: Application, version: ResumeVersion, pdf: Path
    ):
        record(db, application, Report(resume_uploaded=pdf))
        db.flush()
        assert version.is_uploaded is True
        assert version.uploaded_at == LATER

    def test_it_stays_selected_too(
        self, db: Session, application: Application, version: ResumeVersion, pdf: Path
    ):
        """Uploading does not un-choose it; the two facts are independent."""
        record(db, application, Report(resume_uploaded=pdf))
        db.flush()
        assert version.is_selected is True

    def test_the_screen_stops_calling_it_pending(
        self, db: Session, application: Application, version: ResumeVersion, pdf: Path
    ):
        from app.web.queries import resume_groups

        record(db, application, Report(resume_uploaded=pdf))
        db.flush()
        group = next(g for g in resume_groups(db) if g.application_id == application.id)
        assert group.uploaded is not None
        assert group.awaiting_upload is False

    def test_the_recorded_hash_is_the_hash_of_what_was_sent(
        self, db: Session, application: Application, version: ResumeVersion, pdf: Path
    ):
        """The whole reason the hash is stored: it ties the row to the bytes."""
        record(db, application, Report(resume_uploaded=pdf))
        db.flush()
        assert version.sha256 == hashlib.sha256(pdf.read_bytes()).hexdigest()

    def test_the_row_is_found_by_hash_not_by_being_the_selected_one(
        self, db: Session, application: Application, version: ResumeVersion, pdf: Path
    ):
        """A rebuild between preparing and filling would leave the browser holding
        an older file. Matching on the hash puts the flag on the version the
        employer actually received, not on whichever one is current."""
        older = ResumeVersion(
            application_id=application.id,
            job_id=application.job_id,
            kind="TAILORED",
            status="READY_FOR_REVIEW",
            attempt=1,
            source_path="old.tex",
            pdf_path="old.pdf",
            sha256=hashlib.sha256(b"an older build").hexdigest(),
            page_count=1,
            is_selected=False,
        )
        db.add(older)
        db.flush()

        stale = Path(str(pdf)).with_name("stale.pdf")
        stale.write_bytes(b"an older build")
        record(db, application, Report(resume_uploaded=stale))
        db.flush()

        assert older.is_uploaded is True, "the bytes that were sent"
        assert version.is_uploaded is False, "not merely the current selection"

    def test_a_file_matching_no_version_is_not_recorded(
        self, db: Session, application: Application, version: ResumeVersion, tmp_path: Path
    ):
        """Better to record nothing than to attribute an upload to the wrong row."""
        stranger = tmp_path / "stranger.pdf"
        stranger.write_bytes(b"%PDF-1.7\nnot ours\n")

        record(db, application, Report(resume_uploaded=stranger))
        db.flush()
        assert uploaded_version(db, application.id) is None

    def test_a_vanished_file_is_not_recorded(
        self, db: Session, application: Application, version: ResumeVersion, tmp_path: Path
    ):
        record(db, application, Report(resume_uploaded=tmp_path / "gone.pdf"))
        db.flush()
        assert uploaded_version(db, application.id) is None


class TestAFailedUpload:
    def test_a_file_input_that_raised_leaves_it_unuploaded(
        self, db: Session, application: Application, version: ResumeVersion
    ):
        """``fill_form`` sets ``resume_uploaded`` only after ``set_input_files``
        returns, so an exception arrives here as ``None``."""
        record(db, application, Report(resume_uploaded=None))
        db.flush()
        assert version.is_uploaded is False
        assert version.uploaded_at is None

    def test_the_selected_version_is_still_there_to_retry_with(
        self, db: Session, application: Application, version: ResumeVersion
    ):
        record(db, application, Report(resume_uploaded=None))
        db.flush()
        assert selected_version(db, application.id) is not None
        assert Path(version.pdf_path).is_file()


class TestRetrying:
    def test_a_second_pass_after_a_failure_records_the_upload(
        self, db: Session, application: Application, version: ResumeVersion, pdf: Path
    ):
        """The replay path re-attaches the same stored file, so it establishes the
        same fact — which is why it records again rather than assuming the first
        pass did."""
        record(db, application, Report(resume_uploaded=None))
        db.flush()
        assert version.is_uploaded is False

        record(db, application, Report(resume_uploaded=pdf))
        db.flush()
        assert version.is_uploaded is True

    def test_recording_the_same_upload_twice_is_idempotent(
        self, db: Session, application: Application, version: ResumeVersion, pdf: Path
    ):
        record(db, application, Report(resume_uploaded=pdf))
        db.flush()
        first = version.uploaded_at

        mark_uploaded(db, application=application, path=pdf, now=first + timedelta(minutes=1))
        db.flush()

        rows = db.scalars(
            select(ResumeVersion).where(ResumeVersion.application_id == application.id)
        ).all()
        assert len([r for r in rows if r.is_uploaded]) == 1

    def test_only_one_version_is_ever_marked_uploaded(
        self, db: Session, application: Application, version: ResumeVersion, pdf: Path
    ):
        """A replay that sends a different file moves the flag rather than adding
        a second one — an application has one resume at the employer."""
        replacement = Path(str(pdf)).with_name("second.pdf")
        replacement.write_bytes(b"%PDF-1.7\na later build\n")
        later = ResumeVersion(
            application_id=application.id,
            job_id=application.job_id,
            kind="TAILORED",
            status="READY_FOR_REVIEW",
            attempt=2,
            source_path="second.tex",
            pdf_path=str(replacement),
            sha256=hashlib.sha256(replacement.read_bytes()).hexdigest(),
            page_count=1,
            is_selected=False,
        )
        db.add(later)
        db.flush()

        record(db, application, Report(resume_uploaded=pdf))
        db.flush()
        record(db, application, Report(resume_uploaded=replacement))
        db.flush()

        assert version.is_uploaded is False
        assert version.uploaded_at is None
        assert later.is_uploaded is True


class TestTheExactUploadedBytes:
    def test_the_uploaded_row_hashes_to_the_file_that_was_sent(
        self, db: Session, application: Application, version: ResumeVersion, pdf: Path
    ):
        record(db, application, Report(resume_uploaded=pdf))
        db.flush()

        row = uploaded_version(db, application.id)
        assert row is not None
        on_disk = hashlib.sha256(Path(row.pdf_path).read_bytes()).hexdigest()
        assert row.sha256 == on_disk
        assert on_disk == hashlib.sha256(pdf.read_bytes()).hexdigest()

    def test_editing_the_file_afterwards_does_not_change_what_was_recorded(
        self, db: Session, application: Application, version: ResumeVersion, pdf: Path
    ):
        """The hash is a record of what was sent, not a live checksum.

        If the file is later replaced, the recorded hash stops matching — and that
        mismatch is the finding, not something to paper over.
        """
        record(db, application, Report(resume_uploaded=pdf))
        db.flush()
        recorded = version.sha256

        pdf.write_bytes(b"%PDF-1.7\ntampered\n")
        assert version.sha256 == recorded
        assert hashlib.sha256(pdf.read_bytes()).hexdigest() != recorded


class TestTheFieldsSurviveARoundTrip:
    def test_the_columns_are_persisted_and_reread(
        self, db: Session, application: Application, version: ResumeVersion, pdf: Path
    ):
        record(db, application, Report(resume_uploaded=pdf))
        db.flush()
        db.expire_all()

        reread = db.get(ResumeVersion, version.id)
        assert reread is not None
        assert reread.is_selected is True
        assert reread.is_uploaded is True
        assert reread.uploaded_at is not None
