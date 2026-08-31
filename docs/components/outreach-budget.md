# outreach_budget.gs — how three paths share one mailbox

Three paths send from one address. This file is the only place that decides how much of a day
each may have.

## Connections

- **Reads:** the `Email` and `Referral` tabs, as already-parsed rows. It opens no sheet itself.
- **Called by:** `outreachDueNow_` (cold), `outreachReferralRoomOn_` and
  `outreachReferralDueNow_` (referral), `outreachFollowUpDay_` (follow-up).

## The rule

`EMAIL_PATH_ORDER = ['referral', 'cold', 'followup']` — a path **reserves** against everything
below it and **subtracts** everything above it.

- Referral goes first because it is the scarcest: six people per employer, no second attempt
  ever, so an ask that loses its place is one of six chances spent on nothing.
- Follow-up goes last because it is the only path that loses nothing by slipping a day — the
  message it chases has already landed, and its window is five to ten days wide.
- Reserving matters because the cold path runs on an hourly trigger that has been firing for
  weeks. Without a reservation it would take the whole budget every morning and the ordering
  would be a comment rather than a rule.

Individual path caps intentionally may sum to more than `DAILY_EMAIL_BUDGET`: a Tuesday can be
27 cold + 20 Referral + 6 follow-up = 53 against the hard 47-message budget. Referral reserves
first, so cold and then follow-up defer rather than the mailbox exceeding 47.

## Functions

| Function | Does |
|---|---|
| `outreachDaySpend_(queueRows, referralRows, day)` | How much of one day each path has already spent, as `{referral, cold, followup, total}`. |
| `outreachPathCap_(path, day)` | That path's own ceiling for that day — `REFERRAL_DAILY_CAP`, `outreachDailyCap_(day)`, or `FOLLOWUP_DAILY_CAP`. |
| `outreachBudgetRoom_(queueRows, referralRows, day, path)` | How many more messages `path` may send that day. `min(own cap − own spend, DAILY_EMAIL_BUDGET − total spend − reserved above)`, never below zero. |

## Gotcha

`outreachBudgetRoom_` counts *scheduled* rows, not only sent ones, so a planner asking about a
day it is currently filling gets a shrinking answer as it fills. That is intended for planning
across days. A caller that re-places rows it has already counted must keep its own accumulator
(`outreachReferralReplan_` uses `fixed`) rather than assuming the budget knows the difference.
