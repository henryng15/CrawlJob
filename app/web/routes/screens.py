"""Dashboard, job, application, outreach and settings screens (spec §22).

Every state-changing route goes through :func:`assert_transition`, so an invalid
move is a 400 rather than a corrupted row. Nothing here submits an application or
sends an email; the two routes that come closest — "I submitted this" and "save
draft" — record what the *user* did and write to a Gmail draft respectively.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from starlette.responses import RedirectResponse

from app.db.models import (
    Application,
    BrowserSession,
    Job,
    OutreachTask,
    Recruiter,
    ResumeVersion,
    SourceRegistry,
    SuppressionEntry,
)
from app.db.models.sources import KINDS
from app.domain.states import (
    ApplicationState,
    BrowserSlotState,
    InvalidTransition,
    JobState,
    OutreachState,
    assert_transition,
)
from app.domain.tasks import TaskType, idempotency_key
from app.services import audit
from app.services.candidate import Sensitivity, default_sensitivity, list_facts
from app.services.gmail import SCOPES
from app.services.llm.ledger import spent_this_month
from app.services.queue import enqueue
from app.web import queries
from app.web.deps import Config, CurrentSession, Db, require_csrf
from app.web.review_token import DEFAULT_TTL, issue_token, review_cookie_name, verify_token
from app.web.templating import render

__all__ = ["router"]

router = APIRouter(dependencies=[])

CSRF = Depends(require_csrf)

#: Answers never rendered back to the page. §23.5 forbids them in logs; a browser
#: page is a log with a screenshot key, so the same list applies (§23.4).
REDACTED_KEYS: frozenset[str] = frozenset(
    {
        "candidate.date_of_birth",
        "candidate.ssn",
        "candidate.address.street",
        "eeo.race",
        "eeo.gender",
        "eeo.veteran_status",
        "eeo.disability_status",
    }
)

RETENTION: tuple[tuple[str, str], ...] = (
    ("Job source records", "12 months"),
    ("Applications", "until you delete them"),
    ("Tailored resumes", "until you delete them"),
    ("Pre-submit screenshots", "30 days"),
    ("Confirmation screenshots", "12 months"),
    ("Browser storage state", "7 days after submission"),
    ("Logs", "30 days"),
    ("Suppression list", "indefinite — an opt-out that expires is not an opt-out"),
)


#: Slot names are ours, not user input, but the auth endpoint reads one out of a
#: header that a misconfigured proxy could let a client set.
_SLOT_NAME = re.compile(r"[a-z0-9][a-z0-9-]{0,30}")


def _redirect(to: str) -> RedirectResponse:
    return RedirectResponse(to, status_code=status.HTTP_303_SEE_OTHER)


def _readable(path: Path | None) -> bool:
    """Whether *path* is there **and** this process can read it.

    Existence is the wrong question. The Gmail token is delivered by one account
    and read by another, and when the ownership is wrong the file sits there
    plainly visible while every draft fails with PermissionError — so a screen
    that only stats it reports success at precisely the moment the feature is
    broken. That happened in production, and the green tick is what made it hard
    to find. Web and worker run as the same uid, so "I can read this" is a
    truthful answer on the worker's behalf too.

    Reading also subsumes the older failure this replaced: a secrets directory
    the container may not list raises PermissionError from ``exists()`` itself,
    which returned 500 for the whole page. Being shut out is an answer — no.
    """
    if path is None:
        return False
    try:
        with path.open("rb") as handle:
            handle.read(1)
    except OSError:
        return False
    return True


def _move[T: Any](
    obj: Any, target: T, *, db: Session | None = None, actor: str | None = None, **context: Any
) -> None:
    """Apply a state transition, turning a refusal into a 400.

    A rejected transition is a stale page — the user pressed a button that was
    valid when it rendered — not a server fault.

    Anything the user does here is audited as USER, which is the whole point:
    months later the log has to be able to say that a person marked this
    submitted, not that the machine decided it had been.
    """
    was = str(obj.status)
    try:
        obj.status = assert_transition(type(target)(obj.status), target)
    except InvalidTransition as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    if db is not None:
        audit.transition(
            db,
            obj,
            entity_type=type(obj).__name__.lower(),
            was=was,
            now=str(target),
            actor_type=audit.Actor.USER,
            actor_id=actor,
            **context,
        )


# ----------------------------------------------------------------- setup


@dataclass(frozen=True, slots=True)
class SetupStep:
    title: str
    detail: str
    done: bool
    summary: str = ""
    command: str = ""
    link: str = ""
    link_text: str = ""
    optional: bool = False


@router.get("/setup")
def setup(request: Request, db: Db, settings: Config, session: CurrentSession) -> Response:
    """What is still missing before the system can do anything (§22.6).

    A dashboard that is empty because nothing was discovered looks identical to
    one that is empty because no board is being watched. This page is the
    difference.
    """
    from app.services.resume_import import base_version

    values = {f.key: f.value for f in list_facts(db)}
    sources = db.scalars(select(SourceRegistry).where(SourceRegistry.enabled.is_(True))).all()
    base_resume = base_version(db)
    recruiters = int(db.scalar(select(func.count()).select_from(Recruiter)) or 0)

    steps = [
        SetupStep(
            title="Watch a job board",
            detail="Nothing is discovered until at least one board is enabled.",
            done=bool(sources),
            summary=f"{len(sources)} board(s) enabled.",
            link="/settings",
            link_text="Add one in Settings",
        ),
        SetupStep(
            title="Import your resume",
            detail=(
                "This PDF is uploaded to every application, unchanged. Nothing "
                "rewrites it, so it is worth it being the one you would send by hand."
            ),
            done=base_resume is not None,
            summary=(
                f"stored, {base_resume.page_count or '?'} page(s)"
                if base_resume is not None
                else ""
            ),
            command="uv run internship-ops import-resume ~/resume.pdf",
        ),
        SetupStep(
            title="Import recruiters",
            detail="Outreach needs somebody to write to. Without this it stops and asks.",
            done=recruiters > 0,
            summary=f"{recruiters} recruiter(s) stored.",
            link="/settings",
            link_text="Upload in Settings",
            optional=True,
        ),
        SetupStep(
            title="Connect Gmail",
            detail=(
                "Drafts are written into your mailbox. Until this is done they are "
                "kept in memory and disappear when the worker restarts."
            ),
            done=_readable(settings.gmail_token_path),
            command=(
                "uv run python scripts/gmail_authorize.py "
                "--client-secrets ~/client_secret.json"
            ),
            optional=True,
        ),
    ]

    return render(
        request,
        "setup.html",
        {
            "steps": steps,
            "ready": all(s.done for s in steps if not s.optional),
            "preferred_name": values.get("candidate.preferred_name", ""),
            "graduation_date": values.get("education.graduation_date", ""),
            "needs_sponsorship": bool(
                values.get("work_authorization.requires_future_sponsorship", True)
            ),
            # Defaults to unticked: an authorization claim must be something the
            # user asserted, never something a blank form asserted for them.
            "work_authorized": bool(values.get("work_authorization.is_authorized", False)),
        },
        session=session,
    )


@router.post("/setup/profile", dependencies=[CSRF])
def save_profile(
    db: Db,
    session: CurrentSession,
    preferred_name: Annotated[str, Form()],
    graduation_date: Annotated[str, Form()] = "",
    needs_sponsorship: Annotated[str, Form()] = "",
    work_authorized: Annotated[str, Form()] = "",
) -> Response:
    """Record the handful of facts everything else depends on.

    Written as USER, which is what makes them usable: a sponsorship answer no
    person confirmed is not one this system will put on a form (§2.2).
    """
    from app.services.candidate import Actor, set_fact

    set_fact(
        db,
        "candidate.preferred_name",
        preferred_name.strip(),
        actor=Actor.USER,
        verified=True,
    )
    if graduation_date.strip():
        try:
            date.fromisoformat(graduation_date.strip())
        except ValueError as exc:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Graduation date must be YYYY-MM-DD"
            ) from exc
        set_fact(
            db,
            "education.graduation_date",
            graduation_date.strip(),
            actor=Actor.USER,
            verified=True,
        )
    set_fact(
        db,
        "work_authorization.requires_future_sponsorship",
        bool(needs_sponsorship),
        actor=Actor.USER,
        verified=True,
    )
    # The only fact that fills a work-authorization question on a form. Stored
    # under the ``work_authorization`` prefix, which is always locked, so §7.8's
    # "locked fact or a human" is enforced by the fact store rather than by
    # remembering to pass a flag here.
    set_fact(
        db,
        "work_authorization.is_authorized",
        bool(work_authorized),
        actor=Actor.USER,
        verified=True,
    )
    return _redirect("/setup")


# ------------------------------------------------------------- dashboard


@router.get("/")
def dashboard(request: Request, db: Db, settings: Config, session: CurrentSession) -> Response:
    now = datetime.now(UTC)
    return render(
        request,
        "dashboard.html",
        {"d": queries.dashboard(db, settings, now=now), "now": now},
        session=session,
    )


@router.get("/today")
def today(request: Request, db: Db, settings: Config, session: CurrentSession) -> Response:
    """Today Run: the quota, what came of it, and whether the machinery is alive."""
    now = datetime.now(UTC)
    return render(
        request,
        "today.html",
        {"t": queries.today_run(db, settings, now=now), "now": now},
        session=session,
    )


# ------------------------------------------------------------------ jobs


@router.get("/jobs")
def jobs(
    request: Request,
    db: Db,
    session: CurrentSession,
    status_filter: str | None = None,
    q: str | None = None,
) -> Response:
    stmt = queries._job_rows()
    if status_filter:
        stmt = stmt.where(Job.status == status_filter)
    if q:
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(or_(Job.title.ilike(pattern), Job.normalized_title.ilike(pattern)))
    stmt = stmt.order_by(Job.discovered_at.desc()).limit(200)

    return render(
        request,
        "jobs.html",
        {
            "rows": queries._to_job_rows(db, stmt),
            "statuses": [s.value for s in JobState],
            "selected_status": status_filter,
            "query": q,
        },
        session=session,
    )


@router.get("/jobs/{job_id}")
def job_detail(
    request: Request, db: Db, settings: Config, session: CurrentSession, job_id: uuid.UUID
) -> Response:
    view = queries.job_detail(db, job_id)
    if view is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such job")

    can_select, reason = _selectable(db, view, settings)
    return render(
        request,
        "job_detail.html",
        {
            "v": view,
            "now": datetime.now(UTC),
            "can_select": can_select,
            "block_reason": reason,
        },
        session=session,
    )


def _selectable(
    db: Db, view: queries.JobDetail, settings: Config
) -> tuple[bool, str]:
    """Whether "select and prepare" should be offered, and why not.

    The button is disabled rather than hidden: a user who cannot see why a job is
    unavailable will assume the system lost it.
    """
    if view.job.status in {JobState.ARCHIVED, JobState.CLOSED, JobState.ELIGIBILITY_REJECTED}:
        return False, f"This job is {view.job.status}."
    if view.sponsorship and view.sponsorship.recommended_action == "SKIP":
        return False, "The employer's stated policy rules this out."
    active = db.scalar(
        select(func.count())
        .select_from(Application)
        .join(Job, Application.job_id == Job.id)
        .where(Job.company_id == view.job.company_id)
        .where(
            Application.status.notin_(
                [ApplicationState.SKIPPED, ApplicationState.WITHDRAWN, ApplicationState.FAILED]
            )
        )
    )
    if int(active or 0) >= settings.max_active_applications_per_company:
        return False, (
            f"Already {active} active application(s) at this company "
            f"(limit {settings.max_active_applications_per_company})."
        )
    return True, ""


@router.post("/jobs/{job_id}/select", dependencies=[CSRF])
def select_job(db: Db, settings: Config, session: CurrentSession, job_id: uuid.UUID) -> Response:
    view = queries.job_detail(db, job_id)
    if view is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such job")
    can_select, reason = _selectable(db, view, settings)
    if not can_select:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, reason)

    _move(view.job, JobState.SELECTED, db=db, actor=session.username)
    application = Application(
        job_id=view.job.id,
        application_url=view.job.canonical_url,
        ats_type=view.job.ats_type,
        status=ApplicationState.CREATED,
    )
    db.add(application)
    db.flush()
    # Tailoring first: it is what produces the resume the form needs, and it
    # hands off to a browser slot when it succeeds.
    enqueue(
        db,
        task_type=TaskType.PREPARE_RESUME,
        dedupe_key=idempotency_key(TaskType.PREPARE_RESUME, str(application.id)),
        payload={"application_id": str(application.id), "job_id": str(view.job.id)},
    )
    return _redirect(f"/applications/{application.id}")


@router.post("/jobs/{job_id}/skip", dependencies=[CSRF])
def skip_job(db: Db, session: CurrentSession, job_id: uuid.UUID) -> Response:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such job")
    # Via CLOSED, because the job machine has no DISCOVERED -> ARCHIVED edge: the
    # direct route exists only for jobs the pipeline already finished with. A
    # user's "not interested" is a legitimate exit from any state, and closing
    # first is how the machine spells that.
    if JobState(job.status) not in {JobState.CLOSED, JobState.ARCHIVED}:
        _move(job, JobState.CLOSED, db=db, actor=session.username, reason="skipped by you")
    _move(job, JobState.ARCHIVED, db=db, actor=session.username)
    return _redirect("/jobs")


# ---------------------------------------------------------- applications


@router.get("/applications")
def applications(
    request: Request, db: Db, session: CurrentSession, status: str | None = None
) -> Response:
    """All Applications: the whole history, nothing filtered out by default.

    Submitted, never submitted, failed, expired, restored — all of it. This is
    the screen that has to be complete, because it is the only record the user
    has of what the system did on their behalf, and it is the only place a
    restore is offered from (§7.9).
    """
    rows = queries._application_rows(db)
    if status:
        rows = [row for row in rows if row.status == status]
    return render(
        request,
        "applications.html",
        {
            "rows": rows,
            "now": datetime.now(UTC),
            "active_filter": status,
            "counts": queries.status_counts(db),
        },
        session=session,
    )


@router.get("/applications/{application_id}")
def application_detail(
    request: Request, db: Db, settings: Config, session: CurrentSession, application_id: uuid.UUID
) -> Response:
    view = queries.application_detail(db, application_id)
    if view is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such application")

    return render(
        request,
        "application_detail.html",
        {
            "v": view,
            "redacted_keys": REDACTED_KEYS,
            "live_review_url": _live_review_url(db, view, settings),
            # Offered from the states where a person could plausibly have just
            # pressed Submit on the employer's site (§7.10).
            "can_mark_submitted": view.application.status
            in {
                ApplicationState.READY_FOR_REVIEW,
                ApplicationState.LIVE_REVIEW_READY,
                ApplicationState.SUBMISSION_UNCERTAIN,
            },
        },
        session=session,
    )


def _live_review_url(
    db: Db, view: queries.ApplicationDetail, settings: Config
) -> str | None:
    """Mint a fresh, application-scoped review link (§15.3).

    Minted on each page view rather than stored, so a link copied out of the
    browser's history stops working within half an hour, and closing the page
    does not leave a working key behind.
    """
    slot = view.slot
    if slot is None or slot.status not in {
        BrowserSlotState.LIVE_REVIEW,
        BrowserSlotState.MANUAL_LOGIN,
    }:
        return None

    token, digest = issue_token(
        application_id=view.application.id, slot_name=slot.slot_name, settings=settings
    )
    # Replacing the stored hash revokes every earlier link for this slot. That is
    # deliberate: only the tab you just opened should work.
    slot.review_token_hash = digest
    db.flush()

    return f"/review/{slot.slot_name}/?token={quote(token)}"


@router.get("/review/{slot_name}/")
def live_review(
    db: Db,
    settings: Config,
    session: CurrentSession,
    slot_name: str,
    token: str = "",
) -> Response:
    """Validate a review token, then hand off to the slot's noVNC page.

    Caddy routes ``/review/slot-1/*`` straight to the container, so this endpoint
    is what makes the route safe: it is the only thing that checks the token, and
    §15.3 is explicit that Caddy alone is not enough.
    """
    slot = db.scalars(
        select(BrowserSession)
        .where(BrowserSession.slot_name == slot_name)
        .where(BrowserSession.ended_at.is_(None))
    ).first()
    if slot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such live session")

    grant = verify_token(
        token,
        slot_name=slot_name,
        stored_hash=slot.review_token_hash,
        settings=settings,
    )
    if grant is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "That review link has expired or is not valid for this slot. "
            "Open the application again to get a fresh one.",
        )
    if slot.application_id != grant.application_id:
        # The slot moved on to another application since the link was minted.
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This slot is now working on a different application"
        )

    # The noVNC page then loads a dozen assets and opens a WebSocket, none of
    # which will carry the query string. A path-scoped cookie is what carries the
    # grant across them, and Caddy's forward_auth re-checks it on every one — see
    # the note in deploy/Caddyfile about why a redirect alone is not enough.
    response = _redirect(f"/review/{slot_name}/vnc.html?autoconnect=1&resize=scale")
    response.set_cookie(
        review_cookie_name(slot_name),
        token,
        httponly=True,
        samesite="strict",
        secure=settings.session_cookie_secure,
        max_age=int(DEFAULT_TTL.total_seconds()),
        path=f"/review/{slot_name}/",
    )
    return response


@router.get("/internal/review-auth")
def review_auth(db: Db, settings: Config, request: Request) -> Response:
    """Called by Caddy before every ``/review/...`` request (§15.3).

    Caddy routes; it does not authenticate. This is the check, and it runs on the
    noVNC page, on each asset, and on the WebSocket upgrade — so there is no
    request under ``/review/`` that reaches a browser slot unchecked.

    Returns 204 to allow and 403 to refuse; Caddy turns the latter into a denial.
    """
    slot_name = _slot_from_uri(request.headers.get("X-Forwarded-Uri", ""))
    if slot_name is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a review path")

    slot = db.scalars(
        select(BrowserSession)
        .where(BrowserSession.slot_name == slot_name)
        .where(BrowserSession.ended_at.is_(None))
    ).first()
    grant = verify_token(
        request.cookies.get(review_cookie_name(slot_name)),
        slot_name=slot_name,
        stored_hash=slot.review_token_hash if slot else None,
        settings=settings,
    )
    if grant is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No valid review grant")

    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _slot_from_uri(uri: str) -> str | None:
    """``/review/slot-1/vnc.html`` -> ``slot-1``.

    Rejects anything that is not exactly a slot segment, so a traversal attempt
    cannot name a slot it was not granted.
    """
    parts = [p for p in uri.split("?")[0].split("/") if p]
    if len(parts) < 2 or parts[0] != "review":
        return None
    candidate = parts[1]
    return candidate if _SLOT_NAME.fullmatch(candidate) else None


@router.post("/applications/{application_id}/answers", dependencies=[CSRF])
async def save_answers(
    request: Request, db: Db, session: CurrentSession, application_id: uuid.UUID
) -> Response:
    view = queries.application_detail(db, application_id)
    if view is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such application")

    form = await request.form()
    by_id = {str(f.id): f for f in view.fields}
    for name, value in form.items():
        if not name.startswith("field:") or not isinstance(value, str):
            continue
        field = by_id.get(name.removeprefix("field:"))
        if field is None or not value.strip():
            continue
        field.answer_json = {"value": value}
        # USER_OVERRIDE, not the original source: the audit trail must show a
        # person typed this, which is exactly what makes it trustworthy (§7.8).
        field.source_type = "USER_OVERRIDE"
        field.user_overridden = True
        field.manual_required = False

    if not view.manual_fields and view.application.status == ApplicationState.MANUAL_FIELD_REQUIRED:
        _move(view.application, ApplicationState.READY_FOR_REVIEW, db=db,
              actor=session.username)
        view.application.ready_for_review_at = datetime.now(UTC)
    return _redirect(f"/applications/{application_id}")


@router.post("/applications/{application_id}/submitted", dependencies=[CSRF])
def mark_submitted(db: Db, session: CurrentSession, application_id: uuid.UUID) -> Response:
    """Record that the *user* submitted. §7.10's fallback, not an action.

    Two hops because the state machine has no direct edge: the row passes through
    SUBMISSION_PENDING_CONFIRMATION so that every submitted application has the
    same history regardless of how it was established.
    """
    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such application")

    now = datetime.now(UTC)
    if application.status != ApplicationState.SUBMISSION_PENDING_CONFIRMATION:
        _move(application, ApplicationState.SUBMISSION_PENDING_CONFIRMATION, db=db,
              actor=session.username)
    _move(
        application,
        ApplicationState.SUBMITTED,
        db=db,
        actor=session.username,
        method="USER_CONFIRMED",
    )
    application.submitted_at = now
    application.submission_detection_method = "USER_CONFIRMED"
    application.submission_confidence = 1.0

    enqueue(
        db,
        task_type=TaskType.SCHEDULE_OUTREACH,
        dedupe_key=idempotency_key(TaskType.SCHEDULE_OUTREACH, str(application.id)),
        payload={"application_id": str(application.id)},
    )
    return _redirect(f"/applications/{application_id}")


@router.post("/applications/{application_id}/restore", dependencies=[CSRF])
def restore_application(db: Db, session: CurrentSession, application_id: uuid.UUID) -> Response:
    """Ask for an expired application back (§7.9).

    Queues the work rather than doing it: restoring needs a browser slot, and
    this request must return whether or not one is free. The checks that decide
    whether it *can* come back run in the handler, so a restore refused for a
    closed posting is recorded on the row like any other outcome, instead of
    being a flash message the user loses on the next page load.
    """
    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such application")
    if application.status != ApplicationState.EXPIRED:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Only an expired application can be restored; this one is {application.status}",
        )

    enqueue(
        db,
        task_type=TaskType.RESTORE_APPLICATION,
        # The attempt count is in the key so a restore refused this morning can
        # be asked for again this afternoon, once whatever blocked it has moved.
        dedupe_key=idempotency_key(
            TaskType.RESTORE_APPLICATION,
            str(application.id),
            datetime.now(UTC).isoformat(timespec="seconds"),
        ),
        payload={"application_id": str(application.id)},
    )
    return _redirect(f"/applications/{application_id}")


@router.post("/applications/{application_id}/skip", dependencies=[CSRF])
def skip_application(db: Db, session: CurrentSession, application_id: uuid.UUID) -> Response:
    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such application")
    _move(application, ApplicationState.SKIPPED, db=db, actor=session.username)
    return _redirect("/applications")


# -------------------------------------------------------------- outreach


@router.get("/outreach")
def outreach(request: Request, db: Db, session: CurrentSession) -> Response:
    return render(request, "outreach.html", {"rows": queries._outreach_rows(db)}, session=session)


@router.get("/outreach/{task_id}")
def outreach_detail(
    request: Request, db: Db, session: CurrentSession, task_id: uuid.UUID
) -> Response:
    view = queries.outreach_detail(db, task_id)
    if view is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such outreach task")
    return render(
        request,
        "outreach_detail.html",
        {"v": view, "match_reason": (view.task.hook_json or {}).get("match_reason")},
        session=session,
    )


@router.post("/outreach/{task_id}/recruiter", dependencies=[CSRF])
def set_recruiter(
    db: Db,
    session: CurrentSession,
    task_id: uuid.UUID,
    recruiter_id: Annotated[str, Form()] = "",
) -> Response:
    task = db.get(OutreachTask, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such outreach task")

    if not recruiter_id:
        task.recruiter_id = None
    else:
        recruiter = db.get(Recruiter, uuid.UUID(recruiter_id))
        if recruiter is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "No such recruiter")
        if recruiter.do_not_contact:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That contact is suppressed.")
        task.recruiter_id = recruiter.id
    return _redirect(f"/outreach/{task_id}")


@router.post("/outreach/{task_id}/draft", dependencies=[CSRF])
def save_draft(
    db: Db,
    session: CurrentSession,
    task_id: uuid.UUID,
    subject: Annotated[str, Form()],
    body: Annotated[str, Form()],
) -> Response:
    """Save edits and re-sync the Gmail draft. Never sends."""
    task = db.get(OutreachTask, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such outreach task")

    from app.services.gmail import validate_content

    problems = validate_content(subject, body)
    if problems:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "; ".join(problems))

    task.subject = subject
    task.body = body
    enqueue(
        db,
        task_type=TaskType.CREATE_GMAIL_DRAFT,
        dedupe_key=idempotency_key(TaskType.CREATE_GMAIL_DRAFT, str(task.id), str(hash(body))),
        payload={"outreach_task_id": str(task.id)},
    )
    return _redirect(f"/outreach/{task_id}")


@router.post("/outreach/{task_id}/regenerate", dependencies=[CSRF])
def regenerate_outreach(db: Db, session: CurrentSession, task_id: uuid.UUID) -> Response:
    task = db.get(OutreachTask, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such outreach task")
    _move(task, OutreachState.HOOK_GENERATING)
    enqueue(
        db,
        task_type=TaskType.GENERATE_HOOK,
        dedupe_key=idempotency_key(
            TaskType.GENERATE_HOOK, str(task.id), datetime.now(UTC).isoformat()
        ),
        payload={"outreach_task_id": str(task.id)},
    )
    return _redirect(f"/outreach/{task_id}")


@router.post("/outreach/{task_id}/suppress", dependencies=[CSRF])
def suppress(db: Db, session: CurrentSession, task_id: uuid.UUID) -> Response:
    """Never contact this address again (§8.2). Permanent by design."""
    view = queries.outreach_detail(db, task_id)
    if view is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such outreach task")

    if view.recruiter is not None:
        view.recruiter.do_not_contact = True
        db.add(
            SuppressionEntry(
                email=view.recruiter.email,
                company_id=view.company.id,
                reason="USER_MARKED",
                source="web",
            )
        )
    _move(view.task, OutreachState.SUPPRESSED, db=db, actor=session.username)
    return _redirect("/outreach")


@router.post("/outreach/{task_id}/skip", dependencies=[CSRF])
def skip_outreach(db: Db, session: CurrentSession, task_id: uuid.UUID) -> Response:
    task = db.get(OutreachTask, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such outreach task")
    _move(task, OutreachState.CLOSED, db=db, actor=session.username)
    return _redirect("/outreach")


# --------------------------------------------------------------- resumes


@router.get("/resumes")
def resume_versions(
    request: Request, db: Db, settings: Config, session: CurrentSession
) -> Response:
    """Every resume version, grouped by the application it was built for (§7.7).

    The screen exists to answer one question — why is *this* the PDF that went to
    the employer — so it shows the attempts that did not qualify alongside the
    one that did.
    """
    return render(
        request,
        "resume_versions.html",
        {
            "groups": queries.resume_groups(db),
            "base_pdf": settings.base_resume_pdf,
        },
        session=session,
    )


@router.get("/resumes/base/view")
def view_base_resume(settings: Config, session: CurrentSession) -> Response:
    """The canonical PDF, served inline and read-only.

    Served from its configured location rather than a copy, so what the user
    previews here is the file the fallback path would actually use.
    """
    return _pdf_response(_base_pdf(settings), inline=True)


@router.get("/resumes/base/download")
def download_base_resume(settings: Config, session: CurrentSession) -> Response:
    return _pdf_response(_base_pdf(settings), inline=False)


def _base_pdf(settings: Config) -> Path:
    if settings.base_resume_pdf is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "No base resume is configured (BASE_RESUME_PDF)"
        )
    return Path(settings.base_resume_pdf)


def _pdf_response(path: Path, *, inline: bool) -> Response:
    from starlette.responses import FileResponse

    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Artifact missing")
    if inline:
        # Content-Disposition inline, so the browser renders it in the iframe
        # rather than downloading it. FileResponse's ``filename`` would force an
        # attachment, which is the opposite of a preview.
        return FileResponse(
            path,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{path.name}"'},
        )
    return FileResponse(path, media_type="application/pdf", filename=path.name)


@router.get("/resumes/{resume_id}/view")
def view_resume(
    db: Db, settings: Config, session: CurrentSession, resume_id: uuid.UUID
) -> Response:
    """One attempt's PDF, inline, for the preview pane."""
    return _pdf_response(_artifact(db, settings, resume_id, "pdf"), inline=True)


@router.get("/resumes/{resume_id}/source")
def view_resume_source(
    db: Db, settings: Config, session: CurrentSession, resume_id: uuid.UUID
) -> Response:
    """The tailored ``.tex``, as plain text."""
    from starlette.responses import PlainTextResponse

    path = _artifact(db, settings, resume_id, "tex")
    return PlainTextResponse(path.read_text(encoding="utf-8", errors="replace"))


@router.get("/resumes/{resume_id}/log")
def view_resume_log(
    db: Db, settings: Config, session: CurrentSession, resume_id: uuid.UUID
) -> Response:
    """The compilation log. The only thing that says why a build failed."""
    from starlette.responses import PlainTextResponse

    path = _artifact(db, settings, resume_id, "log")
    return PlainTextResponse(path.read_text(encoding="utf-8", errors="replace"))


def _artifact(db: Session, settings: Config, resume_id: uuid.UUID, which: str) -> Path:
    """Resolve one artifact of a resume version, confined to the artifacts root.

    The path comes from the database, but a database row is not a capability:
    confining it means a bad or tampered row cannot read arbitrary files.
    """
    resume = db.get(ResumeVersion, resume_id)
    if resume is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such resume")

    raw = {
        "pdf": resume.pdf_path,
        "tex": resume.source_path,
        "log": resume.log_path,
    }.get(which)
    if not raw:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No {which} for this version")

    path = Path(raw).resolve()
    root = settings.artifacts_dir.resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Artifact missing")
    return path


@router.get("/resumes/{resume_id}")
def resume_detail(
    request: Request, db: Db, session: CurrentSession, resume_id: uuid.UUID
) -> Response:
    resume = db.get(ResumeVersion, resume_id)
    if resume is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such resume")

    return render(request, "resume_detail.html", {"resume": resume}, session=session)


@router.get("/resumes/{resume_id}/download")
def download_resume(
    db: Db, settings: Config, session: CurrentSession, resume_id: uuid.UUID
) -> Response:
    from pathlib import Path

    from starlette.responses import FileResponse

    resume = db.get(ResumeVersion, resume_id)
    if resume is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such resume")

    path = Path(resume.pdf_path).resolve()
    # The path comes from the database, but a database row is not a capability:
    # confining it to the artifacts directory means a bad row cannot read /etc.
    root = settings.artifacts_dir.resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Artifact missing")
    return FileResponse(path, media_type="application/pdf", filename=path.name)


@router.post("/resumes/{resume_id}/approve", dependencies=[CSRF])
def approve_resume(db: Db, session: CurrentSession, resume_id: uuid.UUID) -> Response:
    resume = db.get(ResumeVersion, resume_id)
    if resume is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such resume")
    resume.status = "APPROVED"
    return _redirect(f"/resumes/{resume_id}")


# -------------------------------------------------------------- settings


@router.get("/settings")
def settings_page(
    request: Request, db: Db, settings: Config, session: CurrentSession, import_report: str = ""
) -> Response:
    facts = [
        {
            "key": f.key,
            "display_value": _display(f.key, f.value),
            "locked": f.is_locked,
            "updated_by": f.source,
        }
        for f in list_facts(db)
    ]
    return render(
        request,
        "settings.html",
        {
            "s": settings,
            "facts": facts,
            "redacted_keys": REDACTED_KEYS,
            "gmail_scopes": [s.rsplit("/", 1)[-1] for s in SCOPES],
            "recruiter_count": db.scalar(select(func.count()).select_from(Recruiter)) or 0,
            "retention": RETENTION,
            "sources": db.scalars(
                select(SourceRegistry).order_by(SourceRegistry.kind, SourceRegistry.identifier)
            ).all(),
            "source_kinds": KINDS,
            "spent": spent_this_month(db, settings),
            "import_report": import_report,
        },
        session=session,
    )


def _display(key: str, value: Any) -> str:
    if default_sensitivity(key) is Sensitivity.RESTRICTED:
        return "stored, not displayed"
    return str(value)


@router.post("/settings/sources", dependencies=[CSRF])
def add_source(
    db: Db,
    session: CurrentSession,
    kind: Annotated[str, Form()],
    identifier: Annotated[str, Form()],
    label: Annotated[str, Form()] = "",
) -> Response:
    """Watch a job board. Discovery picks it up on the next daily run."""
    from app.db.models.sources import KINDS

    if kind not in KINDS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown source kind {kind!r}")
    if not identifier.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "An identifier is required")

    existing = db.scalars(
        select(SourceRegistry)
        .where(SourceRegistry.kind == kind)
        .where(SourceRegistry.identifier == identifier.strip())
    ).first()
    if existing is not None:
        existing.enabled = True
        existing.label = label.strip() or existing.label
    else:
        db.add(
            SourceRegistry(
                kind=kind, identifier=identifier.strip(), label=label.strip() or None
            )
        )
    return _redirect("/settings")


@router.post("/settings/sources/{source_id}/toggle", dependencies=[CSRF])
def toggle_source(db: Db, session: CurrentSession, source_id: uuid.UUID) -> Response:
    """Pause or resume a board.

    Disabled rather than deleted: a board that broke last week is usually one you
    want back, and losing the row loses the failure history that explains why.
    """
    source = db.get(SourceRegistry, source_id)
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such source")
    source.enabled = not source.enabled
    return _redirect("/settings")


@router.post("/jobs/import", dependencies=[CSRF])
def import_job_url(
    db: Db, settings: Config, session: CurrentSession, url: Annotated[str, Form()]
) -> Response:
    """Add one posting by URL (§7.2's manual import).

    For the role a friend forwards you, which no feed carries. It goes through
    exactly the same deduplication and assessment as a discovered one — a job
    added by hand is not a job exempt from the rules.
    """
    from app.services.discovery.manual import import_url

    try:
        job, verdict = import_url(db, url.strip(), now=datetime.now(UTC))
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    if verdict.is_new:
        enqueue(
            db,
            task_type=TaskType.ANALYZE_SPONSORSHIP,
            dedupe_key=idempotency_key(TaskType.ANALYZE_SPONSORSHIP, str(job.id)),
            payload={"job_id": str(job.id)},
        )
    return _redirect(f"/jobs/{job.id}")


@router.post("/settings/recruiters", dependencies=[CSRF])
async def import_recruiters(
    db: Db,
    session: CurrentSession,
    file: UploadFile,
    commit: Annotated[str, Form()] = "",
) -> Response:
    """Preview by default; commit only when explicitly asked.

    A spreadsheet with the wrong column order would otherwise write thousands of
    wrong rows before anyone saw it (§7.12).
    """
    import tempfile
    from pathlib import Path
    from urllib.parse import quote

    from app.services.recruiters import Source, commit_import, parse_xlsx, preview_import

    raw = await file.read()
    if (file.filename or "").lower().endswith(".xlsx"):
        # openpyxl reads from a path, not a stream. The temporary file is deleted
        # before the response is written, so a spreadsheet of personal contact
        # details does not outlive the request.
        with tempfile.NamedTemporaryFile(suffix=".xlsx") as handle:
            handle.write(raw)
            handle.flush()
            source: Source = list(parse_xlsx(Path(handle.name)))
    else:
        try:
            source = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "That file is not UTF-8 CSV. Re-export it as CSV UTF-8, or upload the .xlsx.",
            ) from exc

    report = commit_import(db, source) if commit else preview_import(db, source)
    return _redirect(f"/settings?import_report={quote(report.summary())}")
