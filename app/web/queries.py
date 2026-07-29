"""Read models for the web screens (spec §22).

Templates get plain dataclasses, not ORM objects. Two reasons: a template cannot
accidentally trigger a lazy load that turns one page into eighty queries, and the
shape a screen needs is stated here in Python where it can be tested, rather than
implied by whatever attributes a Jinja file happens to touch.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import (
    Application,
    ApplicationField,
    BrowserSession,
    Company,
    Job,
    JobScore,
    OutreachTask,
    Recruiter,
    ResumeVersion,
    ScheduledTask,
    SponsorshipAssessment,
)
from app.domain.states import ApplicationState, BrowserSlotState, JobState, OutreachState
from app.domain.tasks import TaskStatus

__all__ = [
    "ApplicationRow",
    "Dashboard",
    "JobRow",
    "OutreachRow",
    "TodayRun",
    "application_detail",
    "dashboard",
    "job_detail",
    "outreach_detail",
    "today_run",
]


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
    id: uuid.UUID
    job_title: str
    company: str
    status: str
    application_url: str
    updated_at: datetime
    unresolved_fields: int = 0
    expires_at: datetime | None = None
    restore_blocked_reason: str | None = None
    restored_at: datetime | None = None

    @property
    def needs_a_person(self) -> bool:
        return self.status in {
            ApplicationState.READY_FOR_REVIEW,
            ApplicationState.LIVE_REVIEW_READY,
            ApplicationState.MANUAL_LOGIN_REQUIRED,
            ApplicationState.MANUAL_FIELD_REQUIRED,
            ApplicationState.SUBMISSION_UNCERTAIN,
        }

    @property
    def restorable(self) -> bool:
        """Only expired applications, and only from the All Applications screen."""
        return self.status == ApplicationState.EXPIRED

    @property
    def was_restored(self) -> bool:
        return self.restored_at is not None

    def hours_left(self, *, now: datetime) -> float | None:
        """Hours until this stops waiting, or ``None`` when it is not waiting."""
        if self.expires_at is None:
            return None
        return max(0.0, (self.expires_at - now).total_seconds() / 3600)


@dataclass(frozen=True, slots=True)
class OutreachRow:
    id: uuid.UUID
    company: str
    job_title: str
    recruiter_name: str | None
    recruiter_email: str | None
    status: str
    due_at: datetime
    subject: str | None
    gmail_draft_id: str | None


@dataclass(frozen=True, slots=True)
class SlotRow:
    slot_name: str
    status: str
    application_id: uuid.UUID | None
    heartbeat_at: datetime | None
    expires_at: datetime | None

    def stale(self, *, now: datetime, tolerance: timedelta = timedelta(minutes=5)) -> bool:
        """A slot claiming to work with no recent heartbeat is a crashed slot."""
        if self.status in {BrowserSlotState.IDLE, BrowserSlotState.UNHEALTHY}:
            return False
        return self.heartbeat_at is None or now - self.heartbeat_at > tolerance


@dataclass(frozen=True, slots=True)
class Limits:
    """Today's usage against the configured caps (§9.3, §8.1)."""

    prepared_today: int
    prepared_cap: int
    drafts_today: int
    drafts_cap: int

    @property
    def prepared_exhausted(self) -> bool:
        return self.prepared_today >= self.prepared_cap

    @property
    def drafts_exhausted(self) -> bool:
        return self.drafts_today >= self.drafts_cap


@dataclass(frozen=True, slots=True)
class Dashboard:
    """Everything §22.1 asks for, in one round of queries."""

    discovered_today: list[JobRow] = field(default_factory=list)
    selected: list[JobRow] = field(default_factory=list)
    applications: list[ApplicationRow] = field(default_factory=list)
    awaiting_confirmation: list[ApplicationRow] = field(default_factory=list)
    replay_queue: list[ApplicationRow] = field(default_factory=list)
    slots: list[SlotRow] = field(default_factory=list)
    outreach_due: list[OutreachRow] = field(default_factory=list)
    drafts_ready: list[OutreachRow] = field(default_factory=list)
    queue_health: dict[str, int] = field(default_factory=dict)
    limits: Limits = Limits(0, 0, 0, 0)

    @property
    def needs_attention(self) -> int:
        """How many things are waiting on the user. Drives the header badge."""
        return (
            len([a for a in self.applications if a.needs_a_person])
            + len(self.awaiting_confirmation)
            + len(self.drafts_ready)
        )


