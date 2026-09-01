# outreach_followup.gs — the nudge on an existing thread

A follow-up is a reply posted onto the thread the cold email already made, never a new message.
Last in `EMAIL_PATH_ORDER` because it is the only path that loses nothing by slipping a day.

## Connections

- **Reads:** `Email` rows that were sent and not answered; Gmail, for the thread and its
  `Message-ID`.
- **Writes:** the three follow-up columns on `Email` (`Q_FOLLOWUP_AT`, `_TEMPLATE`, `_STATUS`).
- **Budget:** `outreachBudgetRoom_(..., 'followup')` — see [outreach-budget.md](outreach-budget.md).

## Windows and caps

| Constant | Value | Means |
|---|---|---|
| `FOLLOWUP_AFTER_DAYS` | 5 | Earliest a nudge may land. |
| `FOLLOWUP_WINDOW_DAYS` | 10 | How wide the landing window is. |
| `FOLLOWUP_LATEST_DAYS` | 21 | After this the nudge is dropped, not delayed. |
| `FOLLOWUP_DAILY_CAP` | 6 | Per day. |
| `FOLLOWUP_WEEKENDS` | `true` | Unlike the referral path. |

## Deciding

| Function | Does |
|---|---|
| `outreachFollowUpEarns_(row)` | Whether a row is the kind that earns a follow-up at all. |
| `outreachCompanyHasReply_(rows, company)` | Whether anyone at this employer has already answered — if so, nobody there is nudged. |
| `outreachFollowUpWindow_(row)` | The span of days this row's nudge may land in. |
| `outreachFollowUpDay_(...)` | The first day with room, starting at the front of the window. |
| `outreachFollowUpHoursForDay_(day)` | The hours a full day is handed out at. |
| `outreachFollowUpAt_(day, index)` | Day plus hour, as one timestamp. |
| `outreachDayKey_(date)` | Day identity for the load tables. |
| `outreachPlanFollowUps_(...)` | **Pure:** book every row that earned one, and un-book every row that stopped earning it. |
| `outreachFollowUpsDueNow_(...)` | The follow-ups this firing may send. |

## Wording

| Function | Does |
|---|---|
| `outreachFollowUpStartFor_(company)`, `outreachFollowUpTemplateFor_(...)` | The stable company-specific ordering of the twenty notes. |
| `outreachFollowUpTemplateLoad_(...)`, `outreachBalancedFollowUpTemplateFor_(...)` | Count live Queued, Drafted and Sent follow-up bookings, then give a new row the least-used note. The company-specific ordering breaks ties, so colleagues still differ. |
| `outreachFollowUpBody_(...)` | One follow-up, as the plain text that actually goes. |

## Sending

| Function | Does |
|---|---|
| `outreachMessageIdHeader_(message)` | The `Message-ID` of a message this account sent — what makes the reply thread correctly. |
| `outreachSendFollowUp_(row)` | Post one reply onto the existing thread. |
| `planFollowUpReplies()` | Write the plan onto the tab. |
| `sendFollowUpReplies()` | Send the ones whose day has come. |
| `replanOutreachFollowUps()` | Run by hand: throw away every booking not yet gone, and book again. |
| `checkOutreachFollowUpService()` | Run by hand: whether the one thing this file needs from Gmail actually works. |
| `previewOutreachFollowUps()` | Run by hand: print all twenty templates as a list. |

## Gotcha

Planning happens **before** sending in the cycle, so a row booked for today may go out on the
same firing rather than waiting an hour. Reversing the two would add an hour to every nudge.

The balance rule only applies when a new booking is made. A queued or drafted follow-up retains
the template number it already advertises, so a replan cannot silently change a message under
review.
