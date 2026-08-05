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

import json
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
from app.services.expiry import set_deadline
from app.services.restore import replay_package_path
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
    """A session row this slot can start a fill from, created if absent.

    ``IDLE`` is the only state a fill can begin from, so an open row in any other
    state is finished work that was never closed — a slot that died mid-fill, or
    a row left behind by the version of this file that forgot to close them. It
    is retired here rather than reported, because there is nothing for a person
    to decide: the browser it referred to is long gone, and refusing to work
    until somebody clears the row by hand is how two applications a day became
    the ceiling.
    """
    row = session.scalars(
        select(BrowserSession)
        .where(BrowserSession.slot_name == SLOT_NAME)
        .where(BrowserSession.ended_at.is_(None))
    ).first()

    if row is not None and BrowserSlotState(row.status) is not BrowserSlotState.IDLE:
        log.info(
            "slot %s had an open session in %s; retiring it", SLOT_NAME, row.status
        )
        row.ended_at = now
        session.flush()
        row = None

    if row is None:
        row = BrowserSession(slot_name=SLOT_NAME, status=BrowserSlotState.IDLE)
        session.add(row)
        session.flush()
    row.heartbeat_at = now
    return row


def _release(slot: BrowserSession, *, into: BrowserSlotState, now: datetime) -> None:
    """Record how the fill ended, then close the session so the slot is free.

    A row per application, closed when its browser closes. Both halves matter.

    Closing it is what makes the *next* application possible. Without this the
    row stayed open in a terminal state, ``_slot_row`` handed that same row back,
    and the next fill asked for ``LIVE_REVIEW -> ALLOCATING`` — which the state
    machine rightly refuses. The task then retried three times and died. Two
    applications per slot per day, everything after them lost, and nothing said
    so: the only thing that ever set ``ended_at`` was the 03:15 cleanup sweep.

    The slot is genuinely free at this point. ``_page`` closes Chromium when its
    ``with`` block exits, well before any of these states is reached, so what the
    open row was holding was a lock and not a browser.
    """
    slot.status = assert_transition(BrowserSlotState(slot.status), into)
    slot.ended_at = now


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
            # Captured while the page is open. Reconstructing "what the form
            # looked like before the user acted" afterwards is impossible, and it
            # is exactly what submission detection compares against (§7.10).
            application.confirmation_data = _snapshot(page, specs)
            storage_state = _save_storage_state(page, config, application.id)

        # Recorded before the state changes, so the review screen has something
        # to show even if the transition below is refused.
        _record_fields(session, application, specs, answers)

        # Only now, and only if the file input took it. Marking the resume
        # uploaded at build time would make /resumes claim every prepared
        # application had sent its PDF, including the ones whose slot died before
        # the form was even reached.
        _mark_resume_uploaded(session, application, report, now=now)

        # A replay package, so a slot that dies mid-review does not cost the whole
        # form (§7.11). Written now rather than on failure: after the crash there
        # is no page left to read.
        slot.replay_package_path = _save_replay_package(
            config,
            application=application,
            specs=specs,
            answers=answers,
            now=now,
            storage_state_path=storage_state,
            resume_path=str(resume.pdf_path) if resume else None,
        )
        slot.storage_state_path = storage_state

        if report.captcha_detected:
            # Never attempted, never outsourced, never worked around.
            application.status = assert_transition(
                ApplicationState(application.status), ApplicationState.MANUAL_LOGIN_REQUIRED
            )
            set_deadline(application, now=now, ttl_hours=config.prepared_application_ttl_hours)
            _release(slot, into=BrowserSlotState.MANUAL_LOGIN, now=now)
            return HandlerResult(detail="a challenge is present; handing over to you")

        if report.needs_human:
            application.status = assert_transition(
                ApplicationState(application.status), ApplicationState.MANUAL_FIELD_REQUIRED
            )
            set_deadline(application, now=now, ttl_hours=config.prepared_application_ttl_hours)
            _release(slot, into=BrowserSlotState.LIVE_REVIEW, now=now)
            return HandlerResult(
                detail=f"{len(report.skipped_manual) + len(report.not_found)} field(s) need you"
            )

        application.status = assert_transition(
            ApplicationState(application.status), ApplicationState.READY_FOR_REVIEW
        )
        application.ready_for_review_at = now
        set_deadline(application, now=now, ttl_hours=config.prepared_application_ttl_hours)
        _release(slot, into=BrowserSlotState.LIVE_REVIEW, now=now)
        # §29: the last check before a live browser is handed to the user. It has
        # never fired and is not expected to; that is the point of a guard.
        assert_safe_to_review(
            has_clicked_submit=False,
            application_status=str(application.status),
            allowed_pre_submit_states=PRE_SUBMIT_STATES,
        )
        return HandlerResult(detail=f"{len(report.filled)} field(s) filled; ready for you")

    @target.register(TaskType.REPLAY_APPLICATION)
    def replay(session: Session, task: ScheduledTask) -> HandlerResult:
        """Rebuild a lost session from its stored package (§7.11).

        A slot dies, or a review sits past its TTL, and the twenty minutes of
        filling are gone. Replay puts them back — but only if the form is the
        same form. A changed page stops the replay rather than typing stored
        answers into moved boxes, because a form that looks plausible and is
        wrong is the hardest error for a reviewer to catch.

        A *restore* is the same operation with two differences, both carried in
        the payload. It ends in the state the application expired from rather
        than always in a live review; and a changed form blocks it outright
        instead of asking the user to finish by hand, because reproducing the
        stored answers exactly was the entire point (§7.9).
        """
        from app.ats.driver import extract_form, fill_form
        from app.ats.replay import ReplayPackage, check_replayable

        now = run_clock()
        payload = task.payload or {}
        is_restore = bool(payload.get("restore"))
        restore_target = _restore_target(payload)

        raw = (task.payload or {}).get("application_id")
        if not isinstance(raw, str):
            raise PermanentFailure("task payload has no application_id")

        application = session.get(Application, uuid.UUID(raw))
        if application is None:
            raise PermanentFailure("application no longer exists")
        if application.status != ApplicationState.READY_FOR_REPLAY:
            raise PermanentFailure(f"expected READY_FOR_REPLAY, found {application.status}")

        stored_path = replay_package_path(config, application.id)
        if stored_path is None:
            raise PermanentFailure(
                "no replay package was stored for this application; it must be filled again"
            )
        package = ReplayPackage.from_json(json.loads(stored_path.read_text(encoding="utf-8")))

        slot = _slot_row(session, now=now)
        slot.status = assert_transition(
            BrowserSlotState(slot.status), BrowserSlotState.ALLOCATING
        )
        slot.application_id = application.id
        slot.expires_at = now + timedelta(hours=config.live_session_ttl_hours)
        application.browser_slot_id = SLOT_NAME
        application.status = assert_transition(
            ApplicationState(application.status), ApplicationState.REPLAYING
        )
        slot.status = assert_transition(BrowserSlotState(slot.status), BrowserSlotState.REPLAYING)

        with _page(
            config, application.application_url, storage_state=package.storage_state_path
        ) as page:
            current = extract_form(page)
            check = check_replayable(package, current)
            if not check.can_replay:
                if is_restore:
                    # A restore promises the work comes back exactly as it was.
                    # It cannot keep that promise against a changed form, so it
                    # says so instead of half-keeping it.
                    reason = f"the form changed since this was prepared ({check.reason})"
                    application.restore_blocked_reason = reason
                    application.status = assert_transition(
                        ApplicationState(application.status),
                        ApplicationState.RESTORE_BLOCKED,
                    )
                    slot.status = assert_transition(
                        BrowserSlotState(slot.status), BrowserSlotState.CLEANING
                    )
                    return HandlerResult(detail=f"restore blocked: {reason}")

                application.status = assert_transition(
                    ApplicationState(application.status),
                    ApplicationState.MANUAL_FIELD_REQUIRED,
                )
                slot.status = assert_transition(
                    BrowserSlotState(slot.status), BrowserSlotState.LIVE_REVIEW
                )
                return HandlerResult(
                    detail=f"the form changed ({check.reason}); left for you to complete"
                )

            report = fill_form(
                page,
                current,
                _answers_from(package, current),
                resume_path=(
                    Path(package.resume_artifact_path) if package.resume_artifact_path else None
                ),
            )
            _screenshot(page, config, application.id, "pre-submit")
            application.confirmation_data = _snapshot(page, current)

        # A replay re-attaches the same stored file, so it re-establishes the same
        # fact. Recorded again because a replay may follow a failed first pass,
        # where nothing was attached and nothing was marked.
        _mark_resume_uploaded(session, application, report, now=now)

        landing = restore_target if is_restore else ApplicationState.LIVE_REVIEW_READY
        application.status = assert_transition(ApplicationState(application.status), landing)
        if is_restore:
            application.restore_blocked_reason = None
            application.restored_at = now
        set_deadline(application, now=now, ttl_hours=config.prepared_application_ttl_hours)
        # A restore that lands back in the review queue is not holding a window
        # open, and there are only two slots. Releasing it is the difference
        # between restoring thirty applications over a morning and restoring two.
        slot.status = assert_transition(
            BrowserSlotState(slot.status),
            BrowserSlotState.CLEANING
            if landing is ApplicationState.READY_FOR_REVIEW
            else BrowserSlotState.LIVE_REVIEW,
        )
        assert_safe_to_review(
            has_clicked_submit=False,
            application_status=str(application.status),
            allowed_pre_submit_states=PRE_SUBMIT_STATES,
        )
        return HandlerResult(detail=f"replayed {len(report.filled)} field(s)")

    return target


