"""Registering the base resume (spec §7.7).

One PDF, kept by the user, uploaded to every application. Importing it does two
things: copies the file somewhere the pipeline can read regardless of what
happens to the original, and writes the ``ResumeVersion`` row that the pipeline
gate checks for.

That row is why a copy exists at all. ``BASE_RESUME_STATUS=READY`` is a
declaration, and a declaration can be made by somebody who did not look — so the
gate asks the database whether a base resume was ever actually imported, and the
database cannot be optimistic.
"""

from __future__ import annotations

import hashlib
import logging
import shutil
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import ResumeVersion

__all__ = ["SUPPORTED", "ImportResult", "base_version", "import_resume"]

log = logging.getLogger(__name__)

#: What a form will accept as an attachment. ``.tex`` is deliberately absent:
#: employers want the rendered document, not its source.
SUPPORTED = (".pdf", ".docx")


@dataclass(frozen=True, slots=True)
class ImportResult:
    resume: ResumeVersion
    stored_at: Path
    pages: int | None

    def summary(self) -> str:
        pages = f"{self.pages} page(s)" if self.pages else "page count unknown"
        return f"base resume stored ({pages}) at {self.stored_at}"


def base_version(session: Session) -> ResumeVersion | None:
    """The imported base resume, if there is one.

    Specifically one belonging to no application: a row with an
    ``application_id`` records "this application used the base resume", which is
    the pipeline's own output and must not be mistaken for the input.
    """
    return session.scalars(
        select(ResumeVersion)
        .where(ResumeVersion.kind == "BASE")
        .where(ResumeVersion.application_id.is_(None))
        .limit(1)
    ).first()


def import_resume(session: Session, settings: Settings, *, path: Path) -> ImportResult:
    """Store the base resume and record it.

    The file is copied rather than referenced so that the pipeline keeps working
    if the original is moved or edited mid-run, and hashed after the copy so the
    recorded digest describes the bytes actually kept.
    """
    from app.services.resume_artifacts import page_count

    suffix = path.suffix.lower()
    if suffix not in SUPPORTED:
        raise ValueError(f"{path.name}: expected one of {', '.join(SUPPORTED)}")

    artifacts = settings.artifacts_dir / "resume"
    artifacts.mkdir(parents=True, exist_ok=True)
    stored_path = artifacts / f"base{suffix}"
    shutil.copy2(path, stored_path)

    pages = page_count(stored_path) if suffix == ".pdf" else None
    resume = ResumeVersion(
        kind="BASE",
        status="APPROVED",  # the user's own document; nothing was generated
        source_path=str(path),
        pdf_path=str(stored_path),
        sha256=hashlib.sha256(stored_path.read_bytes()).hexdigest(),
        page_count=pages,
        facts_used=[],
    )
    session.add(resume)
    session.flush()
    return ImportResult(resume=resume, stored_at=stored_path, pages=pages)
