# outreach_app_worklist.gs — the App worklist

Once an hour, paints every `App` row that a referral could be asked for **except** that it has no
submittable link, lifts those rows to the top of the tab, and puts everything else back into
`Property` order.

Added 2026-08-30. It replaces a sweep of the same shape in the bound tracker script — see
[the gotcha](#gotcha--the-tab-had-a-second-painter) below.

## Connections

- **Reads:** `App` (every row), `Employees (seed)` in the contacts spreadsheet.
- **Writes:** `App` — the row order, and the background across A..`Update`. No column value, and
  no new column.
- **Decides with:** `outreachReferralNeedsLink_` in
  [outreach-referral-queue.md](outreach-referral-queue.md). The same function the referral planner
  uses, not a second spelling of it.

## What yellow means

Four things, all of them, and the yellow is exactly the planner's own answer:

| Part | Function |
|---|---|
| The employer is one ColdEmail found engineers at | `outreachEmployeesFor_` |
| The application has not been rejected | `outreachReferralLive_` |
| The posting names the intake being asked about | `outreachReferralSeason_` |
| No link on the row passes the ATS/own-domain gate | `outreachReferralLinkOk_` |

Miss any one and the row is not painted. A colour that appears on rows requiring no action is a
colour people stop seeing — a linkless application at a company with nobody to ask is not work,
it is noise.

## Why it lives here and not in the tracker script

The first part of that rule can only be answered from `Employees (seed)`, which lives in the
contacts spreadsheet the sending account owns and the bound tracker script cannot open. A
tracker-side copy could answer three parts out of four, which is worse than not answering: it
would paint every linkless application at every company, including the hundreds where there is
nobody to ask.

## Functions

| Function | Does |
|---|---|
| `syncAppOfficialWorklist()` | The sweep. One read and one write per half. Returns `{ needing, moved }`. |
| `outreachOrderAppEntries_(entries)` | The ordering decision alone — entries in, entries out, no sheet — so it can be tested. |
| `outreachSortAppGroup_(group)` | One group into `Property` order, ties and blanks holding their place. |
| `outreachAppPropertyOf_(row)` | `Property` as a number, or `null` when it has none. |
| `outreachAppRowBlank_(row)` | A row with nothing on it. The two checkbox columns are why this cannot be a simple truth test: the Python half writes `FALSE` down both across every row it covers. |
| `APP_WORKLIST_YELLOW` | `#FFF2CC`. The same yellow the tab has worn for months. |

## Property is the memory

Ordering by `Property` rather than leaving each group in the order it arrived is the point of the
file, not a detail of it.

A stable sort is correct exactly once. The first time a row is lifted to the top it is right, and
from then on the row **has been moved** — its "current" position is the top. Paste the missing
link, and a stable sort has no memory of where the row came from, so it drops to the head of the
second group and stays a hundred rows above where it belongs, for good.

`Property` is written once when the application crosses from `Jobs`, never changes, and numbers
the rows in the order they were applied to. Sorting both groups by it makes the whole sweep a pure
function of the data: a row lifted for a missing link goes home to its own number the moment the
link arrives, and running the sweep twice moves nothing the second time.

Both groups, not just the second. If the yellow block were left in arrival order it would reshuffle
every time a row joined or left it, and the application somebody was half way through chasing would
move under them.

A row with no `Property` sorts to the end of whichever group it is in and keeps the position it
already had. `null`, not `0` — `Number('')` is `0`, which would hoist a half-typed row above every
application on the tab.

## Ordering, in full

1. Rows waiting on a link, by `Property`.
2. Everything else, by `Property`.
3. The trailing blank rows, exactly as they were.

Only the **genuinely trailing** blanks are pinned. A blank row with real rows still below it is a
gap somebody left on purpose.

## Why it runs last in the cycle

`step('appWorklist', …)` is the final step of `runOutreachCycle`, and that is a correctness
requirement rather than a tidy finish. This is the only step that moves rows on `App`, and half
the steps above hold `App` row numbers taken before it ran:

- `scanRejectionEmails` writes `Process` and appends to `Update` **by row number**.
- `cancelStaleOutreachRows` and both referral planners read the tab by row number.

Sorting `App` while any of them still held an index would file a rejection against a different
application. Nothing reads `App` after this step, so nothing can.

## The colour is carried, not recomputed

The tracker script could recompute a row's colour after moving it, because its rule was a pure
function of three cells on the row. This one is not — it needs the employee list and the company's
domain — so the flag rides with the row through the sort. That also removes the only way the values
and the colours can disagree, which matters more: a tab painting the wrong rows yellow is worse
than one not painted at all, because a colour that lies stops being read, and the applications that
really are waiting stop being read with it.

## The race

`highlight.py` reads `App` A:H, works out which rows earn an alumni or recruiter tick, and writes
the two checkbox columns back **by position**. A sort landing between that read and that write puts
an alumnus against the wrong application.

The window is the seconds between two calls in one sync, and the sweep writes nothing at all in the
ordinary case where no row moved. That keeps it narrow rather than closing it. **Stop the sender's
hourly trigger while the Python half is being worked on.** Stopping the tracker's
`removeAppOfficialTrigger` no longer does anything for `App`.

## Gotcha — the tab had a second painter

Until 2026-08-30 the bound tracker script painted this tab hourly from `paintAppOfficialRows`, on
`appOfficialNeedsLink_`: yellow if neither `Application Link` nor `Official` started with `http`.

That rule is loose in the direction that matters. A row carrying a `jobright.ai` link is **not**
yellow under it and **is** refused by the referral planner, so the applications most in need of a
pasted link were the ones the tab never mentioned. It is tight in the other direction too, painting
companies with no engineers on file. And its sort was stable, so no row ever went home.

Meanwhile `outreachReferralNeedsLink_` — the function that got all four parts right — sat in this
project with **zero callers**.

`paintAppOfficialRows`, `sortAppOfficialRowsToTop`, `sortAppOfficialBlock_` and
`orderAppOfficialRows_` are deleted from the tracker script; `runHourlyHousekeeping` now only sinks
called-off `Referral` rows. `paintAppOfficialRows` stays in `HOUSEKEEPING_HANDLERS` precisely
because it no longer exists — a legacy trigger pointing at a deleted function fails silently every
hour, and the remover has to be able to kill it.

**This file owns `App`'s row order and its yellow.** The tracker script may repaint the rows one
`onEdit` touched and nothing else.
