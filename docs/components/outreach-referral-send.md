# outreach_referral_send.gs — the referral path's sheet and Gmail work

Everything the referral path does that touches something outside itself: reading the tab,
appending rows, writing drafts, sending, scanning replies, applying ticks.

## Connections

- **In:** the planners in [outreach-referral-queue.md](outreach-referral-queue.md); wording from
  [outreach-templates.md](outreach-templates.md).
- **Out:** the `Referral` tab and Gmail.
- **Called by:** `runOutreachCycle` — steps `referralScan`, `referralReplanned`,
  `referralPlanned`, `referralSent`, `referralDrafted`.

## Reading and appending

| Function | Does |
|---|---|
| `outreachReadReferralRows_(sheet)` | The tab, parsed, each row knowing its sheet row. **Filters out blank rows** — see the gotcha in [outreach-referral-queue.md](outreach-referral-queue.md). |
| `outreachReferralRowValues_(booking)` | One booked ask as the cells to append. Persists `Priority` for an automatic today/yesterday application so the reason it is urgent is visible and later replans retain the fast-lane lift. |
| `outreachReferralDomainFor_(employees)` | A company's domain out of the employee export, remembered per company. `jobs.apple.com` is the best link an ask can carry and no allowlist will contain it. |
| `outreachReferralAppKey_(...)`, `outreachReferralAppliedOn_(...)`, `outreachReferralAttemptFor_(...)`, `outreachReferralPersonFor_(...)` | The joins between `App`, the export and the tab. `outreachReferralCancelIneligible_` is the safety gate for old queued/drafted rows. |
| `planReferralAsks()` | Read `App`, `Referral` and the export; append what the planner booked. Returns without reading or writing while referral is paused. If a today/yesterday role was auto-marked `Priority`, immediately reprojects only movable `Queued` rows into the fast lane; existing `Drafted` and `Sent` rows stay fixed. |

## Drafting and sending

Drafting happens `DRAFT_LEAD_HOURS` (1) **ahead** of the slot, not at it, so the hour a message
could have been read always exists.

| Function | Does |
|---|---|
| `outreachReferralDraftHour_(scheduled)` | The hour a row's message is due to be written. |
| `outreachReferralToDraft_(rows, now)` | Rows whose message should exist by now. |
| `draftReferralAsks()` | Cancel queued/drafted recipients absent from the verified, non-invalid seed, then write eligible asks into Drafts. Sets `STATUS_DRAFTED`; returns without work while referral is paused. |
| `refreshReferralDraftsForTemplateChange()` | Run after an approved wording change: delete every unsent referral draft, return its row to `Queued`, and leave its scheduled hour intact so the next draft pass recreates it from the current template. |
| `outreachReferralToSend_(rows, now, globalMode, queueRows, priorityDaysByIndex)` | The drafted rows whose hour has arrived, after the shared budget and today/yesterday Priority ordering are applied. |
| `sendReferralAsks()` | Re-check the verified, non-invalid seed before sending. Ineligible queued/drafted rows have their unsent draft deleted and are cancelled before Gmail is touched; rejected applications are handled the same way. Returns without work while referral is paused. |
| `scanReferralReplies()` | Mark the asks that have been answered; returns without opening Gmail while referral is paused. |
| `repairMisreadReferralBounces()` | Run by hand: undo a bounce recorded as a reply. |

## Ticks, times and filing

| Function | Does |
|---|---|
| `outreachApplyReferralCancels_(sheet, rows)` | Settle every `Cancel` tick, expanded to whole asks. |
| `outreachApplyReferralTimes_(tracker, sheet, rows, fastPriorityIndexes, priorityDaysByIndex)` | **Re-time everything still queued** against what the whole mailbox has left. Passes the one-run newly-promoted Priority map and today/yesterday application-age map to `outreachReferralReplan_`, then writes each move with `outreachWriteRow_`. |
| `settleReferralTab_(tracker)` | Everything a tick means, done at once: cancel → re-time → refile. Sheet-only, so it is quick enough to hang off a keystroke. |
| `replanReferralAsks()` | The hourly version: first cancels queued/drafted recipients no longer in the verified, non-invalid seed, then cancels, discards orphaned drafts, promotes eligible existing `Queued` rows for today/yesterday applications, repoints rows onto newer applications, retires rows nothing qualifies for, re-times, refiles. Returns without work while referral is paused. |
| `sortReferralTab()` | Run by hand: file the tab in time order. |
| `checkReferralService()` | Run by hand: whether this path could work, without doing any of it. |
| `outreachReferralNotSetUp_()`, `outreachReferralIdle_()` | The one place the three entry points share their "tab is missing" wording. |

## Who owns the sort

The rule is written on `outreachSortReferralByTime_`: **whatever changes a sort key calls the
sort before it returns.** The keys are `Scheduled At` and whether the row is `Cancelled`.

| Group | Members |
|---|---|
| Owns the sort | `planReferralAsks`, `replanReferralAsks`, `settleReferralTab_`, `repairMisreadReferralBounces`, `sortReferralTab` |
| Cannot move a row | `draftReferralAsks`, `scanReferralReplies` — `Drafted`, `Replied`, `Bounced` are not `Cancelled` and none touches `Scheduled At` |
| Covered by the cycle | `sendReferralAsks` — only ever runs inside `runOutreachCycle`, whose last step refiles |

A fourth caller that writes a status or an hour outside the cycle belongs in the first group.

## Gotchas

- **The Gmail half and the sheet half are split deliberately.** `settleReferralTab_` marks a row
  `Cancelled` at the keystroke; `replanReferralAsks` bins its draft within the hour. Safe in that
  direction only, because `sendReferralAsks` sends nothing the tab no longer calls `Drafted`.
- `sendReferralAsks` repeats the rejection check immediately before sending because the
  one-minute trigger can run between hourly reconciliation passes. A rejected application is
  cancelled and its draft removed instead of being used for a referral request.
- The same one-minute boundary re-checks `Employees (seed)`: a row is sendable only when its
  email is present there with `Verify = debounce:valid`. Source provenance is enforced upstream;
  `pattern_calibrated` rows never enter the seed, and risky/invalid/unverified rows are removed
  before drafting or sending.
- `outreachApplyReferralTimes_` writes **one row at a time**. That is fine at 172 rows and was
  not fine at 499 — see [outreach-diagnostics.md](outreach-diagnostics.md).
