"""Outreach scheduling and anti-spam policy (spec §8).

The system is a personalized outreach assistant, not a bulk sender, and this
module is where that distinction is enforced. Every rule here answers a way the
tool could otherwise embarrass or harm the user:

* emailing about an application that was never actually submitted;
* emailing someone who already replied, or who asked not to be contacted;
* emailing three people at one company in a week;
* emailing at 3am, which reads as automation to any recipient.

Scheduling works in business days and in a New York working window (§16.1, §8.1).
Timestamps are stored UTC; the conversions live here so nothing else has to think
about it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta
from enum import StrEnum
from zoneinfo import ZoneInfo

__all__ = [
    "Decision",
    "OutreachLimits",
    "SuppressionReason",
    "add_business_days",
    "is_business_day",
    "may_draft",
    "next_send_window",
    "schedule_outreach",
]

EASTERN = ZoneInfo("America/New_York")


class SuppressionReason(StrEnum):
    REPLIED = "REPLIED"
    BOUNCED = "BOUNCED"
    OPT_OUT = "OPT_OUT"
    USER_MARKED = "USER_MARKED"
    INVALID_ADDRESS = "INVALID_ADDRESS"


@dataclass(frozen=True, slots=True)
class OutreachLimits:
    """Policy from §8.1. Conservative by default; the user may loosen it."""

    initial_daily_draft_limit: int = 3
    maximum_daily_draft_limit: int = 5
    minimum_days_after_application: int = 2
    use_business_days: bool = True
    window_start: time = time(9, 30)
    window_end: time = time(15, 30)
    maximum_recruiters_per_application: int = 1
    maximum_recruiters_per_company_30d: int = 2
    recruiter_cooldown_days: int = 30
    maximum_followups: int = 1
    followup_business_days: int = 6


def is_business_day(moment: datetime) -> bool:
    """Monday-Friday in Eastern time (§8.1 allowed_weekdays)."""
    return moment.astimezone(EASTERN).weekday() < 5


def add_business_days(start: datetime, days: int) -> datetime:
    """Advance ``start`` by ``days`` business days, preserving the time of day.

    Counts calendar-skipping days, so Thursday + 2 is Monday. Public holidays are
    not modelled: the cost of sending on Thanksgiving is a slightly worse open
    rate, not a correctness failure, and a holiday calendar would need annual
    maintenance the user has not asked for.
    """
    if days < 0:
        raise ValueError(f"days must be >= 0, got {days}")
    moment = start
    remaining = days
    while remaining > 0:
        moment += timedelta(days=1)
        if is_business_day(moment):
            remaining -= 1
    return moment


def next_send_window(moment: datetime, limits: OutreachLimits | None = None) -> datetime:
    """The first business-day moment at or after ``moment`` inside the send window.

    A draft created outside working hours is scheduled forward rather than
    backwards, so the system never presents something as ready earlier than the
    policy allows.
    """
    limits = limits or OutreachLimits()
    local = moment.astimezone(EASTERN)

    while True:
        if not is_business_day(local):
            local = datetime.combine(
                local.date() + timedelta(days=1), limits.window_start, tzinfo=EASTERN
            )
            continue
        if local.time() < limits.window_start:
            local = datetime.combine(local.date(), limits.window_start, tzinfo=EASTERN)
        elif local.time() > limits.window_end:
            local = datetime.combine(
                local.date() + timedelta(days=1), limits.window_start, tzinfo=EASTERN
            )
            continue
        return local.astimezone(UTC)


def schedule_outreach(
    submitted_at: datetime,
    limits: OutreachLimits | None = None,
) -> datetime:
    """When outreach for an application becomes due (§8.1).

    Two business days after a *confirmed* submission, moved into the send window.
    """
    limits = limits or OutreachLimits()
    if limits.use_business_days:
        due = add_business_days(submitted_at, limits.minimum_days_after_application)
    else:
        due = submitted_at + timedelta(days=limits.minimum_days_after_application)
    return next_send_window(due, limits)


@dataclass(slots=True)
class Decision:
    """Whether a draft may be created, and why not when it may not."""

    allowed: bool
    reasons: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return self.allowed


@dataclass(frozen=True, slots=True)
class OutreachContext:
    """Everything the policy needs. Assembled by the caller from the database."""

    application_submitted: bool
    submitted_at: datetime | None
    due_at: datetime | None
    recruiter_email: str | None
    recruiter_do_not_contact: bool = False
    recruiter_replied: bool = False
    recruiter_last_contacted_at: datetime | None = None
    email_is_suppressed: bool = False
    company_is_suppressed: bool = False
    drafts_created_today: int = 0
    contacts_to_company_last_30d: int = 0
    drafts_for_this_application: int = 0
    followups_sent: int = 0
    application_withdrawn: bool = False


def may_draft(
    ctx: OutreachContext,
    *,
    now: datetime,
    limits: OutreachLimits | None = None,
    daily_limit: int | None = None,
) -> Decision:
    """Apply every suppression rule in §8.2.

    Collects *all* failing reasons rather than returning at the first, so the
    outreach screen can explain the whole picture instead of one rule at a time.
    """
    limits = limits or OutreachLimits()
    cap = daily_limit if daily_limit is not None else limits.initial_daily_draft_limit
    reasons: list[str] = []

    # The rule that matters most: never claim an application was submitted unless
    # it was (§8.3). Everything downstream assumes this held.
    if not ctx.application_submitted:
        reasons.append("application is not confirmed submitted")
    if ctx.submitted_at is None:
        reasons.append("application has no submission timestamp")
    if ctx.application_withdrawn:
        reasons.append("application was withdrawn")

    if ctx.due_at is None:
        reasons.append("outreach has not been scheduled")
    elif now < ctx.due_at:
        reasons.append(f"not due until {ctx.due_at.isoformat()}")

    if not ctx.recruiter_email:
        reasons.append("no recruiter matched")
    if ctx.recruiter_do_not_contact:
        reasons.append("recruiter is marked do-not-contact")
    if ctx.recruiter_replied:
        reasons.append("recruiter already replied")
    if ctx.email_is_suppressed:
        reasons.append("recruiter address is on the suppression list")
    if ctx.company_is_suppressed:
        reasons.append("company is on the suppression list")

    if ctx.recruiter_last_contacted_at is not None:
        elapsed = now - ctx.recruiter_last_contacted_at
        if elapsed < timedelta(days=limits.recruiter_cooldown_days):
            reasons.append(
                f"recruiter contacted {elapsed.days} days ago, inside the "
                f"{limits.recruiter_cooldown_days}-day cooldown"
            )

    if ctx.drafts_for_this_application >= limits.maximum_recruiters_per_application:
        reasons.append("this application already has a draft")
    if ctx.contacts_to_company_last_30d >= limits.maximum_recruiters_per_company_30d:
        reasons.append(
            f"company already contacted {ctx.contacts_to_company_last_30d} times in 30 days"
        )
    if ctx.drafts_created_today >= cap:
        reasons.append(f"daily limit of {cap} drafts reached")
    if ctx.followups_sent > limits.maximum_followups:
        reasons.append("follow-up limit reached")

    if not is_business_day(now):
        reasons.append("today is not a business day")

    return Decision(allowed=not reasons, reasons=reasons)


def may_follow_up(
    ctx: OutreachContext,
    *,
    sent_at: datetime,
    now: datetime,
    limits: OutreachLimits | None = None,
) -> Decision:
    """Whether a single follow-up is permitted (§8.4).

    A reply cancels it outright — that check comes first, because following up on
    a conversation already underway is the most visible way to look automated.
    """
    limits = limits or OutreachLimits()
    reasons: list[str] = []

    if ctx.recruiter_replied:
        reasons.append("recruiter replied; follow-ups are cancelled")
    if ctx.email_is_suppressed:
        reasons.append("recruiter address is suppressed")
    if ctx.followups_sent >= limits.maximum_followups:
        reasons.append(f"already sent {ctx.followups_sent} follow-up(s)")

    earliest = add_business_days(sent_at, limits.followup_business_days)
    if now < earliest:
        reasons.append(f"too soon; earliest is {earliest.isoformat()}")

    return Decision(allowed=not reasons, reasons=reasons)
