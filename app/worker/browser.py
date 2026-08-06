"""The browser worker: fill the form, then submit it or hand it over.

Runs inside the browser container. It is an ordinary worker — same queue, same
lease, same retry rules — that additionally owns a Chromium instance, plus a
small health endpoint for the container healthcheck.

This is the only file in the system that can cause an employer to receive an
application, and the only irreversible thing it does is one click. Everything
around that click is arranged so the click is the *last* step and the easiest one
to refuse: the form is filled first, every required answer is checked against a
locked fact, :func:`app.safety.assert_safe_to_submit` gets a veto, and in dry-run
mode the control is located and photographed but never pressed.

A refusal is not a failure. It moves the application to ``NEEDS_ME`` with a
sentence the user can act on, and they finish it in their own browser.
"""

from __future__ import annotations

import logging
import os
import threading
import uuid
from datetime import datetime, time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db.models import Application, ApplicationField, Job, ResumeVersion, ScheduledTask
from app.domain.states import ApplicationState, assert_transition
from app.domain.tasks import TaskType
from app.safety import SubmitRefused, assert_safe_to_submit
from app.services import audit
from app.services import candidate as facts
from app.worker.runtime import (
    HandlerResult,
    PermanentFailure,
    Registry,
    Worker,
    run_clock,
)

__all__ = ["main", "register_browser_handlers"]

log = logging.getLogger(__name__)

WORKER_NAME = os.environ.get("SLOT_NAME", "browser-1")
HEALTH_PORT = int(os.environ.get("HEALTH_PORT", "7080"))

POLL_SECONDS = 15.0


# ------------------------------------------------------------------ health


class _Health(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *args: Any) -> None:  # keep the access log quiet
        return


def _serve_health() -> None:
    HTTPServer(("0.0.0.0", HEALTH_PORT), _Health).serve_forever()  # noqa: S104


# ------------------------------------------------------------------ handler


def register_browser_handlers(
    into: Registry | None = None, *, settings: Settings | None = None
) -> Registry:
    """Register the handlers that need a browser."""
    target = into if into is not None else Registry()
    config = settings or get_settings()

    @target.register(TaskType.SUBMIT_APPLICATION)
    def submit(session: Session, task: ScheduledTask) -> HandlerResult:
        """Open the form, fill what the locked facts cover, and submit it.

        Ends in exactly one of two places. ``SUBMITTED`` means the employer's own
        page confirmed it. ``NEEDS_ME`` means everything else, always with a
        reason: a question no locked fact answers, a CAPTCHA, the daily cap, a
        dry run, or a click that went through without the page ever saying so.
        """
        from app.ats.driver import extract_form, fill_form, submit_form
        from app.ats.fields import resolve

        now = run_clock()
        raw = (task.payload or {}).get("application_id")
        if not isinstance(raw, str):
            raise PermanentFailure("task payload has no application_id")

        application = session.get(Application, uuid.UUID(raw))
        if application is None:
            raise PermanentFailure("application no longer exists")
        if application.status != ApplicationState.BROWSER_QUEUED:
            raise PermanentFailure(f"expected BROWSER_QUEUED, found {application.status}")

        application.status = assert_transition(
            ApplicationState(application.status), ApplicationState.BROWSER_FILLING
        )

        stored = {f.key: f.value for f in facts.list_facts(session)}
        locked = frozenset(f.key for f in facts.list_facts(session) if f.is_locked)
        job = session.get(Job, application.job_id)
        resume = (
            session.get(ResumeVersion, application.resume_version_id)
            if application.resume_version_id
            else None
        )

        with _page(config, application.application_url) as page:
            specs = extract_form(page)
            # Both are computed once for the whole form. ``_drafts`` makes a
            # network call, and putting it inside the comprehension would make
            # one per field on the page.
            derived = _derived(job, stored)
            drafts = _drafts(specs, job, resume, stored, config)
            answers = [
                resolve(
                    spec,
                    facts=stored,
                    locked_keys=locked,
                    derived=derived,
                    ai_answers=drafts,
                )
                for spec in specs
            ]
            report = fill_form(
                page,
                specs,
                answers,
                resume_path=Path(resume.pdf_path) if resume else None,
            )
            _screenshot(page, config, application.id, "pre-submit")

            try:
                assert_safe_to_submit(
                    enabled=config.auto_submit_enabled,
                    dry_run=config.auto_submit_dry_run,
                    blocked=report.blocked,
                    block_reason=report.block_reason,
                    captcha_detected=report.captcha_detected,
                    resume_attached=report.resume_uploaded is not None or resume is None,
                    submitted_today=_submitted_today(session, config, now=now),
                    daily_cap=config.max_auto_submits_per_day,
                )
            except SubmitRefused as refusal:
                _record_fields(session, application, specs, answers)
                _mark_resume_uploaded(session, application, report, now=now)
                _hand_over(
                    session,
                    application,
                    reason=str(refusal),
                    missing=list(report.blocking_questions),
                    now=now,
                )
                return HandlerResult(detail=f"yours to finish: {refusal}")

            outcome = submit_form(page, dry_run=config.auto_submit_dry_run)
            _record_fields(session, application, specs, answers)
            _mark_resume_uploaded(session, application, report, now=now)

            if outcome.dry_run:
                # Deliberately not SUBMITTED. The row would otherwise be
                # indistinguishable from a real one on the dashboard, and the
                # whole point of a dry run is that the user can look at what the
                # machine was about to do.
                application.was_dry_run = True
                _hand_over(
                    session,
                    application,
                    reason=(
                        "dry run: every required question was answered and this would have "
                        "been submitted. Turn off AUTO_SUBMIT_DRY_RUN, or apply yourself."
                    ),
                    missing=[],
                    now=now,
                )
                return HandlerResult(detail="dry run: would have submitted")

            verdict = outcome.verdict
            if verdict is None or not verdict.submitted:
                _screenshot(page, config, application.id, "after-submit")
                # A click we could not read the result of is the dangerous case:
                # the application may well be in, so the message has to stop the
                # user from cheerfully submitting a second one.
                said = verdict.reason if verdict is not None else outcome.reason
                _hand_over(
                    session,
                    application,
                    reason=(
                        "Submit was clicked but the page never confirmed it — check your "
                        f"email before applying again ({said})."
                    ),
                    missing=[],
                    now=now,
                )
                return HandlerResult(detail=f"unconfirmed: {said}")

            _screenshot(page, config, application.id, "confirmation")
            application.confirmation_data = {
                "reason": verdict.reason,
                "signals": [s.name for s in verdict.signals],
                "control": outcome.control,
                "url": outcome.observation.url_after if outcome.observation else "",
            }

        _move(
            session,
            application,
            ApplicationState.SUBMITTED,
            reason=verdict.reason,
            confidence=verdict.confidence,
        )
        application.submitted_at = now
        application.submission_detection_method = verdict.method.value
        application.submission_confidence = verdict.confidence
        return HandlerResult(
            detail=f"submitted ({verdict.reason}), {len(report.filled)} field(s) filled"
        )

    return target


