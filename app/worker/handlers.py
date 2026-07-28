"""Task handlers: the pipeline the worker actually runs (spec §16.2).

Each handler does one stage and enqueues the next, so the pipeline is described by
what each stage hands on rather than by a controller that knows all of it. A
stage's work and its fan-out commit in the same transaction (see
``Worker._execute``), which is what makes "enqueue the next step" safe: there is
no state where the work happened but the follow-up was lost.

Two stages are deliberately absent from this module:

* **Browser work** (``PREPARE_APPLICATION`` past materials, ``REPLAY_APPLICATION``)
  lives in the browser worker, which registers its own handlers. A web worker
  that tried them would have no Chromium.
* **Sending anything.** ``CREATE_GMAIL_DRAFT`` writes a draft; nothing here sends
  it, and nothing here submits a form.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db.models import (
    Application,
    Company,
    Job,
    OutreachTask,
    Recruiter,
    ScheduledTask,
    SponsorshipAssessment,
    SuppressionEntry,
)
from app.db.models import (
    JobScore as JobScoreRow,
)
from app.domain.states import (
    ApplicationState,
    InvalidTransition,
    JobState,
    OutreachState,
    assert_transition,
)
from app.domain.tasks import TaskType, idempotency_key
from app.services import candidate as facts
from app.services.eligibility import Verdict
from app.services.hooks import Hook, HookType, SourceDocument, compose_email, generate_hook
from app.services.llm.base import LLMError, LLMProvider
from app.services.outreach_policy import (
    OutreachContext,
    OutreachLimits,
    may_draft,
    schedule_outreach,
)
from app.services.recruiters import match_recruiter
from app.services.scoring import ScoreInput, score
from app.services.sponsorship import RecommendedAction, analyze, recommend
from app.worker.runtime import (
    HandlerResult,
    PermanentFailure,
    Registry,
    registry,
    run_clock,
)

__all__ = ["build_provider", "register_pipeline"]

log = logging.getLogger(__name__)

#: Overridable so tests can inject a NullProvider with canned payloads without
#: monkeypatching a module attribute at every call site.
ProviderFactory = Callable[[Settings], LLMProvider]


def build_provider(settings: Settings) -> LLMProvider:
    from app.services.llm.anthropic import build_provider as _build

    return _build(settings)


# ------------------------------------------------------------- utilities


def _payload_uuid(task: ScheduledTask, key: str) -> uuid.UUID:
    """Read a UUID from a task payload, or bury the task.

    A malformed payload is a programming error in whatever enqueued it; retrying
    would run the same broken row until it exhausts its attempts.
    """
    raw = (task.payload or {}).get(key)
    if not isinstance(raw, str):
        raise PermanentFailure(f"task payload has no {key}")
    try:
        return uuid.UUID(raw)
    except ValueError as exc:
        raise PermanentFailure(f"{key}={raw!r} is not a UUID") from exc


def _require[T](value: T | None, what: str) -> T:
    if value is None:
        raise PermanentFailure(f"{what} no longer exists")
    return value


def _move(obj: Any, target: StrEnum) -> None:
    """Transition, treating an illegal move as permanent.

    A state machine refusal means the row moved on since the task was queued —
    usually because a person acted. Retrying would fight the user.
    """
    try:
        obj.status = assert_transition(type(target)(obj.status), target)
    except InvalidTransition as exc:
        raise PermanentFailure(str(exc)) from exc


def _candidate_facts(session: Session) -> dict[str, Any]:
    return {f.key: f.value for f in facts.list_facts(session)}


def _graduation_date(values: dict[str, Any]) -> date | None:
    raw = values.get("education.graduation_date") or values.get("candidate.graduation_date")
    if not isinstance(raw, str):
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        # A malformed date is worth a log line, not a failed pipeline: scoring
        # simply loses one component.
        log.warning("graduation date %r is not ISO-8601; ignoring", raw)
        return None


# ------------------------------------------------------------- discovery


def register_pipeline(
    into: Registry | None = None,
    *,
    settings: Settings | None = None,
    provider_factory: ProviderFactory = build_provider,
) -> Registry:
    """Register every non-browser handler.

    Args:
        into: registry to populate. Defaults to the process-wide one.
        settings: configuration. Read once here rather than per task.
        provider_factory: how to obtain an LLM provider. Injectable so tests can
            run the whole pipeline against canned responses.
    """
    target = into if into is not None else registry
    config = settings or get_settings()

    # ------------------------------------------------------------ discovery

    @target.register(TaskType.DISCOVER_SOURCE)
    def discover(session: Session, task: ScheduledTask) -> HandlerResult:
        """Fetch one feed and store what is new (§7.2)."""
        from app.services.discovery.ingest import ingest_all
        from app.worker.sources import adapters_for

        payload = task.payload or {}
        adapters = adapters_for(payload, settings=config)
        if not adapters:
            raise PermanentFailure(f"no adapter matches payload {payload!r}")

        reports = ingest_all(session, adapters)
        follow_ups: list[tuple[TaskType, str, dict[str, Any]]] = []

        # Analyse only jobs that have neither an assessment nor a score. A feed
        # that republishes 200 unchanged rows must not re-spend the budget.
        pending = session.scalars(
            select(Job.id)
            .outerjoin(SponsorshipAssessment, SponsorshipAssessment.job_id == Job.id)
            .where(SponsorshipAssessment.id.is_(None))
            .where(Job.status.in_([JobState.DISCOVERED, JobState.ENRICHED]))
            .limit(200)
        ).all()
        for job_id in pending:
            follow_ups.append(
                (
                    TaskType.ANALYZE_SPONSORSHIP,
                    idempotency_key(TaskType.ANALYZE_SPONSORSHIP, str(job_id)),
                    {"job_id": str(job_id)},
                )
            )

        detail = "; ".join(_summarise(r) for r in reports) if reports else "nothing fetched"
        return HandlerResult(detail=detail, follow_ups=tuple(follow_ups))

    # --------------------------------------------------------- sponsorship

    @target.register(TaskType.ANALYZE_SPONSORSHIP)
    def sponsorship(session: Session, task: ScheduledTask) -> HandlerResult:
        """Classify the employer's stated policy (§7.5).

        The stored row records what the *employer* said, and only that. The
        candidate's own facts are read to decide what to recommend, and never
        written — §2.2 keeps the two records apart, because conflating them is how
        a system ends up answering a form dishonestly.
        """
        job = _require(session.get(Job, _payload_uuid(task, "job_id")), "job")

        existing = session.scalars(
            select(SponsorshipAssessment).where(SponsorshipAssessment.job_id == job.id)
        ).first()
        if existing is not None:
            return HandlerResult(detail="already assessed")

        analysis = analyze(
            job.description_text or "",
            provider=provider_factory(config),
            source_url=job.canonical_url,
        )
        # The recommendation depends on the user's own facts, which are read here
        # and never written. §2.2: what the employer said and what is true about
        # the candidate are two different records, and only one of them is a fact
        # about a person.
        values = _candidate_facts(session)
        action = recommend(
            analysis,
            candidate_needs_sponsorship=bool(
                values.get("work_authorization.requires_future_sponsorship", True)
            ),
            candidate_is_us_citizen=bool(values.get("citizenship.is_us_citizen", False)),
            candidate_is_permanent_resident=bool(
                values.get("citizenship.is_permanent_resident", False)
            ),
        )

        session.add(
            SponsorshipAssessment(
                job_id=job.id,
                classification=analysis.classification.value,
                work_authorization_restriction=analysis.work_authorization_restriction.value,
                evidence=[e.model_dump() for e in analysis.evidence],
                confidence=analysis.confidence,
                recommended_action=action.value,
                reasoning_summary=analysis.reasoning_summary,
            )
        )

        if job.status == JobState.DISCOVERED:
            _move(job, JobState.ENRICHED)

        if action is RecommendedAction.SKIP:
            # No score, no application, no spend. The employer already answered.
            _move(job, JobState.ELIGIBILITY_REJECTED)
            return HandlerResult(detail=f"{analysis.classification.value}: skipped")

        follow = (
            TaskType.SCORE_JOB,
            idempotency_key(TaskType.SCORE_JOB, str(job.id)),
            {"job_id": str(job.id)},
        )
        return HandlerResult(detail=analysis.classification.value, follow_ups=(follow,))

    # -------------------------------------------------------------- scoring

    @target.register(TaskType.SCORE_JOB)
    def score_job(session: Session, task: ScheduledTask) -> HandlerResult:
        """Score a job out of 100 (§7.6). Ineligible jobs never reach the model."""
        job = _require(session.get(Job, _payload_uuid(task, "job_id")), "job")
        values = _candidate_facts(session)

        # Ordinarily sponsorship analysis has already moved the job on. Doing it
        # here too lets a job be re-scored without first replaying every earlier
        # stage, which is what an operator re-queuing one row expects.
        if job.status == JobState.DISCOVERED:
            _move(job, JobState.ENRICHED)

        assessment = session.scalars(
            select(SponsorshipAssessment).where(SponsorshipAssessment.job_id == job.id)
        ).first()

        result = score(
            ScoreInput(
                normalized_title=job.normalized_title,
                normalized_location=job.normalized_location or "",
                description_text=job.description_text,
                season=job.season,
                posted_at=job.posted_at,
                is_closed=job.status == JobState.CLOSED,
                graduation_date=_graduation_date(values),
                needs_sponsorship=bool(
                    values.get("work_authorization.requires_future_sponsorship", True)
                ),
                is_us_citizen=bool(values.get("citizenship.is_us_citizen", False)),
                is_permanent_resident=bool(values.get("citizenship.is_permanent_resident", False)),
                preferred_locations=frozenset(values.get("preferences.locations", []) or []),
                open_to_remote=bool(values.get("preferences.open_to_remote", True)),
            ),
            provider=provider_factory(config),
            sponsorship=None,
            candidate_summary=str(values.get("profile.summary", "")),
            now=run_clock(),
        )

        session.add(
            JobScoreRow(
                job_id=job.id,
                total_score=result.total,
                components=dict(result.components),
                hard_filter_result=result.hard_filter_result.value,
                fact_references=list(result.fact_references),
                model_name=result.model_name,
                prompt_version=result.prompt_version,
            )
        )

        if result.hard_filter_result is Verdict.REJECT:
            _move(job, JobState.ELIGIBILITY_REJECTED)
            return HandlerResult(detail=f"rejected: {'; '.join(result.eligibility_reasons)}")

        _move(job, JobState.SCORED)
        detail = f"{result.total:.1f}/100"

        # Selection stays with the user (§0.2): a score above the threshold makes
        # the job visible on the dashboard, it does not start an application.
        if assessment and assessment.recommended_action == RecommendedAction.MANUAL_REVIEW:
            detail += " (sponsorship needs your judgement)"
        return HandlerResult(detail=detail)

    # -------------------------------------------------------- applications

    @target.register(TaskType.PREPARE_APPLICATION)
    def prepare(session: Session, task: ScheduledTask) -> HandlerResult:
        """Assemble materials, then hand the form itself to a browser worker.

        This handler runs anywhere; the filling does not. Splitting them keeps a
        web-only deployment able to prepare materials, and means a browser slot
        being busy delays the form rather than the whole pipeline.
        """
        application = _require(
            session.get(Application, _payload_uuid(task, "application_id")), "application"
        )
        job = _require(session.get(Job, application.job_id), "job")

        if application.status == ApplicationState.CREATED:
            _move(application, ApplicationState.MATERIALS_PREPARING)

        follow_ups: list[tuple[TaskType, str, dict[str, Any]]] = []
        if application.resume_version_id is None:
            follow_ups.append(
                (
                    TaskType.TAILOR_RESUME,
                    idempotency_key(TaskType.TAILOR_RESUME, str(application.id)),
                    {"application_id": str(application.id), "job_id": str(job.id)},
                )
            )

        _move(application, ApplicationState.MATERIALS_READY)
        _move(application, ApplicationState.BROWSER_QUEUED)
        return HandlerResult(
            detail="queued for a browser slot", follow_ups=tuple(follow_ups)
        )

    # ------------------------------------------------------------ outreach

    @target.register(TaskType.SCHEDULE_OUTREACH)
    def schedule(session: Session, task: ScheduledTask) -> HandlerResult:
        """Create the outreach task, due two business days after submission (§8.1)."""
        application = _require(
            session.get(Application, _payload_uuid(task, "application_id")), "application"
        )
        if application.status != ApplicationState.SUBMITTED:
            raise PermanentFailure(
                f"outreach follows a confirmed submission; this application is "
                f"{application.status}"
            )

        submitted_at = application.submitted_at or run_clock()
        due_at = schedule_outreach(submitted_at, _limits(config))

        existing = session.scalars(
            select(OutreachTask).where(OutreachTask.application_id == application.id)
        ).first()
        outreach = existing or OutreachTask(
            application_id=application.id,
            status=OutreachState.NOT_ELIGIBLE,
            due_at=due_at,
        )
        outreach.due_at = due_at
        if existing is None:
            session.add(outreach)
            session.flush()
        if outreach.status == OutreachState.NOT_ELIGIBLE:
            _move(outreach, OutreachState.SCHEDULED)

        application.outreach_due_at = due_at
        follow = (
            TaskType.MATCH_RECRUITER,
            idempotency_key(TaskType.MATCH_RECRUITER, str(outreach.id)),
            {"outreach_task_id": str(outreach.id)},
        )
        return HandlerResult(detail=f"due {due_at.isoformat()}", follow_ups=(follow,))

    @target.register(TaskType.MATCH_RECRUITER)
    def match(session: Session, task: ScheduledTask) -> HandlerResult:
        """Pick the recruiter, or ask the user (§7.12).

        A near-miss is not a match: emailing the wrong company is worse than
        emailing nobody, so an unresolved company parks the task in a state the
        outreach screen renders as a question.
        """
        outreach = _require(
            session.get(OutreachTask, _payload_uuid(task, "outreach_task_id")), "outreach task"
        )
        application = _require(session.get(Application, outreach.application_id), "application")
        job = _require(session.get(Job, application.job_id), "job")
        company = _require(session.get(Company, job.company_id), "company")

        result = match_recruiter(
            session,
            company_name=company.canonical_name,
            company_domain=company.domain,
            now=run_clock(),
        )
        if result.recruiter is None:
            if outreach.status == OutreachState.SCHEDULED:
                _move(outreach, OutreachState.RECRUITER_MATCH_REQUIRED)
            return HandlerResult(detail=f"no match: {result.reason}")

        outreach.recruiter_id = result.recruiter.id
        outreach.hook_json = {**(outreach.hook_json or {}), "match_reason": result.matched_on}
        _move(outreach, OutreachState.HOOK_GENERATING)

        follow = (
            TaskType.GENERATE_HOOK,
            idempotency_key(TaskType.GENERATE_HOOK, str(outreach.id)),
            {"outreach_task_id": str(outreach.id)},
        )
        return HandlerResult(detail=f"matched on {result.matched_on}", follow_ups=(follow,))

    @target.register(TaskType.GENERATE_HOOK)
    def hook(session: Session, task: ScheduledTask) -> HandlerResult:
        """Write the email. A hook without a source is dropped, not softened (§7.13)."""
        outreach = _require(
            session.get(OutreachTask, _payload_uuid(task, "outreach_task_id")), "outreach task"
        )
        application = _require(session.get(Application, outreach.application_id), "application")
        job = _require(session.get(Job, application.job_id), "job")
        company = _require(session.get(Company, job.company_id), "company")
        recruiter = (
            session.get(Recruiter, outreach.recruiter_id) if outreach.recruiter_id else None
        )
        if recruiter is None:
            raise PermanentFailure("no recruiter is assigned")

        # Checked before the model runs: an email nobody can sign is not worth
        # paying to write.
        values = _candidate_facts(session)
        applicant = str(values.get("candidate.preferred_name") or values.get("profile.name") or "")
        if not applicant:
            raise PermanentFailure(
                "no candidate name is set; add candidate.preferred_name in Settings"
            )

        sources = [
            SourceDocument(
                url=job.canonical_url,
                kind="job_description",
                text=job.description_text or "",
            )
        ]
        try:
            written = generate_hook(
                sources,
                provider=provider_factory(config),
                company=company.canonical_name,
                role=job.title,
            )
        except LLMError as exc:
            # §7.13 prefers a short, direct email over an invented personal
            # detail, so a model that is unavailable, over budget, or returning
            # nonsense costs the personal touch and nothing else.
            log.info("hook generation skipped (%s); sending a plain email", exc)
            written = Hook(hook_type=HookType.NONE, unsupported_claims=[str(exc)])

        subject, body = compose_email(
            recruiter_first_name=recruiter.full_name.split(" ")[0],
            company=company.canonical_name,
            role=job.title,
            applicant_name=applicant,
            hook=written,
            applied_on=(application.submitted_at or run_clock()).strftime("%d %B"),
        )

        outreach.hook_json = {**(outreach.hook_json or {}), **written.model_dump()}
        outreach.subject = subject
        outreach.body = body
        _move(outreach, OutreachState.DRAFT_CREATING)

        follow = (
            TaskType.CREATE_GMAIL_DRAFT,
            idempotency_key(TaskType.CREATE_GMAIL_DRAFT, str(outreach.id)),
            {"outreach_task_id": str(outreach.id)},
        )
        return HandlerResult(detail=written.hook_type.value, follow_ups=(follow,))

    @target.register(TaskType.CREATE_GMAIL_DRAFT)
    def draft(session: Session, task: ScheduledTask) -> HandlerResult:
        """Create the Gmail draft. Never sends it (§7.14).

        Every §8.2 suppression rule is checked here, immediately before the draft
        exists — not at scheduling time, when a reply or an opt-out could not yet
        have happened.
        """
        from app.services.gmail import GmailService
        from app.worker.gmail_client import open_gmail

        outreach = _require(
            session.get(OutreachTask, _payload_uuid(task, "outreach_task_id")), "outreach task"
        )
        application = _require(session.get(Application, outreach.application_id), "application")
        recruiter = (
            session.get(Recruiter, outreach.recruiter_id) if outreach.recruiter_id else None
        )
        if recruiter is None:
            raise PermanentFailure("no recruiter is assigned")
        if not outreach.subject or not outreach.body:
            raise PermanentFailure("the email has not been written yet")

        decision = may_draft(
            _outreach_context(session, outreach, application, recruiter),
            now=run_clock(),
            limits=_limits(config),
            daily_limit=config.outreach_initial_daily_limit,
        )
        if not decision:
            # Recorded, not merely logged: a user looking at an outreach with no
            # draft needs to know which rule held it back, and "check the worker
            # log" is not an answer.
            outreach.hook_json = {**(outreach.hook_json or {}), "withheld": decision.reasons}
            log.info("draft withheld: %s", "; ".join(decision.reasons))
            return HandlerResult(detail="withheld: " + "; ".join(decision.reasons))

        service: GmailService = open_gmail(config)
        record = service.create_draft(
            to=recruiter.email, subject=outreach.subject, body=outreach.body
        )

        outreach.gmail_draft_id = record.draft_id
        outreach.gmail_message_id = record.message_id
        outreach.gmail_thread_id = record.thread_id
        recruiter.last_contacted_at = run_clock()
        _move(outreach, OutreachState.READY_FOR_REVIEW)

        return HandlerResult(detail=f"draft {record.draft_id} ready for your review")

    @target.register(TaskType.RECONCILE_GMAIL)
    def reconcile_gmail(session: Session, task: ScheduledTask) -> HandlerResult:
        """Observe what the *user* did with each draft (§7.14).

        The only way an outreach reaches SENT. Nothing in this system sends, so
        SENT always means a person pressed Send in Gmail.
        """
        from app.services.gmail import MessageState, reconcile
        from app.worker.gmail_client import open_gmail

        service = open_gmail(config)
        pending = session.scalars(
            select(OutreachTask)
            .where(OutreachTask.gmail_draft_id.is_not(None))
            .where(OutreachTask.status.in_([OutreachState.READY_FOR_REVIEW, OutreachState.SENT]))
        ).all()

        changed = 0
        now = run_clock()
        for outreach in pending:
            observed = reconcile(
                service,
                draft_id=outreach.gmail_draft_id,
                thread_id=outreach.gmail_thread_id,
            )
            if observed.state is MessageState.SENT and outreach.status != OutreachState.SENT:
                outreach.sent_at = now
                outreach.gmail_message_id = observed.message_id or outreach.gmail_message_id
                _move(outreach, OutreachState.SENT)
                changed += 1
            elif (
                observed.state is MessageState.REPLIED
                and outreach.status != OutreachState.REPLIED
            ):
                if outreach.status == OutreachState.READY_FOR_REVIEW:
                    # A reply proves it was sent, even if this is the first time
                    # reconciliation has looked.
                    outreach.sent_at = outreach.sent_at or now
                    _move(outreach, OutreachState.SENT)
                outreach.replied_at = observed.replied_at or now
                _move(outreach, OutreachState.REPLIED)
                # A reply cancels every follow-up (§8.4) and suppresses further
                # contact: the conversation has started, and this system is not
                # part of it.
                session.add(
                    SuppressionEntry(
                        email=_recruiter_email(session, outreach),
                        reason="REPLIED",
                        source="gmail-reconciliation",
                    )
                )
                changed += 1

        return HandlerResult(detail=f"{changed} of {len(pending)} changed")

    # ------------------------------------------------------- housekeeping

    @target.register(TaskType.CLEANUP_EXPIRED_SESSION)
    def cleanup(session: Session, task: ScheduledTask) -> HandlerResult:
        """Close browser sessions past their TTL (§15.5, §23.6)."""
        from app.db.models import BrowserSession
        from app.domain.states import BrowserSlotState

        now = run_clock()
        expired = session.scalars(
            select(BrowserSession)
            .where(BrowserSession.ended_at.is_(None))
            .where(BrowserSession.expires_at < now)
        ).all()

        for slot in expired:
            slot.ended_at = now
            slot.error_summary = "expired"
            # Straight to CLEANING regardless of where it was: the TTL exists so
            # an abandoned live review does not hold a slot for ever.
            with_suppressed_invalid_transition(slot, BrowserSlotState.CLEANING)

        return HandlerResult(detail=f"closed {len(expired)} expired session(s)")

    return target


def with_suppressed_invalid_transition(obj: Any, target: Any) -> None:
    """Transition if the machine allows it; otherwise leave the status alone.

    Used only by cleanup, where the row is being closed anyway and the exact
    prior state does not change what happens next.
    """
    try:
        obj.status = assert_transition(type(target)(obj.status), target)
    except InvalidTransition:
        log.debug("slot %s left in %s during cleanup", getattr(obj, "id", "?"), obj.status)


def _summarise(report: Any) -> str:
    """One line per feed, for the worker log and the task detail."""
    parts = [f"{report.source_name}: {report.new_jobs} new"]
    if report.duplicates or report.probable_duplicates:
        parts.append(f"{report.duplicates + report.probable_duplicates} already known")
    if report.skipped:
        parts.append(f"{report.skipped} skipped")
    if report.errors:
        parts.append(f"errors: {'; '.join(report.errors)}")
    return ", ".join(parts)


def _limits(settings: Settings) -> OutreachLimits:
    return OutreachLimits(
        initial_daily_draft_limit=settings.outreach_initial_daily_limit,
        maximum_daily_draft_limit=settings.outreach_max_daily_limit,
        minimum_days_after_application=settings.outreach_delay_business_days,
        maximum_recruiters_per_company_30d=settings.outreach_max_per_company_30d,
        maximum_followups=settings.outreach_max_followups,
    )


def _recruiter_email(session: Session, outreach: OutreachTask) -> str | None:
    if outreach.recruiter_id is None:
        return None
    recruiter = session.get(Recruiter, outreach.recruiter_id)
    return recruiter.email if recruiter else None


def _outreach_context(
    session: Session,
    outreach: OutreachTask,
    application: Application,
    recruiter: Recruiter,
) -> OutreachContext:
    """Gather everything §8.2 needs, from the database rather than from hope."""
    now = run_clock()
    day_start = datetime(now.year, now.month, now.day, tzinfo=UTC)

    job = session.get(Job, application.job_id)
    company_id = job.company_id if job else None

    drafts_today = session.scalar(
        select(func.count())
        .select_from(OutreachTask)
        .where(OutreachTask.gmail_draft_id.is_not(None))
        .where(OutreachTask.updated_at >= day_start)
    )
    to_company = session.scalar(
        select(func.count())
        .select_from(OutreachTask)
        .join(Application, OutreachTask.application_id == Application.id)
        .join(Job, Application.job_id == Job.id)
        .where(Job.company_id == company_id)
        .where(OutreachTask.gmail_draft_id.is_not(None))
    )
    suppressed_email = session.scalar(
        select(func.count())
        .select_from(SuppressionEntry)
        .where(SuppressionEntry.email == recruiter.email)
    )
    suppressed_company = session.scalar(
        select(func.count())
        .select_from(SuppressionEntry)
        .where(SuppressionEntry.company_id == company_id)
    )

    return OutreachContext(
        application_submitted=application.status == ApplicationState.SUBMITTED,
        submitted_at=application.submitted_at,
        due_at=outreach.due_at,
        recruiter_email=recruiter.email,
        recruiter_do_not_contact=recruiter.do_not_contact,
        recruiter_replied=recruiter.replied_at is not None,
        recruiter_last_contacted_at=recruiter.last_contacted_at,
        email_is_suppressed=bool(suppressed_email),
        company_is_suppressed=bool(suppressed_company),
        drafts_created_today=int(drafts_today or 0),
        contacts_to_company_last_30d=int(to_company or 0),
        drafts_for_this_application=1 if outreach.gmail_draft_id else 0,
        followups_sent=outreach.followup_count,
    )
