"""Database constraint tests (spec §12).

These assert that the *database* refuses bad data, not merely that the Python
layer avoids writing it. Application code has bugs; a unique index does not.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import (
    Application,
    Company,
    Job,
    ScheduledTask,
)
from app.domain.normalization import AtsType, canonicalize_url, url_hash
from app.domain.states import ApplicationState, JobState
from app.domain.tasks import TaskStatus, TaskType

pytestmark = pytest.mark.db

NOW = datetime.now(UTC)


def make_company(db: Session, name: str = "Acme") -> Company:
    company = Company(canonical_name=name, normalized_name=name.lower())
    db.add(company)
    db.flush()
    return company


def make_job(db: Session, company: Company, *, url: str, **kw: object) -> Job:
    defaults = dict(
        company_id=company.id,
        canonical_url=canonicalize_url(url),
        canonical_url_hash=url_hash(url),
        title="Software Engineer Intern",
        normalized_title="software engineer intern",
        dedupe_fingerprint=uuid.uuid4().hex,
        discovered_at=NOW,
        status=JobState.DISCOVERED,
    )
    job = Job(**{**defaults, **kw})
    db.add(job)
    db.flush()
    return job


def make_application(db: Session, job: Job, status: ApplicationState) -> Application:
    app = Application(
        job_id=job.id,
        application_url=job.canonical_url,
        status=status,
    )
    db.add(app)
    db.flush()
    return app


class TestCompany:
    def test_normalized_name_is_unique(self, db: Session):
        make_company(db, "Acme")
        db.add(Company(canonical_name="ACME Inc", normalized_name="acme"))
        with pytest.raises(IntegrityError):
            db.flush()


class TestJobDeduplication:
    def test_canonical_url_hash_is_unique(self, db: Session):
        """Priority 2 (§7.4): the same URL can only ever produce one job row."""
        company = make_company(db)
        make_job(db, company, url="https://boards.greenhouse.io/acme/jobs/1")
        with pytest.raises(IntegrityError):
            make_job(db, company, url="https://boards.greenhouse.io/acme/jobs/1?utm_source=x")

    def test_same_requisition_from_two_boards_is_rejected(self, db: Session):
        """Priority 1 (§7.4): requisition id wins even when the URLs differ."""
        company = make_company(db)
        make_job(
            db,
            company,
            url="https://boards.greenhouse.io/acme/jobs/1",
            ats_type=AtsType.GREENHOUSE,
            ats_board_id="acme",
            requisition_id="4567890",
        )
        with pytest.raises(IntegrityError):
            make_job(
                db,
                company,
                url="https://acme.com/careers?gh_jid=4567890",
                ats_type=AtsType.GREENHOUSE,
                ats_board_id="acme",
                requisition_id="4567890",
            )

    def test_jobs_without_a_requisition_id_do_not_collide(self, db: Session):
        """The requisition index is partial: NULLs must not block landing pages."""
        company = make_company(db)
        make_job(db, company, url="https://acme.com/careers/a", ats_type=AtsType.UNKNOWN)
        make_job(db, company, url="https://acme.com/careers/b", ats_type=AtsType.UNKNOWN)
        db.flush()  # must not raise

    def test_duplicate_fingerprints_are_allowed(self, db: Session):
        """A fingerprint collision is only *probable* duplication (§7.4).

        It must reach a human for review, so the index is non-unique — a unique
        one would raise on INSERT and lose the record entirely.
        """
        company = make_company(db)
        fingerprint = "shared-fingerprint"
        make_job(db, company, url="https://a.com/1", dedupe_fingerprint=fingerprint)
        make_job(
            db,
            company,
            url="https://b.com/1",
            dedupe_fingerprint=fingerprint,
            status=JobState.DUPLICATE_PROBABLE,
        )
        db.flush()  # must not raise

    def test_invalid_status_is_rejected_by_check_constraint(self, db: Session):
        company = make_company(db)
        with pytest.raises(IntegrityError):
            make_job(db, company, url="https://a.com/1", status="TOTALLY_MADE_UP")


class TestApplicationUniqueness:
    def test_two_active_applications_for_one_job_are_rejected(self, db: Session):
        """G5: never apply twice to the same requisition."""
        company = make_company(db)
        job = make_job(db, company, url="https://a.com/1")
        make_application(db, job, ApplicationState.NEEDS_ME)
        with pytest.raises(IntegrityError):
            make_application(db, job, ApplicationState.CREATED)

    def test_a_submitted_application_still_blocks_a_second_one(self, db: Session):
        """SUBMITTED is not a closed state — it is precisely what must not repeat."""
        company = make_company(db)
        job = make_job(db, company, url="https://a.com/1")
        make_application(db, job, ApplicationState.SUBMITTED)
        with pytest.raises(IntegrityError):
            make_application(db, job, ApplicationState.CREATED)

    @pytest.mark.parametrize(
        "closed",
        [ApplicationState.SKIPPED, ApplicationState.FAILED],
    )
    def test_can_reapply_after_an_abandoned_attempt(self, db: Session, closed):
        """Diverges from the spec's plain UNIQUE(job_id), which blocks this forever."""
        company = make_company(db)
        job = make_job(db, company, url="https://a.com/1")
        make_application(db, job, closed)
        make_application(db, job, ApplicationState.CREATED)
        db.flush()  # must not raise

    def test_two_abandoned_attempts_coexist(self, db: Session):
        company = make_company(db)
        job = make_job(db, company, url="https://a.com/1")
        make_application(db, job, ApplicationState.FAILED)
        make_application(db, job, ApplicationState.FAILED)
        db.flush()  # must not raise




class TestScheduledTask:
    def test_dedupe_key_is_unique(self, db: Session):
        """§16.5: enqueueing the same logical work twice collapses to one row."""
        for _ in range(2):
            db.add(
                ScheduledTask(
                    task_type=TaskType.SCORE_JOB,
                    dedupe_key="score:job-1:profile-1:v1",
                    payload={},
                    run_at=NOW,
                    status=TaskStatus.PENDING,
                )
            )
        with pytest.raises(IntegrityError):
            db.flush()

    def test_invalid_task_type_is_rejected(self, db: Session):
        db.add(
            ScheduledTask(
                task_type="LAUNCH_MISSILES",
                dedupe_key="x",
                payload={},
                run_at=NOW,
                status=TaskStatus.PENDING,
            )
        )
        with pytest.raises(IntegrityError):
            db.flush()


class TestTimestamps:
    def test_created_at_is_populated_and_timezone_aware(self, db: Session):
        company = make_company(db)
        db.refresh(company)
        assert company.created_at.tzinfo is not None
        # Against the clock now, not the module-level NOW captured at import: the
        # window is meant to catch a wrong default, not to measure how long the
        # rest of the suite took to reach this test.
        assert abs((company.created_at - datetime.now(UTC)).total_seconds()) < 60
