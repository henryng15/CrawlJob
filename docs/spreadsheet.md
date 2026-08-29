# Two tabs, and who writes where

The spreadsheet is the interface to the whole system. Understanding who owns which column is
most of understanding it.

## Tab `Jobs` — still to be applied to

| Column | | Who writes it |
|---|---|---|
| A | Company | tool |
| B | Role | tool |
| C | Link Apply | tool |
| D | Date Posted | tool |
| E | **Source** | tool |
| F | **Applied** ☑ | you, and the tool ticks it ahead of you |
| G | **Expired** ☑ | you only |
| H onward | free-text notes | you only |

The tool paints only a Company cell **light green** when its employer matches a
company with a DOL-certified H-1B LCA for a Software Engineer role in FY2024 or
FY2025.  It normalizes punctuation, legal suffixes, and extra parent-company
wording, and recognizes a small set of high-confidence brand aliases (for
example, AWS).  It is a sponsorship signal, not a guarantee for a particular
role or candidate; every normal GitHub Actions sync re-checks the shipped list,
and the green is removed only when it was applied by the tool.

Every sync run **overwrites all of** A–E and sorts again. Column F onward is read back and
written out untouched, so your tick always travels with its own row rather than staying
behind at the old row number.

### Sort order

**Everything still to do rises to the top, everything dealt with sinks to the bottom.** A row
ticked `Applied` **or** `Expired` is pushed to the end; within each half the newest posting
comes first.

Between the two halves sits **one blank row highlighted yellow** as the marker. Above it is
the work to do, below it the work done — and there is no other gap.

That marker row is not data: it holds nothing, so the next read cannot tell it from the
checkbox-only rows and drops it too. It is rebuilt from scratch every run, and that is exactly
what keeps it in place as the two halves change size. The colour moves with it, through the
same selective-clearing mechanism used for alumni.

That gap was once real. `setupJobsCheckboxes` lays validation over `F2:G500` whether or not
there is a job on the row, and an unticked checkbox reads back as `FALSE` rather than as empty
— so one read of `A:Z` returned all 499 rows, most of them holding nothing but two `FALSE`s.
They sorted into the "still to do" group with no date, which put them after the real jobs but
before the ticked ones. Now any row with nothing in A–D is dropped outright before the sort.

### Column E — `Source`

Where the row came from: `Simplify`, `Jobright`, `speedyapply`, `zshah101`, `sndsh404`, or
`Greenhouse` / `Lever` / `Ashby` where it was read straight off the company's own board.

Written by the tool, and **only into empty cells**. A row that already names a source keeps it,
even where another tracker is carrying that same posting today — where it was **first seen** is
the answer that does not change, while overwriting every run would leave this column flickering
between two names for a row that has not changed at all.

Rows that existed before this column did are backfilled from their link, on the first sync run
after the column is inserted.

> **Why Source sits at E rather than at the end.** Every column past `Expired` is read as a
> note of yours, and a note is the **only** thing that stops the auto-tick. A Source column
> placed after G would look like a note on every row, and the tool would stop ticking anywhere
> on the sheet — exactly the bug that had the first version ticking 0 rows.

### Column F — `Applied`

Tick it and the row is copied to the `App` tab straight away, with a Property number, today's
date and `Process = Applied`. It takes about a second.

The tool also ticks this box for you on jobs the `App` tab shows you have already applied to —
see [matching.md](matching.md). Put another way: **whatever is still blank in column F is the
work left to do.**

### Column G — `Expired`

For a posting that has closed while the board still answers HTTP 200, so the liveness check
cannot drop it on its own. Ticking it means:

- The row **does not go to `App`**, even where `Applied` is ticked too. Expired wins.
- The tool **no longer** auto-ticks `Applied` on that row.
- The row stops counting towards the "still to apply to" total.

It only blocks the outbound direction. Once a row has reached `App`, ticking `Expired`
afterwards **does not** call it back — `App` is the source of truth. Clear the tick and the row
travels normally again; there is no stuck state.

### Column H onward — notes

Write anything here and the tool stops touching that row's checkboxes. It is the only way to
say "the tool matched this wrong", because a bare untick is ticked again on the next run.

