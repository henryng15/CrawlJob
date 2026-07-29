"""The pipeline, stage by stage (spec §16.2).

Each stage is driven through the real ``Worker``, not called directly, so the
tests also cover the thing that makes the pipeline safe: work and fan-out commit
together, and a stage that fails enqueues nothing.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
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
    ScheduledTask,
    SponsorshipAssessment,
    SuppressionEntry,
)
from app.domain.normalization import canonicalize_url, url_hash
from app.domain.states import ApplicationState, JobState, OutreachState
from app.domain.tasks import TaskStatus, TaskType, idempotency_key
from app.services.candidate import Actor, set_fact
from app.services.llm.base import NullProvider
from app.services.outreach_policy import next_send_window
from app.services.queue import enqueue
from app.worker.handlers import register_pipeline
from app.worker.runtime import Registry, Worker
from tests.helpers import not_none

pytestmark = pytest.mark.db

#: Anchored to the wall clock. Follow-up tasks are enqueued with the real
#: ``utcnow()``, so a fixed date in the past would leave every second stage
#: unclaimable and the pipeline tests would silently only ever test one step.
NOW = datetime.now(UTC).replace(microsecond=0)

NO_SPONSORSHIP_JD = """
We are hiring a Software Engineer Intern for Summer 2027.
You will write Python. We are unable to sponsor or take over sponsorship of an
employment visa at this time.
"""

CITIZENS_ONLY_JD = """
Software Engineer Intern, Summer 2027. Python and FastAPI work.
Applicants must be a U.S. citizen to be eligible for this position.
"""

#: What the model would return for a posting that says nothing about sponsorship.
#: Queued explicitly so a test can never pass on a response nobody wrote.
SILENT = {
    "classification": "SPONSORSHIP_NOT_MENTIONED",
    "work_authorization_restriction": "UNKNOWN",
    "evidence": [],
    "confidence": 0.4,
    "reasoning_summary": "The posting does not mention sponsorship.",
}

JUDGMENT = {
    "core_swe_relevance": 16.0,
    "skills_overlap": 11.0,
    "experience_relevance": 10.0,
    "fact_references": ["skill.python"],
    "reasons": ["Python and FastAPI match the stored skills."],
}

ORDINARY_JD = """
Software Engineer Intern, Summer 2027. You will write Python and work on our
FastAPI services alongside the platform team.
"""


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        app_env="development",
        app_secret_key="handler-tests",
        data_dir=tmp_path / "data",
    )


@pytest.fixture
def provider() -> NullProvider:
    """One provider for the whole run, so queued responses are consumed in order."""
    return NullProvider()


@pytest.fixture
def registry(settings: Settings, provider: NullProvider) -> Registry:
    return register_pipeline(
        Registry(), settings=settings, provider_factory=lambda _: provider
    )


@pytest.fixture
def worker(committing_db: sessionmaker[Session], registry: Registry) -> Worker:
    return Worker(
        session_factory=committing_db,
        worker_id="pipeline-test",
        registry=registry,
        poll_interval=0.0,
    )


@pytest.fixture
def db(committing_db: sessionmaker[Session]) -> Iterator[Session]:
    """A session on the same database the worker commits to.

    The rollback-wrapped ``db`` fixture cannot be used here: the worker runs in
    its own session and would not see anything this one had not committed.
    """
    session = committing_db()
    try:
        yield session
    finally:
        session.close()


# ------------------------------------------------------------------ setup


def make_job(session: Session, *, description: str = ORDINARY_JD, **kw: object) -> Job:
    company = session.scalars(
        select(Company).where(Company.normalized_name == "acme")
    ).first() or Company(canonical_name="Acme Inc", normalized_name="acme", domain="acme.com")
    session.add(company)
    session.flush()

    url = f"https://boards.greenhouse.io/acme/jobs/{uuid.uuid4().hex[:8]}"
    defaults: dict[str, object] = {
        "company_id": company.id,
        "canonical_url": canonicalize_url(url),
        "canonical_url_hash": url_hash(url),
        "title": "Software Engineer Intern",
        "normalized_title": "software engineer intern",
        "dedupe_fingerprint": uuid.uuid4().hex,
        "discovered_at": NOW,
        "posted_at": NOW - timedelta(days=3),
        "season": "SUMMER_2027",
        "status": JobState.DISCOVERED,
        "description_text": description,
        "normalized_location": "remote",
    }
    job = Job(**{**defaults, **kw})
    session.add(job)
    session.commit()
    return job


def queue(session: Session, task_type: TaskType, **payload: str) -> None:
    enqueue(
        session,
        task_type=task_type,
        dedupe_key=idempotency_key(task_type, *payload.values()),
        payload=payload,
        run_at=NOW,
    )
    session.commit()


def drain(worker: Worker, *, now: datetime | None = None, limit: int = 12) -> int:
    """Run until the queue is empty. Returns how many tasks ran.

    ``now`` moves slightly ahead of the enqueue time so a task queued by the
    stage before it is claimable in the same drain.
    """
    moment = now or (NOW + timedelta(minutes=1))
    ran = 0
    while ran < limit and worker.run_once(now=moment):
        ran += 1
    return ran


def tasks(session: Session, task_type: TaskType) -> list[ScheduledTask]:
    session.expire_all()
    return list(
        session.scalars(select(ScheduledTask).where(ScheduledTask.task_type == task_type)).all()
    )


# ------------------------------------------------------------------ tests


class TestRegistration:
    def test_every_non_browser_task_type_has_a_handler(self, registry: Registry):
        """A task type with no handler is buried on arrival, so a gap here is not
        a missing feature — it is a queue that silently discards work."""
        # ENRICH_JOB and DEDUPE_JOB happen inside discovery rather than as
        # separate stages; REPLAY_APPLICATION needs a browser and is registered
        # by the slot.
        assert registry.missing() == {
            TaskType.REPLAY_APPLICATION,
            TaskType.ENRICH_JOB,
            TaskType.DEDUPE_JOB,
        }

    def test_registering_twice_is_refused(self, settings: Settings, provider: NullProvider):
        target = Registry()
        register_pipeline(target, settings=settings, provider_factory=lambda _: provider)
        with pytest.raises(ValueError, match="already has a handler"):
            register_pipeline(target, settings=settings, provider_factory=lambda _: provider)


class TestSponsorship:
    def test_a_citizens_only_posting_is_rejected_without_a_model_call(
        self, worker: Worker, db: Session, provider: NullProvider
    ):
        """The keyword pre-pass settles this, so the budget is never touched.

        A citizenship requirement the candidate does not meet is the one
        sponsorship case with a decisive answer; everything softer goes to the
        user (see the next test).
        """
        job = make_job(db, description=CITIZENS_ONLY_JD)
        queue(db, TaskType.ANALYZE_SPONSORSHIP, job_id=str(job.id))

        drain(worker)
        db.refresh(job)

        assert job.status == JobState.ELIGIBILITY_REJECTED
        assert provider.calls == []

    def test_no_sponsorship_wording_goes_to_the_user_rather_than_the_bin(
        self, worker: Worker, db: Session
    ):
        """"We cannot sponsor" is the employer's policy, not a legal conclusion
        about this candidate. §7.5 routes it to a human."""
        job = make_job(db, description=NO_SPONSORSHIP_JD)
        queue(db, TaskType.ANALYZE_SPONSORSHIP, job_id=str(job.id))
        worker.run_once(now=NOW)

        assessment = not_none(
            db.scalars(
                select(SponsorshipAssessment).where(SponsorshipAssessment.job_id == job.id)
            ).first()
        )
        assert assessment.recommended_action == "MANUAL_REVIEW"
        db.refresh(job)
        assert job.status != JobState.ELIGIBILITY_REJECTED

    def test_the_quote_is_stored_as_evidence(self, worker: Worker, db: Session):
        job = make_job(db, description=NO_SPONSORSHIP_JD)
        queue(db, TaskType.ANALYZE_SPONSORSHIP, job_id=str(job.id))
        drain(worker)

        assessment = not_none(
            db.scalars(select(SponsorshipAssessment).where(SponsorshipAssessment.job_id == job.id))
            .first()
        )
        assert assessment.evidence
        assert "unable to sponsor" in assessment.evidence[0]["quote"].lower()

    def test_a_rejected_job_is_never_scored(self, worker: Worker, db: Session):
        job = make_job(db, description=CITIZENS_ONLY_JD)
        queue(db, TaskType.ANALYZE_SPONSORSHIP, job_id=str(job.id))
        drain(worker)

        assert tasks(db, TaskType.SCORE_JOB) == []

    def test_an_ordinary_posting_fans_out_to_scoring(
        self, worker: Worker, db: Session, provider: NullProvider
    ):
        provider.queue(SILENT)
        job = make_job(db)
        queue(db, TaskType.ANALYZE_SPONSORSHIP, job_id=str(job.id))
        worker.run_once(now=NOW)

        assert [t.dedupe_key for t in tasks(db, TaskType.SCORE_JOB)] == [
            idempotency_key(TaskType.SCORE_JOB, str(job.id))
        ]

    def test_re_running_does_not_duplicate_the_assessment(
        self, worker: Worker, db: Session, provider: NullProvider
    ):
        provider.queue(SILENT)
        provider.queue(JUDGMENT)
        job = make_job(db)
        queue(db, TaskType.ANALYZE_SPONSORSHIP, job_id=str(job.id))
        drain(worker)

        enqueue(
            db,
            task_type=TaskType.ANALYZE_SPONSORSHIP,
            dedupe_key="second-look",
            payload={"job_id": str(job.id)},
            run_at=NOW,
        )
        db.commit()
        drain(worker)

        count = len(
            db.scalars(
                select(SponsorshipAssessment).where(SponsorshipAssessment.job_id == job.id)
            ).all()
        )
        assert count == 1

    def test_a_job_that_vanished_is_buried_not_retried(self, worker: Worker, db: Session):
        queue(db, TaskType.ANALYZE_SPONSORSHIP, job_id=str(uuid.uuid4()))
        worker.run_once(now=NOW)

        task = tasks(db, TaskType.ANALYZE_SPONSORSHIP)[0]
        assert task.status == TaskStatus.DEAD

    def test_a_malformed_payload_is_buried(self, worker: Worker, db: Session):
        queue(db, TaskType.ANALYZE_SPONSORSHIP, job_id="not-a-uuid")
        worker.run_once(now=NOW)
        assert tasks(db, TaskType.ANALYZE_SPONSORSHIP)[0].status == TaskStatus.DEAD


class TestScoring:
    def test_a_scored_job_gets_a_row_and_a_status(
        self, worker: Worker, db: Session, provider: NullProvider
    ):
        provider.queue(JUDGMENT)
        job = make_job(db)
        set_fact(db, "education.graduation_date", "2028-05-15", actor=Actor.USER)
        db.commit()

        queue(db, TaskType.SCORE_JOB, job_id=str(job.id))
        drain(worker)
        db.refresh(job)

        stored = not_none(db.scalars(select(JobScore).where(JobScore.job_id == job.id)).first())
        assert job.status == JobState.SCORED
        assert 0 < float(stored.total_score) <= 100

    def test_an_ineligible_job_scores_zero_and_skips_the_model(
        self, worker: Worker, db: Session, provider: NullProvider
    ):
        """§7.6: a high AI score may never override a hard ineligibility, and the
        cheapest way to guarantee that is not to ask."""
        job = make_job(db, title="Senior Staff Engineer", normalized_title="senior staff engineer")
        queue(db, TaskType.SCORE_JOB, job_id=str(job.id))
        drain(worker)
        db.refresh(job)

        stored = not_none(db.scalars(select(JobScore).where(JobScore.job_id == job.id)).first())
        assert float(stored.total_score) == 0
        assert job.status == JobState.ELIGIBILITY_REJECTED
        assert provider.calls == []

    def test_the_breakdown_is_stored_for_the_review_screen(
        self, worker: Worker, db: Session, provider: NullProvider
    ):
        provider.queue(JUDGMENT)
        job = make_job(db)
        queue(db, TaskType.SCORE_JOB, job_id=str(job.id))
        drain(worker)

        stored = not_none(db.scalars(select(JobScore).where(JobScore.job_id == job.id)).first())
        assert "internship_level_fit" in stored.components

    def test_scoring_does_not_start_an_application(
        self, worker: Worker, db: Session, provider: NullProvider
    ):
        """Selection is the user's (§0.2). A good score is an invitation, not a
        decision."""
        provider.queue(JUDGMENT)
        job = make_job(db)
        queue(db, TaskType.SCORE_JOB, job_id=str(job.id))
        drain(worker)

        assert db.scalars(select(Application)).all() == []
        assert tasks(db, TaskType.PREPARE_APPLICATION) == []


class TestPrepare:
    def test_it_queues_the_application_for_a_browser(self, worker: Worker, db: Session):
        job = make_job(db)
        application = Application(
            job_id=job.id, application_url=job.canonical_url, status=ApplicationState.CREATED
        )
        db.add(application)
        db.commit()

        queue(db, TaskType.PREPARE_APPLICATION, application_id=str(application.id))
        worker.run_once(now=NOW)
        db.refresh(application)

        assert application.status == ApplicationState.BROWSER_QUEUED

    def test_it_asks_for_a_tailored_resume_when_there_is_none(
        self, worker: Worker, db: Session
    ):
        job = make_job(db)
        application = Application(
            job_id=job.id, application_url=job.canonical_url, status=ApplicationState.CREATED
        )
        db.add(application)
        db.commit()

        queue(db, TaskType.PREPARE_APPLICATION, application_id=str(application.id))
        worker.run_once(now=NOW)

        assert len(tasks(db, TaskType.TAILOR_RESUME)) == 1


#: Comfortably past the two-business-day delay and inside the send window, so the
#: tests below are about matching and drafting rather than about the calendar.
#: Computed with the policy's own helper rather than a hand-picked date, which
#: would land on a weekend roughly two runs in seven.
AFTER_THE_DELAY = next_send_window(NOW + timedelta(days=9))


class TestTailoring:
    def _application(self, db: Session) -> Application:
        job = make_job(db)
        application = Application(
            job_id=job.id,
            application_url=job.canonical_url,
            status=ApplicationState.MATERIALS_PREPARING,
        )
        db.add(application)
        db.commit()
        return application

    def _facts(self, db: Session, *, verified: bool) -> None:
        from app.services.candidate import Actor
        from app.services.resume_import import ExtractedFacts, store_facts

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
            actor=Actor.USER if verified else Actor.IMPORT,
        )
        set_fact(db, "candidate.preferred_name", "Hoan", actor=Actor.USER)
        db.commit()

    def test_unverified_facts_block_tailoring_and_say_so(self, worker: Worker, db: Session):
        """§7.7: a tailored resume may only cite facts the user has read."""
        application = self._application(db)
        self._facts(db, verified=False)

        queue(db, TaskType.TAILOR_RESUME, application_id=str(application.id))
        worker.run_once(now=NOW)

        task = tasks(db, TaskType.TAILOR_RESUME)[0]
        assert task.status == TaskStatus.DEAD
        assert "waiting for you to confirm" in not_none(task.last_error)

    def test_no_facts_at_all_names_the_command_to_run(self, worker: Worker, db: Session):
        application = self._application(db)
        set_fact(db, "candidate.preferred_name", "Hoan", actor=Actor.USER)
        db.commit()

        queue(db, TaskType.TAILOR_RESUME, application_id=str(application.id))
        worker.run_once(now=NOW)

        assert "import-resume" in not_none(tasks(db, TaskType.TAILOR_RESUME)[0].last_error)

    def test_a_supported_plan_produces_a_pdf_and_attaches_it(
        self, worker: Worker, db: Session, provider: NullProvider, settings: Settings
    ):
        application = self._application(db)
        self._facts(db, verified=True)
        provider.queue(
            {
                "summary": "",
                "summary_fact_ids": [],
                "bullets": [
                    {
                        "text": "Built a FastAPI service at Todd Labs.",
                        "fact_ids": ["exp.todd.1"],
                        "transformation": "shorten",
                    }
                ],
                "section_order": [],
            }
        )

        queue(db, TaskType.TAILOR_RESUME, application_id=str(application.id))
        worker.run_once(now=NOW)

        db.refresh(application)
        version = not_none(
            db.scalars(select(ResumeVersion).where(ResumeVersion.kind == "TAILORED")).first()
        )
        assert application.resume_version_id == version.id
        assert Path(version.pdf_path).is_file()
        assert version.status == "READY_FOR_REVIEW"

    def test_an_unsupported_claim_blocks_and_records_the_violations(
        self, worker: Worker, db: Session, provider: NullProvider
    ):
        """§7.7: block, do not quietly ship a weakened resume."""
        application = self._application(db)
        self._facts(db, verified=True)
        invented = {
            "summary": "",
            "summary_fact_ids": [],
            "bullets": [
                {
                    "text": "Scaled the platform to 4 million users at Stripe.",
                    "fact_ids": ["exp.todd.1"],
                    "transformation": "rewrite",
                }
            ],
            "section_order": [],
        }
        provider.queue(invented)
        provider.queue(invented)

        queue(db, TaskType.TAILOR_RESUME, application_id=str(application.id))
        worker.run_once(now=NOW)

        task = tasks(db, TaskType.TAILOR_RESUME)[0]
        assert task.status == TaskStatus.DEAD
        assert "unsupported claims" in not_none(task.last_error)
        assert db.scalars(select(ResumeVersion)).all() == []

    def test_the_violations_are_written_where_the_review_screen_reads_them(
        self, worker: Worker, db: Session, provider: NullProvider, settings: Settings
    ):
        """A user cannot judge "it was rejected" without seeing why."""
        import json

        application = self._application(db)
        self._facts(db, verified=True)
        invented = {
            "summary": "",
            "summary_fact_ids": [],
            "bullets": [
                {
                    "text": "Scaled the platform to 4 million users.",
                    "fact_ids": ["exp.todd.1"],
                    "transformation": "rewrite",
                }
            ],
            "section_order": [],
        }
        provider.queue(invented)
        provider.queue(invented)

        queue(db, TaskType.TAILOR_RESUME, application_id=str(application.id))
        worker.run_once(now=NOW)

        sidecar = settings.artifacts_dir / str(application.id) / "resume-validation.json"
        written = json.loads(sidecar.read_text(encoding="utf-8"))
        assert written["validation"]["passed"] is False
        assert any(v["kind"] == "INVENTED_METRIC" for v in written["violations"])


class TestOutreachPipeline:
    def _submitted(self, db: Session) -> Application:
        job = make_job(db)
        application = Application(
            job_id=job.id,
            application_url=job.canonical_url,
            status=ApplicationState.SUBMITTED,
            submitted_at=NOW - timedelta(days=1),
        )
        db.add(application)
        db.commit()
        return application

    def _recruiter(self, db: Session, **kw: object) -> Recruiter:
        company = db.scalars(
            select(Company).where(Company.normalized_name == "acme")
        ).first() or Company(canonical_name="Acme Inc", normalized_name="acme", domain="acme.com")
        db.add(company)
        db.flush()
        defaults: dict[str, object] = {
            "full_name": "Alice Nguyen",
            "raw_company": "Acme Inc",
            "email": "alice@acme.com",
            "email_domain": "acme.com",
            "company_id": company.id,
            "title": "University Recruiter",
        }
        recruiter = Recruiter(**{**defaults, **kw})
        db.add(recruiter)
        db.commit()
        return recruiter

    def test_outreach_is_due_two_business_days_later(self, worker: Worker, db: Session):
        application = self._submitted(db)
        queue(db, TaskType.SCHEDULE_OUTREACH, application_id=str(application.id))
        worker.run_once(now=NOW)

        outreach = not_none(db.scalars(select(OutreachTask)).first())
        assert outreach.due_at > (application.submitted_at or NOW)
        assert outreach.status == OutreachState.SCHEDULED

    def test_outreach_is_refused_before_submission(self, worker: Worker, db: Session):
        """§8.2: the email says "I applied". It must be true."""
        job = make_job(db)
        application = Application(
            job_id=job.id,
            application_url=job.canonical_url,
            status=ApplicationState.READY_FOR_REVIEW,
        )
        db.add(application)
        db.commit()

        queue(db, TaskType.SCHEDULE_OUTREACH, application_id=str(application.id))
        worker.run_once(now=NOW)

        assert db.scalars(select(OutreachTask)).all() == []
        assert tasks(db, TaskType.SCHEDULE_OUTREACH)[0].status == TaskStatus.DEAD

    def test_an_unmatched_company_asks_rather_than_guessing(self, worker: Worker, db: Session):
        application = self._submitted(db)
        queue(db, TaskType.SCHEDULE_OUTREACH, application_id=str(application.id))
        drain(worker, now=AFTER_THE_DELAY)

        outreach = not_none(db.scalars(select(OutreachTask)).first())
        assert outreach.status == OutreachState.RECRUITER_MATCH_REQUIRED
        assert outreach.recruiter_id is None

    def test_a_matched_recruiter_leads_to_a_draft(self, worker: Worker, db: Session):
        self._recruiter(db)
        application = self._submitted(db)
        set_fact(db, "candidate.preferred_name", "Hoan", actor=Actor.USER)
        db.commit()

        queue(db, TaskType.SCHEDULE_OUTREACH, application_id=str(application.id))
        drain(worker, now=AFTER_THE_DELAY)

        outreach = not_none(db.scalars(select(OutreachTask)).first())
        assert outreach.status == OutreachState.READY_FOR_REVIEW
        assert outreach.gmail_draft_id
        assert outreach.subject and outreach.body

    def test_the_body_names_the_role_and_the_recruiter(self, worker: Worker, db: Session):
        self._recruiter(db)
        application = self._submitted(db)
        set_fact(db, "candidate.preferred_name", "Hoan", actor=Actor.USER)
        db.commit()

        queue(db, TaskType.SCHEDULE_OUTREACH, application_id=str(application.id))
        drain(worker, now=AFTER_THE_DELAY)

        outreach = not_none(db.scalars(select(OutreachTask)).first())
        assert "Alice" in not_none(outreach.body)
        assert "Software Engineer Intern" in not_none(outreach.body)

    def test_a_draft_carries_no_unrendered_placeholder(self, worker: Worker, db: Session):
        """The draft goes through validate_content, which refuses one."""
        self._recruiter(db)
        application = self._submitted(db)
        set_fact(db, "candidate.preferred_name", "Hoan", actor=Actor.USER)
        db.commit()

        queue(db, TaskType.SCHEDULE_OUTREACH, application_id=str(application.id))
        drain(worker, now=AFTER_THE_DELAY)

        outreach = not_none(db.scalars(select(OutreachTask)).first())
        assert "{{" not in not_none(outreach.body)

    def test_a_withheld_draft_records_why(self, worker: Worker, db: Session):
        """"No draft" with no explanation is indistinguishable from a bug."""
        self._recruiter(db)
        application = self._submitted(db)
        set_fact(db, "candidate.preferred_name", "Hoan", actor=Actor.USER)
        db.commit()

        queue(db, TaskType.SCHEDULE_OUTREACH, application_id=str(application.id))
        # Deliberately before the due date: the two-business-day delay is the
        # rule being exercised.
        drain(worker, now=NOW + timedelta(minutes=1))

        outreach = not_none(db.scalars(select(OutreachTask)).first())
        assert outreach.gmail_draft_id is None
        assert any("not due until" in r for r in (outreach.hook_json or {}).get("withheld", []))

    def test_a_suppressed_recruiter_gets_no_draft(self, worker: Worker, db: Session):
        recruiter = self._recruiter(db)
        db.add(SuppressionEntry(email=recruiter.email, reason="OPT_OUT", source="test"))
        application = self._submitted(db)
        set_fact(db, "candidate.preferred_name", "Hoan", actor=Actor.USER)
        db.commit()

        queue(db, TaskType.SCHEDULE_OUTREACH, application_id=str(application.id))
        drain(worker, now=AFTER_THE_DELAY)

        outreach = not_none(db.scalars(select(OutreachTask)).first())
        assert outreach.gmail_draft_id is None
        assert outreach.status != OutreachState.READY_FOR_REVIEW

    def test_a_do_not_contact_recruiter_is_never_matched(self, worker: Worker, db: Session):
        self._recruiter(db, do_not_contact=True)
        application = self._submitted(db)
        db.commit()

        queue(db, TaskType.SCHEDULE_OUTREACH, application_id=str(application.id))
        drain(worker, now=AFTER_THE_DELAY)

        outreach = not_none(db.scalars(select(OutreachTask)).first())
        assert outreach.gmail_draft_id is None

    def test_without_a_candidate_name_the_task_stops_and_says_why(
        self, worker: Worker, db: Session
    ):
        """Better a clear stop than an email signed by nobody."""
        self._recruiter(db)
        application = self._submitted(db)

        queue(db, TaskType.SCHEDULE_OUTREACH, application_id=str(application.id))
        drain(worker, now=AFTER_THE_DELAY)

        hook_task = tasks(db, TaskType.GENERATE_HOOK)[0]
        assert hook_task.status == TaskStatus.DEAD
        assert "candidate.preferred_name" in not_none(hook_task.last_error)


class TestTransactionality:
    def test_a_failing_stage_enqueues_nothing(self, worker: Worker, db: Session):
        """The whole point of committing work and fan-out together."""
        queue(db, TaskType.ANALYZE_SPONSORSHIP, job_id=str(uuid.uuid4()))
        worker.run_once(now=NOW)

        assert tasks(db, TaskType.SCORE_JOB) == []
