# outreach_budget.gs — how three paths share one mailbox

Three paths send from one address. This file is the only place that decides how much of a day
each may have.

## Connections

- **Reads:** the `Email` and `Referral` tabs, as already-parsed rows. It opens no sheet itself.
- **Called by:** `outreachDueNow_` (cold), `outreachReferralRoomOn_` and
  `outreachReferralDueNow_` (referral), `outreachFollowUpDay_` (follow-up).

## The rule

`EMAIL_PATH_ORDER = ['referral', 'cold', 'followup']` — Referral gets first refusal when the
budget is tight. Its queued work reserves up to the full **20-message Referral allowance**;
cold email and follow-up then coordinate over the remaining mailbox room. If fewer than 20
Referral rows can use the day, the unused room remains available to the lower paths.

- Referral goes first because it is the scarcest: six people per employer, no second attempt
  ever, so an ask that loses its place is one of six chances spent on nothing.
- Follow-up goes last because it is the only path that loses nothing by slipping a day — the
  message it chases has already landed, and its window is five to ten days wide.
- The reservation matters because the cold path runs on an hourly trigger that has been firing
  for weeks. It protects today's Referral allocation from a lower path that fires first, while
  allowing Email and Reply to self-coordinate over whatever remains.

Individual path caps intentionally may sum to more than `DAILY_EMAIL_BUDGET`: a Tuesday can be
27 cold + 20 Referral + 6 follow-up = 53 against the hard 47-message budget. Referral reserves
its pending capacity first, cold receives the remaining room, and follow-up yields last; the
mailbox never exceeds 47 under the normal planner.

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
