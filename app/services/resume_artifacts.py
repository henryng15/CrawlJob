"""Attaching the base resume to an application (spec §7.7, §23.5).

The system does not rewrite the resume. The user maintains one PDF, and that
file is what every application gets — so "preparing" a resume here is a copy and
a row, not a build.

The copy is the point. ``BASE_RESUME_PDF`` is a file the user keeps editing;
without a snapshot, "which resume went to Amazon in August" stops being
answerable the moment they change it. So the bytes are copied into the
application's own artifact folder and hashed there, and the hash is what proves
the PDF in that folder is the one that was sent.

**Selected is not uploaded.** Preparing marks the row that *should* go to the
employer, ``is_selected``. Whether it actually reached them is a different fact,
known only after Playwright has set the file on the form, and it is recorded
separately by :func:`mark_uploaded`. Collapsing the two would make ``/resumes``
claim a document was sent whenever the pipeline merely intended to send it — and
the case where that matters is the case where something went wrong: the browser
slot died, the file input was never found, the form changed. Those are exactly
the applications a person needs to look at, so they must not be the ones the
screen describes as done.
"""

from __future__ import annotations

import hashlib
import logging
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import Application, ResumeVersion

__all__ = [
    "BASE_ATTEMPT",
    "attach_base",
    "mark_uploaded",
    "page_count",
    "resume_dir",
    "selected_version",
    "sha256_of",
    "uploaded_version",
]

log = logging.getLogger(__name__)

#: Attempt number reserved for the user's own resume. Kept at 0 because the
#: column is still there and a row has to say something; nothing counts attempts
#: any more.
BASE_ATTEMPT = 0


def resume_dir(settings: Settings, application_id: uuid.UUID) -> Path:
    return settings.artifacts_dir / str(application_id) / "resume"


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def page_count(pdf: Path) -> int | None:
    """Pages in a PDF, or ``None`` if it cannot be read.

    ``None`` rather than a raise: a resume whose page count cannot be determined
    is worth saying so about, and is not a reason to refuse to prepare an
    application.
    """
    try:
        from pypdf import PdfReader

        return len(PdfReader(str(pdf)).pages)
    except Exception as exc:  # pragma: no cover - depends on the file
        log.warning("could not read %s to count its pages: %s", pdf, exc)
        return None


def attach_base(
    session: Session,
    settings: Settings,
    *,
    application: Application,
    now: datetime,
) -> ResumeVersion | None:
    """Snapshot the base resume for this application and record it.

    ``None`` when no base resume is configured or the file is gone — the caller
    turns that into a message naming what the user has to fix, because an
    application with no resume is not one a browser should be sent to fill.

    Idempotent: an application that already has a selected resume keeps it. Two
    workers, or one worker retried, must not leave two rows both claiming to be
    the thing that will be uploaded.
    """
    existing = selected_version(session, application.id)
    if existing is not None:
        return existing

    source = settings.base_resume_pdf
    if source is None or not source.is_file():
        return None

    directory = resume_dir(settings, application.id)
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / "resume.pdf"
    shutil.copy2(source, destination)

    row = ResumeVersion(
        application_id=application.id,
        job_id=application.job_id,
        kind="BASE",
        status="READY_FOR_REVIEW",
        attempt=BASE_ATTEMPT,
        source_path=str(source),
        pdf_path=str(destination),
        sha256=sha256_of(destination),
        page_count=page_count(destination),
        facts_used=[],
        is_selected=True,
        created_at=now,
    )
    session.add(row)
    session.flush()
    application.resume_version_id = row.id
    return row


def selected_version(session: Session, application_id: uuid.UUID) -> ResumeVersion | None:
    """The version prepared to send. May not have been sent yet."""
    return session.scalars(
        select(ResumeVersion)
        .where(ResumeVersion.application_id == application_id)
        .where(ResumeVersion.is_selected.is_(True))
    ).first()


def uploaded_version(session: Session, application_id: uuid.UUID) -> ResumeVersion | None:
    """The version a browser actually attached to the employer's form."""
    return session.scalars(
        select(ResumeVersion)
        .where(ResumeVersion.application_id == application_id)
        .where(ResumeVersion.is_uploaded.is_(True))
    ).first()


def mark_uploaded(
    session: Session,
    *,
    application: Application,
    path: Path,
    now: datetime,
) -> ResumeVersion | None:
    """Record that ``path`` was attached to the form. Called after the fact.

    Matched by hash rather than by row id. The browser was handed a *file*, and
    the only honest statement afterwards is "these bytes were uploaded" — so the
    row that gets the flag is the one whose recorded ``sha256`` matches what was
    read off disk. If the base resume changed between preparing and filling, that
    check is what stops the flag landing on a version the employer never saw.
    """
    if not path.is_file():
        log.warning("resume at %s is gone; nothing marked as uploaded", path)
        return None

    digest = sha256_of(path)
    row = session.scalars(
        select(ResumeVersion)
        .where(ResumeVersion.application_id == application.id)
        .where(ResumeVersion.sha256 == digest)
        .order_by(ResumeVersion.attempt)
    ).first()
    if row is None:
        log.warning(
            "the uploaded file for application %s matches no recorded version",
            application.id,
        )
        return None

    session.execute(
        update(ResumeVersion)
        .where(ResumeVersion.application_id == application.id)
        .where(ResumeVersion.id != row.id)
        .values(is_uploaded=False, uploaded_at=None)
    )
    row.is_uploaded = True
    row.uploaded_at = now
    return row
