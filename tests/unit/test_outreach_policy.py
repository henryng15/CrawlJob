"""Outreach scheduling and anti-spam policy tests (spec §8)."""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta

import pytest

from app.services.outreach_policy import (
    EASTERN,
    OutreachContext,
    OutreachLimits,
    add_business_days,
    is_business_day,
    may_draft,
    may_follow_up,
    next_send_window,
    schedule_outreach,
)


def et(year: int, month: int, day: int, hour: int = 12, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=EASTERN)


# 2026-07-28 is a Tuesday.
TUESDAY = et(2026, 7, 28)
THURSDAY = et(2026, 7, 30)
FRIDAY = et(2026, 7, 31)
SATURDAY = et(2026, 8, 1)
SUNDAY = et(2026, 8, 2)
MONDAY = et(2026, 8, 3)


class TestBusinessDays:
    @pytest.mark.parametrize("moment", [TUESDAY, THURSDAY, FRIDAY, MONDAY])
    def test_weekdays_are_business_days(self, moment):
        assert is_business_day(moment)

    @pytest.mark.parametrize("moment", [SATURDAY, SUNDAY])
    def test_weekends_are_not(self, moment):
        assert not is_business_day(moment)

    def test_weekend_is_judged_in_eastern_not_utc(self):
        """Friday 9pm ET is Saturday in UTC; the policy is about the recipient."""
        friday_late = et(2026, 7, 31, 21)
        assert friday_late.astimezone(UTC).weekday() == 5, "precondition: Saturday in UTC"
        assert is_business_day(friday_late)

    def test_adding_zero_days_is_a_no_op(self):
        assert add_business_days(TUESDAY, 0) == TUESDAY

    def test_two_business_days_from_tuesday_is_thursday(self):
        assert add_business_days(TUESDAY, 2).date() == THURSDAY.date()

    def test_two_business_days_from_thursday_skips_the_weekend(self):
        """The rule that makes this worth having: Thursday + 2 is Monday."""
        assert add_business_days(THURSDAY, 2).date() == MONDAY.date()

    def test_two_business_days_from_friday_is_tuesday(self):
        assert add_business_days(FRIDAY, 2).date() == et(2026, 8, 4).date()

    def test_time_of_day_is_preserved(self):
        result = add_business_days(et(2026, 7, 28, 14, 45), 3)
        assert result.astimezone(EASTERN).time() == time(14, 45)

    def test_negative_days_are_rejected(self):
        with pytest.raises(ValueError, match="must be >= 0"):
            add_business_days(TUESDAY, -1)


class TestSendWindow:
    def test_inside_the_window_is_unchanged(self):
        moment = et(2026, 7, 28, 11)
        assert next_send_window(moment) == moment.astimezone(UTC)

    def test_before_the_window_waits_until_it_opens(self):
        result = next_send_window(et(2026, 7, 28, 6)).astimezone(EASTERN)
        assert result.date() == TUESDAY.date()
        assert result.time() == time(9, 30)

    def test_after_the_window_moves_to_the_next_morning(self):
        """Never schedule backwards; a late draft waits rather than looking early."""
        result = next_send_window(et(2026, 7, 28, 20)).astimezone(EASTERN)
        assert result.date() == et(2026, 7, 29).date()
        assert result.time() == time(9, 30)

    def test_friday_evening_lands_on_monday_morning(self):
        result = next_send_window(et(2026, 7, 31, 20)).astimezone(EASTERN)
        assert result.date() == MONDAY.date()
        assert result.time() == time(9, 30)

    @pytest.mark.parametrize("weekend", [SATURDAY, SUNDAY])
    def test_weekends_land_on_monday(self, weekend):
        assert next_send_window(weekend).astimezone(EASTERN).date() == MONDAY.date()

    def test_result_is_always_a_business_day_inside_the_window(self):
        limits = OutreachLimits()
        for offset in range(0, 24 * 10, 7):
            result = next_send_window(TUESDAY + timedelta(hours=offset))
            local = result.astimezone(EASTERN)
            assert is_business_day(result)
            assert limits.window_start <= local.time() <= limits.window_end


class TestScheduleOutreach:
    def test_two_business_days_after_submission(self):
        due = schedule_outreach(et(2026, 7, 28, 10)).astimezone(EASTERN)
        assert due.date() == THURSDAY.date()

    def test_weekend_submission_does_not_shorten_the_wait(self):
        """Submitting Friday must not produce a Sunday draft."""
        due = schedule_outreach(et(2026, 7, 31, 10)).astimezone(EASTERN)
        assert is_business_day(due)
        assert due.date() >= MONDAY.date()

    def test_result_is_inside_the_send_window(self):
        due = schedule_outreach(et(2026, 7, 28, 23)).astimezone(EASTERN)
        assert time(9, 30) <= due.time() <= time(15, 30)

    def test_calendar_days_can_be_configured(self):
        limits = OutreachLimits(use_business_days=False)
        due = schedule_outreach(et(2026, 7, 31, 10), limits).astimezone(EASTERN)
        assert due.date() >= MONDAY.date(), "still moved into a business-day window"