@dataclass(frozen=True, slots=True)
class TodayRun:
    """§22.1's "what is happening today", separated from the whole history.

    The dashboard used to be both, and the two answer different questions. This
    one answers "how is today's run going" — the quota, what came out of it, and
    whether the machinery doing it is alive. Anything older than today belongs on
    All Applications, where it does not compete for attention with work that is
    still actionable.
    """

    day: date
    runs: tuple[str, ...] = ()
    limits: Limits = Limits(0, 0, 0, 0)
    waiting: list[ApplicationRow] = field(default_factory=list)
    prepared_today: list[ApplicationRow] = field(default_factory=list)
    expired_today: list[ApplicationRow] = field(default_factory=list)
    slots: list[SlotRow] = field(default_factory=list)
    queue_health: dict[str, int] = field(default_factory=dict)
    live_session_cap: int = 2

    @property
    def status_counts(self) -> list[tuple[str, int]]:
        """Today's prepared applications, grouped by where they got to."""
        counts: dict[str, int] = {}
        for row in self.prepared_today:
            counts[row.status] = counts.get(row.status, 0) + 1
        return sorted(counts.items())

    @property
    def live_sessions(self) -> int:
        return len([s for s in self.slots if s.application_id is not None])

    @property
    def needs_attention(self) -> int:
        return len(self.waiting)


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


def _application_rows(
    session: Session,
    *statuses: ApplicationState,
    exclude: tuple[ApplicationState, ...] = (),
) -> list[ApplicationRow]:
    unresolved = (
        select(
            ApplicationField.application_id.label("application_id"),
            func.count().label("n"),
        )
        .where(ApplicationField.manual_required.is_(True))
        .where(ApplicationField.user_overridden.is_(False))
        .group_by(ApplicationField.application_id)
        .subquery()
    )
    stmt = (
        select(
            Application.id,
            Job.title,
            Company.canonical_name,
            Application.status,
            Application.application_url,
            Application.updated_at,
            func.coalesce(unresolved.c.n, 0),
            Application.expires_at,
            Application.restore_blocked_reason,
            Application.restored_at,
        )
        .join(Job, Application.job_id == Job.id)
        .join(Company, Job.company_id == Company.id)
        .outerjoin(unresolved, unresolved.c.application_id == Application.id)
        .order_by(Application.updated_at.desc())
    )
    if statuses:
        stmt = stmt.where(Application.status.in_([s.value for s in statuses]))
    if exclude:
        stmt = stmt.where(Application.status.not_in([s.value for s in exclude]))
    return [
        ApplicationRow(
            id=row[0],
            job_title=row[1],
            company=row[2],
            status=row[3],
            application_url=row[4],
            updated_at=row[5],
            unresolved_fields=row[6],
            expires_at=row[7],
            restore_blocked_reason=row[8],
            restored_at=row[9],
        )
        for row in session.execute(stmt).all()
    ]


def _outreach_rows(session: Session, *statuses: OutreachState) -> list[OutreachRow]:
    stmt = (
        select(
            OutreachTask.id,
            Company.canonical_name,
            Job.title,
            Recruiter.full_name,
            Recruiter.email,
            OutreachTask.status,
            OutreachTask.due_at,
            OutreachTask.subject,
            OutreachTask.gmail_draft_id,
        )
        .join(Application, OutreachTask.application_id == Application.id)
        .join(Job, Application.job_id == Job.id)
        .join(Company, Job.company_id == Company.id)
        .outerjoin(Recruiter, OutreachTask.recruiter_id == Recruiter.id)
        .order_by(OutreachTask.due_at)
    )
    if statuses:
        stmt = stmt.where(OutreachTask.status.in_([s.value for s in statuses]))
    return [
        OutreachRow(
            id=row[0],
            company=row[1],
            job_title=row[2],
            recruiter_name=row[3],
            recruiter_email=row[4],
            status=row[5],
            due_at=row[6],
            subject=row[7],
            gmail_draft_id=row[8],
        )
        for row in session.execute(stmt).all()
    ]


# ------------------------------------------------------------- dashboard


