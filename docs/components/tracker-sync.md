# apps_script/sync_applied_to_app.gs — the tracker-bound script

Bound to the spreadsheet. Owns the moment a job becomes an application, every tab's layout,
and the hourly housekeeping. Script id `1WrD8HUZ...`; `clasp` profile `default` pushes it,
`kenyon` deploys it.

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
| `onReferralPriorityEdit(e)` | A Priority tick spread across the whole ask it belongs to. |
| `stageLabel(v)`, `hasStage(...)`, `stamp(...)` | The canonical stage name (or `''`), and the date written into the cell. |
| `lastEntry(...)` | Two things read in one pass over the `Property` column. |

An edit trigger is not guaranteed: a paste, a fill-down or an undo may fire nothing. That is
why the hourly sweep re-does the same work.

## Layout migrations — run once by hand

| Function | Does |
|---|---|
| `setupJobsCheckboxes` | Headers and checkboxes for `Jobs`. |
| `setupOutreachQueue` | Create the empty `Email` tab. |
| `setupReferralQueue` | Create the empty `Referral` tab. |
| `setupAppColumns` | The four `App` columns past `Note` — including `Official`. |
| `migrateOutreachColumns` | Walk `Email` forward to the current layout, one column at a time. |
| `migrateOutreachPriorityColumn` | Old name kept: `docs/spreadsheet.md` and a year of notes refer to it. |
| `migrateReferralCancelColumn`, `migrateReferralLayout` | Walk `Referral` forward to the current twenty-column layout. |
| `migrateAppOfficialColumn`, `migrateUpdateColumn` | Walk `App` forward. `Update` used to live at J until Alumni and Recruiter took I and J. |

## The App worklist

An application whose link nobody can be asked to refer against is worth doing something about,
so those rows are painted and floated to the top.

| Function | Does |
|---|---|
| `appOfficialUsableLink_(url)` | Whether the link is the employer's own posting. |
| `appOfficialNeedsLink_(row)` | Which rows are worth painting. |
| `paintAppOfficialRows`, `paintAppOfficialBlock_` | Paint A..L yellow, and clear rows that no longer qualify. |
| `sortAppOfficialRowsToTop`, `sortAppOfficialBlock_` | Float them up. |
| `orderAppOfficialRows_(rows)` | The ordering decision alone — rows in, rows out, no sheet — so it can be tested. |
| `appRowIsEmpty_(row)` | A row with nothing on it; the two checkbox columns are why this cannot be a simple truth test. |

## Referral housekeeping

| Function | Does |
|---|---|
| `referralGroupKey_(row)` | Which ask a row belongs to: one employer, one job. |
| `referralCancelled_(row)`, `referralPrioritised_(row)` | Tick state, compared case-insensitively on purpose. |
| `orderReferralCancelledRows_(rows)` | Pure ordering: live asks up, called-off ones down. |
| `reflowReferralTimes_(rows)` | The queue's own hours dealt out again in the order the rows now sit in. |
| `sortReferralCancelledBlock_`, `sortReferralCancelledToBottom` | Apply it to the sheet. |

## The clock

| Function | Does |
|---|---|
| `installAppOfficialTrigger` | Put the hourly housekeeping on the clock. |
| `removeAppOfficialTrigger` | The kill switch, and still the only one. |
| `runHourlyHousekeeping` | Float the `App` worklist to the top, then sink the called-off `Referral` rows. |
| `draftHourFor_(sendHour)` | A send hour turned into the hour its message is written, one lead earlier. |

## Backfill and reports

| Function | Does |
|---|---|
| `backfillTicksFromApp` | Tick the `Jobs` rows already sitting in `App`. |
| `colourQueueColumn_(...)` | Paint one dropdown column by value. |
| `updateReport`, `backfillReport`, `stageReport`, `referralCancelReport`, `report`, `rowCount` | Human-readable summaries. |

## Gotcha

`clasp push` **does not update a pinned deployment.** The Web App is pinned to `@2` and keeps
serving that snapshot. Redeploy after any change that the extension depends on.