def _restore_target(payload: dict[str, Any]) -> ApplicationState:
    """Where a restore should land, from the task payload.

    Anything unrecognised or not human-gated falls back to the review queue.
    A payload is data from another process; it decides where a half-filled form
    is handed to a person, so it is validated rather than trusted.
    """
    from app.services.restore import RESTORE_TARGET_DEFAULT

    try:
        state = ApplicationState(str(payload.get("restore_target")))
    except ValueError:
        return RESTORE_TARGET_DEFAULT
    return state if state in HUMAN_GATED_APPLICATION_STATES else RESTORE_TARGET_DEFAULT


def _answers_from(package: Any, current: list[Any]) -> list[Any]:
    """Line the stored answers up with the form as it is now.

    Matched by question text rather than by position: ``check_replayable`` has
    already confirmed the question *set* is the same, but nothing guarantees the
    order, and matching by index would silently transpose two answers.
    """
    from app.ats.fields import Answer, SourceType

    by_label = {
        f.label.strip().lower(): f for f in [*package.fields, *package.manual_fields]
    }
    answers: list[Any] = []
    for spec in current:
        stored = by_label.get(spec.question_text.strip().lower())
        if stored is None:
            answers.append(Answer(None, None, SourceType.UNRESOLVED))
            continue
        answers.append(
            Answer(stored.semantic_key, stored.value, SourceType(stored.source_type))
        )
    return answers


