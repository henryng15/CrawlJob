# outreach_referral_queue.gs — the Referral tab

Decides which applications are worth asking a favour about, who to ask, on what day and at what
hour, and in what order. A **new** row is admitted only for a non-quant employer that is **not** in
the live `Target` tab and whose application was made today or yesterday. Referral is planned before
the other paths, capped at 15 asks per day, and the remainder goes to Email and Reply. Contacts are
booked by company/application cluster so one employer's asks stay together. Unsent rows that enter
the Target list or miss the two-day window are automatically cancelled. A separate recipient
safety gate cancels any queued or drafted row whose email is missing from `Employees (seed)` or
whose Verify value is the explicit `debounce:invalid`; blank and all other verification verdicts,
including pattern-calibrated and risky, may reach Gmail.
Almost all pure — the sheet work lives in [outreach-referral-send.md](outreach-referral-send.md).

## Connections

- **Reads:** `App` (every row is an application already made), `Employees (seed)` in the contacts
  spreadsheet, and the `Referral` tab itself.
- **Budget:** `outreachReferralRoomOn_` wraps `outreachBudgetRoom_`.
- **Shares:** the employer normaliser with the cold planner; Referral scheduling keeps each
  application/company cluster together.

## The three caps

| Cap | Value | Why |
|---|---|---|
| `REFERRAL_DAILY_CAP` | 15 | Hard referral maximum per day. The shared 47-message mailbox cap remains authoritative. |
| `REFERRAL_PER_COMPANY` | 6 | People ever asked at one employer. No second attempt, ever. |
| `REFERRAL_COMPANY_DAILY_CAP` | **6** | People per employer/application cluster per day. This keeps a fresh company's ask together without exceeding the six-person lifetime cap. |
| `REFERRAL_PRIORITY_COMPANY_CAP` | 6 | What a **ticked** employer gets: the whole group in one day if the day holds it. Raises the per-employer cap; the mailbox's own cap is never lifted, so ticking everything changes who goes first, not how many go. |

## Which link, which posting

| Function | Does |
|---|---|
| `outreachReferralHost_(url)`, `outreachReferralUnder_(host, domain)` | Host parsing. |
| `outreachReferralIsAggregator_(url)` | A link that redirects rather than being the posting. |
| `outreachReferralLinkOk_(url, domain, company)` | Whether this link can be put in front of somebody being asked for a referral. Three ways to pass: the employer's own domain, an ATS, or the company's name at the front of the host. `company` is optional — called with two arguments the name rule never fires. |
| `outreachReferralNameKeys_(company)` | The spellings of a name that may stand at the front of a host: the full name with punctuation removed, plus the single noise-stripped word when there is exactly one. |
| `outreachReferralNameMatchesHost_(host, company)` | The third rule. `blackrock.tal.net` is BlackRock, `amazon.jobs` is Amazon. First label only, matched whole, aggregators refused outright. |
| `outreachReferralLinkProblem_(url, domain, company)` | **Why** it was refused, for the person who has to fix it. |
| `outreachReferralNeedsLink_(appRows, employees)` | `App` rows that should be painted yellow, and why. Called by `syncAppOfficialWorklist` — see [outreach-app-worklist.md](outreach-app-worklist.md). Dead code until 2026-08-30, while the tracker script painted the tab on a looser rule of its own. |
| `outreachReferralSeason_(role)` | Whether a posting names the intake being asked about. `REFERRAL_REQUIRE_SEASON` is `false`: of 327 live `App` rows only 81 say "summer", and having applied is a far stronger signal than a word in a title. |
| `outreachReferralLive_(app)` | Whether this application is still worth asking a favour about. |
| `outreachReferralIsQuantFirm_(company)` | Whether the company matches the maintained quant-firm exclusion list. |
| `outreachReferralTargetCompanies_(tracker)` | Reads the four live seven-column Target blocks and returns the normalized company set used as the authoritative exclusion list. If Target cannot be read, planning is held. |
| `outreachReferralAdmission_(app, today, targetCompanies)` | The new-row gate: rejects quant firms and Target companies, and admits only an application made today or yesterday. Both ages are automatic `Priority`. |
| `outreachReferralAutomaticPriorities_(rows, apps, today, targetCompanies)` | Finds existing **Queued** Referral rows at a non-Target employer with a today/yesterday application so the sender can persist Priority before re-timing. Drafted and Sent rows remain fixed. |
| `outreachReferralAutomaticPriorityDays_(rows, apps, today, targetCompanies)` | Maps queued automatic-Priority rows to application age (`0` today, `1` yesterday), so an existing queue is re-timed inside its deadline. |
| `outreachPickReferralRole_(apps)` | Chooses one role per company: Software Engineer/Engineering Intern first, then a Technology role, then the remaining usable role by newest application and stable title order. |

## People

| Function | Does |
|---|---|
| `outreachReadEmployees_(sheet)` | Employees by employer, from the tab ColdEmail exports; admits every `Verify` value except `debounce:invalid`, including blank values. |
| `outreachEmployeesFor_(employees, company)` | The people at one employer. |
| `outreachParseApplication_(row, index, domainFor)` | One `App` row as the fields this path reads. |
| `outreachParseReferral_(row, index)` | One `Referral` row. Checkboxes read `=== true`: an untouched box reads as `''`, not `false`. |
| `outreachReferralAsked_(rows)` | Everyone in an active or sent row — **by address only**. Sent/Replied/Bounced are permanent; Cancelled/Failed rows are reusable because no message reached that person. |
| `outreachReferralSpent_(rows, company)` | How many people at one employer have an active or sent row; Cancelled/Failed rows do not consume the six-person allowance. |