def dashboard(session: Session, settings: Settings, *, now: datetime | None = None) -> Dashboard:
    """Assemble §22.1. ``now`` is injectable so "today" is testable."""
    moment = now or datetime.now(UTC)
    # "Today" means the user's day, not UTC's: at 21:00 Eastern the UTC date has
    # already rolled over, and a dashboard that empties itself every evening would
    # look like data loss.
    local_midnight = datetime.combine(
        moment.astimezone(settings.timezone).date(),
        datetime.min.time(),
        tzinfo=settings.timezone,
    ).astimezone(UTC)

    return Dashboard(
        discovered_today=_to_job_rows(
            session,
            _job_rows()
            .where(Job.discovered_at >= local_midnight)
            .order_by(Job.discovered_at.desc()),
        ),
        selected=_to_job_rows(
            session,
            _job_rows()
            .where(Job.status == JobState.SELECTED)
            .order_by(JobScore.total_score.desc()),
        ),
        # Expired applications leave this list and only this list (§7.9). They
        # are still in the database, still in the audit trail and still
        # restorable — but the dashboard answers "what is waiting for me", and
        # something the user has already let lapse is not an answer to that.
        applications=_application_rows(session, exclude=(ApplicationState.EXPIRED,)),
        awaiting_confirmation=_application_rows(
            session,
            ApplicationState.SUBMISSION_PENDING_CONFIRMATION,
            ApplicationState.SUBMISSION_UNCERTAIN,
        ),
        replay_queue=_application_rows(
            session, ApplicationState.READY_FOR_REPLAY, ApplicationState.REPLAYING
        ),
        slots=_slot_rows(session),
        outreach_due=_outreach_rows(session, OutreachState.SCHEDULED, OutreachState.FOLLOWUP_DUE),
        drafts_ready=_outreach_rows(session, OutreachState.READY_FOR_REVIEW),
        queue_health=_queue_health(session),
        limits=_limits(session, settings, since=local_midnight),
    )


def _slot_rows(session: Session) -> list[SlotRow]:
    """The open browser sessions, one per slot."""
    return [
        SlotRow(
            slot_name=row[0],
            status=row[1],
            application_id=row[2],
            heartbeat_at=row[3],
            expires_at=row[4],
        )
        for row in session.execute(
            select(
                BrowserSession.slot_name,
                BrowserSession.status,
                BrowserSession.application_id,
                BrowserSession.heartbeat_at,
                BrowserSession.expires_at,
            )
            .where(BrowserSession.ended_at.is_(None))
            .order_by(BrowserSession.slot_name)
        ).all()
    ]


def today_run(session: Session, settings: Settings, *, now: datetime | None = None) -> TodayRun:
    """Assemble the Today Run screen.

    "Today" is the user's day, not UTC's: at 21:00 Eastern the UTC date has
    already rolled over, and a screen that empties itself every evening looks
    exactly like data loss.
    """
    moment = now or datetime.now(UTC)
    local_midnight = datetime.combine(
        moment.astimezone(settings.timezone).date(),
        datetime.min.time(),
        tzinfo=settings.timezone,
    ).astimezone(UTC)

    # Prepared today, whatever became of them since — including the ones that
    # have already expired, because "30 prepared, 6 submitted, 24 lapsed" is the
    # honest summary of a day and hiding the last number would flatter it.
    prepared_today = _prepared_since(session, local_midnight)

    return TodayRun(
        day=moment.astimezone(settings.timezone).date(),
        runs=tuple(f"{t:%H:%M}" for t in settings.orchestration_times),
        limits=_limits(session, settings, since=local_midnight),
        waiting=[
            row
            for row in _application_rows(session, exclude=(ApplicationState.EXPIRED,))
            if row.needs_a_person
        ],
        prepared_today=prepared_today,
        expired_today=[
            row for row in prepared_today if row.status == ApplicationState.EXPIRED
        ],
        slots=_slot_rows(session),
        queue_health=_queue_health(session),
        live_session_cap=settings.max_live_sessions,
    )


def status_counts(session: Session) -> list[tuple[str, int]]:
    """Every application status and how many rows hold it, for the filter bar."""
    rows = session.execute(
        select(Application.status, func.count()).group_by(Application.status)
    ).all()
    return sorted((str(status), int(total)) for status, total in rows)


