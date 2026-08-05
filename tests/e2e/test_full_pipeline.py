"""One job, start to finish.

Walks a single posting through every stage the system owns, exercising the web
screens and the worker against the same database — the path the user actually
takes, rather than each stage in isolation.

Two runs, because the product is two lanes. An ordinary employer is scored,
selected, prepared and handed to a browser with nobody pressing anything. An
employer on the manual-only list stops before the browser and waits, and the
dashboard says why.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.db.models import (
    Application,
    Company,
    Job,
    JobScore,
    ResumeVersion,
)
from app.domain.normalization import canonicalize_url, url_hash
from app.domain.states import ApplicationState, JobState
from app.domain.tasks import TaskType, idempotency_key
from app.services.candidate import Actor, set_fact
from app.services.queue import enqueue
from app.web.app import create_app
from app.web.deps import get_config, get_db
from app.web.security import COOKIE_NAME, hash_password, read
from app.worker.handlers import register_pipeline
from app.worker.runtime import Registry, Worker
from tests.helpers import not_none

pytestmark = pytest.mark.db

PASSWORD = "an-end-to-end-password"
NOW = datetime.now(UTC).replace(microsecond=0)

JD = """
Software Engineer Intern, Summer 2027.

You will work on our Python and FastAPI backend services alongside the platform
team. We are looking for students graduating in 2028.
"""

SILENT_SPONSORSHIP = {
    "classification": "SPONSORSHIP_NOT_MENTIONED",
    "work_authorization_restriction": "UNKNOWN",
    "evidence": [],
    "confidence": 0.4,
    "reasoning_summary": "The posting does not mention sponsorship.",
}

JUDGMENT = {
    "core_swe_relevance": 17.0,
    "skills_overlap": 12.0,
    "experience_relevance": 11.0,
    "fact_references": ["exp.todd.1"],
    "reasons": ["Python and FastAPI match the stored experience."],
}

HOOK = {
    "hook_type": "NONE",
    "hook": "",
    "source_url": "",
    "source_excerpt": "",
    "confidence": 0.0,
    "unsupported_claims": ["nothing verifiable in the posting"],
}


@pytest.fixture(scope="module")
def password_hash() -> str:
    return hash_password(PASSWORD)


@pytest.fixture
def settings(password_hash: str, tmp_path: Path, sample_resume: Path) -> Settings:
    pdf = sample_resume
    return Settings(
        app_env="development",
        app_secret_key="end-to-end",
        admin_username="hoan",
        admin_password_hash=password_hash,
        data_dir=tmp_path / "data",
        # Preparing an application attaches this file. The sample rather than
        # the user's own resume: this test asserts the pipeline moves, not
        # anything about the document.
        base_resume_pdf=pdf,
    )


@pytest.fixture
def db(committing_db: sessionmaker[Session]) -> Iterator[Session]:
    session = committing_db()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def worker(committing_db: sessionmaker[Session], settings: Settings) -> Worker:
    return Worker(
        session_factory=committing_db,
        worker_id="e2e",
        registry=register_pipeline(Registry(), settings=settings),
        poll_interval=0.0,
    )


@pytest.fixture
def client(db: Session, settings: Settings) -> Iterator[TestClient]:
    def request_session() -> Iterator[Session]:
        yield db
        db.commit()

    app: FastAPI = create_app()
    app.dependency_overrides[get_db] = request_session
    app.dependency_overrides[get_config] = lambda: settings
    app.state.settings = settings

    with TestClient(app, follow_redirects=False) as signed_in:
        assert (
            signed_in.post("/login", data={"username": "hoan", "password": PASSWORD}).status_code
            == 303
        )
        yield signed_in
    app.dependency_overrides.clear()


def csrf(client: TestClient, settings: Settings) -> str:
    return not_none(read(client.cookies.get(COOKIE_NAME), settings)).csrf_token


def drain(worker: Worker, *, now: datetime, limit: int = 15) -> int:
    ran = 0
    while ran < limit and worker.run_once(now=now):
        ran += 1
    return ran


def seed_profile(db: Session) -> None:
    """What the user supplies once: their name and their dates."""
    set_fact(db, "candidate.preferred_name", "Hoan", actor=Actor.USER)
    set_fact(db, "education.graduation_date", "2028-05-15", actor=Actor.USER)
    set_fact(db, "work_authorization.requires_future_sponsorship", True, actor=Actor.USER)
    db.commit()


def seed_job(db: Session) -> Job:
    company = Company(canonical_name="Acme Inc", normalized_name="acme", domain="acme.com")
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
        posted_at=NOW - timedelta(days=2),
        season="SUMMER_2027",
        status=JobState.DISCOVERED,
        description_text=JD,
        normalized_location="remote",
    )
    db.add(job)
    db.commit()
    return job


def test_one_job_from_scoring_to_a_browser(
    db: Session,
    client: TestClient,
    worker: Worker,
    settings: Settings,
) -> None:
    """The auto lane. Nobody presses anything until the form itself needs them."""
    seed_profile(db)
    job = seed_job(db)

    # --- 1. The machine scores the posting ---------------------------------
    enqueue(
        db,
        task_type=TaskType.SCORE_JOB,
        dedupe_key=idempotency_key(TaskType.SCORE_JOB, str(job.id)),
        payload={"job_id": str(job.id)},
        run_at=NOW,
    )
    db.commit()
    drain(worker, now=NOW + timedelta(minutes=1))

    db.expire_all()
    score = not_none(db.scalars(select(JobScore).where(JobScore.job_id == job.id)).first())
    assert float(score.total_score) > 0

    # --- 2. and starts an application itself -------------------------------
    db.refresh(job)
    assert job.status == JobState.SELECTED, "a good score selects the job outright"
    application = not_none(db.scalars(select(Application)).first())

    # --- 3. Materials, then the browser queue ------------------------------
    db.refresh(application)
    resume = not_none(
        db.scalars(
            select(ResumeVersion).where(ResumeVersion.application_id == application.id)
        ).first()
    )
    assert Path(resume.pdf_path).is_file()
    assert application.status == ApplicationState.BROWSER_QUEUED

    # The browser worker runs in its own process with its own Chromium, so this
    # stands in for it. What is being tested here is the handoffs either side.
    application.status = ApplicationState.BROWSER_FILLING
    application.status = ApplicationState.NEEDS_ME
    application.needs_me_at = NOW
    application.needs_me_reason = "2 required questions had no locked fact behind them"
    application.missing_fields = ["Expected salary", "Type your full name to sign"]
    application.resume_version_id = resume.id
    db.commit()

    # --- 4. The dashboard tells the user what is left ----------------------
    dashboard = client.get("/")
    assert "waiting on you" in dashboard.text
    assert "Expected salary" in dashboard.text
    assert job.canonical_url in dashboard.text, "the link to finish it by hand"

    # --- 5. They finish it and say so --------------------------------------
    assert (
        client.post(
            f"/applications/{application.id}/submitted",
            data={"csrf_token": csrf(client, settings)},
        ).status_code
        == 303
    )
    db.expire_all()
    db.refresh(application)
    assert application.status == ApplicationState.SUBMITTED
    assert application.submission_detection_method == "USER_CONFIRMED"


def test_a_manual_only_employer_never_reaches_a_browser(
    db: Session,
    client: TestClient,
    worker: Worker,
) -> None:
    """The other lane. These are the employers the user reserved for themselves."""
    from app.db.models import ManualOnlyCompany

    seed_profile(db)
    job = seed_job(db)
    db.add(ManualOnlyCompany(domain="acme.com", company_name="Acme Inc", source="seed_manual.csv"))
    db.commit()

    enqueue(
        db,
        task_type=TaskType.SCORE_JOB,
        dedupe_key=idempotency_key(TaskType.SCORE_JOB, str(job.id)),
        payload={"job_id": str(job.id)},
        run_at=NOW,
    )
    db.commit()
    drain(worker, now=NOW + timedelta(minutes=1))

    db.expire_all()
    application = not_none(db.scalars(select(Application)).first())
    assert application.status == ApplicationState.NEEDS_ME
    assert "manual-only list" in (application.needs_me_reason or "")
    assert not_none(
        db.scalars(
            select(ResumeVersion).where(ResumeVersion.application_id == application.id)
        ).first()
    ), "it still gets its resume"
    assert job.canonical_url in client.get("/").text