## Scheduling

| Function | Does |
|---|---|
| `outreachReferralLoad_(rows, upTo)` | Rows already booked per day, in total, per employer, by occupied hour and by exact timestamp for the Priority fast lane. |
| `outreachReferralPriorityGapMinutes_(...)` / `outreachReferralPrioritySlot_(...)` | Stable 10–20 minute jitter and the Priority slot finder. It uses the next two hours, avoids any Referral already within ten minutes, and returns no fast slot rather than bursting. |
| `outreachReferralSlot_(company, today, load, roomOn, priority, fastPriority, latestDay)` | **The first slot this person can have**, never later than the application's same-day/next-day deadline. It checks mailbox room, the 15-message Referral cap and the per-company cluster cap. |
| `outreachReferralPlan_(...)` | **Which rows to add.** Applies Target + freshness admission, orders today before yesterday, and books each company cluster contiguously. |
| `outreachReferralRoomOn_(queueRows, rows)` | Returns a *function* of day, because the planner asks about days it has not thought of yet. Referral's 20 slots are considered before lower paths; unused Referral room can still be used by Email and Reply. |
| `outreachReferralReplan_(rows, today, roomOn, fastPriorityIndexes, priorityDaysByIndex)` | **Re-times still-`Queued` rows whose drafting window has not opened.** Manual Priority first, then automatic Priority applications from today and yesterday in that order, then the rest; each half remains grouped by company cluster. `fastPriorityIndexes` is a one-run map for applications just recognised as today/yesterday Priority; only those rows use the two-hour lane. `priorityDaysByIndex` keeps already queued automatic rows in fresh-application order even when their old hours disagree. A queued row already due to be drafted keeps its hour so a transient dependency failure retries rather than being deferred every hour. `Drafted` rows have an addressed message against a particular hour, and `Sent` rows are history. All three occupy their day. |
| `outreachReferralDueNow_(rows, now, queueRows, priorityDaysByIndex)` | Rows whose hour has come, `Drafted` and due, priority ahead of the clock; automatic Priority due today is selected before yesterday when a firing has limited room. |
| `outreachReferralAbandoned_(rows)` | Rows whose Gmail draft now points at a message nobody wants sent. |

## Groups — a tick moves the whole ask

| Function | Does |
|---|---|
| `outreachReferralGroupKey_(company, role, index)` | One employer, one posting. Falls back to `row:<index>` when either is blank. |
| `outreachReferralGroupOf_(rows, row)` | Every row a tick on one row should take with it. Six people at one company are **one decision**. |
| `outreachReferralToCancel_(rows)` | The rows a run must write `Cancelled` onto, ticks expanded to whole asks. The tick is the record, not whether `onEdit` saw it — a paste or fill-down fires no trigger. |
| `outreachReferralRepliedGroups_(rows)` | Groups somebody has already answered from. One engineer answering says nothing about a different req, and everything about the five colleagues queued for this one. |
| `outreachReferralReconcile_(rows, applications)` | The tab reconciled against `App`: rows to repoint at a newer application, rows to retire because nothing qualifies any more. |

## Filing and repair

| Function | Does |
|---|---|
| `outreachReferralRowTime_`, `outreachReferralTimeOrder_`, `outreachSortReferralByTime_` | Earliest first, called-off sunk to the bottom, sent rows keeping their place in the timeline. |
| `outreachReferralAudit_(rows)` | What the tab says day by day, and whether it obeys its own caps. |
| `auditReferralTab()` | Run by hand: the above, logged. |
| `repairReferralBlankRows()` | Clear the wreckage described below. Only touches rows **strictly below** the last real ask. |

## Gotcha — the self-amplifying blank row

`outreachReadReferralRows_` used to map every row up to `getLastRow()` into an ask, blanks
included. A blank row has no company, so no application matched it, so `outreachReferralReconcile_`
retired it — writing `Cancelled` and *"No application at  qualifies any more"* (note the doubled
space) into the blank row. That raised `getLastRow()`, handing the next firing one more blank to
retire. The tab grew from 173 real rows to 500, heading for the 1000-row ceiling.

Fixed by filtering on `row.company || row.email` **after** the map, so `index` stays the true
sheet row. `repairReferralBlankRows` clears what the bug already wrote.

## Gotcha — the tab had a second scheduler

The bound tracker script (`sync_applied_to_app.gs`) used to write these same two hour columns.
`orderReferralCancelledRows_` regrouped live rows into company+role blocks with the ticked asks
lifted to the top, and `reflowReferralTimes_` then dealt the tab's own hours back out **in row
order** — so one employer took six consecutive sending slots, and non-priority companies got well
past `REFERRAL_COMPANY_DAILY_CAP`. It ran on every Priority or Cancel tick and hourly from
`runHourlyHousekeeping`.

Nothing was wrong with the code in this file; the two projects simply undid each other on the hour.
On 2026-08-30 the live tab held Nuro with four asks on one day — arithmetic `outreachReferralSlot_`
cannot produce — while Cloud Logging showed the replan re-timing 97 rows that same hour.

Fixed at the other end: `reflowReferralTimes_` is deleted and `orderReferralCancelledRows_` now only
sinks called-off rows. **This file owns the Referral tab's order and its hours.** See
`tracker-sync.md`.
