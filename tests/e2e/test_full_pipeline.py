"""One job, start to finish (spec §6, §32).

Walks a single posting through every stage the system owns, exercising the web
screens and the worker against the same database — the path the user actually
takes, rather than each stage in isolation.

The two moments that matter are the ones where nothing happens automatically:
the application waits at ``READY_FOR_REVIEW`` until a person submits, and the
email waits as a Gmail draft until a person sends it.
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
    OutreachTask,
    Recruiter,
    ResumeVersion,
    SponsorshipAssessment,
)
from app.domain.normalization import canonicalize_url, url_hash
from app.domain.states import ApplicationState, JobState, OutreachState
from app.domain.tasks import TaskType, idempotency_key
from app.services.candidate import Actor, set_fact
from app.services.llm.base import NullProvider
from app.services.outreach_policy import next_send_window
from app.services.queue import enqueue
from app.services.resume_import import ExtractedFacts, store_facts
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

TAILORED = {
    "summary": "",
    "summary_fact_ids": [],
    "bullets": [
        {
            "text": "Built a FastAPI service at Todd Labs.",
            "fact_ids": ["exp.todd.1"],
            "transformation": "shorten",
        }
    ],
    "section_order": ["experience"],
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
def settings(password_hash: str, tmp_path: Path) -> Settings:
    return Settings(
        app_env="development",
        app_secret_key="end-to-end",
        admin_username="hoan",
        admin_password_hash=password_hash,
        data_dir=tmp_path / "data",
    )


@pytest.fixture
def provider() -> NullProvider:
    """Every model call this run will make, in the order it will make them."""
    return NullProvider([SILENT_SPONSORSHIP, JUDGMENT, TAILORED, HOOK])


@pytest.fixture
def db(committing_db: sessionmaker[Session]) -> Iterator[Session]:
    session = committing_db()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def worker(
    committing_db: sessionmaker[Session], settings: Settings, provider: NullProvider
) -> Worker:
    return Worker(
        session_factory=committing_db,
        worker_id="e2e",
        registry=register_pipeline(
            Registry(), settings=settings, provider_factory=lambda _: provider
        ),
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
    """What the user supplies once: their name, their dates, their resume facts."""
    set_fact(db, "candidate.preferred_name", "Hoan", actor=Actor.USER)
    set_fact(db, "education.graduation_date", "2028-05-15", actor=Actor.USER)
    set_fact(db, "work_authorization.requires_future_sponsorship", True, actor=Actor.USER)
    store_facts(
        db,
        ExtractedFacts.model_validate(
            {
                "facts": [
                    {
                        "id": "exp.todd.1",
                        "text": "Built a FastAPI service at Todd Labs that cut report "
                        "generation from 40 minutes to 6.",
                        "organisation": "Todd Labs",
                        "technologies": ["FastAPI", "Python"],
                    }
                ]
            }
        ),
        actor=Actor.USER,
    )
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
    db.add(
        Recruiter(
            full_name="Alice Nguyen",
            raw_company="Acme Inc",
            email="alice@acme.com",
            email_domain="acme.com",
            company_id=company.id,
            title="University Recruiter",
        )
    )
    db.commit()
    return job


def test_one_job_from_discovery_to_a_gmail_draft(
    db: Session,
    client: TestClient,
    worker: Worker,
    settings: Settings,
    provider: NullProvider,
) -> None:
    seed_profile(db)
    job = seed_job(db)

    # --- 1. The machine assesses the posting -------------------------------
    enqueue(
        db,
        task_type=TaskType.ANALYZE_SPONSORSHIP,
        dedupe_key=idempotency_key(TaskType.ANALYZE_SPONSORSHIP, str(job.id)),
        payload={"job_id": str(job.id)},
        run_at=NOW,
    )
    db.commit()
    drain(worker, now=NOW + timedelta(minutes=1))

    db.expire_all()
    assert not_none(
        db.scalars(select(SponsorshipAssessment).where(SponsorshipAssessment.job_id == job.id))
        .first()
    ).classification == "SPONSORSHIP_NOT_MENTIONED"
    score = not_none(db.scalars(select(JobScore).where(JobScore.job_id == job.id)).first())
    assert float(score.total_score) > 0
    db.refresh(job)
    assert job.status == JobState.SCORED

    # No application yet. A good score is an invitation, not a decision (§0.2).
    assert db.scalars(select(Application)).all() == []

    # --- 2. The user selects it --------------------------------------------
    page = client.get(f"/jobs/{job.id}")
    assert page.status_code == 200
    assert "Software Engineer Intern" in page.text

    selected = client.post(
        f"/jobs/{job.id}/select", data={"csrf_token": csrf(client, settings)}
    )
    assert selected.status_code == 303
    db.expire_all()
    application = not_none(db.scalars(select(Application)).first())
    assert application.status == ApplicationState.CREATED

    # --- 3. The machine prepares materials ---------------------------------
    drain(worker, now=NOW + timedelta(minutes=2))
    db.refresh(application)

    resume = not_none(
        db.scalars(select(ResumeVersion).where(ResumeVersion.kind == "TAILORED")).first()
    )
    assert Path(resume.pdf_path).is_file()
    assert application.status == ApplicationState.BROWSER_QUEUED

    # A browser slot would fill the form here. Standing in for it, because the
    # point of this test is the handoffs either side of that step.
    application.status = ApplicationState.BROWSER_FILLING
    application.status = ApplicationState.READY_FOR_REVIEW
    application.ready_for_review_at = NOW
    application.resume_version_id = resume.id
    db.commit()

    # --- 4. It stops. The user reviews and submits --------------------------
    review = client.get(f"/applications/{application.id}")
    assert review.status_code == 200
    assert "never presses Submit" in review.text

    dashboard = client.get("/")
    assert "waiting on you" in dashboard.text

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

    # --- 5. Outreach, two business days later -------------------------------
    outreach_time = next_send_window(NOW + timedelta(days=9))
    drain(worker, now=outreach_time)

    db.expire_all()
    outreach = not_none(db.scalars(select(OutreachTask)).first())
    assert outreach.status == OutreachState.READY_FOR_REVIEW
    assert outreach.gmail_draft_id, "a draft should exist"
    assert not_none(outreach.recruiter_id)

    body = not_none(outreach.body)
    assert "Alice" in body
    assert "Software Engineer Intern" in body
    assert "Hoan" in body
    assert "{{" not in body

    # --- 6. It stops again. Sending is the user's ---------------------------
    page = client.get(f"/outreach/{outreach.id}")
    assert page.status_code == 200
    assert "Open draft in Gmail" in page.text
    assert outreach.sent_at is None, "nothing in this system sends"

    # Every model call was one this test queued; none was invented.
    assert len(provider.calls) == 4
