# outreach_referral_queue.gs — the Referral tab

Decides which applications are worth asking a favour about, who to ask, on what day and at what
hour, and in what order. A **new** row is admitted only for a non-quant employer whose application
is at most seven calendar days old or whose `App!Property` rank is in the top 70. An application
made today or yesterday is marked `Priority`; the overall mailbox cap still applies. Existing Referral rows are
never removed by this admission rule — a drafted or queued row remains in its established pipeline.
Almost all pure — the sheet work lives in [outreach-referral-send.md](outreach-referral-send.md).

## Connections

- **Reads:** `App` (every row is an application already made), `Employees (seed)` in the contacts
  spreadsheet, and the `Referral` tab itself.
- **Budget:** `outreachReferralRoomOn_` wraps `outreachBudgetRoom_`.
- **Shares:** `outreachInterleaveByCompany_` with the cold planner.

## The three caps

| Cap | Value | Why |
|---|---|---|
| `REFERRAL_DAILY_CAP` | 20 | What the mailbox will carry. Six of the fourteen 06:00–19:00 hours have capacity for two asks; no hour receives more than two. The shared 47-message mailbox cap remains authoritative. |
| `REFERRAL_PER_COMPANY` | 6 | People ever asked at one employer. No second attempt, ever. |
| `REFERRAL_COMPANY_DAILY_CAP` | **1** | People per employer per day. A full day reaches up to twenty employers rather than repeatedly concentrating on two, and the second ask at a company is still unwritten when the first is read — which is what gives a reply something to stop. |
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
| `outreachReferralAdmission_(app, today)` | The new-row gate: rejects quant firms, admits a ≤7-day application or a non-quant top-70 `Property` company, and marks applications from today or yesterday as automatic `Priority`. Does not alter existing Referral rows. |
| `outreachReferralAutomaticPriorities_(rows, apps, today)` | Finds existing **Queued** Referral rows at an employer with a today/yesterday application so the sender can persist Priority before re-timing. Drafted and Sent rows remain fixed. |
| `outreachPickReferralRole_(apps)` | Which of a company's applications to ask about. |

## People

| Function | Does |
|---|---|
| `outreachReadEmployees_(sheet)` | Employees by employer, from the tab ColdEmail exports. |
| `outreachEmployeesFor_(employees, company)` | The people at one employer. |
| `outreachParseApplication_(row, index, domainFor)` | One `App` row as the fields this path reads. |
| `outreachParseReferral_(row, index)` | One `Referral` row. Checkboxes read `=== true`: an untouched box reads as `''`, not `false`. |
| `outreachReferralAsked_(rows)` | Everyone this path has written to or is about to — **by address only**. A person is asked once and never again; asking twice for a favour is not persistence. Cancelled rows count as asked. |
| `outreachReferralSpent_(rows, company)` | How many people at one employer already have a row, whatever became of it. |

## Scheduling

| Function | Does |
|---|---|
| `outreachReferralLoad_(rows, upTo)` | Rows already booked per day, in total, per employer, by occupied hour and by exact timestamp for the Priority fast lane. |
| `outreachReferralPriorityGapMinutes_(...)` / `outreachReferralPrioritySlot_(...)` | Stable 10–20 minute jitter and the Priority slot finder. It uses the next two hours, avoids any Referral already within ten minutes, and returns no fast slot rather than bursting. |
| `outreachReferralSlot_(company, today, load, roomOn, priority, fastPriority)` | **The first slot this person can have.** A newly automatic Priority row first tries the two-hour fast lane, including a weekend or after the normal cutoff; otherwise it walks forward a day at a time, skipping weekends, checking the day's mailbox room, Referral cap and per-employer cap. Priority remains first in the normal queue after that one fast-lane pass, so an overloaded burst stays stable rather than re-timing hourly. At 20/day six ordinary hours may take two asks; no hour takes more than two. |
| `outreachReferralPlan_(...)` | **Which rows to add.** Applies the new-row admission gate before choosing a role, puts today/yesterday applications first, then runs round-robin: the outer loop is the attempt number, the inner loop the companies, so every employer gets its first ask before any gets its second. Company-by-company made the first employers fill multiple days while the two-hundredth waited a quarter of a year. |
| `outreachReferralRoomOn_(queueRows, rows)` | Returns a *function* of day, because the planner asks about days it has not thought of yet. |
| `outreachReferralReplan_(rows, today, roomOn, fastPriorityIndexes)` | **Re-times still-`Queued` rows whose drafting window has not opened.** Ticked rows first, then the rest; each half interleaved by company. `fastPriorityIndexes` is a one-run map for applications just recognised as today/yesterday Priority; only those rows use the two-hour lane. A queued row already due to be drafted keeps its hour so a transient dependency failure retries rather than being deferred every hour. `Drafted` rows have an addressed message against a particular hour, and `Sent` rows are history. All three occupy their day. |
| `outreachReferralDueNow_(rows, now, queueRows)` | Rows whose hour has come, `Drafted` and due, priority ahead of the clock. |
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
