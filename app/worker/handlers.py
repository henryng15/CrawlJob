"""Task handlers: the pipeline the worker actually runs.

Each handler does one stage and enqueues the next, so the pipeline is described by
what each stage hands on rather than by a controller that knows all of it. A
stage's work and its fan-out commit in the same transaction (see
``Worker._execute``), which is what makes "enqueue the next step" safe: there is
no state where the work happened but the follow-up was lost.

``SUBMIT_APPLICATION`` is deliberately absent from this module: it needs Chromium
and lives in ``app.worker.browser``. Exactly one process owns each task type — two
handlers for one type means whichever worker claims it first decides whether the
task makes sense.

Nothing here calls a model. Sponsorship screening is regex; scoring is
arithmetic. That is not a limitation being worked around, it is the reason the
whole pipeline costs nothing to run.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, time
from enum import StrEnum
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db.models import (
    Application,
    Company,
    Job,
    ScheduledTask,
    SponsorshipAssessment,
)
from app.db.models import (
    JobScore as JobScoreRow,
)
from app.domain.states import (
    ApplicationState,
    InvalidTransition,
    JobState,
    assert_transition,
)
from app.domain.tasks import TaskType, idempotency_key
from app.services import audit
from app.services import candidate as facts
from app.services.eligibility import Verdict
from app.services.filters import screen
from app.services.scoring import ScoreInput, score
from app.worker.runtime import (
    HandlerResult,
    PermanentFailure,
    Registry,
    registry,
    run_clock,
)

__all__ = ["register_pipeline"]

log = logging.getLogger(__name__)


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


def _move(obj: Any, target: StrEnum, *, session: Session | None = None, **context: Any) -> None:
    """Transition, treating an illegal move as permanent.

    A state machine refusal means the row moved on since the task was queued —
    usually because a person acted. Retrying would fight the user.

    Pass ``session`` to record the change in the audit log. It commits with the
    transition, so the log cannot claim something the transaction rolled back.
    """
    was = str(obj.status)
    try:
        obj.status = assert_transition(type(target)(obj.status), target)
    except InvalidTransition as exc:
        raise PermanentFailure(str(exc)) from exc

    if session is not None:
        audit.transition(
            session,
            obj,
            entity_type=type(obj).__name__.lower(),
            was=was,
            now=str(target),
            **context,
        )


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
) -> Registry:
    """Register every handler that does not need a browser.

    Args:
        into: registry to populate. Defaults to the process-wide one.
        settings: configuration. Read once here rather than per task.
    """
    target = into if into is not None else registry
    config = settings or get_settings()

    # ------------------------------------------------------------ discovery

    @target.register(TaskType.DISCOVER_SOURCE)
    def discover(session: Session, task: ScheduledTask) -> HandlerResult:
        """Fetch one feed and store what is new (§7.2)."""
        from app.services.discovery.ingest import ingest_all
        from app.services.sponsorship import (
            Classification,
            RecommendedAction,
            SponsorshipAnalysis,
            WorkAuthRestriction,
            deterministic_prepass,
            recommend,
        )
        from app.worker.sources import adapters_for

        payload = task.payload or {}
        adapters = adapters_for(payload, settings=config)
        if not adapters:
            raise PermanentFailure(f"no adapter matches payload {payload!r}")

        reports = ingest_all(session, adapters)
        follow_ups: list[tuple[TaskType, str, dict[str, Any]]] = []

        # Screen only jobs that have not been assessed yet. A feed that
        # republishes 200 unchanged rows must not re-screen all of them.
        #
        # Deduplication has already happened during ingest: an exact duplicate
        # never became a row of its own, and a probable one carries
        # DUPLICATE_PROBABLE and so is not selected here.
        pending = session.scalars(
            select(Job)
            .outerjoin(SponsorshipAssessment, SponsorshipAssessment.job_id == Job.id)
            .where(SponsorshipAssessment.id.is_(None))
            .where(Job.status.in_([JobState.DISCOVERED, JobState.ENRICHED]))
            .limit(200)
        ).all()

        rules = config.screen_rules
        moment = run_clock()
        screened_out = 0
        values = _candidate_facts(session)
        needs_sponsorship = bool(values.get("work_authorization.requires_future_sponsorship", True))
        is_citizen = bool(values.get("citizenship.is_us_citizen", False))
        is_resident = bool(values.get("citizenship.is_permanent_resident", False))
        for job in pending:
            verdict = screen(
                normalized_title=job.normalized_title,
                # The raw text, not the normalized form: normalization folds
                # every remote posting to the bare word "remote", discarding the
                # country this check exists to read.
                location_text=job.location_text,
                posted_at=job.posted_at,
                discovered_at=job.discovered_at,
                now=moment,
                rules=rules,
            )
            if not verdict.passed:
                # Rejected before the job can take one of the day's application
                # slots. The row stays, with its reason, so the user can see
                # what was turned away.
                if job.status == JobState.DISCOVERED:
                    _move(job, JobState.ENRICHED)
                _move(
                    job,
                    JobState.ELIGIBILITY_REJECTED,
                    session=session,
                    reason=verdict.reason,
                    stage="pre_spend_screen",
                )
                screened_out += 1
                continue
            if job.status == JobState.DISCOVERED:
                _move(job, JobState.ENRICHED)

            # What the employer said about sponsorship, read by regex. A quote
            # that is actually in the posting is the only thing that can reject
            # a job here — see app.services.sponsorship for why the wording
            # matters more than the confidence.
            hit = deterministic_prepass(job.description_text or "", source_url=job.canonical_url)
            # Either half is decisive on its own. "Must be a U.S. citizen" sets a
            # restriction and no classification at all — reading only the
            # classification would send an unauthorised applicant straight at it.
            if hit.classification is None and hit.restriction is None:
                follow_ups.append(_score_next(job))
                continue

            analysis = SponsorshipAnalysis(
                classification=hit.classification or Classification.SPONSORSHIP_NOT_MENTIONED,
                work_authorization_restriction=(
                    hit.restriction or WorkAuthRestriction.NO_EXPLICIT_RESTRICTION
                ),
                evidence=hit.evidence,
                confidence=1.0,
            )
            action = recommend(
                analysis,
                candidate_needs_sponsorship=needs_sponsorship,
                candidate_is_us_citizen=is_citizen,
                candidate_is_permanent_resident=is_resident,
            )
            session.add(
                SponsorshipAssessment(
                    job_id=job.id,
                    classification=analysis.classification.value,
                    work_authorization_restriction=(analysis.work_authorization_restriction.value),
                    evidence=[e.model_dump(mode="json") for e in hit.evidence],
                    recommended_action=action.value,
                    # A regex match is not a probability. The quote is either in
                    # the posting or it is not, and verify_evidence checks that.
                    confidence=1.0,
                )
            )
            # The user's own facts decide this, not the posting alone: "US
            # citizens only" is a rejection for one person and irrelevant to
            # the next.
            #
            # MANUAL_REVIEW stops the job too. It used to mean "put this in front
            # of a human", and there is no longer a human in this lane — so the
            # choice is between spending an application on a posting that says it
            # cannot hire this candidate, and not. The job keeps its row and its
            # quote, so it is still visible on the jobs screen.
            if action is not RecommendedAction.CONTINUE:
                quote = hit.evidence[0].quote if hit.evidence else "sponsorship is not offered"
                _move(
                    job,
                    JobState.ELIGIBILITY_REJECTED,
                    session=session,
                    reason=f"the posting says: {quote}",
                    stage="sponsorship_prepass",
                )
                screened_out += 1
                continue

            follow_ups.append(_score_next(job))

        detail = "; ".join(_summarise(r) for r in reports) if reports else "nothing fetched"
        if screened_out:
            detail += f"; {screened_out} screened out before spend"
        return HandlerResult(detail=detail, follow_ups=tuple(follow_ups))

    # -------------------------------------------------------------- scoring

    @target.register(TaskType.SCORE_JOB)
    def score_job(session: Session, task: ScheduledTask) -> HandlerResult:
        """Score a job out of 100, and start an application if it clears the bar."""
        job = _require(session.get(Job, _payload_uuid(task, "job_id")), "job")
        if job.status == JobState.SELECTED:
            # Already applied to. Re-scoring is something an operator does by
            # hand, and it must not walk the job backwards or apply twice.
            return HandlerResult(detail="already selected")

        values = _candidate_facts(session)

        # Discovery ordinarily moves the job on. Doing it here too lets a job be
        # re-scored without first replaying every earlier stage, which is what an
        # operator re-queuing one row expects.
        if job.status == JobState.DISCOVERED:
            _move(job, JobState.ENRICHED)

        result = score(
            ScoreInput(
                normalized_title=job.normalized_title,
                normalized_location=job.normalized_location or "",
                location_text=job.location_text,
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
            sponsorship=None,
            now=run_clock(),
        )

        session.add(
            JobScoreRow(
                job_id=job.id,
                total_score=result.total,
                components=dict(result.components),
                hard_filter_result=result.hard_filter_result.value,
            )
        )

        if result.hard_filter_result is Verdict.REJECT:
            _move(job, JobState.ELIGIBILITY_REJECTED)
            return HandlerResult(detail=f"rejected: {'; '.join(result.eligibility_reasons)}")

        # Already SCORED means this is a re-score, and the state machine has no
        # SCORED -> SCORED edge because a job does not move by being looked at
        # again. Without this, every job scored under an older version of the
        # scoring code was stuck with the number that version produced: the
        # weights changed when the model components were removed, and 176 jobs
        # sat below the bar carrying totals nothing could recompute.
        if job.status != JobState.SCORED:
            _move(job, JobState.SCORED)
        detail = f"{result.total:.1f}/100"

        if result.total < config.minimum_fit_score:
            return HandlerResult(detail=f"{detail}, below the {config.minimum_fit_score} bar")

        refusal = _cannot_start_application(session, job, config, now=run_clock())
        if refusal:
            return HandlerResult(detail=f"{detail}, not started: {refusal}")

        application = Application(
            job_id=job.id,
            application_url=job.canonical_url,
            ats_type=job.ats_type,
            status=ApplicationState.CREATED,
        )
        session.add(application)
        session.flush()
        _move(job, JobState.SELECTED, session=session, reason=f"scored {result.total:.1f}")

        follow = (
            TaskType.PREPARE_APPLICATION,
            idempotency_key(TaskType.PREPARE_APPLICATION, str(application.id)),
            {"application_id": str(application.id)},
        )
        return HandlerResult(detail=f"{detail}, application started", follow_ups=(follow,))

    # -------------------------------------------------------- applications

    @target.register(TaskType.PREPARE_APPLICATION)
    def prepare(session: Session, task: ScheduledTask) -> HandlerResult:
        """Attach the resume, then decide which lane this application takes.

        The resume is not rewritten per job. The user keeps one PDF; this copies
        it into the application's artifact folder, hashes it, and records the row
        the browser will upload — so what was sent stays answerable even after
        they edit the original.

        One way this stops: no base resume on disk. An application with nothing
        to attach is not one a browser should be sent to fill, and the message
        names the setting to fix.

        Employers on the manual-only list stop here, successfully: the resume is
        attached and the application is handed straight over without a browser
        ever opening. Those are the ones the user has said they will apply to
        themselves, so filling the form would be work thrown away.
        """
        from app.services.manual_companies import is_manual_only
        from app.services.resume_artifacts import attach_base

        now = run_clock()
        application = _require(
            session.get(Application, _payload_uuid(task, "application_id")), "application"
        )
        job = _require(session.get(Job, application.job_id), "job")
        company = session.get(Company, job.company_id) if job.company_id else None

        row = attach_base(session, config, application=application, now=now)
        if row is None:
            raise PermanentFailure(
                "no base resume is available; point BASE_RESUME_PDF at your resume "
                f"(currently {config.base_resume_pdf})"
            )

        # Materials are the last thing this worker can do; the form itself needs
        # a browser, and that is a different process.
        if application.status == ApplicationState.CREATED:
            _move(application, ApplicationState.MATERIALS_READY, session=session)

        pages = f"{row.page_count} page(s)" if row.page_count else "page count unknown"

        by_hand = is_manual_only(
            session,
            domain=company.domain if company else None,
            company_name=company.canonical_name if company else None,
        )
        if by_hand:
            named = company.canonical_name if company else "this employer"
            _move(
                application,
                ApplicationState.NEEDS_ME,
                session=session,
                reason="employer is on the manual-only list; nothing was filled",
                stage="manual_only_policy",
            )
            application.needs_me_at = now
            application.needs_me_reason = (
                f"{named} is on your manual-only list — open the link and apply yourself"
            )
            return HandlerResult(detail=f"resume attached ({pages}); yours to fill — {named}")

        _move(application, ApplicationState.BROWSER_QUEUED, session=session)
        follow = (
            TaskType.SUBMIT_APPLICATION,
            idempotency_key(TaskType.SUBMIT_APPLICATION, str(application.id)),
            {"application_id": str(application.id)},
        )
        return HandlerResult(
            detail=f"resume attached ({pages}); queued for a browser",
            follow_ups=(follow,),
        )

    # ------------------------------------------------------------- backups

    @target.register(TaskType.BACKUP_DATABASE)
    def backup_database(session: Session, task: ScheduledTask) -> HandlerResult:
        """Encrypted ``pg_dump`` to the data volume (§24.1).

        Encrypted with the application key, because a backup is a copy of every
        locked fact the user owns — their address, their citizenship, their
        demographic answers — and an unencrypted one on disk is the same data
        with the protections removed.
        """
        from app.services.backup import backup_database as run

        result = run(config, now=run_clock())
        return HandlerResult(detail=result.summary())

    @target.register(TaskType.BACKUP_ARTIFACTS)
    def backup_artifacts(session: Session, task: ScheduledTask) -> HandlerResult:
        """Archive resumes and screenshots (§24.2)."""
        from app.services.backup import backup_artifacts as run

        result = run(config, now=run_clock())
        return HandlerResult(detail=result.summary())

    return target


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


def _cannot_start_application(
    session: Session, job: Job, settings: Settings, *, now: datetime
) -> str:
    """Why this job must not become an application yet, or "" if it may.

    Three ceilings, all of them about blast radius rather than about fit. The
    daily one is counted on ``created_at`` rather than on submissions, because
    the thing worth capping is how much work the system starts on its own — an
    application that stops at NEEDS_ME still cost the user attention.
    """
    if session.scalars(
        select(Application.id)
        .where(Application.job_id == job.id)
        .where(Application.status.not_in(_ABANDONED))
        .limit(1)
    ).first():
        return "an application for this job already exists"

    start = datetime.combine(
        now.astimezone(settings.timezone).date(),
        time.min,
        tzinfo=settings.timezone,
    )
    started_today = (
        session.scalar(select(func.count(Application.id)).where(Application.created_at >= start))
        or 0
    )
    if started_today >= settings.max_prepared_applications_per_day:
        return f"today's cap of {settings.max_prepared_applications_per_day} is reached"

    if job.company_id is not None:
        active = (
            session.scalar(
                select(func.count(Application.id))
                .join(Job, Job.id == Application.job_id)
                .where(Job.company_id == job.company_id)
                .where(Application.status.not_in(_ABANDONED))
            )
            or 0
        )
        if active >= settings.max_active_applications_per_company:
            return (
                f"this employer already has {active} active application(s), "
                f"the limit is {settings.max_active_applications_per_company}"
            )

    return ""


#: Applications that no longer hold a job or a company slot.
_ABANDONED = (ApplicationState.SKIPPED, ApplicationState.FAILED)


def _score_next(job: Job) -> tuple[TaskType, str, dict[str, Any]]:
    return (
        TaskType.SCORE_JOB,
        idempotency_key(TaskType.SCORE_JOB, str(job.id)),
        {"job_id": str(job.id)},
    )