# ------------------------------------------------------------------ answers


def _derived(job: Job | None, stored: dict[str, Any]) -> dict[str, Any]:
    """Answers computed from this posting rather than stored on the profile.

    Only the term so far. "Which term are you applying for" is a question about
    the role, so the posting's own season wins — a Fall 2027 posting is answered
    "Fall 2027" even though the user's standing answer is Summer 2027. The
    standing answer covers the common case, where the title says "Intern" and
    nothing else.
    """
    from app.domain.normalization import season_label

    term = season_label(job.season) if job is not None else None
    term = term or stored.get("logistics.default_term")
    return {"logistics.term": term} if term else {}


def _drafts(
    specs: list[Any],
    job: Job | None,
    resume: ResumeVersion | None,
    stored: dict[str, Any],
    settings: Settings,
) -> dict[str, str]:
    """Draft the free-text answers this form actually asks for.

    Gated on the question being present, which is the whole cost control: most
    forms never ask, and a model call per application regardless would spend the
    free tier on paragraphs nobody reads. A failure returns nothing and the field
    goes to the user — see :mod:`app.services.why_company`.
    """
    from app.ats.fields import classify
    from app.services.why_company import Posting, draft_why_company

    if job is None or not any(classify(spec) == "open.why_company" for spec in specs):
        return {}

    company = job.company.canonical_name if job.company is not None else ""
    paragraph = draft_why_company(
        Posting(
            company=company,
            title=job.title,
            description=job.description_text or "",
            location=job.location_text or "",
        ),
        resume_text=_resume_source(resume),
        about=_about(stored),
        settings=settings,
    )
    return {"open.why_company": paragraph} if paragraph else {}


def _about(stored: dict[str, Any]) -> str:
    """A one-line profile summary for the draft prompt.

    Only the facts that belong in a paragraph about wanting a job. Nothing from
    the legally sensitive set goes near the model, whatever the profile holds.
    """
    wanted = (
        ("education.school", "School"),
        ("education.degree", "Degree"),
        ("education.major", "Major"),
        ("education.graduation_date", "Graduating"),
    )
    return "; ".join(f"{label}: {stored[key]}" for key, label in wanted if stored.get(key))


