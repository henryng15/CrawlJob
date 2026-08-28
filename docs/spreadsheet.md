# Four tabs, and who writes where

The spreadsheet is the interface to the whole system. Understanding who owns which column is
most of understanding it. `Jobs` and `App` are the tracker itself; `Email` and `Referral` are the
two outreach queues, and a fifth tab of people lives in a different spreadsheet entirely, at the
bottom of this page.

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
| H | **Referral Link** | you, by hand — and the crawler owns `H1` |
| I onward | free-text notes | you only |

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

### Everything past `Expired` — notes

Write anything in column H or beyond and the tool stops touching that row's checkboxes. It is the
only way to say "the tool matched this wrong", because a bare untick is ticked again on the next
run. Column H has since been given a specific job — the section below — but it is still one of
these cells and still has this effect.

> **Why notes have to start at H and not G.** A checkbox column reads back as `FALSE` on
> *every* row it covers, not as an empty cell. If G counted as the place for notes, the tool
> would see a note on the whole sheet and stop auto-ticking entirely. That is the bug that had
> the first version ticking 0 rows while the workflow still reported green. A test pins it:
> `test_the_expired_column_is_not_read_as_a_note`.

### Column H — `Referral Link`

The first of the note columns now has a job of its own: **the employer's own application link,
pasted by hand**, for a posting whose crawled link in C goes to an aggregator instead. It is what
makes a referral askable — see [outreach.md](outreach.md#the-referral--asking-an-engineer-instead-of-a-recruiter),
where the rule for which links count is set out. Nothing writes it for you; the whole column below
row 1 is yours.

Rows still waiting for one are **painted yellow across A to H**. Yellow means one thing: this is a
summer posting worth asking somebody about and there is no way in yet. Paste a link and the colour
goes on the same keystroke, because the `onEdit` trigger repaints the rows the edit touched rather
than waiting for the next full sweep — a tab that tells you to go and find a link you have already
found is a tab you stop believing. `paintJobsReferralRows` does the whole sheet in one read and one
write when the rule itself changes.

A row that needs no action is never painted, and clearing is done with `null` rather than white, so
a row losing its yellow keeps whatever banding or highlight it already had.

> **A pasted link stops that row being retired, and that is the trade.** Every cell past `Expired`
> is a note as far as `_is_annotated` in `job_sync/sheet.py` is concerned, and an annotated row is
> never dropped by the liveness check or merged away as a duplicate. A summer posting you are
> hunting a way into is exactly the row that must not vanish underneath you, so this is accepted
> rather than worked around.
>
> **`H1` is not one of those cells and belongs to the crawler.** The sync splits the header off the
> data before `_is_annotated` sees anything, so the header row cannot annotate a job — which is why
> `H1` is where the `Last updated: …` caption lives, on the one cell of the notes column no job will
> ever want. `setupJobsReferralColumn` therefore writes **no header at all**: it sets the column
> width and stops. An earlier version wrote `Referral Link` into that cell, which the crawler
> overwrote within the hour and then refused to run against on the next setup, so the setup could
> only ever be run once. Nothing in the referral path reads the header, so the column loses a word
> at the top and gains a setup that does not fight the crawler.

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
| Follow Up / Follow Up Template / Follow Up Status | the day the one chasing reply is booked for, which of the twenty sentences it uses, and where it has got to |
| Contact Fingerprint | non-reversible fingerprint used to avoid contacting the same address twice |
| Gmail Draft ID / Gmail Message ID / Sent At | audit references, populated only after Gmail work exists |
| Result / Last Error / Version | delivery outcome, diagnostic, and concurrency guard |

All rows start empty. The future queue worker will be the only automation allowed to create or
move them; until then this tab is safe to inspect and format manually.

`Priority` leads `Status` because the two read as one answer: whether this row was asked for, and
where it has got to. The three `Follow Up` columns sit immediately after `Mode` for the same
reason one column over: they are those questions asked one message later, and they only mean
anything read next to the status of the email they are chasing.

A tab built before those columns existed opens them by itself. `outreachEnsurePriorityColumn_` and
`outreachEnsureFollowUpColumns_` are the first two things `runOutreachCycle` does, before anything
reads the queue and outside the per-step isolation, so either the layout is right or the run stops
without touching a row. They run in that order because the second is written against the layout
the first produces, and a tab two migrations behind is walked forward twice in one firing.

It is the sender that migrates rather than a button somebody presses because the schema and the
code have to change together: a tab on an old layout read by the new constants has `Status` where
`Mode` should be, or `Contact Fingerprint` where `Follow Up` should be, so no row matches any
status, no row counts as having spent a contact, and the next enqueue writes a second cold email
to people already written to. Deploying the sender is the whole migration, and there is no window
in between.

`setupOutreachQueue` cannot do this itself — it refuses to write a header over a different one,
which is the guard doing its job. `migrateOutreachColumns` in the bound script is the manual
equivalent, for a tab being brought up to the current layout by hand with the sender switched off;
it walks both steps and is idempotent, and `migrateOutreachPriorityColumn` is kept as a name that
calls it.

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

## Tab `Referral` — who has been asked

Run `setupReferralQueue` in Apps Script to create this tab. Like `setupOutreachQueue` before it,
this only builds the table: it does **not** read `Jobs`, choose who to ask, compose anything or
touch Gmail. Rows arrive from `planReferralAsks` in the sender project, which is not part of the
hourly cycle — until somebody runs it, or wires it to a trigger, this tab stays empty.

The `Email` tab records one controlled email to a recruiter about an application you have already
made. This one records one email to an engineer at a company, asking them to refer you, about a
posting you may not have applied to yet. Two tabs and not more columns on one, because those are
two questions a person asks separately — and mixed into one table neither could be scanned, since
the recruiter rows outnumber the referral rows and both halves would carry the other's columns as
blanks.

| Column | Meaning |
|---|---|
| Company / Role / Job Link | the posting being asked about — one per company, chosen by the planner |
| Person / Email / Title | which human this is; they lead because they are the row |
| Tier | `peer` / `mid` / `senior` / `staff`, a dropdown, read off `Title` |
| Template | which of that tier's ten messages this row uses |
| Drafted At / Scheduled At | when it appears in `Drafts`, and the hour it leaves them |
| Status / Mode | the same seven states the `Email` tab uses, and `Draft` versus `Send`; both dropdowns |
| Gmail Draft ID | the draft waiting its hour. Deleting that draft in Gmail is what calls the message off |
| Sent At / Result / Last Error | when it went, the id of the message that went, and why it did not go |
| Queue ID / Version | `R-` and the person's address, and the concurrency guard |

Eighteen columns, and the order is the argument. `Person`, `Email` and `Title` come first because
they are what the tab is opened to read. `Tier` sits beside `Template` because the tier is what
decides which template is worth using. Everything from `Status` rightwards is the same machinery
the `Email` tab carries, in the same order and wearing the same status colours, so the two tabs
read alike exactly where they do the same job — a second colour language for one more tab would
only have to be learned twice.

`Tier` is a dropdown rather than free text because a tier typed by hand drifts — `Senior`, `sr`,
`Sr.` — and then no filter finds the seniors.

`Gmail Draft ID` sits between `Mode` and `Sent At` because that is where it happens in the row's
life. An earlier layout had no column for it and let the draft's id ride in `Result` until the send
replaced it with the sent message's id — two different kinds of Gmail id in one cell, tellable
apart only by also reading `Status`, in the column whose whole job is to say how it went.

Two of the eighteen behave differently from their namesakes on the `Email` tab, and each
difference is deliberate:

- **`Queue ID` is `R-` and the address.** This path asks one person once and never again, so the id
  is the identity of the row spelled out rather than a number drawn for it; a second row for
  somebody who already has one is visibly a duplicate. It is the same rule `P12-A2` follows on the
  `Email` tab.
- **`Mode` is left blank** when a row is written, so the cell carries the tab's own default. A value
  written at planning time would overrule a person who set that cell to `Draft`, which is the one
  direction the mode rules never allow.

### It holds the name and the address, and the `Email` tab does not

That is the plain opposite of the rule a few sections up, and it is a **deliberate decision by the
sheet's owner** rather than an oversight.

The `Email` tab sends in bulk and unattended, so keeping a recruiter's name and address out of the
tracker costs nothing and removes a class of accident a screen-share can cause. The `Referral` tab
is read by a person before anybody is asked, and the question it exists to answer is *who at this
company have I already asked* — a tab that answers that with a non-reversible fingerprint is a tab
you have to open the contacts spreadsheet to use, which means row 14 stays anonymous exactly when
you need to know who row 14 is.

The rules the rows will be created under — which posting, which six people, which day, and why a
person is asked once and never again — are in
[outreach.md](outreach.md#the-referral--asking-an-engineer-instead-of-a-recruiter).

## The contacts spreadsheet — tab `Employees (seed)`

Not this file. The contacts spreadsheet is a second, separate spreadsheet **owned by the sending
account**, so that no recruiter's or engineer's address ever lands in the tracker as a side effect
of an export. It has three tabs: `Contacts (seed)`, `Contacts (manual)` and, for the referral path,
`Employees (seed)`.

`Employees (seed)` is written wholesale by `src/export_referrals.py` in ColdEmail and imported over
the tab, so **nothing typed by hand belongs on it** — there is no manual sibling, and a name added
here is erased by the next export.

| Column | Meaning |
|---|---|
| Company | matched to a `Jobs` row by the same company rule the recruiter path uses |
| Person Name | the greeting |
| Email | the address; also the key that says this person has been asked already |
| Title | what decides the tier, ahead of `Seniority` |
| Domain | what tells the employer's own careers site apart from an aggregator carrying the same posting |
| Seniority | ColdEmail's own label, read **only** when the title settles nothing, and left empty rather than guessed |
| LinkedIn | for a person checking a row by hand; nothing reads it |
| Angle | one sentence about the company, shared by everyone there |
| Bucket | the industry, which picks the two resume numbers |
| Verify | where the address was confirmed |

## Why writing the sheet takes two calls

`_write` writes `A:D` with `valueInputOption="RAW"` and `E` onward with `USER_ENTERED`, at the
cost of one extra API call per run. The two halves need opposite parsing:

- **`A:D` has to be RAW.** `Date Posted` is the ISO string `2026-08-16` and the sort that reads
  it treats it as a string. `USER_ENTERED` would parse it into a date serial and break the sort.
- **`E` onward has to be USER_ENTERED.** The string `"TRUE"` written RAW sits **on top of** the
  checkbox as text instead of ticking it, and the next run reads it back as unticked.