def _snapshot(page: Any, specs: list[Any]) -> dict[str, Any]:
    """What the form looked like before the user touched it (§7.10).

    Only the "before" half. The "after" half is written when the user comes back
    and reconciliation compares them; a snapshot taken by this worker after its
    own fill would compare the page to itself.
    """
    try:
        return {
            "url_before": page.url,
            "title_before": page.title(),
            "form_present_before": page.query_selector("form") is not None,
            "submit_button_present_before": _has_submit(page),
            "field_count_before": len(specs),
        }
    except Exception:  # pragma: no cover - depends on the page
        log.warning("could not snapshot the form", exc_info=True)
        return {}


def _has_submit(page: Any) -> bool:
    return any(
        page.query_selector(selector) is not None
        for selector in ("button[type=submit]", "input[type=submit]")
    )


def _save_storage_state(page: Any, settings: Settings, application_id: uuid.UUID) -> str | None:
    """Persist cookies and local storage so a replay does not re-do a login.

    §23.6 deletes this seven days after submission; until then it is the only
    thing that makes a manual SSO login worth doing once.
    """
    try:
        directory = settings.data_dir / "browser-sessions" / SLOT_NAME
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{application_id}.json"
        page.context.storage_state(path=str(path))
        path.chmod(0o600)  # session cookies are credentials
        return str(path)
    except Exception:  # pragma: no cover - depends on the page
        log.warning("could not save storage state", exc_info=True)
        return None


def _save_replay_package(
    settings: Settings,
    *,
    application: Application,
    specs: list[Any],
    answers: list[Any],
    now: datetime,
    storage_state_path: str | None,
    resume_path: str | None,
) -> str | None:
    from app.ats.replay import build_package

    try:
        package = build_package(
            application_id=str(application.id),
            application_url=application.application_url,
            ats_type=str(application.ats_type or "unknown"),
            specs=specs,
            answers=answers,
            created_at=now,
            storage_state_path=storage_state_path,
            resume_artifact_path=resume_path,
        )
        directory = settings.artifacts_dir / str(application.id)
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / "replay.json"
        path.write_text(json.dumps(package.to_json(), indent=2), encoding="utf-8")
        return str(path)
    except Exception:  # pragma: no cover - best effort
        log.warning("could not write the replay package", exc_info=True)
        return None


def _mark_resume_uploaded(
    session: Session, application: Application, report: Any, *, now: datetime
) -> None:
    """Record which resume version reached the form, if one did.

    Records nothing when the browser did not confirm the file is on the input.
    That is not an error worth failing the task over — plenty of forms ask for the
    resume on a later page, and the application is going to a human anyway — but it
    must not be recorded as an upload, because the Resume Versions screen is where
    the user checks what the employer has.
    """
    from app.services.resume_artifacts import mark_uploaded

    uploaded = getattr(report, "resume_uploaded", None)
    if uploaded is None:
        # Only when there was something to attach and it did not stick. A form with
        # no resume field at all is ordinary and says nothing worth logging.
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


def _page(settings: Settings, url: str, *, storage_state: str | None = None) -> Any:
    """Open ``url`` in a fresh context. A context manager so the page always closes.

    ``storage_state`` restores cookies from an earlier session, which is what
    makes a replay skip a manual SSO login rather than asking for it again.
    """
    from contextlib import contextmanager

    @contextmanager
    def opened() -> Any:
        from playwright.sync_api import sync_playwright

        state = storage_state if storage_state and Path(storage_state).is_file() else None
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=False)
            context = browser.new_context(
                viewport={"width": 1400, "height": 860}, storage_state=state
            )
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