def ready(**overrides: object) -> OutreachContext:
    """A context that satisfies every rule, for overriding one at a time."""
    base = {
        "application_submitted": True,
        "submitted_at": TUESDAY - timedelta(days=3),
        "due_at": TUESDAY - timedelta(hours=1),
        "recruiter_email": "recruiter@acme.com",
    }
    return OutreachContext(**{**base, **overrides})  # type: ignore[arg-type]


class TestMayDraft:
    def test_a_fully_ready_application_is_allowed(self):
        assert may_draft(ready(), now=TUESDAY)

    @pytest.mark.parametrize(
        ("override", "fragment"),
        [
            ({"application_submitted": False}, "not confirmed submitted"),
            ({"submitted_at": None}, "no submission timestamp"),
            ({"application_withdrawn": True}, "withdrawn"),
            ({"due_at": None}, "not been scheduled"),
            ({"recruiter_email": None}, "no recruiter matched"),
            ({"recruiter_do_not_contact": True}, "do-not-contact"),
            ({"recruiter_replied": True}, "already replied"),
            ({"email_is_suppressed": True}, "suppression list"),
            ({"company_is_suppressed": True}, "company is on the suppression list"),
            ({"drafts_for_this_application": 1}, "already has a draft"),
            ({"contacts_to_company_last_30d": 2}, "already contacted"),
            ({"drafts_created_today": 3}, "daily limit"),
            ({"followups_sent": 2}, "follow-up limit"),
        ],
    )
    def test_each_suppression_rule_blocks_independently(self, override, fragment):
        decision = may_draft(ready(**override), now=TUESDAY)
        assert not decision
        assert any(fragment in r for r in decision.reasons), decision.reasons

    def test_not_yet_due_is_blocked(self):
        decision = may_draft(ready(due_at=TUESDAY + timedelta(days=1)), now=TUESDAY)
        assert not decision
        assert any("not due until" in r for r in decision.reasons)

    def test_recruiter_cooldown_is_enforced(self):
        """§8.1: 30 days between contacts with the same person."""
        decision = may_draft(
            ready(recruiter_last_contacted_at=TUESDAY - timedelta(days=10)), now=TUESDAY
        )
        assert not decision
        assert any("cooldown" in r for r in decision.reasons)

    def test_cooldown_expires(self):
        assert may_draft(
            ready(recruiter_last_contacted_at=TUESDAY - timedelta(days=45)), now=TUESDAY
        )

    def test_weekends_are_blocked(self):
        decision = may_draft(ready(), now=SATURDAY)
        assert not decision
        assert any("not a business day" in r for r in decision.reasons)

    def test_all_failing_reasons_are_reported_together(self):
        """The outreach screen should explain the whole picture at once."""
        decision = may_draft(
            ready(application_submitted=False, recruiter_replied=True, email_is_suppressed=True),
            now=SATURDAY,
        )
        assert len(decision.reasons) >= 4

    def test_daily_limit_can_be_raised_to_the_maximum(self):
        """§8.1 allows growing from 3 to 5 once the user trusts the output."""
        ctx = ready(drafts_created_today=4)
        assert not may_draft(ctx, now=TUESDAY)
        assert may_draft(ctx, now=TUESDAY, daily_limit=5)

    def test_the_limit_still_binds_at_the_maximum(self):
        assert not may_draft(ready(drafts_created_today=5), now=TUESDAY, daily_limit=5)


class TestMayFollowUp:
    SENT = et(2026, 7, 20, 10)

    def test_allowed_after_the_waiting_period(self):
        assert may_follow_up(ready(), sent_at=self.SENT, now=et(2026, 7, 29))

    def test_a_reply_cancels_it(self):
        """§8.4: the most visible way to look automated is following up mid-thread."""
        decision = may_follow_up(
            ready(recruiter_replied=True), sent_at=self.SENT, now=et(2026, 7, 29)
        )
        assert not decision
        assert any("replied" in r for r in decision.reasons)

    def test_too_soon_is_blocked(self):
        decision = may_follow_up(ready(), sent_at=self.SENT, now=et(2026, 7, 22))
        assert not decision
        assert any("too soon" in r for r in decision.reasons)

    def test_only_one_follow_up_is_permitted(self):
        decision = may_follow_up(ready(followups_sent=1), sent_at=self.SENT, now=et(2026, 8, 10))
        assert not decision
        assert any("already sent" in r for r in decision.reasons)

    def test_a_bounce_cancels_it(self):
        decision = may_follow_up(
            ready(email_is_suppressed=True), sent_at=self.SENT, now=et(2026, 8, 10)
        )
        assert not decision
