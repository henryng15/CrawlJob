"""Task handlers: the pipeline the worker actually runs (spec §16.2).

Each handler does one stage and enqueues the next, so the pipeline is described by
what each stage hands on rather than by a controller that knows all of it. A
stage's work and its fan-out commit in the same transaction (see
``Worker._execute``), which is what makes "enqueue the next step" safe: there is
no state where the work happened but the follow-up was lost.

Two stages are deliberately absent from this module:

* **Browser work** (``PREPARE_APPLICATION``, ``REPLAY_APPLICATION``) lives in the
  browser worker, which registers its own handlers. A web worker that tried them
  would have no Chromium. Exactly one process owns each task type — two handlers
  for one type means whichever worker claims it first decides whether the task
  makes sense.
* **Sending anything.** ``CREATE_GMAIL_DRAFT`` writes a draft; nothing here sends
  it, and nothing here submits a form.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from enum import StrEnum
from functools import lru_cache
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db.models import (
    Application,
    BatchState,
    Company,
    Job,
    LLMBatch,
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
from app.services import audit
from app.services import candidate as facts
from app.services.eligibility import Verdict
from app.services.filters import screen
from app.services.hooks import Hook, HookType, SourceDocument, compose_email, generate_hook
from app.services.llm.base import LLMError, LLMProvider, Task, TokenCounts, Usage
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
    """The process-wide provider, with a budget that survives a restart.

    Cached because the ledger's in-memory total is the hot path: rebuilding the
    provider per task would re-read the month's spend before every classification
    and put the database in front of every model call.
    """
    return _cached_provider(settings)


@lru_cache(maxsize=1)
def _cached_provider(settings: Settings) -> LLMProvider:
    from app.db.session import get_sessionmaker
    from app.services.llm.anthropic import build_provider as _build
    from app.services.llm.ledger import load_ledger

    return _build(settings, budget=load_ledger(get_sessionmaker(), settings))


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


def _move(
    obj: Any, target: StrEnum, *, session: Session | None = None, **context: Any
) -> None:
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
        #
        # Deduplication has already happened during ingest: an exact duplicate
        # never became a row of its own, and a probable one carries
        # DUPLICATE_PROBABLE and so is not selected here. That is the first of
        # the four pre-spend filters; the other three run just below.
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
                # Rejected before a model is called and before the job can take
                # one of the day's prepared-application slots. The row stays,
                # with its reason, so the user can see what was turned away.
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
            follow_ups.append(
                (
                    TaskType.ANALYZE_SPONSORSHIP,
                    idempotency_key(TaskType.ANALYZE_SPONSORSHIP, str(job.id)),
                    {"job_id": str(job.id)},
                )
            )

        detail = "; ".join(_summarise(r) for r in reports) if reports else "nothing fetched"
        if screened_out:
            detail += f"; {screened_out} screened out before spend"
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
            _move(
                job,
                JobState.ELIGIBILITY_REJECTED,
                session=session,
                reason=analysis.classification.value,
            )
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

    @target.register(TaskType.TAILOR_RESUME)
    def tailor_resume(session: Session, task: ScheduledTask) -> HandlerResult:
        """Tailor the resume, or refuse (§7.7).

        Three ways this stops rather than producing something:

        * no verified facts — nothing to cite, so nothing may be written;
        * validation fails twice — an unsupported claim blocks, it does not
          degrade into a weaker bullet;
        * no base resume — there is nothing to tailor.

        Each leaves a message naming what the user has to do.

        The model call happens here; everything after it — validation, the LaTeX
        build, the artifacts, the rows — is :func:`tailoring.apply_plan`, the
        same function the batch path calls. There is one way an application gets
        a resume, and this is not a second one.
        """
        from app.services import tailoring
        from app.services.resume import tailor
        from app.services.resume_import import load_facts, unverified

        now = run_clock()
        application = _require(
            session.get(Application, _payload_uuid(task, "application_id")), "application"
        )
        job = _require(session.get(Job, application.job_id), "job")

        available = load_facts(session)
        if not available:
            waiting = unverified(session)
            raise PermanentFailure(
                f"{len(waiting)} resume fact(s) are waiting for you to confirm in Settings"
                if waiting
                else "no resume facts are stored; run: internship-ops import-resume <file>"
            )

        source = tailoring.base_resume_source(config)
        if source is None:
            raise PermanentFailure(
                "no base resume is configured; set BASE_RESUME_TEX to your .tex file"
            )

        # The model is asked to edit *these* bullets, by id, and the version they
        # came from is pinned before the call. The window is small here — one
        # handler, two reads of the same file — but it is not zero, and a plan
        # applied to a resume it was not planned against is exactly the failure the
        # pin exists to stop.
        application.base_tex_sha256 = source.sha256
        plan, _ = tailor(
            facts=available,
            job_title=job.title,
            job_description=job.description_text or "",
            provider=provider_factory(config),
            bullets=source.inventory(),
        )

        output = tailoring.apply_plan(
            session,
            config,
            application=application,
            job=job,
            plan=plan,
            facts=available,
            now=now,
            model=config.llm_writing_model,
            pinned_sha256=source.sha256,
        )
        if not output.ok:
            raise PermanentFailure(output.blocked_reason or "the resume could not be built")

        # Materials are the last thing this worker can do; the form itself needs
        # a browser. Walking the states here rather than in a second handler
        # keeps one owner per task type — two handlers for PREPARE_APPLICATION,
        # one per process, meant whichever worker claimed it first decided
        # whether the task made sense.
        if application.status == ApplicationState.CREATED:
            _move(application, ApplicationState.MATERIALS_PREPARING, session=session)
        if application.status == ApplicationState.MATERIALS_PREPARING:
            _move(application, ApplicationState.MATERIALS_READY, session=session)
        if application.status == ApplicationState.MATERIALS_READY:
            _move(application, ApplicationState.BROWSER_QUEUED, session=session)

        follow = (
            TaskType.PREPARE_APPLICATION,
            idempotency_key(TaskType.PREPARE_APPLICATION, str(application.id)),
            {"application_id": str(application.id)},
        )
        return HandlerResult(
            detail=f"{output.detail()}; queued for a browser",
            follow_ups=(follow,),
        )

    # ------------------------------------------------------ batch tailoring

    @target.register(TaskType.SUBMIT_TAILORING_BATCH)
    def submit_tailoring_batch(session: Session, task: ScheduledTask) -> HandlerResult:
        """Send the day's tailoring to the Batch API at half price (§7.7, §26.2).

        Idempotent by way of a stored row: if this dedupe key already has a batch,
        that batch is adopted and nothing is submitted again. The window this
        closes is real — the API accepts the batch, the worker is killed before
        the transaction commits, the task is retried, and without the row the
        user pays twice.
        """
        from app.services import tailoring
        from app.services.llm.batch import check_affordable
        from app.services.llm.batch_client import AnthropicBatchClient
        from app.services.resume import SYSTEM_PROMPT, TailoringPlan
        from app.services.resume_import import load_facts

        now = run_clock()
        dedupe_key = str((task.payload or {}).get("dedupe_key") or task.dedupe_key)

        existing = session.scalars(
            select(LLMBatch).where(LLMBatch.dedupe_key == dedupe_key)
        ).first()
        if existing is not None:
            return HandlerResult(
                detail=f"batch {existing.provider_batch_id or existing.id} already submitted",
                follow_ups=_poll_follow_up(existing, task),
            )

        provider = provider_factory(config)
        # §26.2's ladder, applied before anything is selected: OK and WARNING
        # tailor the day's whole quota, RESTRICTED tailors only the best few,
        # EXHAUSTED tailors nothing and the pipeline continues without a model.
        limit = provider.budget.tailoring_limit(config.max_prepared_applications_per_day)
        if limit <= 0:
            return HandlerResult(
                detail=(
                    f"budget {provider.budget.state.value.lower()} "
                    f"(${provider.budget.spent_usd:.2f} of "
                    f"${provider.budget.monthly_cap_usd:.2f}); nothing tailored"
                )
            )

        applications = _applications_awaiting_tailoring(session, task, limit=limit)
        if not applications:
            return HandlerResult(detail="nothing to tailor")

        facts = load_facts(session)
        if not facts:
            raise PermanentFailure(
                "no resume facts are stored; run: internship-ops import-resume <file>"
            )

        source = tailoring.base_resume_source(config)
        if source is None:
            raise PermanentFailure(
                "no base resume is configured; set BASE_RESUME_TEX to your .tex file"
            )
        # Every request in the batch names the same bullets, because they are all
        # edits to the same resume. Parsed once, and pinned: results come back up
        # to a day later, by which time the canonical resume may have been edited.
        inventory = source.inventory()

        requests = []
        pinned: list[Application] = []
        for application in applications:
            job = session.get(Job, application.job_id)
            if job is None:
                continue
            requests.append(
                tailoring.batch_request_for(application, job, facts, bullets=inventory)
            )
            pinned.append(application)
        if not requests:
            return HandlerResult(detail="nothing to tailor")

        pricing = provider.pricing.get(config.llm_writing_model)
        # Before a single token is sent. A batch cannot be un-submitted, so a cap
        # checked afterwards is a cap that has already been broken.
        estimate = check_affordable(provider.budget, requests, pricing)

        batch = LLMBatch(
            dedupe_key=dedupe_key,
            model=config.llm_writing_model,
            custom_ids=[item.custom_id for item in requests],
            estimated_cost_usd=estimate,
            submitted_at=now,
            base_tex_sha256=source.sha256,
        )
        session.add(batch)
        # On the applications as well as the batch. The batch's pin is what the
        # poll checks; the application's survives the batch being abandoned, so a
        # later run can still tell what this application was last planned against.
        for application in pinned:
            application.base_tex_sha256 = source.sha256
        # Flushed before the network call so the unique index rejects a second
        # worker racing for the same key rather than both of them submitting.
        session.flush()

        if config.anthropic_api_key is None:
            raise PermanentFailure("batch tailoring needs ANTHROPIC_API_KEY")
        client = AnthropicBatchClient(api_key=config.anthropic_api_key.get_secret_value())
        batch.provider_batch_id = client.submit(
            requests,
            model=config.llm_writing_model,
            schema=TailoringPlan.model_json_schema(),
            system=tailoring.shared_system_blocks(SYSTEM_PROMPT),
        )

        audit.record(
            session,
            event_type="LLM_BATCH_SUBMITTED",
            entity_type="llm_batch",
            entity_id=batch.id,
            actor_type="WORKER",
            requests=len(requests),
            estimated_cost_usd=estimate,
            model=config.llm_writing_model,
        )
        return HandlerResult(
            detail=f"submitted {len(requests)} for tailoring (~${estimate:.2f})",
            follow_ups=_poll_follow_up(batch, task),
        )

    @target.register(TaskType.POLL_TAILORING_BATCH)
    def poll_tailoring_batch(session: Session, task: ScheduledTask) -> HandlerResult:
        """Collect a finished batch, or ask again later (§7.7).

        Outside the pipeline gate: this collects results that have already been
        paid for, so pausing after a submit must not throw the money away.
        """
        from app.services import tailoring
        from app.services.llm.batch import BatchRequest, is_stale, match_results
        from app.services.llm.batch_client import AnthropicBatchClient
        from app.services.resume import TailoringPlan
        from app.services.resume_import import load_facts

        now = run_clock()
        batch = _require(
            session.get(LLMBatch, _payload_uuid(task, "batch_id")), "batch"
        )
        if batch.state in {BatchState.APPLIED, BatchState.ABANDONED}:
            return HandlerResult(detail=f"batch already {batch.state.lower()}")
        if batch.provider_batch_id is None:
            raise PermanentFailure("batch row has no provider id; it was never submitted")

        if config.anthropic_api_key is None:
            raise PermanentFailure("batch tailoring needs ANTHROPIC_API_KEY")
        client = AnthropicBatchClient(api_key=config.anthropic_api_key.get_secret_value())

        status = client.status(batch.provider_batch_id)
        if not status.finished:
            if is_stale(
                batch.submitted_at or now,
                now=now,
                timeout_hours=config.llm_batch_timeout_hours,
            ):
                # Abandoning is a decision the user can see. Polling forever is
                # not, and the applications waiting on it never get prepared.
                batch.state = BatchState.ABANDONED
                batch.completed_at = now
                client.cancel(batch.provider_batch_id)
                return HandlerResult(
                    detail=f"batch abandoned after {config.llm_batch_timeout_hours}h"
                )
            return HandlerResult(
                detail=f"batch is {status.processing_status}",
                follow_ups=_poll_follow_up(batch, task),
            )

        outcome = client.results(batch.provider_batch_id)
        requests = [
            BatchRequest(custom_id=cid, messages=[])
            for cid in (batch.custom_ids or [])
        ]
        # By key. Never by position — the API finishes requests in whatever order
        # it likes, and zipping would hand one applicant another's resume.
        matched, missing = match_results(requests, outcome)

        facts = load_facts(session)

        applied = 0
        blocked: dict[str, str] = {}
        follow_ups: list[tuple[TaskType, str, dict[str, Any]]] = []
        for custom_id, payload in matched.items():
            application = session.get(Application, uuid.UUID(custom_id))
            if application is None:
                blocked[custom_id] = "the application no longer exists"
                continue
            job = session.get(Job, application.job_id)
            if job is None:
                blocked[custom_id] = "the job no longer exists"
                continue
            try:
                plan = TailoringPlan.model_validate(payload)
            except Exception:
                blocked[custom_id] = "the model returned a plan that does not parse"
                continue

            output = tailoring.apply_plan(
                session,
                config,
                application=application,
                job=job,
                plan=plan,
                facts=facts,
                now=now,
                model=batch.model,
                # The resume this batch's bullet ids were read from. Up to a day
                # may have passed; if the canonical file has been edited since,
                # these ids no longer address the sentences the model was shown,
                # and the plan is refused rather than applied to whatever is there
                # now.
                pinned_sha256=batch.base_tex_sha256,
            )
            if not output.ok:
                blocked[custom_id] = output.blocked_reason or "blocked"
                continue
            applied += 1
            follow_ups.extend(_queue_for_browser(session, application))

        batch.state = BatchState.APPLIED
        batch.completed_at = now
        batch.input_tokens = outcome.input_tokens
        batch.output_tokens = outcome.output_tokens
        provider = provider_factory(config)
        pricing = provider.pricing.get(batch.model)
        batch.actual_cost_usd = outcome.cost(pricing)
        # Charged from the usage that came back, not from the estimate: the cap
        # must track what was billed. Recorded with its detail so the month can
        # be broken down by task rather than being one opaque number.
        provider.budget.charge(
            batch.actual_cost_usd or 0.0,
            Usage(
                model=batch.model,
                task=Task.RESUME_PLAN,
                tokens=TokenCounts(
                    input_tokens=outcome.input_tokens,
                    output_tokens=outcome.output_tokens,
                ),
                cost_usd=batch.actual_cost_usd or 0.0,
                batch=True,
            ),
        )
        batch.failures = {
            **{cid: reason for cid, reason in blocked.items()},
            **{cid: "no result returned" for cid in missing},
            **{cid: reason for cid, reason in outcome.errors.items()},
        }

        audit.record(
            session,
            event_type="LLM_BATCH_APPLIED",
            entity_type="llm_batch",
            entity_id=batch.id,
            actor_type="WORKER",
            applied=applied,
            failed=len(batch.failures),
            actual_cost_usd=batch.actual_cost_usd,
            estimated_cost_usd=batch.estimated_cost_usd,
        )
        detail = f"tailored {applied}"
        if batch.failures:
            detail += f", {len(batch.failures)} did not"
        return HandlerResult(detail=detail, follow_ups=tuple(follow_ups))

    # ------------------------------------------------------------ outreach

    @target.register(TaskType.SCHEDULE_OUTREACH)
    def schedule(session: Session, task: ScheduledTask) -> HandlerResult:
        """Create the outreach task, due two business days after submission (§8.1).

        With no ``application_id`` this is the periodic scan from §16.2: it finds
        submitted applications that have no outreach yet and fans out one task
        each. The scan exists because an application can become submitted without
        anything enqueuing outreach — a reconciliation, a restore, a row the user
        fixed by hand.
        """
        if "application_id" not in (task.payload or {}):
            return _scan_for_outreach(session)

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
        _move(
            outreach,
            OutreachState.READY_FOR_REVIEW,
            session=session,
            recruiter_email=recruiter.email,
            draft_id=record.draft_id,
        )

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

    @target.register(TaskType.RECONCILE_SUBMISSION)
    def reconcile_submission(session: Session, task: ScheduledTask) -> HandlerResult:
        """Decide what happened to applications waiting on confirmation (§7.10).

        The browser slot records what it *observed*; this decides what it *means*,
        so the judgement lives in one testable place rather than inside a page
        interaction. Ambiguity resolves to SUBMISSION_UNCERTAIN, never to
        SUBMITTED — a wrongly confirmed submission produces a recruiter email
        about an application that does not exist.
        """
        from app.ats.submission import detect

        now = run_clock()
        waiting = session.scalars(
            select(Application).where(
                Application.status == ApplicationState.SUBMISSION_PENDING_CONFIRMATION
            )
        ).all()

        confirmed = uncertain = 0
        for application in waiting:
            data = application.confirmation_data or {}
            verdict = detect(_observation_from(data))

            if verdict.submitted:
                _move(
                    application,
                    ApplicationState.SUBMITTED,
                    session=session,
                    method=verdict.method.value,
                    confidence=verdict.confidence,
                    signals=[s.name for s in verdict.signals],
                )
                application.submitted_at = now
                application.submission_detection_method = verdict.method.value
                application.submission_confidence = verdict.confidence
                confirmed += 1
                continue

            waited = now - (application.updated_at or now)
            if waited >= CONFIRMATION_GRACE:
                # Long enough that no further observation is coming. Asking the
                # user beats guessing.
                _move(application, ApplicationState.SUBMISSION_UNCERTAIN)
                uncertain += 1

        follow_ups = tuple(
            (
                TaskType.SCHEDULE_OUTREACH,
                idempotency_key(TaskType.SCHEDULE_OUTREACH, str(a.id)),
                {"application_id": str(a.id)},
            )
            for a in waiting
            if a.status == ApplicationState.SUBMITTED
        )
        return HandlerResult(
            detail=f"{confirmed} confirmed, {uncertain} left for you, {len(waiting)} examined",
            follow_ups=follow_ups,
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

        from app.services.backup import expire_artifacts

        # §23.6 is a promise the settings screen displays. Displaying it while
        # deleting nothing would make it a false one.
        deleted = expire_artifacts(config, now=now)
        total = sum(deleted.values())

        return HandlerResult(
            detail=f"closed {len(expired)} expired session(s), deleted {total} expired artifact(s)"
        )

    @target.register(TaskType.EXPIRE_PREPARED_APPLICATIONS)
    def expire_prepared(session: Session, task: ScheduledTask) -> HandlerResult:
        """Retire prepared applications the user did not act on (§7.9).

        Outside the pipeline gate on purpose: a paused instance prepares nothing
        new, but yesterday's queue must still stop claiming to be today's.
        """
        from app.services.expiry import expire_due

        expired = expire_due(session, now=run_clock(), actor_id="scheduler")
        if not expired:
            return HandlerResult(detail="nothing due")
        return HandlerResult(detail=f"expired {len(expired)} prepared application(s)")

    @target.register(TaskType.RESTORE_APPLICATION)
    def restore_application(session: Session, task: ScheduledTask) -> HandlerResult:
        """Check an expired application can come back, then hand it to a replay.

        Everything expensive — the browser slot, the form comparison, the upload —
        belongs to the replay handler, which already does exactly this job for a
        session that died. All this stage does is refuse the restores that cannot
        work, before one of the two slots is spent finding out.
        """
        from app.services.restore import (
            check_restorable,
            previous_human_state,
            replay_package_path,
        )

        application = _require(
            session.get(Application, _payload_uuid(task, "application_id")), "application"
        )
        # Cleared first: a reason left from a previous attempt would otherwise
        # still be on screen next to a restore that has since succeeded.
        application.restore_blocked_reason = None

        check = check_restorable(
            session,
            application,
            has_replay_package=replay_package_path(config, application.id) is not None,
        )
        if not check:
            _block_restore(session, application, check.reason)
            return HandlerResult(detail=f"restore blocked: {check.reason}")

        target_state = previous_human_state(session, application)
        _move(
            application,
            ApplicationState.READY_FOR_REPLAY,
            session=session,
            reason="restore requested",
            restore_target=target_state.value,
        )
        # Deliberately not touching ready_for_review_at: that column is what the
        # daily quota counts, and restoring work the user already had must not
        # cost them one of the day's thirty slots (§16.3).
        follow = (
            TaskType.REPLAY_APPLICATION,
            idempotency_key(
                TaskType.REPLAY_APPLICATION, str(application.id), "restore", str(task.id)
            ),
            {
                "application_id": str(application.id),
                "restore": True,
                "restore_target": target_state.value,
            },
        )
        return HandlerResult(detail=f"restoring to {target_state.value}", follow_ups=(follow,))

    return target


def _poll_follow_up(
    batch: LLMBatch, source: ScheduledTask
) -> tuple[tuple[TaskType, str, dict[str, Any]], ...]:
    """The next poll for ``batch``, keyed by the task that asked for it.

    The source task's id is what makes successive polls distinct. A wall-clock
    bucket does not: two polls inside one bucket produce the same key, the second
    is deduped against the first, and the chain stops — leaving a paid-for batch
    that is never collected.

    Keying on the source id also keeps a *retry* idempotent, which is the other
    half of the requirement: re-running one poll enqueues one successor, not two.
    """
    return (
        (
            TaskType.POLL_TAILORING_BATCH,
            idempotency_key(TaskType.POLL_TAILORING_BATCH, str(batch.id), str(source.id)),
            {"batch_id": str(batch.id)},
        ),
    )


def _applications_awaiting_tailoring(
    session: Session, task: ScheduledTask, *, limit: int
) -> list[Application]:
    """The applications this batch should tailor for, best first.

    An explicit list in the payload wins, so an operator can re-run one — but it
    is still trimmed to ``limit``, because the budget does not care who asked.

    Ordered by fit score descending, which is what makes the RESTRICTED tier
    meaningful: when only five may be tailored, they should be the five best
    roles rather than the five that happened to be discovered first.
    """
    if limit <= 0:
        return []

    raw = (task.payload or {}).get("application_ids")
    if isinstance(raw, list) and raw:
        found = [session.get(Application, uuid.UUID(str(r))) for r in raw]
        return [a for a in found if a is not None][:limit]

    return list(
        session.scalars(
            select(Application)
            .join(Job, Application.job_id == Job.id)
            .outerjoin(JobScoreRow, JobScoreRow.job_id == Job.id)
            .where(Application.resume_version_id.is_(None))
            .where(
                Application.status.in_(
                    [ApplicationState.CREATED, ApplicationState.MATERIALS_PREPARING]
                )
            )
            # NULLS LAST: an unscored application is not a zero-scoring one, but
            # it is not evidence of a good role either, so it queues behind.
            .order_by(JobScoreRow.total_score.desc().nullslast())
            .limit(limit)
        ).all()
    )


def _queue_for_browser(
    session: Session, application: Application
) -> list[tuple[TaskType, str, dict[str, Any]]]:
    """Walk a tailored application to BROWSER_QUEUED and queue the fill."""
    if application.status == ApplicationState.CREATED:
        _move(application, ApplicationState.MATERIALS_PREPARING, session=session)
    if application.status == ApplicationState.MATERIALS_PREPARING:
        _move(application, ApplicationState.MATERIALS_READY, session=session)
    if application.status == ApplicationState.MATERIALS_READY:
        _move(application, ApplicationState.BROWSER_QUEUED, session=session)
    return [
        (
            TaskType.PREPARE_APPLICATION,
            idempotency_key(TaskType.PREPARE_APPLICATION, str(application.id)),
            {"application_id": str(application.id)},
        )
    ]


def _block_restore(session: Session, application: Application, reason: str) -> None:
    """Record a refused restore on the row and in the audit trail."""
    was = str(application.status)
    application.restore_blocked_reason = reason
    _move(
        application,
        ApplicationState.RESTORE_BLOCKED,
        session=session,
        reason=reason,
        was_before_block=was,
    )


def with_suppressed_invalid_transition(obj: Any, target: Any) -> None:
    """Transition if the machine allows it; otherwise leave the status alone.

    Used only by cleanup, where the row is being closed anyway and the exact
    prior state does not change what happens next.
    """
    try:
        obj.status = assert_transition(type(target)(obj.status), target)
    except InvalidTransition:
        log.debug("slot %s left in %s during cleanup", getattr(obj, "id", "?"), obj.status)


#: How long an application may sit awaiting confirmation before the user is asked.
#: Long enough that a slow page is not mistaken for a lost one, short enough that
#: outreach for a real submission is not delayed by a day.
CONFIRMATION_GRACE = timedelta(hours=2)


def _observation_from(data: dict[str, Any]) -> Any:
    """Rebuild the slot's observation from what it stored.

    Deliberately tolerant: a slot that recorded fewer fields than a later version
    expects yields a *weaker* observation, and a weaker observation cannot produce
    a false confirmation — the defaults all point at "no evidence".
    """
    from app.ats.submission import Observation

    return Observation(
        url_before=str(data.get("url_before", "")),
        url_after=str(data.get("url_after", "")),
        text_after=str(data.get("text_after", "")),
        title_before=str(data.get("title_before", "")),
        title_after=str(data.get("title_after", "")),
        submit_button_present_before=bool(data.get("submit_button_present_before", True)),
        submit_button_present_after=bool(data.get("submit_button_present_after", True)),
        form_present_before=bool(data.get("form_present_before", True)),
        form_present_after=bool(data.get("form_present_after", True)),
        network=tuple((str(u), int(s)) for u, s in data.get("network", ())),
        errors_visible=bool(data.get("errors_visible", False)),
    )


def _scan_for_outreach(session: Session) -> HandlerResult:
    """Find submitted applications with no outreach task yet (§16.2)."""
    orphaned = session.scalars(
        select(Application.id)
        .outerjoin(OutreachTask, OutreachTask.application_id == Application.id)
        .where(Application.status == ApplicationState.SUBMITTED)
        .where(OutreachTask.id.is_(None))
        .limit(50)
    ).all()

    follow_ups = tuple(
        (
            TaskType.SCHEDULE_OUTREACH,
            idempotency_key(TaskType.SCHEDULE_OUTREACH, str(application_id)),
            {"application_id": str(application_id)},
        )
        for application_id in orphaned
    )
    return HandlerResult(
        detail=f"{len(orphaned)} application(s) need outreach scheduling",
        follow_ups=follow_ups,
    )


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
