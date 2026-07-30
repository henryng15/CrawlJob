"""Storing a resume build (spec §7.7, §23.5).

Every attempt gets a row and a folder, including the ones that came out at two
pages. These tests are mostly about that: the record has to be complete enough to
answer "why is this the PDF that went to the employer", and exactly one row per
application may claim to be that PDF.
"""

from __future__ import annotations

import json
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
from app.services.latex import engine_available
from app.services.resume_artifacts import record_build, resume_dir, selected_version
from app.services.resume_build import build
from app.services.resume_tex import parse

pytestmark = [pytest.mark.db, pytest.mark.latex]

if engine_available() is None:  # pragma: no cover - depends on the machine
    pytest.skip("no LaTeX engine installed", allow_module_level=True)

NOW = datetime.now(UTC).replace(microsecond=0)
JD = "Backend Engineer Intern. Python, FastAPI, PostgreSQL, Docker, REST APIs."

MINIMAL = r"""
\documentclass[letterpaper,10pt]{article}
\usepackage[top=0.4in,bottom=0.4in,left=0.4in,right=0.4in]{geometry}
\usepackage{enumitem}
\newcommand{\resumeItem}[1]{\item\small{#1}}
\newcommand{\resumeItemListStart}{\begin{itemize}[topsep=5pt]}
\newcommand{\resumeItemListEnd}{\end{itemize}}
\begin{document}
\section{Work Experience}
  \resumeItemListStart
    \resumeItem{Built REST APIs in Python with FastAPI and PostgreSQL}
    \resumeItem{Wrote a compiler in Rust for fun}
  \resumeItemListEnd
\end{document}
"""


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        app_env="development",
        app_secret_key="artifact-tests",
        data_dir=tmp_path / "data",
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
        canonical_name="Acme Inc", normalized_name=f"acme-{uuid.uuid4().hex[:6]}", domain="a.com"
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
        description_text=JD,
    )
    db.add(job)
    db.flush()
    application = Application(
        job_id=job.id, application_url=url, status=ApplicationState.CREATED
    )
    db.add(application)
    db.commit()
    return application


def run(db: Session, settings: Settings, application: Application, *, overflow: bool = False):
    document = parse(MINIMAL)
    replacements = None
    if overflow:
        replacements = {
            b.index: "Engineered a distributed system in Python. " * 400
            for b in document.bullets
        }
    outcome = build(
        MINIMAL,
        job_text=JD,
        work_dir=resume_dir(settings, application.id),
        replacements=replacements,
        base_pdf=None,
    )
    selected = record_build(
        db,
        settings,
        application=application,
        document=document,
        outcome=outcome,
        facts_used=["f1", "f2"],
        model="claude-sonnet-5",
        prompt_version="resume/v1",
        now=NOW,
    )
    db.commit()
    return outcome, selected


class TestASuccessfulBuild:
    def test_one_row_is_written_for_the_attempt(
        self, db: Session, settings: Settings
    ):
        application = make_application(db)
        outcome, selected = run(db, settings, application)

        rows = db.scalars(
            select(ResumeVersion).where(ResumeVersion.application_id == application.id)
        ).all()
        assert len(rows) == len(outcome.attempts)
        assert selected is not None

    def test_the_selected_row_is_the_one_that_qualified(
        self, db: Session, settings: Settings
    ):
        application = make_application(db)
        _, selected = run(db, settings, application)
        assert selected.page_count == 1
        assert selected.is_selected

    def test_the_application_points_at_it(self, db: Session, settings: Settings):
        application = make_application(db)
        _, selected = run(db, settings, application)
        db.refresh(application)
        assert application.resume_version_id == selected.id

    def test_the_artifacts_are_on_disk(self, db: Session, settings: Settings):
        application = make_application(db)
        _, selected = run(db, settings, application)

        assert Path(selected.pdf_path).is_file()
        assert Path(selected.source_path).is_file()
        assert Path(selected.log_path).is_file()
        assert Path(selected.manifest_path).is_file()

    def test_the_hashes_match_the_bytes_on_disk(self, db: Session, settings: Settings):
        """``sha256`` proves the PDF in the folder is the one that was measured."""
        import hashlib

        application = make_application(db)
        _, selected = run(db, settings, application)

        actual = hashlib.sha256(Path(selected.pdf_path).read_bytes()).hexdigest()
        assert selected.sha256 == actual

        tex = hashlib.sha256(Path(selected.source_path).read_bytes()).hexdigest()
        assert selected.tex_sha256 == tex

    def test_the_manifest_records_what_it_should(self, db: Session, settings: Settings):
        application = make_application(db)
        _, selected = run(db, settings, application)

        manifest = json.loads(Path(selected.manifest_path).read_text())
        assert manifest["attempt"] == 1
        assert manifest["pages"] == 1
        assert manifest["one_page"] is True
        assert manifest["facts_used"] == ["f1", "f2"]
        assert manifest["model"] == "claude-sonnet-5"
        assert manifest["prompt_version"] == "resume/v1"
        assert manifest["engine"]
        assert manifest["tex_sha256"] and manifest["pdf_sha256"]

    def test_the_manifest_carries_no_prompt_or_resume_text(
        self, db: Session, settings: Settings
    ):
        """It sits in the artifact folder; a prompt carries an employment
        history (§23.5)."""
        application = make_application(db)
        _, selected = run(db, settings, application)

        manifest = json.loads(Path(selected.manifest_path).read_text())
        assert "prompt" not in manifest
        assert "messages" not in manifest
        assert "system" not in manifest