> **Why notes have to start at H and not G.** A checkbox column reads back as `FALSE` on
> *every* row it covers, not as an empty cell. If G counted as the place for notes, the tool
> would see a note on the whole sheet and stop auto-ticking entirely. That is the bug that had
> the first version ticking 0 rows while the workflow still reported green. A test pins it:
> `test_the_expired_column_is_not_read_as_a_note`.

### Do not delete rows from `Jobs`

Applied rows and Expired rows both have to **stay behind as tombstones**. The tool knows a job
is already in the sheet by comparing against the links the sheet itself holds; delete the row
and the job — still listed by the source tracker — is appended again on the next run.

To get them out of sight, use a **filter view** hiding `F = TRUE` or `G = TRUE` rather than
deleting.

## Tab `App` — applied to

| Column | | |
|---|---|---|
| A | Property | sequence number, auto-incrementing |
| B | Company | |
| C | Application Link | |
| D | Date Applied | the day you ticked |
| E | Location (State) | **always blank when generated** — the Jobs tab does not carry this |
| F | Process | dropdown: Applied / OA / Completed OA / Interview / Offer / Rejected |
| G | Role | |
| H | Note | |
| I | **Alumni** ☑ | the tool ticks it where that company has an alumnus — see [alumni.md](alumni.md) |
| J | **Recruiter** ☑ | the tool ticks it where that company has a recruiter in the contact list |
| K | **Update** | stage history, one line per stage |

`Property` is worked out as **the largest number present + 1**, not the row number — App may
have had rows deleted out of the middle, and two rows sharing a number is worse than a gap.

A new row's data validation is **copied from the last entry row** instead of being rebuilt,
because the coloured-chip `Process` dropdown is made through the Sheets interface and Apps
Script has no API for setting chip colours. Copying makes the new row identical to the old one,
whatever way the dropdown happened to be created.

### Columns I and J — `Alumni`, `Recruiter`

Two checkboxes **the tool ticks**, not you. Column I turns on where the `Alumni` tab has
someone working at that company; column J turns on where that company is in the recruiter list
shipped with the repo. Both are rewritten from scratch on every sync run, so a tick by hand is
cleared on the next one — the place to write anything you want kept is column H, `Note`.
Details in [alumni.md](alumni.md).

> Column J answers *is there a contact anywhere*. **How many of them can actually be written
> to** is a different question with a different answer, and it lives in the `Email` tab rather
> than here — see [outreach.md](outreach.md). Nothing in the outreach system writes to `App`.



These two columns are the **only** cells outside the Jobs tab that the tool writes. They are
kept narrow (70px and 90px) because nothing else ever goes in them; column K is 300px wide so
a few stacked lines of history fit.

