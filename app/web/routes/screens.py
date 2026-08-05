"""Dashboard, job, application and settings screens (spec §22).

Every state-changing route goes through :func:`assert_transition`, so an invalid
move is a 400 rather than a corrupted row. The one route that changes the meaning
of an application is "I submitted this": it records what the *user* did in their
own browser, and it is the only way an application reaches SUBMITTED without the
machine having clicked anything.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from starlette.responses import RedirectResponse

from app.db.models import Application, Job, ResumeVersion, SourceRegistry
from app.db.models.sources import KINDS
from app.domain.states import (
    ApplicationState,
    InvalidTransition,
    JobState,
    assert_transition,
)
from app.domain.tasks import TaskType, idempotency_key
from app.services import audit
from app.services.candidate import Sensitivity, default_sensitivity, list_facts
from app.services.queue import enqueue
from app.web import queries
from app.web.deps import Config, CurrentSession, Db, require_csrf
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
    ("Resumes", "until you delete them"),
    ("Pre-submit screenshots", "30 days"),
    ("Confirmation screenshots", "12 months"),
    ("Logs", "30 days"),
)


def _redirect(to: str) -> RedirectResponse:
    return RedirectResponse(to, status_code=status.HTTP_303_SEE_OTHER)


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
            title="Let it press Submit",
            detail=(
                "Until this is on, every application is filled and then handed to "
                "you. With it on and dry-run off, the browser clicks Submit itself."
            ),
            done=settings.auto_submit_enabled and not settings.auto_submit_dry_run,
            summary=(
                f"on, up to {settings.max_auto_submits_per_day}/day"
                if settings.auto_submit_enabled and not settings.auto_submit_dry_run
                else ""
            ),
            command="AUTO_SUBMIT_ENABLED=true AUTO_SUBMIT_DRY_RUN=false in .env",
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
    """The whole point of the web app: what went out, and what is yours to finish."""
    now = datetime.now(UTC)
    return render(
        request,
        "dashboard.html",
        {"d": queries.dashboard(db, settings, now=now), "now": now},
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


def _selectable(db: Db, view: queries.JobDetail, settings: Config) -> tuple[bool, str]:
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
        .where(Application.status.notin_([ApplicationState.SKIPPED, ApplicationState.FAILED]))
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
    # One task, which attaches the resume and then decides the lane: a browser,
    # or straight to the user for an employer on the manual-only list.
    enqueue(
        db,
        task_type=TaskType.PREPARE_APPLICATION,
        dedupe_key=idempotency_key(TaskType.PREPARE_APPLICATION, str(application.id)),
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
    """The whole history, nothing filtered out by default.

    The dashboard answers "what now"; this answers "what has this thing ever done
    on my behalf", which is the question an audit trail exists for.
    """
    rows = queries._application_rows(db)
    if status:
        rows = [row for row in rows if row.status == status]
    return render(
        request,
        "applications.html",
        {
            "rows": rows,
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
            # NEEDS_ME and nothing else. Every other state either has not reached
            # a form yet or is already finished with.
            "can_mark_submitted": view.application.status == ApplicationState.NEEDS_ME,
        },
        session=session,
    )


@router.get("/applications/{application_id}/confirmation")
def confirmation_screenshot(
    db: Db, settings: Config, session: CurrentSession, application_id: uuid.UUID
) -> Response:
    """The picture of the page that said it went through.

    Kept because "SUBMITTED" is a claim, and a screenshot of the employer's own
    confirmation is the only thing that settles it months later.
    """
    from starlette.responses import FileResponse

    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such application")

    data = application.confirmation_data or {}
    raw = data.get("screenshot_path") or data.get("screenshot")
    if not isinstance(raw, str) or not raw:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No confirmation screenshot")

    # The path comes from the database, but a database row is not a capability.
    path = Path(raw).resolve()
    if not path.is_relative_to(settings.artifacts_dir.resolve()) or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Artifact missing")
    return FileResponse(path, media_type="image/png")


@router.post("/applications/{application_id}/submitted", dependencies=[CSRF])
def mark_submitted(db: Db, session: CurrentSession, application_id: uuid.UUID) -> Response:
    """Record that the *user* submitted, in their own browser.

    The only route from NEEDS_ME to SUBMITTED. The machine never takes an
    application back once it has handed it over, so this is a report of something
    that already happened rather than an instruction to do anything.
    """
    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such application")

    _move(
        application,
        ApplicationState.SUBMITTED,
        db=db,
        actor=session.username,
        method=queries.USER_CONFIRMED,
    )
    application.submitted_at = datetime.now(UTC)
    application.submission_detection_method = queries.USER_CONFIRMED
    application.submission_confidence = 1.0
    return _redirect("/")


@router.post("/applications/{application_id}/skip", dependencies=[CSRF])
def skip_application(db: Db, session: CurrentSession, application_id: uuid.UUID) -> Response:
    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such application")
    _move(application, ApplicationState.SKIPPED, db=db, actor=session.username)
    return _redirect("/")


# --------------------------------------------------------------- resumes


@router.get("/resumes")
def resume_versions(
    request: Request, db: Db, settings: Config, session: CurrentSession
) -> Response:
    """Every resume version, grouped by the application it was built for (§7.7).

    The screen exists to answer one question — why is *this* the PDF that went to
    the employer.
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
    """The ``.tex``, as plain text."""
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
    return _pdf_response(_artifact(db, settings, resume_id, "pdf"), inline=False)


@router.post("/resumes/{resume_id}/approve", dependencies=[CSRF])
def approve_resume(db: Db, session: CurrentSession, resume_id: uuid.UUID) -> Response:
    resume = db.get(ResumeVersion, resume_id)
    if resume is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such resume")
    resume.status = "APPROVED"
    return _redirect(f"/resumes/{resume_id}")


# -------------------------------------------------------------- settings


@router.get("/settings")
def settings_page(request: Request, db: Db, settings: Config, session: CurrentSession) -> Response:
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
            "retention": RETENTION,
            "sources": db.scalars(
                select(SourceRegistry).order_by(SourceRegistry.kind, SourceRegistry.identifier)
            ).all(),
            "source_kinds": KINDS,
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
            SourceRegistry(kind=kind, identifier=identifier.strip(), label=label.strip() or None)
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
            task_type=TaskType.SCORE_JOB,
            dedupe_key=idempotency_key(TaskType.SCORE_JOB, str(job.id)),
            payload={"job_id": str(job.id)},
        )
    return _redirect(f"/jobs/{job.id}")
