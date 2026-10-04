# outreach_budget.gs — how three paths share one mailbox

Three paths send from one address. This file is the only place that decides how much of a day
each may have.

## Connections

- **Reads:** the `Email` and `Referral` tabs, as already-parsed rows. It opens no sheet itself.
- **Called by:** `outreachDueNow_` (cold), `outreachReferralRoomOn_` and
  `outreachReferralDueNow_` (referral), `outreachFollowUpDay_` (follow-up).

## The rule

`EMAIL_PATH_ORDER = ['referral', 'cold']` — Referral gets first refusal when the budget is
tight. Its queued work reserves up to the full **10-message Referral allowance**; cold email
then takes the remaining mailbox room. If fewer than 10 Referral rows can use the day, the
unused room remains available to the cold path.

- Referral goes first because it is the scarcest: six people per employer, no second attempt
  ever, so an ask that loses its place is one of six chances spent on nothing.
- The reservation matters because the cold path runs on an hourly trigger that has been firing
  for weeks. It protects today's Referral allocation from a lower path that fires first.
- **Follow-up is switched off** and is no longer in this list. A path missing from
  `EMAIL_PATH_ORDER` still gets a correct answer from `outreachBudgetRoom_` — the reservation
  loop simply never breaks early, so it reserves for every listed path — and its own
  `FOLLOWUP_DAILY_CAP` of 0 then makes `own` non-positive and the room zero.

**The caps no longer overbook the budget, and that is a change worth knowing about.** They used
to on purpose: a Tuesday was 27 cold + 20 referral + 6 follow-up = 53 against a hard 47, and the
reservation machinery above is what kept the mailbox under 47 anyway. Now 20 cold + 10 referral
+ 0 follow-up = exactly `DAILY_EMAIL_BUDGET`, so nothing ever competes and the ordering decides
nothing in practice. The machinery is still correct and still the guard rail — raise any path
cap without raising the budget and the paths start competing again, which is the intended
behaviour.

## Functions

| Function | Does |
|---|---|
| `outreachDaySpend_(queueRows, referralRows, day)` | How much of one day each path has already spent, as `{referral, cold, followup, total}`. `followup` is always 0 in practice while that path is off. |
| `outreachPathCap_(path, day)` | That path's own ceiling for that day — `REFERRAL_DAILY_CAP`, `outreachDailyCap_(day)`, or `FOLLOWUP_DAILY_CAP`. |
| `outreachPendingPathDemand_(queueRows, referralRows, day, path)` | Count of usable queued higher-priority rows that can consume that day's allowance. |
| `outreachBudgetRoom_(queueRows, referralRows, day, path)` | How many more messages `path` may send that day. `min(own cap − own spend, DAILY_EMAIL_BUDGET − total spend − pending reservation above)`, never below zero. |

## Gotcha

`outreachBudgetRoom_` counts sent/drafted rows as spend and queued higher-priority rows as
pending demand. It does not reserve a higher path's entire cap when that path has no usable
queued row for the day. A caller that re-places rows it has already counted must keep its own
accumulator (`outreachReferralReplan_` uses `fixed`) rather than assuming the budget knows the
difference.