A row with no match shows an empty tick box, not an empty cell — that is what an unticked
checkbox normally looks like. Where the cell shows the word `FALSE`, the checkbox rule has not
reached that row yet; the next sync run fixes it, see
[alumni.md](alumni.md#when-the-cell-shows-the-word-false).

### Column K — `Update`

Every time you change `Process` in column F, Apps Script appends one line to the K cell of
**that same row**, naming the stage just moved to and today's date. Several lines live in one
cell, separated by line breaks (Alt+Enter):

```
Applied: Jul 21, 2026
OA: Aug 3, 2026
Completed OA: Aug 9, 2026
Interview: Aug 12, 2026
```

The `Date Applied` column can only remember the first date. This one remembers the route — how
long until the OA, how long from OA to interview — which is what looking at where a `Process`
cell currently stands will never tell you.

**Each stage is written exactly once.** The cell is a history, not a log: going back to a stage
already passed, or pasting the value it already holds over itself, produces no second line. A
value from outside the pipeline (typing "Phone screen" by hand, say) is ignored outright — the
dropdown lists every stage that really exists, so anything that does not match is a typo.

The script only **appends**; it never rewrites what is there. So the cell is safe to edit by
hand: delete a line written in error, fill in an old date you have remembered.

### The `?` in the Update column

`setupAppColumns` builds this column for the rows that already exist. Only the `Applied` stage
can be inferred — from the `Date Applied` cell. The day a row moved to OA or Interview **was
never recorded anywhere**, so a row standing at a stage past `Applied` gets a second line:

```
Applied: Jul 26, 2026
OA: ?
```

The `?` means the stage really happened but nobody knows the date. Ctrl+F for `: ?` gives
exactly the list to fill in by hand. It is there instead of an invented date that would look
real.

From the build onwards every stage change records itself, so `?` only shows up on the rows that
came before it.

## Tab `Email` — the outreach queue

Run `setupOutreachQueue` in Apps Script to create this tab. At this stage it is only an empty,
human-visible queue: it does **not** read the `App` tab, add an application, contact a recruiter,
or connect to Gmail.

The tab is intentionally separate from `App`. `App` remains the source of truth for an
application; the queue will later record one controlled outreach attempt without putting a
recruiter's name, email address, or drafted message into this spreadsheet.

| Column | Meaning |
|---|---|
| Queue ID | stable ID for one outreach attempt |
| App Property | the `Property` value of the related App row |
| Company / Role / Date Applied | snapshots of the application when queued |
| Recruiters | how many contacts exist at that company, refreshed hourly |
| Attempt / Template | which contact at that company this is, and which of the ten hooks it uses |
| Drafted At / Scheduled At | when it appears in `Drafts`, and the hour it leaves them — projected while `Queued`, fact once written |
| Priority | tick to move this posting to the front of the queue; a checkbox, and the only column here a person writes to |
| Status / Mode | queue lifecycle and `Draft` versus `Send`; both are dropdowns |
| Contact Fingerprint | non-reversible fingerprint used to avoid contacting the same address twice |
| Gmail Draft ID / Gmail Message ID / Sent At | audit references, populated only after Gmail work exists |
| Result / Last Error / Version | delivery outcome, diagnostic, and concurrency guard |

All rows start empty. The future queue worker will be the only automation allowed to create or
move them; until then this tab is safe to inspect and format manually.

`Priority` leads `Status` because the two read as one answer: whether this row was asked for, and
where it has got to.

A tab built before the column existed opens it by itself. `outreachEnsurePriorityColumn_` is the
first thing `runOutreachCycle` does, before anything reads the queue and outside the per-step
isolation, so either the layout is right or the run stops without touching a row. It is the sender
that migrates rather than a button somebody presses because the schema and the code have to change
together: a tab on the old layout read by the new constants has `Status` where `Mode` should be, so
no row matches any status, no row counts as having spent a contact, and the next enqueue writes a
second cold email to people already written to. Deploying the sender is the whole migration, and
there is no window in between.

`setupOutreachQueue` cannot do this itself — it refuses to write `Priority` over a header that says
`Status`, which is the guard doing its job. `migrateOutreachPriorityColumn` in the bound script is
the manual equivalent, for a tab being brought up to the current layout by hand; both are
idempotent and safe to run after the other.

One tick covers the job, not the row. Ticking any row lifts every row with the same company and
the same role — the same two tests the one-posting-one-wave rule uses — so a tick on attempt 1 at
Stripe also moves attempts 2 and 3, and a tick on a row that has already been sent still lifts the
ones behind it. It groups only as tightly as those tests do: `Software Engineer Intern` and
`Software Engineering Internship` are one posting, `SWE Intern` is not.

A tick reorders and does nothing else. It cannot make a row eligible before its two-day wait, it
cannot raise the day's cap or the weekly cap on one company, and it cannot send at the weekend —
it decides who gets the slots that already existed. The new order shows up in `Scheduled At` on the
next hourly run, which is where you check that a tick did what you expected.

The design the worker will follow — what enters the queue, in what order, how many go out a
day, and where the sender lives — is [outreach.md](outreach.md).

### Filling in Role lets the tool tick more

An `App` row missing `Company` or `Role` can **never match by name** — it matches only where
the link agrees character for character. The last audit had 14 such rows out of 82. Fill in
`Role` and the next sync run ticks a batch more.

Run [`--audit-app`](operations.md#auditing-the-app-tab) to see exactly which rows.

## Why writing the sheet takes two calls

`_write` writes `A:D` with `valueInputOption="RAW"` and `E` onward with `USER_ENTERED`, at the
cost of one extra API call per run. The two halves need opposite parsing:

- **`A:D` has to be RAW.** `Date Posted` is the ISO string `2026-08-16` and the sort that reads
  it treats it as a string. `USER_ENTERED` would parse it into a date serial and break the sort.
- **`E` onward has to be USER_ENTERED.** The string `"TRUE"` written RAW sits **on top of** the
  checkbox as text instead of ticking it, and the next run reads it back as unticked.
