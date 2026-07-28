"""One browser slot: fill forms, never submit (spec §15, §7.8, §7.9).

Runs inside the browser container. It is an ordinary worker — same queue, same
lease, same retry rules — that additionally owns a Chromium instance and a
heartbeat, plus a small health endpoint for the container healthcheck.

The one thing this file must never do is press Submit. That is not enforced by
care: :func:`app.ats.driver.fill_form` has no submit path, the state machine has
no edge from ``BROWSER_FILLING`` to ``SUBMITTED``, and
:func:`app.safety.assert_safe_to_review` is called before the page is handed to
the user.
"""

from __future__ import annotations

import logging
import os
import threading
import uuid
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db.models import (
    Application,
    ApplicationField,
    BrowserSession,
    ResumeVersion,
    ScheduledTask,
)
from app.domain.states import (
    HUMAN_GATED_APPLICATION_STATES,
    ApplicationState,
    BrowserSlotState,
    assert_transition,
)
from app.domain.tasks import TaskType
from app.safety import assert_safe_to_review
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

SLOT_NAME = os.environ.get("SLOT_NAME", "slot-1")
HEALTH_PORT = int(os.environ.get("HEALTH_PORT", "7080"))
NOVNC_PORT = int(os.environ.get("NOVNC_PORT", "6080"))

#: Written every pass. A slot claiming to be working with a stale heartbeat is a
#: crashed slot, and the dashboard says so (§9.1, §22.1).
HEARTBEAT = timedelta(seconds=30)

#: States a slot may legitimately be in when the user takes over. Derived from
#: the state machine rather than restated, so the two cannot drift apart.
PRE_SUBMIT_STATES = frozenset(s.value for s in HUMAN_GATED_APPLICATION_STATES)


# ------------------------------------------------------------------ health


