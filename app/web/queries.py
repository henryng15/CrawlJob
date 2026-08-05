"""Read models for the web screens (spec §22).

Templates get plain dataclasses, not ORM objects. Two reasons: a template cannot
accidentally trigger a lazy load that turns one page into eighty queries, and the
shape a screen needs is stated here in Python where it can be tested, rather than
implied by whatever attributes a Jinja file happens to touch.

The dashboard is now one list of applications split three ways — submitted,
waiting on the user, finished with. Everything that used to feed it (browser
slots, outreach, expiry countdowns) described machinery the user was not asking
about.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import (
    Application,
    ApplicationField,
    AuditEvent,
    Company,
    Job,
    JobScore,
    ResumeVersion,
    ScheduledTask,
    SponsorshipAssessment,
)
from app.domain.states import ApplicationState
from app.domain.tasks import TaskStatus

__all__ = [
    "ApplicationRow",
    "Dashboard",
    "JobRow",
    "ResumeGroup",
    "application_detail",
    "dashboard",
    "job_detail",
    "resume_groups",
    "status_counts",
]

#: What ``submission_detection_method`` holds when the user pressed the button.
USER_CONFIRMED = "USER_CONFIRMED"


# ------------------------------------------------------------------ rows


@dataclass(frozen=True, slots=True)
class JobRow:
    id: uuid.UUID
    title: str
    company: str
    location: str | None
    status: str
    score: float | None
    discovered_at: datetime
    sponsorship: str | None
    url: str

    @property
    def age_days(self) -> int:
        return (datetime.now(UTC) - self.discovered_at).days


@dataclass(frozen=True, slots=True)
class ApplicationRow:
    """One application, in the terms the dashboard talks about it.

    ``needs_me_reason`` and ``missing_fields`` are the whole point of the screen:
    the machine stopped, and these two say why and what is left to type.
    """

    id: uuid.UUID
    job_title: str
    company: str
    status: str
    application_url: str
    updated_at: datetime
    needs_me_reason: str | None = None
    missing_fields: tuple[str, ...] = ()
    needs_me_at: datetime | None = None
    submitted_at: datetime | None = None
    submission_detection_method: str | None = None
    confirmation_screenshot: bool = False
    #: Why it failed or was skipped, taken from the audit log. There is no error
    #: column on the row, and "FAILED" with no sentence next to it sends the user
    #: to the worker log for something the log already recorded.
    note: str | None = None

    @property
    def needs_me(self) -> bool:
        return self.status == ApplicationState.NEEDS_ME

    @property
    def marked_by_you(self) -> bool:
        return self.submission_detection_method == USER_CONFIRMED

    @property
    def detection(self) -> str:
        """How the submission was established, in words rather than a code."""
        if self.submission_detection_method is None:
            return "—"
        if self.marked_by_you:
            return "you marked it"
        return f"auto-detected ({self.submission_detection_method})"

    @property
    def when(self) -> datetime:
        """The moment this row last meant something, whatever its state."""
        return self.submitted_at or self.needs_me_at or self.updated_at


@dataclass(frozen=True, slots=True)
class Dashboard:
    """The one screen: what went out, what is yours to finish, what is over.

    ``in_progress`` is not one of the three groups the user asked for, but
    dropping it would make an application the machine is holding look like an
    application that vanished.
    """

    needs_me: list[ApplicationRow] = field(default_factory=list)
    submitted: list[ApplicationRow] = field(default_factory=list)
    closed: list[ApplicationRow] = field(default_factory=list)
    in_progress: list[ApplicationRow] = field(default_factory=list)
    submitted_today: int = 0
    daily_cap: int = 0
    auto_submit_enabled: bool = False
    dry_run: bool = True
    queue_health: dict[str, int] = field(default_factory=dict)

    @property
    def needs_attention(self) -> int:
        """How many things are waiting on the user. Drives the header badge."""
        return len(self.needs_me)

    @property
    def cap_reached(self) -> bool:
        return self.submitted_today >= self.daily_cap


# ------------------------------------------------------------- selectors


def _job_rows() -> Select[Any]:
    return (
        select(
            Job.id,
            Job.title,
            Company.canonical_name,
            Job.location_text,
            Job.status,
            JobScore.total_score,
            Job.discovered_at,
            SponsorshipAssessment.classification,
            Job.canonical_url,
        )
        .join(Company, Job.company_id == Company.id)
        .outerjoin(JobScore, JobScore.job_id == Job.id)
        .outerjoin(SponsorshipAssessment, SponsorshipAssessment.job_id == Job.id)
    )


def _to_job_rows(session: Session, stmt: Select[Any]) -> list[JobRow]:
    return [
        JobRow(
            id=row[0],
            title=row[1],
            company=row[2],
            location=row[3],
            status=row[4],
            score=float(row[5]) if row[5] is not None else None,
            discovered_at=row[6],
            sponsorship=row[7],
            url=row[8],
        )
        for row in session.execute(stmt).all()
    ]


def _questions(raw: Any) -> tuple[str, ...]:
    """Coerce the ``missing_fields`` JSONB list into strings for the template."""
    if not isinstance(raw, list):
        return ()
    return tuple(str(item) for item in raw if item)


def _has_screenshot(raw: Any) -> bool:
    if not isinstance(raw, dict):
        return False
    return bool(raw.get("screenshot_path") or raw.get("screenshot"))


def _application_rows(
    session: Session,
    *statuses: ApplicationState,
    exclude: tuple[ApplicationState, ...] = (),
) -> list[ApplicationRow]:
    stmt = (
        select(
            Application.id,
            Job.title,
            Company.canonical_name,
            Application.status,
            Application.application_url,
            Application.updated_at,
            Application.needs_me_reason,
            Application.missing_fields,
            Application.needs_me_at,
            Application.submitted_at,
            Application.submission_detection_method,
            Application.confirmation_data,
        )
        .join(Job, Application.job_id == Job.id)
        .join(Company, Job.company_id == Company.id)
        .order_by(Application.updated_at.desc())
    )
    if statuses:
        stmt = stmt.where(Application.status.in_([s.value for s in statuses]))
    if exclude:
        stmt = stmt.where(Application.status.not_in([s.value for s in exclude]))

    rows = [
        ApplicationRow(
            id=row[0],
            job_title=row[1],
            company=row[2],
            status=row[3],
            application_url=row[4],
            updated_at=row[5],
            needs_me_reason=row[6],
            missing_fields=_questions(row[7]),
            needs_me_at=row[8],
            submitted_at=row[9],
            submission_detection_method=row[10],
            confirmation_screenshot=_has_screenshot(row[11]),
        )
        for row in session.execute(stmt).all()
    ]
    return _with_notes(session, rows)


def _with_notes(session: Session, rows: list[ApplicationRow]) -> list[ApplicationRow]:
    """Attach the last recorded explanation to every failed or skipped row.

    Read from the audit log rather than from a column, because the log is where
    the worker already writes the sentence and a second copy could disagree with
    it.
    """
    from dataclasses import replace

    wanted = {
        row.id for row in rows if row.status in {ApplicationState.FAILED, ApplicationState.SKIPPED}
    }
    if not wanted:
        return rows

    notes: dict[uuid.UUID, str] = {}
    for entity_id, payload in session.execute(
        select(AuditEvent.entity_id, AuditEvent.event_metadata)
        .where(AuditEvent.entity_type == "application")
        .where(AuditEvent.entity_id.in_(wanted))
        .order_by(AuditEvent.created_at)
    ).all():
        if not isinstance(payload, dict):
            continue
        text = next(
            (str(payload[key]) for key in ("error", "reason", "detail") if payload.get(key)),
            None,
        )
        if entity_id is not None and text:
            notes[entity_id] = text

    return [replace(row, note=notes.get(row.id)) if row.id in notes else row for row in rows]


# ------------------------------------------------------------- dashboard


def dashboard(session: Session, settings: Settings, *, now: datetime | None = None) -> Dashboard:
    """Assemble the one screen. ``now`` is injectable so "today" is testable."""
    moment = now or datetime.now(UTC)
    # "Today" means the user's day, not UTC's: at 21:00 Eastern the UTC date has
    # already rolled over, and a counter that resets every evening would say the
    # cap was free when it was not.
    local_midnight = datetime.combine(
        moment.astimezone(settings.timezone).date(),
        datetime.min.time(),
        tzinfo=settings.timezone,
    ).astimezone(UTC)

    rows = _application_rows(session)
    submitted = [r for r in rows if r.status == ApplicationState.SUBMITTED]
    closed = [r for r in rows if r.status in {ApplicationState.FAILED, ApplicationState.SKIPPED}]
    return Dashboard(
        needs_me=sorted((r for r in rows if r.needs_me), key=lambda r: r.when, reverse=True),
        submitted=sorted(submitted, key=lambda r: r.when, reverse=True),
        closed=closed,
        in_progress=[
            r
            for r in rows
            if r.status
            in {
                ApplicationState.CREATED,
                ApplicationState.MATERIALS_READY,
                ApplicationState.BROWSER_QUEUED,
                ApplicationState.BROWSER_FILLING,
            }
        ],
        submitted_today=len(
            [r for r in submitted if r.submitted_at and r.submitted_at >= local_midnight]
        ),
        daily_cap=settings.max_auto_submits_per_day,
        auto_submit_enabled=settings.auto_submit_enabled,
        dry_run=settings.auto_submit_dry_run,
        queue_health=_queue_health(session),
    )


@dataclass(frozen=True, slots=True)
class ResumeGroup:
    """Every resume version built for one application (§7.7)."""

    application_id: uuid.UUID
    company: str
    job_title: str
    versions: list[ResumeVersion] = field(default_factory=list)

    @property
    def selected(self) -> ResumeVersion | None:
        """The version the build chose. May never have reached an employer."""
        return next((v for v in self.versions if v.is_selected), None)

    @property
    def uploaded(self) -> ResumeVersion | None:
        """The version a browser actually attached to the form."""
        return next((v for v in self.versions if v.is_uploaded), None)

    @property
    def awaiting_upload(self) -> bool:
        """Chosen, but not yet sent anywhere.

        Normal for an application still queued for a browser, and the signal worth
        looking at for one a browser has already been through.
        """
        return self.selected is not None and self.uploaded is None

    @property
    def attempts(self) -> int:
        return len([v for v in self.versions if v.kind == "TAILORED"])

    @property
    def fell_back(self) -> bool:
        chosen = self.selected
        return chosen is not None and chosen.kind == "BASE"


def resume_groups(session: Session, *, limit: int = 200) -> list[ResumeGroup]:
    """Resume versions, grouped by the application they were built for.

    Ordered newest application first, and attempts in build order within each —
    so the page reads as a history rather than as a list of files.
    """
    rows = session.execute(
        select(ResumeVersion, Job.title, Company.canonical_name)
        .join(Application, ResumeVersion.application_id == Application.id)
        .join(Job, Application.job_id == Job.id)
        .join(Company, Job.company_id == Company.id)
        .order_by(ResumeVersion.created_at.desc(), ResumeVersion.attempt)
        .limit(limit)
    ).all()

    groups: dict[uuid.UUID, ResumeGroup] = {}
    for version, title, company in rows:
        group = groups.get(version.application_id)
        if group is None:
            group = ResumeGroup(
                application_id=version.application_id, company=company, job_title=title
            )
            groups[version.application_id] = group
        group.versions.append(version)

    for group in groups.values():
        group.versions.sort(key=lambda v: (v.kind != "BASE", v.attempt))
    return list(groups.values())


def status_counts(session: Session) -> list[tuple[str, int]]:
    """Every application status and how many rows hold it, for the filter bar."""
    rows = session.execute(
        select(Application.status, func.count()).group_by(Application.status)
    ).all()
    return sorted((str(status), int(total)) for status, total in rows)


def _queue_health(session: Session) -> dict[str, int]:
    rows = session.execute(
        select(ScheduledTask.status, func.count()).group_by(ScheduledTask.status)
    ).all()
    counts = {status: int(total) for status, total in rows}
    return {member.value.lower(): counts.get(member.value, 0) for member in TaskStatus}


# ----------------------------------------------------------------- detail


@dataclass(frozen=True, slots=True)
class JobDetail:
    """§22.2. ``duplicates`` is the "duplicate analysis" the spec asks for."""

    job: Job
    company: Company
    score: JobScore | None
    sponsorship: SponsorshipAssessment | None
    duplicates: list[JobRow]
    application: Application | None

    @property
    def components(self) -> list[tuple[str, Any]]:
        if self.score is None:
            return []
        return sorted(self.score.components.items())


def job_detail(session: Session, job_id: uuid.UUID) -> JobDetail | None:
    job = session.get(Job, job_id)
    if job is None:
        return None
    company = session.get(Company, job.company_id)
    assert company is not None  # FK guarantees it

    # Both directions: rows this one absorbed, and the row that absorbed it.
    related = _job_rows().where(
        (Job.duplicate_of_id == job.id)
        | ((Job.id == job.duplicate_of_id) if job.duplicate_of_id else False)
    )
    return JobDetail(
        job=job,
        company=company,
        score=session.scalars(select(JobScore).where(JobScore.job_id == job.id)).first(),
        sponsorship=session.scalars(
            select(SponsorshipAssessment).where(SponsorshipAssessment.job_id == job.id)
        ).first(),
        duplicates=_to_job_rows(session, related),
        application=session.scalars(
            select(Application).where(Application.job_id == job.id)
        ).first(),
    )


@dataclass(frozen=True, slots=True)
class ApplicationDetail:
    """§22.4: what the machine put on the form, and what it would not answer."""

    application: Application
    job: Job
    company: Company
    fields: list[ApplicationField]
    sponsorship: SponsorshipAssessment | None
    resume: ResumeVersion | None

    @property
    def missing_fields(self) -> tuple[str, ...]:
        return _questions(self.application.missing_fields)

    @property
    def completion(self) -> tuple[int, int]:
        answered = sum(1 for f in self.fields if f.answer_json is not None)
        return answered, len(self.fields)

    @property
    def confirmation_screenshot(self) -> bool:
        return _has_screenshot(self.application.confirmation_data)


def application_detail(session: Session, application_id: uuid.UUID) -> ApplicationDetail | None:
    application = session.get(Application, application_id)
    if application is None:
        return None
    job = session.get(Job, application.job_id)
    assert job is not None
    company = session.get(Company, job.company_id)
    assert company is not None

    return ApplicationDetail(
        application=application,
        job=job,
        company=company,
        fields=list(
            session.scalars(
                select(ApplicationField)
                .where(ApplicationField.application_id == application.id)
                .order_by(ApplicationField.page_index, ApplicationField.created_at)
            ).all()
        ),
        sponsorship=session.scalars(
            select(SponsorshipAssessment).where(SponsorshipAssessment.job_id == job.id)
        ).first(),
        resume=(
            session.get(ResumeVersion, application.resume_version_id)
            if application.resume_version_id
            else None
        ),
    )
