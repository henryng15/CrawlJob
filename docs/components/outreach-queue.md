# outreach_queue.gs — the Email tab

The cold path's planner: which applications earn an email, who at that employer gets it, in what
order, and what the tab should look like. A wave contains up to three contacts; the next wave may
open after 5 days of silence, and there is no per-company rolling-7-day cap. 45 functions, most
of them pure.

## Connections

- **Reads:** `App` (applications), the contacts spreadsheet (people), `Email` (what is committed).
- **Writes:** `Email` — appends rows, rewrites projections, repairs layout, sorts.
- **Feeds:** [outreach-send.md](outreach-send.md) drafts and sends what this books.
- **Shares:** `outreachInterleaveByCompany_` with the referral planner.

## Deciding what to send

| Function | Does |
|---|---|
| `outreachParseApp_`, `outreachParseQueue_`, `outreachDate_` | Rows into objects. |
| `outreachRoleTokens_(title)` | A role as the bag of words that say what the job is. |
| `outreachSameRole_(a, b)` | Whether two roles at one employer are one posting written twice. Threshold `ROLE_MATCH = 0.6`. |
| `outreachRankApplications_(rows)` | Which application at an employer leads. |
| `outreachAttemptsWanted_(...)` | How many people the current wave can use; the former per-company rolling-week cap no longer applies. |
| `outreachContactAvailable_(...)` | Whether this person may be written to about this intake today. |
| `outreachPickContact_(...)` | The first contact who may be. |
| `outreachPlanEnqueue_(...)` | **Pure planner:** data in, rows and reasons out. It counts non-cancelled templates already committed in `Email`, then gives each new row the least-used cold base and copy form; company relevance only breaks ties. |
| `outreachQueueRowValues_(...)` | One booked row as the cells to append. |
| `enqueueOutreach()` | Read `App` and the queue, work out what is missing, append it. |
| `enqueueAndProject()` | The same, plus a reprojection. |

## Ordering and timing

| Function | Does |
|---|---|
| `outreachPriorityGroups_(rows)` | The company-and-role pairs somebody ticked by hand. |
| `outreachPrioritised_(row)` | Whether a row rides on someone else's tick — **a tick moves the whole group**. |
| `outreachOrderForSending_(rows)` | Ticked rows first, then employers taking turns, oldest application first inside each. Both halves go through `outreachInterleaveByCompany_`; the shared budget separately protects this path only when queued cold work is present. |
| `outreachDueNow_(...)` | The rows allowed out on this firing, against the shared budget. Explicitly timed off-Target Email rows are excluded because their minute trigger owns delivery. |
| `outreachProjectSchedule_(rows)` | The date each queued row is expected to go. Explicitly timed off-Target Email rows retain their stored time and do not consume normal weekday slots. |
| `refreshOutreachSchedule()`, `outreachWriteProjection_(...)` | Rewrite the derived columns, and only those. |
| `outreachColdTargetCompanies_(tracker)` | Reads the four seven-column Target blocks at `A:G`, `I:O`, `Q:W`, `Y:AE` and returns the normalized company set used to exclude Target companies from automatic cold planning. |
| `outreachRowTime_`, `outreachTimeOrder_`, `outreachSortQueueByTime_` | File the tab: earliest hour first, cancelled sunk. Sorting *values* rather than calling `Range.sort` is what makes it testable. |

## Tab shape

The live `Email` tab is trimmed to its owned schema `A:W` (23 columns). The columns after
`Version` were empty grid space and were removed; the queue keeps its operational timestamps in
`Drafted At`, `Scheduled At`, `Follow Up`, and `Sent At` rather than adding a second schedule area.

`Email_target` is a separate sender-owned mirror for explicit Target recruiter campaigns, including
the seven independently scheduled Microsoft recruiter drafts. It uses the same `A:W` shape and
records the campaign's company, role, application/property lookup, template, scheduled time and
current state. It is a reportable schedule, not an operational queue: normal planners, budget checks
and senders read `Email` only. `initializeTargetQueueTabs()` creates or refreshes it from the sender's
Target campaign Script Properties; a Microsoft role is recovered once from its existing draft body,
then retained in campaign state. Direct-send ticks refresh the mirror after a state transition.
Recipient names and addresses remain out of this mirror, matching the privacy rule of `Email`.

The one-time 2026-09-13 off-Target migration uses ordinary `Email` rows with ids beginning
`OFFTARGET-EMAIL-`. Those rows are operational queue records, but their explicit 23:00 and 03:00
times are preserved by the minute handler in `outreach_offtarget_waves.gs`; normal projection,
drafting and sending do not alter or consume them.

| Function | Does |
|---|---|
| `outreachHeaderRow_(sheet)` | The header, never wider than the sheet actually is. |
| `outreachPriorityColumnAction_`, `outreachEnsurePriorityColumn_` | Open the `Priority` column on a tab built before it existed. |
| `outreachFollowUpColumnsAction_`, `outreachEnsureFollowUpColumns_` | The same for the three follow-up columns. Runs **after** Priority: it expects `Contact Fingerprint` at a position only true once Priority exists. |
| `outreachQueueGaps_`, `outreachRowHasContent_` | Which blocks inside the table are empty and should not be. |
| `outreachRepairQueueLayout_` | Pull the table together after rows were appended below a gap, and dress them. |
| `outreachDressQueueRows_`, `outreachColourQueueColumn_` | Checkboxes, timestamp formats and colour rules, over the rows that exist and only those. |
| `refileOutreachQueue()`, `repairOutreachQueueLayout()` | Run by hand; send nothing. |

## Season

| Function | Does |
|---|---|
| `outreachSeasonReport_(rows)` | Employers that look like they run two intakes. |
| `outreachSeasonProperties_`, `refreshSeasonTab()` | Rewrite the `Season` tab from `App`. |
| `backfillSeasonFingerprints()` | Re-fingerprint off-cycle rows written before intakes existed. |

## Edit triggers

| Function | Does |
|---|---|
| `outreachEditTouchesRole_(e)` | Whether an edit landed on a `Role` cell in `App`. |
| `outreachRolePlan_(...)`, `syncRoleEdit_(...)` | Carry a corrected role out to the queue rows that repeat it. |
| `outreachEditTouchesPriority_(e)` | Whether an edit is a `Priority` cell on a data row. The test is **overlap, not equality** — a paste across a whole row includes Priority. |
| `outreachEditTouchesReferral_(e)` | Whether an edit is one the `Referral` tab must answer at once. |

## Gotcha

The schema migrations run **outside** the `step()` isolation in `runOutreachCycle` and are fatal
by design: a tab on the pre-Priority layout has `Status` where `Mode` should be, so no row
matches any status and enqueue writes a second email to people already written to.