class TestAFallbackBuild:
    def test_every_attempt_is_recorded_not_just_the_last(
        self, db: Session, settings: Settings
    ):
        application = make_application(db)
        outcome, _ = run(db, settings, application, overflow=True)

        rows = db.scalars(
            select(ResumeVersion).where(ResumeVersion.application_id == application.id)
        ).all()
        # Three attempts plus the base row that was actually used.
        assert len(rows) == len(outcome.attempts) + 1
        assert sorted(r.attempt for r in rows) == [0, 1, 2, 3]

    def test_the_failed_attempts_are_marked_rejected(
        self, db: Session, settings: Settings
    ):
        application = make_application(db)
        run(db, settings, application, overflow=True)

        tailored = db.scalars(
            select(ResumeVersion)
            .where(ResumeVersion.application_id == application.id)
            .where(ResumeVersion.kind == "TAILORED")
        ).all()
        assert all(r.status == "REJECTED" for r in tailored)
        assert all(r.page_count != 1 for r in tailored)

    def test_the_selected_row_is_the_base_resume_with_a_reason(
        self, db: Session, settings: Settings
    ):
        application = make_application(db)
        run(db, settings, application, overflow=True)

        selected = selected_version(db, application.id)
        assert selected is not None
        assert selected.kind == "BASE"
        assert selected.attempt == 0
        assert "did not produce a one-page PDF" in selected.fallback_reason

    def test_the_failed_attempts_keep_their_logs(self, db: Session, settings: Settings):
        """The log is the only thing that says why a build did not qualify."""
        application = make_application(db)
        run(db, settings, application, overflow=True)

        tailored = db.scalars(
            select(ResumeVersion)
            .where(ResumeVersion.application_id == application.id)
            .where(ResumeVersion.kind == "TAILORED")
        ).all()
        for row in tailored:
            assert Path(row.log_path).is_file()
            assert Path(row.log_path).read_text(errors="replace").strip()


class TestExactlyOneSelectedVersion:
    def test_only_one_row_claims_to_be_the_selected_one(
        self, db: Session, settings: Settings
    ):
        application = make_application(db)
        run(db, settings, application, overflow=True)

        rows = db.scalars(
            select(ResumeVersion).where(ResumeVersion.application_id == application.id)
        ).all()
        assert len([r for r in rows if r.is_selected]) == 1

    def test_rebuilding_does_not_leave_two(self, db: Session, settings: Settings):
        """A second build must not leave the first one still claiming it."""
        application = make_application(db)
        run(db, settings, application)
        run(db, settings, application)

        rows = db.scalars(
            select(ResumeVersion).where(ResumeVersion.application_id == application.id)
        ).all()
        assert len([r for r in rows if r.is_selected]) == 1

    def test_rebuilding_keeps_the_earlier_rows(self, db: Session, settings: Settings):
        """Artifacts are immutable: a rebuild adds, it does not replace."""
        application = make_application(db)
        run(db, settings, application)
        first = len(
            db.scalars(
                select(ResumeVersion).where(ResumeVersion.application_id == application.id)
            ).all()
        )
        run(db, settings, application)
        second = len(
            db.scalars(
                select(ResumeVersion).where(ResumeVersion.application_id == application.id)
            ).all()
        )
        assert second > first


class TestTheTemplateSurvives:
    def test_the_stored_tex_still_has_the_original_preamble(
        self, db: Session, settings: Settings
    ):
        application = make_application(db)
        _, selected = run(db, settings, application)

        stored = Path(selected.source_path).read_text(encoding="utf-8")
        marker = r"\begin{document}"
        assert stored.split(marker)[0] == MINIMAL.split(marker)[0]

    def test_the_stored_tex_recompiles_to_the_same_page_count(
        self, db: Session, settings: Settings, tmp_path: Path
    ):
        from app.services.latex import compile_pdf

        application = make_application(db)
        _, selected = run(db, settings, application)

        stored = Path(selected.source_path).read_text(encoding="utf-8")
        assert compile_pdf(stored, work_dir=tmp_path / "recheck").pages == selected.page_count