class _Health(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self.send_response(200 if self.path == "/health" else 404)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok" if self.path == "/health" else b"not found")

    def log_message(self, *_: Any) -> None:
        """Silence per-request logging. A healthcheck every 30s would otherwise
        be the only thing in the slot's log."""


def _serve_health() -> None:
    HTTPServer(("0.0.0.0", HEALTH_PORT), _Health).serve_forever()  # noqa: S104


# ------------------------------------------------------------------ slot


def _slot_row(session: Session, *, now: datetime) -> BrowserSession:
    """The open session row for this slot, created if absent."""
    row = session.scalars(
        select(BrowserSession)
        .where(BrowserSession.slot_name == SLOT_NAME)
        .where(BrowserSession.ended_at.is_(None))
    ).first()
    if row is None:
        row = BrowserSession(slot_name=SLOT_NAME, status=BrowserSlotState.IDLE)
        session.add(row)
        session.flush()
    row.heartbeat_at = now
    return row


def register_browser_handlers(
    into: Registry | None = None, *, settings: Settings | None = None
) -> Registry:
    """Register the handlers that need a browser."""
    target = into if into is not None else Registry()
    config = settings or get_settings()

    @target.register(TaskType.PREPARE_APPLICATION)
    def fill(session: Session, task: ScheduledTask) -> HandlerResult:
        """Open the form, fill what policy allows, and stop.

        Ends in one of three states, all of which wait for a person:
        ``READY_FOR_REVIEW`` when everything resolved, ``MANUAL_FIELD_REQUIRED``
        when something needs the user, or ``MANUAL_LOGIN_REQUIRED`` when the page
        wants credentials or shows a challenge.
        """
        from app.ats.driver import extract_form, fill_form
        from app.ats.fields import resolve

        now = run_clock()
        raw = (task.payload or {}).get("application_id")
        if not isinstance(raw, str):
            raise PermanentFailure("task payload has no application_id")

        application = session.get(Application, uuid.UUID(raw))
        if application is None:
            raise PermanentFailure("application no longer exists")
        if application.status != ApplicationState.BROWSER_QUEUED:
            raise PermanentFailure(
                f"expected BROWSER_QUEUED, found {application.status}"
            )

        slot = _slot_row(session, now=now)
        slot.status = assert_transition(
            BrowserSlotState(slot.status), BrowserSlotState.ALLOCATING
        )
        slot.application_id = application.id
        slot.started_at = now
        slot.expires_at = now + timedelta(hours=config.live_session_ttl_hours)
        application.browser_slot_id = SLOT_NAME
        application.status = assert_transition(
            ApplicationState(application.status), ApplicationState.BROWSER_FILLING
        )
        slot.status = assert_transition(BrowserSlotState(slot.status), BrowserSlotState.FILLING)

        stored = {f.key: f.value for f in facts.list_facts(session)}
        locked = frozenset(f.key for f in facts.list_facts(session) if f.is_locked)
        resume = (
            session.get(ResumeVersion, application.resume_version_id)
            if application.resume_version_id
            else None
        )

        with _page(config, application.application_url) as page:
            specs = extract_form(page)
            answers = [resolve(spec, facts=stored, locked_keys=locked) for spec in specs]
            report = fill_form(
                page,
                specs,
                answers,
                resume_path=Path(resume.pdf_path) if resume else None,
            )
            _screenshot(page, config, application.id, "pre-submit")

        # Recorded before the state changes, so the review screen has something
        # to show even if the transition below is refused.
        _record_fields(session, application, specs, answers)

        if report.captcha_detected:
            # Never attempted, never outsourced, never worked around.
            application.status = assert_transition(
                ApplicationState(application.status), ApplicationState.MANUAL_LOGIN_REQUIRED
            )
            slot.status = assert_transition(
                BrowserSlotState(slot.status), BrowserSlotState.MANUAL_LOGIN
            )
            return HandlerResult(detail="a challenge is present; handing over to you")

        if report.needs_human:
            application.status = assert_transition(
                ApplicationState(application.status), ApplicationState.MANUAL_FIELD_REQUIRED
            )
            slot.status = assert_transition(
                BrowserSlotState(slot.status), BrowserSlotState.LIVE_REVIEW
            )
            return HandlerResult(
                detail=f"{len(report.skipped_manual) + len(report.not_found)} field(s) need you"
            )

        application.status = assert_transition(
            ApplicationState(application.status), ApplicationState.READY_FOR_REVIEW
        )
        application.ready_for_review_at = now
        slot.status = assert_transition(
            BrowserSlotState(slot.status), BrowserSlotState.LIVE_REVIEW
        )
        # §29: the last check before a live browser is handed to the user. It has
        # never fired and is not expected to; that is the point of a guard.
        assert_safe_to_review(
            has_clicked_submit=False,
            application_status=str(application.status),
            allowed_pre_submit_states=PRE_SUBMIT_STATES,
        )
        return HandlerResult(detail=f"{len(report.filled)} field(s) filled; ready for you")

    return target


def _record_fields(
    session: Session, application: Application, specs: list[Any], answers: list[Any]
) -> None:
    """Store every question and its answer, with where the answer came from.

    The source is the audit trail the review screen renders; without it the user
    cannot tell a locked fact from a model's guess (§7.8, §22.4).
    """
    session.query(ApplicationField).filter(
        ApplicationField.application_id == application.id,
        ApplicationField.user_overridden.is_(False),
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
    """Open ``url`` in a fresh context. A context manager so the page always closes."""
    from contextlib import contextmanager

    @contextmanager
    def opened() -> Any:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=False)
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
    """Capture the filled form before a human sees it (§7.9).

    Best effort: a screenshot that fails must not lose a filled form.
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
    log.info("slot %s: health on :%d, noVNC on :%d", SLOT_NAME, HEALTH_PORT, NOVNC_PORT)

    from app.db.session import get_sessionmaker

    worker = Worker(
        session_factory=get_sessionmaker(),
        worker_id=SLOT_NAME,
        registry=register_browser_handlers(settings=settings),
        # One slot fills one form at a time; there is nothing else it can claim.
        task_types=[TaskType.PREPARE_APPLICATION],
        poll_interval=HEARTBEAT.total_seconds(),
    )
    worker.install_signal_handlers()

    with get_sessionmaker()() as session:
        _slot_row(session, now=datetime.now(UTC))
        session.commit()

    worker.run_forever()
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