def _resume_source(resume: ResumeVersion | None) -> str:
    """The résumé as text, or an empty string. Never a reason to fail."""
    if resume is None:
        return ""
    try:
        return Path(resume.source_path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        log.info("could not read the resume source for drafting; continuing without it")
        return ""


# ------------------------------------------------------------------ helpers


def _hand_over(
    session: Session,
    application: Application,
    *,
    reason: str,
    missing: list[str],
    now: datetime,
) -> None:
    """Stop, and tell the user what is left to do.

    The reason is written for a person reading a dashboard, not for a log. It is
    the only thing standing between them and an application they have no idea why
    the machine did not finish.
    """
    _move(session, application, ApplicationState.NEEDS_ME, reason=reason)
    application.needs_me_at = now
    application.needs_me_reason = reason
    application.missing_fields = missing


def _move(
    session: Session,
    application: Application,
    target: ApplicationState,
    **context: Any,
) -> None:
    was = str(application.status)
    application.status = assert_transition(ApplicationState(application.status), target)
    audit.transition(
        session,
        application,
        entity_type="application",
        was=was,
        now=str(target),
        actor_id=WORKER_NAME,
        **context,
    )


def _submitted_today(session: Session, settings: Settings, *, now: datetime) -> int:
    """How many applications this system has already sent today.

    Counted off ``submitted_at`` in the business timezone, so the cap resets when
    the user's day does rather than at UTC midnight.
    """
    start = datetime.combine(
        now.astimezone(settings.timezone).date(), time.min, tzinfo=settings.timezone
    )
    return (
        session.scalar(
            select(func.count(Application.id))
            .where(Application.submitted_at >= start)
            .where(Application.was_dry_run.is_(False))
        )
        or 0
    )


def _mark_resume_uploaded(
    session: Session, application: Application, report: Any, *, now: datetime
) -> None:
    """Record which resume version reached the form, if one did.

    Records nothing when the browser did not confirm the file is on the input.
    "We produced a PDF" and "the employer has the PDF" are different claims, and
    only the second one belongs on the Resume Versions screen.
    """
    from app.services.resume_artifacts import mark_uploaded

    uploaded = getattr(report, "resume_uploaded", None)
    if uploaded is None:
        reason = getattr(report, "resume_unconfirmed", "")
        if reason:
            log.warning(
                "application %s: resume not confirmed on the form (%s); "
                "left as selected, not uploaded",
                application.id,
                reason,
            )
        return
    mark_uploaded(session, application=application, path=Path(uploaded), now=now)


def _record_fields(
    session: Session, application: Application, specs: list[Any], answers: list[Any]
) -> None:
    """Store every question and its answer, with where the answer came from.

    This is what the system sent, kept as evidence. After an auto-submission it
    is the only record of what the employer was told, so it is written whether
    the submission happened or not.
    """
    session.query(ApplicationField).filter(
        ApplicationField.application_id == application.id,
    ).delete()

    for index, (spec, answer) in enumerate(zip(specs, answers, strict=True)):
        session.add(
            ApplicationField(
                application_id=application.id,
                semantic_key=answer.semantic_key,
                page_index=index,
                question_text=spec.question_text or spec.name or "(unlabelled)",
                field_type=str(spec.field_type),
                answer_json={"value": answer.value} if answer.value is not None else None,
                source_type=str(answer.source_type),
                source_fact_ids=list(answer.fact_ids),
                required=bool(spec.required),
                manual_required=bool(answer.needs_human),
            )
        )


def _page(settings: Settings, url: str) -> Any:
    """Open ``url`` in a fresh context. A context manager so the page always closes.

    Headless now that nobody watches it work. Each application gets a clean
    context: no cookies survive between employers, which is both the private
    thing to do and the reason one employer's session cannot leak into another's
    form.
    """
    from contextlib import contextmanager

    @contextmanager
    def opened() -> Any:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1400, "height": 860})
            page = context.new_page()
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=45_000)
                yield page
            finally:
                context.close()
                browser.close()

    return opened()


def _screenshot(page: Any, settings: Settings, application_id: uuid.UUID, label: str) -> None:
    """Photograph the form at a moment that cannot be reconstructed later.

    Best effort: a screenshot that fails must not cost a filled form. But the
    pre-submit one is the user's only way to see what was actually sent, so a
    failure is logged loudly rather than swallowed.
    """
    try:
        directory = settings.artifacts_dir / str(application_id)
        directory.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(directory / f"{label}.png"), full_page=True)
    except Exception:  # pragma: no cover - depends on the page
        log.warning("could not capture the %s screenshot", label, exc_info=True)


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s"
    )
    settings = get_settings()

    threading.Thread(target=_serve_health, daemon=True, name="health").start()
    log.info(
        "%s: health on :%d, auto-submit %s%s",
        WORKER_NAME,
        HEALTH_PORT,
        "on" if settings.auto_submit_enabled else "off",
        " (dry run)" if settings.auto_submit_dry_run else "",
    )

    from app.db.session import get_sessionmaker

    worker = Worker(
        session_factory=get_sessionmaker(),
        worker_id=WORKER_NAME,
        registry=register_browser_handlers(settings=settings),
        task_types=[TaskType.SUBMIT_APPLICATION],
        poll_interval=POLL_SECONDS,
    )
    worker.install_signal_handlers()
    worker.run_forever()
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
