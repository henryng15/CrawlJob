# outreach_budget.gs — how three paths share one mailbox

Three paths send from one address. This file is the only place that decides how much of a day
each may have.

## Connections

- **Reads:** the `Email` and `Referral` tabs, as already-parsed rows. It opens no sheet itself.
- **Called by:** `outreachDueNow_` (cold), `outreachReferralRoomOn_` and
  `outreachReferralDueNow_` (referral), `outreachFollowUpDay_` (follow-up).

## The rule

`EMAIL_PATH_ORDER = ['referral', 'cold', 'followup']` — a path gets first refusal when the
budget is tight. A higher-priority path reserves only the allowance it has real queued work
for on that day; an idle path does not strand its allowance.

- Referral goes first because it is the scarcest: six people per employer, no second attempt
  ever, so an ask that loses its place is one of six chances spent on nothing.
- Follow-up goes last because it is the only path that loses nothing by slipping a day — the
  message it chases has already landed, and its window is five to ten days wide.
- The reservation matters because the cold path runs on an hourly trigger that has been firing
  for weeks. It protects actual Referral/cold work from a lower path that fires first, while
  allowing follow-ups to use capacity that the higher paths cannot use.

Individual path caps intentionally may sum to more than `DAILY_EMAIL_BUDGET`: a Tuesday can be
27 cold + 20 Referral + 6 follow-up = 53 against the hard 47-message budget. Referral and
cold reserve only their pending work, so follow-up defers when those slots are needed and uses
otherwise idle room; the mailbox never exceeds 47.

## Functions

| Function | Does |
|---|---|
| `outreachDaySpend_(queueRows, referralRows, day)` | How much of one day each path has already spent, as `{referral, cold, followup, total}`. |
| `outreachPathCap_(path, day)` | That path's own ceiling for that day — `REFERRAL_DAILY_CAP`, `outreachDailyCap_(day)`, or `FOLLOWUP_DAILY_CAP`. |
| `outreachPendingPathDemand_(queueRows, referralRows, day, path)` | Count of usable queued higher-priority rows that can consume that day's allowance. |
| `outreachBudgetRoom_(queueRows, referralRows, day, path)` | How many more messages `path` may send that day. `min(own cap − own spend, DAILY_EMAIL_BUDGET − total spend − pending reservation above)`, never below zero. |

## Gotcha

`outreachBudgetRoom_` counts sent/drafted rows as spend and queued higher-priority rows as
pending demand. It does not reserve a higher path's entire cap when that path has no usable
queued row for the day. A caller that re-places rows it has already counted must keep its own
accumulator (`outreachReferralReplan_` uses `fixed`) rather than assuming the budget knows the
difference.
