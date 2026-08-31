# apps_script/sync_applied_to_app.gs — the tracker-bound script

Bound to the spreadsheet. Owns the moment a job becomes an application, every tab's layout,
and the hourly housekeeping. Script id `1WrD8HUZ...`; `clasp` profile `default` pushes it,
`kenyon` deploys it.

## API execution

The bound project exposes its Execution API with `access: ANYONE`, so any signed-in Google
account can invoke it. This is deliberately broader than the two editor accounts because Apps
Script cannot allowlist two accounts from different domains at the executable level. It exists
for `clasp run`; keep calls to named administrative or diagnostic functions and do not expose
new write-capable entry points casually.

## Connections

- **In:** `onEdit` on every tab; an hourly clock trigger.
- **Reads/writes:** `Jobs`, `App`, `Email`, `Referral`.
- **Does not touch Gmail.** All sending lives in the outreach script.
- Mirrors identity rules from `job_sync/sources.py` — `normalizeLink` and `nameKey` must agree
  with their Python twins or the two sides disagree about what one posting is.

## Identity

| Function | Does |
|---|---|
| `normalizeLink(url)` | "The same posting" — strips `?utm_source=Simplify&ref=Simplify`. Twin of `sources.normalize_link`. |
| `nameKey(text)` | A job as Python identifies one: the `(company, role)` pair with case and punctuation set aside. |
| `identity(row)` | The pair used for comparison. |
| `existingLinks()`, `existingNames()` | What `App` already holds. `existingNames` is for the backfill only. |

## The edit triggers

| Function | Does |
|---|---|
| `onEdit(e)` | Every cell edit in the file lands here first and is dispatched by tab. |
| `onJobsEdit(e)` | Ticking **Applied** on `Jobs` copies the row into `App`. |
| `onAppEdit(e)` | Changing **Process** in column F appends one `"<Stage>: <date>"` line to `Update`. |
| `onReferralEdit(e)` | Ticking **Cancel** in column M calls that ask off immediately. |
| `onReferralPriorityEdit(e)` | A Priority tick spread across the whole ask it belongs to. Writes the boxes and nothing else — no reorder, no re-time. |
| `stageLabel(v)`, `hasStage(...)`, `stamp(...)` | The canonical stage name (or `''`), and the date written into the cell. |
| `lastEntry(...)` | Two things read in one pass over the `Property` column. |

An edit trigger is not guaranteed: a paste, a fill-down or an undo may fire nothing. That is
why the hourly sweep re-does the same work.

## Layout migrations — run once by hand

| Function | Does |
|---|---|
| `setupJobsCheckboxes` | Headers and checkbox validation for `Jobs`, through the tab's current last row (and at least row 500). Useful as a manual repair; `job_sync` now extends the validation after every Jobs rewrite. |
| `setupOutreachQueue` | Create the empty `Email` tab. |
| `setupReferralQueue` | Create the empty `Referral` tab. |
| `setupAppColumns` | The four `App` columns past `Note` — including `Official`. |
| `migrateOutreachColumns` | Walk `Email` forward to the current layout, one column at a time. |
| `migrateOutreachPriorityColumn` | Old name kept: `docs/spreadsheet.md` and a year of notes refer to it. |
| `migrateReferralCancelColumn`, `migrateReferralLayout` | Walk `Referral` forward to the current twenty-column layout. |
| `migrateAppOfficialColumn`, `migrateUpdateColumn` | Walk `App` forward. `Update` used to live at J until Alumni and Recruiter took I and J. |

## The App worklist — the optimistic half only

**This file no longer owns the `App` worklist.** Deciding that an application is waiting on a
link needs the `Employees (seed)` tab, which lives in the contacts spreadsheet the sending
account owns and this script cannot open, so the rule here could only ever approximate the
sender's. It painted on "neither link starts with `http`", which left every row carrying a
Jobright or Simplify link **white** while the referral planner refused it — the applications
most in need of a pasted link were the ones the tab never mentioned. Moved to the sender on
2026-08-30: see [outreach-app-worklist.md](outreach-app-worklist.md).

What stays is the `onEdit` repaint, and it is deliberately optimistic: paste something into
column I and the row goes white immediately, because a tab that goes on telling you to find a
link you have just found is one you stop believing. If what you pasted does not pass the
sender's gate, the next cycle paints it yellow again and lifts it back within the hour.

| Function | Does |
|---|---|
| `appOfficialUsableLink_(url)` | Whether the cell holds anything starting with `http`. Not the ATS judgement — that is the sender's. |
| `appOfficialNeedsLink_(row)` | The optimistic rule, for `onEdit` alone. |
| `paintAppOfficialBlock_(app, from, to)` | Paint A..L yellow over the rows one edit touched, or clear them. The only App painting left here. |
| `appRowIsEmpty_(row)` | A row with nothing on it; the two checkbox columns are why this cannot be a simple truth test. Still used by the Referral sort. |

`onEdit` never sorts, and now nothing in this file can: sorting under the cursor would pull the
row out from under a person mid-paste. Position is the sender's job, once an hour, when nobody
is looking at the tab.

## Referral housekeeping

| Function | Does |
|---|---|
| `referralGroupKey_(row)` | Which ask a row belongs to: one employer, one job. |
| `referralCancelled_(row)` | Tick state, compared case-insensitively on purpose. |
| `orderReferralCancelledRows_(rows)` | Pure ordering, and the only one this file makes: called-off rows sink, live rows keep the order the sender filed them in. |
| `sortReferralCancelledBlock_`, `sortReferralCancelledToBottom` | Apply it to the sheet. |

**This file does not schedule.** The Referral tab's row order and its two hour columns
belong to the sender (`outreach_referral_queue.gs`), which is the only end that knows the
per-employer caps. Until 2026-08-30 `orderReferralCancelledRows_` also grouped live rows by
employer and lifted ticked asks, and a deleted `reflowReferralTimes_` then dealt the tab's
hours back out in that row order — so an employer got six consecutive sending slots and the
two projects undid each other every hour. See `outreach-referral-queue.md`.

## The clock

| Function | Does |
|---|---|
| `installAppOfficialTrigger` | Put the hourly housekeeping on the clock. |
| `removeAppOfficialTrigger` | The kill switch, and still the only one. It deletes every handler in `HOUSEKEEPING_HANDLERS`, not just today's. |
| `HOUSEKEEPING_HANDLERS` | `runHourlyHousekeeping` (current), plus `paintAppOfficialRows` and `paintJobsReferralRows` — both deleted from this file. A name stays on the list *because* the function is gone: a trigger pointing at a deleted function fails silently every hour and no kill switch that does not know its name can reach it. `paintJobsReferralRows` was found on 2026-08-30 in Cloud Logging, failing at `:21` past every hour, from a trigger nothing on the sheet explained. |
| `runHourlyHousekeeping` | Sink the called-off `Referral` rows. That is now its whole job; the `App` half left for the sender on 2026-08-30. Stopping this trigger no longer stops `App` being reordered. |

## Backfill and reports

| Function | Does |
|---|---|
| `backfillTicksFromApp` | Tick the `Jobs` rows already sitting in `App`. |
| `colourQueueColumn_(...)` | Paint one dropdown column by value. |
| `updateReport`, `backfillReport`, `stageReport`, `referralCancelReport`, `report`, `rowCount` | Human-readable summaries. |

## Gotcha

`clasp push` **does not update a pinned deployment.** The Web App is pinned to `@2` and keeps
serving that snapshot. Redeploy after any change that the extension depends on.
