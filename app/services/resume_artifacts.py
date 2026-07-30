"""Persisting a resume build (spec §7.7, §23.5).

One build produces up to three attempts plus, sometimes, a fallback. All of them
are written to disk and recorded in the database, including the ones that came
out at two pages — because the question the Resume Versions screen has to answer
is not "what was uploaded" but "why was *that* the thing uploaded", and the
attempts that did not qualify are the answer.

Artifacts are immutable. A row is inserted per attempt and never updated; a
rebuild produces new rows. The bytes on disk are the bytes that were hashed, so
``sha256`` proves the PDF in the folder is the one the page count was measured on.

**Selected is not uploaded.** Building picks the PDF that *should* go to the
employer and marks it ``is_selected``. Whether it actually reached the employer is
a different fact, known only after Playwright has set the file on the form, and it
is recorded separately by :func:`mark_uploaded`. Collapsing the two would make
``/resumes`` claim a document was sent whenever the pipeline merely intended to
send it — and the case where that matters is the case where something went wrong:
the browser slot died, the file input was never found, the form changed. Those are
exactly the applications a person needs to look at, so they must not be the ones
the screen describes as done.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import Application, ResumeVersion
from app.services.resume_build import (
    Attempt,
    BuildOutcome,
    manifest_for,
    sha256_of,
    write_manifest,
)
from app.services.resume_edits import Edits
from app.services.resume_tex import TexResume

__all__ = [
    "BASE_ATTEMPT",
    "mark_uploaded",
    "record_build",
    "resume_dir",
    "selected_version",
    "uploaded_version",
]

log = logging.getLogger(__name__)

#: Attempt number reserved for the user's own resume.
BASE_ATTEMPT = 0


def resume_dir(settings: Settings, application_id: uuid.UUID) -> Path:
    return settings.artifacts_dir / str(application_id) / "resume"


def record_build(
    session: Session,
    settings: Settings,
    *,
    application: Application,
    document: TexResume,
    outcome: BuildOutcome,
    facts_used: list[str],
    model: str | None,
    prompt_version: str | None,
    now: datetime,
    validation_path: Path | None = None,
    edits: Edits | None = None,
) -> ResumeVersion | None:
    """Write every attempt to disk and to the database. Returns the selected one.

    The selected flag is cleared across the application first, so a rebuild
    cannot leave two rows both claiming to be the one that will be sent. The
    uploaded flag is never set here — see :func:`mark_uploaded`.
    """
    directory = resume_dir(settings, application.id)
    directory.mkdir(parents=True, exist_ok=True)

    session.execute(
        update(ResumeVersion)
        .where(ResumeVersion.application_id == application.id)
        .values(is_selected=False)
    )

    rows: list[ResumeVersion] = []
    for attempt in outcome.attempts:
        rows.append(
            _record_attempt(
                session,
                settings,
                application=application,
                document=document,
                attempt=attempt,
                outcome=outcome,
                facts_used=facts_used,
                model=model,
                prompt_version=prompt_version,
                now=now,
                directory=directory,
                validation_path=validation_path,
                edits=edits,
            )
        )

    if outcome.used_base:
        rows.append(
            _record_base(
                session,
                application=application,
                outcome=outcome,
                now=now,
                directory=directory,
                validation_path=validation_path,
            )
        )

    session.flush()
    selected = next((row for row in rows if row.is_selected), None)
    if selected is not None:
        application.resume_version_id = selected.id
    return selected


def _record_attempt(
    session: Session,
    settings: Settings,
    *,
    application: Application,
    document: TexResume,
    attempt: Attempt,
    outcome: BuildOutcome,
    facts_used: list[str],
    model: str | None,
    prompt_version: str | None,
    now: datetime,
    directory: Path,
    validation_path: Path | None = None,
    edits: Edits | None = None,
) -> ResumeVersion:
    attempt_dir = directory / f"attempt-{attempt.number}"
    attempt_dir.mkdir(parents=True, exist_ok=True)

    tex_path = attempt_dir / "resume.tex"
    tex_path.write_text(attempt.tex, encoding="utf-8")

    log_path = attempt_dir / "compile.log"
    log_path.write_text(attempt.result.log_text, encoding="utf-8")

    pdf_path: Path | None = None
    pdf_sha: str | None = None
    if attempt.result.pdf_path and attempt.result.pdf_path.is_file():
        pdf_path = attempt_dir / "resume.pdf"
        if attempt.result.pdf_path.resolve() != pdf_path.resolve():
            pdf_path.write_bytes(attempt.result.pdf_path.read_bytes())
        pdf_sha = sha256_of(pdf_path)

    manifest_path = attempt_dir / "manifest.json"
    write_manifest(
        manifest_path,
        manifest_for(
            attempt,
            document=document,
            facts_used=facts_used,
            model=model,
            prompt_version=prompt_version,
            now=now,
            pdf_sha256=pdf_sha,
            fallback_reason=outcome.fallback_reason if outcome.used_base else "",
            plan_note=edits.note if edits else "",
            rejections=tuple(str(r) for r in edits.rejections) if edits else (),
            drift=dict(edits.drift) if edits else None,
        ),
    )

    chosen = outcome.chosen is not None and outcome.chosen.number == attempt.number
    row = ResumeVersion(
        application_id=application.id,
        job_id=application.job_id,
        kind="TAILORED",
        status="READY_FOR_REVIEW" if attempt.ok else "REJECTED",
        attempt=attempt.number,
        source_path=str(tex_path),
        # A failed attempt still has a row; pointing at the tex keeps the column
        # non-null without inventing a PDF that does not exist.
        pdf_path=str(pdf_path) if pdf_path else str(tex_path),
        log_path=str(log_path),
        manifest_path=str(manifest_path),
        # The provenance sidecar when there is one; the manifest otherwise. The
        # approve button reads this to refuse a resume that failed validation, so
        # it must point at the file that actually records that verdict.
        validation_path=str(validation_path or manifest_path),
        sha256=pdf_sha or "",
        tex_sha256=attempt.tex_sha256,
        page_count=attempt.result.pages,
        prompt_version=prompt_version,
        model_name=model,
        facts_used=list(facts_used),
        is_selected=chosen,
        fallback_reason=None,
    )
    session.add(row)
    return row


def _record_base(
    session: Session,
    *,
    application: Application,
    outcome: BuildOutcome,
    now: datetime,
    directory: Path,
    validation_path: Path | None = None,
) -> ResumeVersion:
    """The fallback row: the user's own resume, used unchanged."""
    pdf_path = outcome.pdf_path
    row = ResumeVersion(
        application_id=application.id,
        job_id=application.job_id,
        kind="BASE",
        status="READY_FOR_REVIEW",
        attempt=BASE_ATTEMPT,
        source_path=str(outcome.tex_path or ""),
        pdf_path=str(pdf_path or ""),
        manifest_path=None,
        validation_path=str(validation_path) if validation_path else None,
        sha256=sha256_of(pdf_path) if pdf_path and pdf_path.is_file() else "",
        page_count=1,
        facts_used=[],
        is_selected=True,
        fallback_reason=outcome.fallback_reason,
    )
    session.add(row)
    return row


def selected_version(session: Session, application_id: uuid.UUID) -> ResumeVersion | None:
    """The version the build chose to send. May not have been sent yet."""
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
    read off disk. If a rebuild happened between preparing and filling, that check
    is what stops the flag landing on a version the employer never saw.
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