def _prepared_since(session: Session, since: datetime) -> list[ApplicationRow]:
    """Applications that became reviewable on or after ``since``.

    Keyed on ``ready_for_review_at`` because that is the same column the daily
    quota counts — so this list and the "27 / 30" above it can never disagree.
    """
    ids = set(
        session.scalars(
            select(Application.id).where(Application.ready_for_review_at >= since)
        ).all()
    )
    return [row for row in _application_rows(session) if row.id in ids]


def _queue_health(session: Session) -> dict[str, int]:
    rows = session.execute(
        select(ScheduledTask.status, func.count()).group_by(ScheduledTask.status)
    ).all()
    counts = {status: int(total) for status, total in rows}
    return {member.value.lower(): counts.get(member.value, 0) for member in TaskStatus}


def _limits(session: Session, settings: Settings, *, since: datetime) -> Limits:
    prepared = session.scalar(
        select(func.count())
        .select_from(Application)
        .where(Application.ready_for_review_at >= since)
    )
    drafts = session.scalar(
        select(func.count()).select_from(OutreachTask).where(OutreachTask.created_at >= since)
    )
    return Limits(
        prepared_today=int(prepared or 0),
        prepared_cap=settings.max_prepared_applications_per_day,
        drafts_today=int(drafts or 0),
        drafts_cap=settings.outreach_max_daily_limit,
    )


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
    """§22.4."""

    application: Application
    job: Job
    company: Company
    fields: list[ApplicationField]
    sponsorship: SponsorshipAssessment | None
    resume: ResumeVersion | None
    slot: BrowserSession | None

    @property
    def manual_fields(self) -> list[ApplicationField]:
        return [f for f in self.fields if f.manual_required and not f.user_overridden]

    @property
    def completion(self) -> tuple[int, int]:
        answered = sum(1 for f in self.fields if f.answer_json is not None)
        return answered, len(self.fields)

    @property
    def blocked(self) -> bool:
        """§7.9: an unanswered required field means the form is not ready."""
        return any(f.required and f.answer_json is None for f in self.fields)


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
        slot=session.scalars(
            select(BrowserSession)
            .where(BrowserSession.application_id == application.id)
            .where(BrowserSession.ended_at.is_(None))
        ).first(),
    )


@dataclass(frozen=True, slots=True)
class OutreachDetail:
    """§22.5."""

    task: OutreachTask
    application: Application
    job: Job
    company: Company
    recruiter: Recruiter | None
    candidates: list[Recruiter]

    @property
    def hook(self) -> dict[str, Any]:
        return self.task.hook_json or {}

    @property
    def hook_source(self) -> str | None:
        source = self.hook.get("source_url")
        return source if isinstance(source, str) else None

    @property
    def withheld(self) -> list[str]:
        """Why the draft was not created, if it was not (§8.2).

        A missing draft with no explanation is indistinguishable from a bug, and
        the user would reasonably start looking for one.
        """
        reasons = self.hook.get("withheld")
        return [str(r) for r in reasons] if isinstance(reasons, list) else []

    @property
    def gmail_url(self) -> str | None:
        """Deep link to the draft. Opening it is the user's send button."""
        if not self.task.gmail_draft_id:
            return None
        return f"https://mail.google.com/mail/u/0/#drafts?compose={self.task.gmail_draft_id}"


def outreach_detail(session: Session, task_id: uuid.UUID) -> OutreachDetail | None:
    task = session.get(OutreachTask, task_id)
    if task is None:
        return None
    application = session.get(Application, task.application_id)
    assert application is not None
    job = session.get(Job, application.job_id)
    assert job is not None
    company = session.get(Company, job.company_id)
    assert company is not None

    return OutreachDetail(
        task=task,
        application=application,
        job=job,
        company=company,
        recruiter=session.get(Recruiter, task.recruiter_id) if task.recruiter_id else None,
        # Offered under "change recruiter" (§22.5). Suppressed contacts are
        # excluded here rather than shown and refused later.
        candidates=list(
            session.scalars(
                select(Recruiter)
                .where(Recruiter.company_id == company.id)
                .where(Recruiter.do_not_contact.is_(False))
                .order_by(Recruiter.full_name)
                .limit(25)
            ).all()
        ),
    )


def today_in(settings: Settings, moment: datetime) -> date:
    return moment.astimezone(settings.timezone).date()
