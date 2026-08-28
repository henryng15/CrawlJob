# Outreach — emailing a recruiter after you have applied

Once an application is in `App` and the tool has ticked `Recruiter`, there is a person at that
company worth writing to. This is the design for doing that on a schedule, from an account that
is **not** the one that owns the spreadsheet, and entirely inside free quotas.

The decision logic is built and tested: `apps_script/outreach/`, with 378 tests in its own
harness that run on a laptop with no Google account and nothing that can send. What is not done
is installing it — that needs the sending account, and is the last section here.

## What this is not

It does not open-track, it does not rewrite links to bounce through a redirector, and it does
not measure open rate. Those are the first three features every cold-email tool ships and all
three hurt deliverability. At the volume here — tens of emails a week — open rate would not be
a measurement, it would be noise with a spam penalty attached.

It also does not put a recruiter's name, address, or the message body into the tracker
spreadsheet. That boundary already exists: see [`scripts/recruiter_companies.py`](../scripts/recruiter_companies.py).
The tracker knows a contact exists; it never learns who.

## Three identities, and why the sender is Apps Script

| Identity | Does | Never does |
|---|---|---|
| Service account | reads and writes the sheet from GitHub Actions | send email |
| `nguyen15@kenyon.edu` | owns the spreadsheet and its bound Apps Script | send email |
| `hoanng15.work@gmail.com` | owns a **standalone** Apps Script project; sends | own the sheet |

The bound Apps Script cannot be the sender. It runs as whoever owns the spreadsheet, so
`GmailApp.sendEmail` there would send from the Kenyon account — the one thing this is meant to
avoid. The sender has to be a separate project owned by the sending account, with the
spreadsheet shared to it as Editor.

> **Why not a GitHub Actions worker.** It was the first plan and the minutes do not exist.
> The repository is private, so Actions gives 2,000 minutes a month; [`sync.yml`](../.github/workflows/sync.yml)
> already spends about 1,080 of them and `boards.yml` a little more. Spreading 25 emails a day
> needs roughly nine runs, and Actions bills wall-clock time — so the pauses between sends are
> billed for sitting still. That lands at about 28 minutes a day against a 30-minute remainder,
> with nothing left for a retry.
>
> A time-driven Apps Script trigger costs no minutes at all, needs no OAuth refresh token in a
> secret, and cannot hit the expiry that catches an OAuth app left in Testing status. It also
> gets reply detection for free, because it is already inside the mailbox it sent from.

The recruiter addresses and the message bodies live in a **second spreadsheet owned by the
sending account**, exported from ColdEmail's `finals/9_emails.csv`. The tracker never holds them.

## What enters the queue

Read from `App` on the sync run that already walks every row ([`job_sync/highlight.py`](../job_sync/highlight.py)):

- `Recruiter` (J) is ticked
- `Process` (F) is `Applied` or `Completed OA` — not `Rejected`, and not `OA` / `Interview` /
  `Offer`. `Interview` and `Offer` mean a human contact already exists and a cold email is the
  wrong message; `OA` means the assessment is still owed, and the recruiter's first answer
  would be to go and finish it. `Completed OA` is the opposite of both: there is finished work
  sitting in their system and nobody assigned to look at it, which is the best moment in the
  whole pipeline to write. The email says so — see the intro bullet in
  [`outreach_compose.gs`](../apps_script/outreach/outreach_compose.gs)
- `Company`, `Role` and `Date Applied` are all filled — an empty one cannot be written into a
  sentence, and an empty date cannot be ordered
- the contact's `verify_tool` is not `local:Unknown`
- no queue row exists for this `Property` yet

`Eligible At` is `Date Applied` + 2 days. Sending the same day reads as automation; two days in,
the application has reached the ATS.

It stays `Date Applied` for a row that moves to `Completed OA`, which is worth knowing before
you tick one: an application from three weeks ago is already past its eligible day, so the wave
opens on the next firing rather than two days later. That is the intent — the assessment is the
event, and it has already happened — but it means ticking several `Completed OA` rows in one
sitting queues all of them at once. `DAILY_CAP` is what stops that becoming a spike.

> **Why `local:Unknown` is excluded.** Those 171 rows were never actually verified — ColdEmail's
> own note says not to treat unknown as confirmed, but `generate_seed.py` applies no quality
> filter, so they arrive alongside the verified ones. Bounce rate, not volume, is what gets a
> sending account penalised. Excluding roughly 7.5% of the list is the cheapest protection
> available.

### The tick and the queue have to agree

Dropping those rows drops **70 whole companies**: 720 in the contact list, 650 with a contact
worth writing to. Every one of the 70 has contacts and none of them are sendable.

`recruiter_companies.txt` is generated from the whole CSV, so column `Recruiter` on the `App`
tab ticks for all 720. On 70 companies that tick would promise someone to write to and the queue
would produce nothing — the column saying one thing and the system doing another.

So the count lives on the `Email` tab instead, next to the application it belongs to, and
**nothing in this system writes to `App` at all**. Column J there keeps its existing meaning —
*is there a contact anywhere* — written by `job_sync` exactly as it is today. `Recruiters` on the
`Email` tab answers the sharper question: *how many of them can actually be written to*.

Two columns, two questions, and no handover to arrange: `recruiter_companies.txt` stays where it
is, `job_sync` is not touched, and the `App` tab does not gain a column on a tab that is already
dense enough to read past.

## Order: oldest application first

One sort key, `Date Applied` ascending. Nothing else.

The obvious instinct is to send the freshest applications first, and it is wrong here. **The
value of the email decays with the age of the application**, so the oldest row is the one
closest to being worthless — it has the nearest deadline. A 25-day-old application sent today
beats the same one sent in six days at 31. A one-day-old application loses almost nothing by
waiting.

This also removes a mechanism rather than adding one: there is no fresh lane and no backlog
lane competing for the day's budget, because the backlog is simply the oldest rows and goes
first by construction. It drains in about a week, after which the queue is plain FIFO forever.

`Priority` survives as a **filter, not a sort key** — it records the verification tier, which is
the reason a row was let in or kept out.

## Volume

A fixed cap per weekday, deliberately not random:

| Mon | Tue | Wed | Thu | Fri | Sat/Sun |
|---|---|---|---|---|---|
| 15 | 25 | 22 | 18 | 10 | 0 |

Fixed beats random on two counts: there is nothing to debug when the number looks wrong, and
the shape is more human than randomness is. Tuesday and Wednesday are high because that is when
a recruiter reads carefully; Friday is low because Friday afternoon email dies.

The trigger fires hourly from 09:00 to 17:00 ET on weekdays — nine firings. Each one sends
`ceil(remaining ÷ firings left)`, which spreads the day evenly without any `sleep`, and
self-corrects if a firing is missed.

Gmail allows a consumer account 100 recipients a day through Apps Script. The busiest day here
asks for a quarter of that.

> **Re-check immediately before sending.** Days pass between enqueue and send, and `Process` can
> move in that time. Read the matching `App` row again; if it is now `Rejected` or has advanced
> a stage, the row becomes `Cancelled` and nothing goes out. This is the single most important
> correctness rule in the system.

## One application, up to three recruiters — queued together

Three contacts at a company is worth more than one. The first version made them wait on each
other: attempt 2 was created only once attempt 1 had gone four days without a reply. That was
wrong, and wrong in a way the rest of this document already argued against — it took **twelve
days** to work through one employer, and the application it is about ages the whole time.
Ordering by application age and then spending a fortnight per company are not the same system.

So a **wave of three** is queued at once, one day apart:

```
Aug 1   applied
Aug 3   recruiter #1
Aug 4   recruiter #2
Aug 5   recruiter #3
        ...
Aug 19  silence for 14 days -> recruiters #4, #5, #6
```

One day apart rather than one morning, because three near-identical emails landing on one team
inside an hour is what reads as spray. Spread over three days it reads as a person working
through a list — which is what it is.

The three subjects, the result bullet under each and the ask all differ, so what arrives is
three different emails, not three copies.

### Three at a time, not three in total

Three is the right number to send *together*. It was the wrong number to stop at: a company with
five contacts held two nobody was ever going to write to.

After a wave, **fourteen days of silence opens the next one** — the next three people, and so on
until the contacts run out. Within a wave a reply changes nothing, because those emails were
already committed. A reply *before* the next wave calls it off: by then there is a person to
talk to, and three more cold emails to their colleagues would be talking past them.

A half-finished wave is different again — a company with two contacts, where a third gets typed
into `Contacts (manual)` a week later. That third goes out without waiting, because it was always
meant to be part of the same three.

**A reply does not call off the rest of its own wave.** An earlier version cancelled the siblings, on the
reasoning that reaching one person was the point. It was wrong twice over: "we will pass this
on" is not being in, and the person who actually owns the req may well be the second or the
third. It also barely ever fired — with the three going out a day apart, all of them have left
before a first reply arrives.

What *does* stop everything is the application's own `Process` moving off `Applied`. That is the
signal that means something, and it is checked immediately before every send.

The person who replied is still never written to again — they have been reached, and their
address is spent for good.

### Two caps, one of which is not obvious

`Contact Fingerprint` — a non-reversible HMAC of the address — stops the same person being
written to twice about the same intake, across every application. It is scoped by intake rather
than by address alone, so one recruiter can hear about Winter once and Summer once; see
[Two intakes, two waves](#two-intakes-two-waves).

That is not enough on its own. Apply to the same company three times and the queue treats those
as three unrelated applications, working through its contacts three attempts at a time. So a
second cap: **a company receives at most 5 emails in any rolling 7 days**, counted across every
application. Rolling rather than calendar, so nothing resets in a burst on Monday morning. With
oldest-first ordering, the oldest application at that company spends the allowance.

> **What counts against it.** Everything sent in the window *and everything still queued*. An
> earlier version counted only sends, which made the cap do nothing on the one run where it
> matters most: on a first run nothing has been sent at all, so every company reads as having its
> whole allowance free, and three applications to one employer with ten contacts queue nine
> emails in a single pass. A queued row is an email that company is going to get. `Cancelled` and
> `Failed` rows do not count — nothing is going to arrive from those.

### One posting, one wave

Before either cap is consulted, an application is skipped if a **sibling application for the same
posting at the same employer** already owns a wave.

This exists because the cap alone was the wrong instrument. American Express advertised one
programme in three cities and three applications went in; each asked for three emails to three
different recruiters. The cap held the week to five, which is five of American Express's five
contacts spent on one job, with nobody left for the next posting. IBM was worse: ten applications
against eight contacts, so a single employer consumed the entire list. Across the sheet, 21
employers carried more than one open application — 48 emails where 23 were meant.

Two roles at one employer are the same posting when they share at least `ROLE_MATCH` (0.6) of
their words, after the city and state are dropped. Equality is the wrong test: the three American
Express postings read `Software Engineer, Enterprise Technology Services- Charlotte, NC`,
`Software Engineer, Technology - New York, NY` and `Software Engineer I, Enterprise Technology
Services- Phoenix, AZ` — three different sentences, not one string with a suffix. Stripping the
city still leaves them unequal.

0.6 was measured against the 39 duplicated applications in the sheet, not guessed. It folds those
three into one and IBM's seven vendor practices into one, while keeping IBM's sales and strategy
programmes separate and NVIDIA's Dynamo team apart from its general posting. 0.5 also folded
`Software Engineer Intern` into `AI Software Engineering - Edge` at Microsoft, which are not the
same job.

The word test alone cannot separate two intakes, and for a long time this document claimed it
could. `Software Engineer Intern - Winter 2027` against the same title ending in `Summer 2027`
differs by one word in six: 0.67 overlap, comfortably past 0.6, and the second application was
skipped as a duplicate of the first. Longer titles fold harder, not softer, because every word
they share pushes the ratio up. The intake is now tested separately and first — see below.

> **Skipped, not merged.** The queue row still belongs to the one application that owns it. A
> rejection arriving for that application cancels exactly its own rows, and the sibling becomes
> eligible on the next firing — a refusal from the Charlotte posting must not silence New York.
> A blank role never matches anything, including another blank, because otherwise every
> unfilled cell at one employer would read as one job and silence the lot.

### Two intakes, two waves

An employer that runs both a summer programme and an off-cycle one is running two openings, and
they deserve two waves — to the same recruiters, if that is who is there. The `ROLE_MATCH` test
cannot see the difference, so the intake is a separate test applied before it: **two applications
with different intakes are never the same posting, however alike their titles read.**

Two buckets, not four. A role naming **Winter**, **Spring** or **Fall** is off-cycle; **everything
else is Summer**. Every named off-season shares one bucket because an employer running more than
one of them is running one programme more than once, and a recruiter reading about each separately
reads near-identical emails a month apart. The ceiling this sets is the point of it: **one person
hears from us at most twice, ever** — once about Summer, once about everything else. Splitting
`OFFCYCLE_SEASONS` into separate buckets is a one-line change and should not be made lightly: four
buckets means four cold emails to one recruiter, and at 25 days apart that is all four inside a
single hiring year.

The default is the whole rule, not a fallback. An unlabelled role reads as Summer rather than as
*unknown*, and that is what lets an employer who has so far posted only a Winter opening be
recognised as a two-intake employer: the Summer row does not have to say "Summer", it only has to
not say "Winter".

The price of defaulting rather than refusing is that a role name which lost its season — truncated
in a paste, or never filled in — reads as Summer and hands back a contact already written to. So
the second half of the rule is a clock:

> **`SEASON_RECONTACT_DAYS` — 25 days.** Within one intake the fingerprint is final: written to is
> written to, forever. *Across* intakes the block is a gap. Two intakes are two occasions, but only
> if enough has happened in between that the second reads as a new one rather than as a follow-up
> to a mail already ignored. 25 days sits under the four-week mark where an unanswered email stops
> being recent, and over the fortnight a wave itself takes, so the two can never overlap.

Two endings are not unlocked by any amount of time. A `Bounced` row means the address is dead, and
it is just as dead for the other intake; a `Replied` row means the person has been reached, and a
cold email about the next opening talks past a conversation that already exists. Both close that
person in **every** bucket — which is what "spent for good" has always meant. Only a plain `Sent`
that nobody answered is what the 25-day clock applies to.

A row in the other bucket that has **not gone out yet** blocks outright rather than being measured.
There is no date to measure from: a row still `Queued` has a send date that moves every time the
queue does, and reading "not yet sent" as "sent long ago" would schedule both intakes into one
week. The practical effect is that one recruiter never picks up both intakes inside a single
enqueue run — the second waits until the first has actually landed, and then 25 days more.

The company cap is untouched by any of this. Five emails per employer per rolling seven days still
holds across both intakes, so a second wave queues behind the first rather than doubling the week.

### A Role corrected by hand

The crawlers drop the intake. A posting titled `Software Engineer Intern, Winter 2027` reaches the
sheet as `Software Engineer Intern` often enough that fixing one by hand is routine — and under the
rule above that correction is not cosmetic. It moves the application out of the Summer bucket,
which is what decides whether its recruiters may be written to again.

So the `Role` column in `App` is watched. Type the missing season, press Enter, and three tabs
catch up in the same second:

| | |
|---|---|
| `Alphabet_Order` | the same row, matched by `Property`, gets the corrected title |
| `Email` | every queue row of that application gets the corrected title, and a row **not yet sent** also moves bucket |
| `Season` | rebuilt, so the employer appears — or stops appearing — as two-intake straight away |

The bucket move is the half that matters, and it is deliberately limited to rows that have not gone
out. A `Sent` row records who was written to and which intake it was spent on; that is history, and
rewriting it would hand back a person who has already had their email. A `Queued` row has spent
nothing yet, so leaving it in the wrong bucket is the actively dangerous case: it would go out about
Winter while still holding Summer's hash, the off-cycle bucket would read as free, and the next
enqueue would write to that same person about Winter a second time.

> **It does not enqueue.** Everything on that list rearranges what is already written. Opening a
> wave stays the hourly cycle's job, because an edit trigger that could start one would make a
> keystroke in a cell the thing that decides an email goes out. The recruiter unlocked by the
> correction is picked up at the next firing, within the hour.

It rides on the installed `onEdit` trigger that already answers a `Priority` tick — one trigger,
two filters, both of which run before anything is opened or read. A paste down the column is handled
row by row, because each row is a different application.

> **Why the contact lookup stopped reading `Role`.** `outreachContactByFingerprint_` used to derive
> the intake from the row's own `Role` cell to know which hash to match. That was correct right up
> until somebody fixed a `Role` — the row would stop resolving to any contact, and `sendPreparedDrafts`
> cancels a row it cannot resolve. A correction to the sheet would have silently called off the email
> it was meant to improve. It now tries both buckets, which costs one extra hash and makes the lookup
> independent of a cell anybody can edit.

### The `Season` tab

A report, written every firing and read by nobody but a person. One line per employer with at
least one off-cycle application:

| Column | |
|---|---|
| `Company` | the longest spelling seen, because `Amex` is the one that needs looking up |
| `Off-cycle` / `Summer` | how many applications fall in each bucket |
| `Reading` | whether both intakes are applied to, or a Summer row is still to come |
| `Off-cycle rows` / `Summer rows` | the `P` numbers, to click back to `App` |
| `Recruiters` | how many contacts exist there — the budget the second wave will need |
| `Roles as written` | the titles untouched, because this is the column where the rule is caught misreading one |

Two kinds of employer are left out. Those with nothing off-cycle, because under this rule they are
the whole rest of the sheet and a report listing everything reports nothing. And those with **no
contacts at all** — the tab exists to say where a second wave is coming *before* the contact budget
is spent on the first, and an employer with no contacts has no budget to spend and no wave to
expect. It would be a row that can only ever be read and then skipped over.

The point is the ordering of two facts. The contact list is the scarce thing, and it is worth
knowing that an employer will want a second wave *before* their five weekly emails have been spent
on the first. An employer showing `Off-cycle only — a Summer row is still to come` is one whose
Summer posting has not opened yet, and whose recruiters should not all be spent on Winter.

> **One migration, run once.** Summer hashes to exactly what it always did, so every row this
> system has already sent still matches — no backfill for those. Off-cycle rows written *before*
> this change are the exception: they carry the unscoped hash, which is now the Summer bucket's
> hash, so a Winter row already sent reads as "this person has heard about Summer" and the same
> recruiter would be written to about Winter again 25 days later. `backfillSeasonFingerprints`
> fixes exactly those rows — run it by hand after pushing and before the next cycle. It is
> idempotent, and it never puts an address in the sheet: the old hash is matched back to a contact
> in the contacts book, the new hash is computed from that address, and only the hash is written.

The tab holds no state anything else reads — no fingerprint, no status, nothing the sender
consults — so it is cleared and rewritten whole rather than reconciled. `refreshSeasonTab` can be
run on its own from the editor's Run menu; the hourly cycle calls it last, after everything that
could change what it reports on.

It is a loose cap on purpose, because the contact list is the tighter one almost everywhere:

| Contacts at a company | Companies | Share with at least this many |
|---|---|---|
| 1 | 178 | 100% |
| 2 | 129 | 72.6% |
| 3 | 110 | 52.8% |
| 5 | 54 | **22.6%** |
| 10 | 10 | 1.5% |

2,098 sendable contacts across 650 companies, averaging 3.23. The weekly cap can only ever bind
on the 147 companies holding five or more — for the other three quarters the list runs out
first. **At 178 companies there is exactly one person to write to**, so the attempt 1→2→3 cycle
cannot complete at better than a quarter of them, and that is a property of the data rather than
something to fix here.

> **Why there is no lifetime cap per company as well.** The worst case the weekly cap allows is
> ten emails to one company across two weeks, and the only companies with ten contacts are
> Meta, OpenAI, Palantir, Citadel and their size — where ten recruiters is a rounding error. A
> five-person startup cannot reach that ceiling because it does not have five recruiters in the
> list. Contact count tracks company size, so the cap is self-limiting and a second mechanism
> would only add a way to be wrong.

## Reply and bounce

`GmailApp.search` inside the sending account's own mailbox — no extra scope, no extra service.

- an inbound message on the thread → `Replied`, and no further attempt is created
- a message from `mailer-daemon` naming that recipient → `Bounced`, and the fingerprint goes on
  a never-contact-again list

Watch the bounce count over the first week. Above 2–3% means a bad slice of the contact list,
not a bad day, and the run should stop until it is found.

## The follow-up — one reply, five to ten days later

A cold email that goes quiet is not evidence of a no. It is evidence of an inbox. Every `Sent`
row earns exactly **one** short reply on its own thread, and then that row is finished forever.

Three columns hold it, and they sit immediately after `Mode` because they are the same four
questions asked one message later: `Follow Up` is the **hour** it is booked for, `Follow Up
Template` is which of the twenty sentences it will use, and `Follow Up Status` is where it has got
to.
Read next to `Status` they are one story — *this went out, nobody answered, so a nudge is booked
for Tuesday.* Put out past the audit references they would have been three columns nobody
scrolls to, which is exactly what happened to `Priority` before it moved.

### One reply at a company silences the whole company

If Samsara had three emails and **one** of them came back, none of the three is chased.

This reverses the cold path on purpose, and the reversal is the point rather than an
inconsistency. `outreachAttemptsWanted_` says a reply does not stop the rest, because one
recruiter answering *we will pass this on* is not the same as being in and the person who owns
the req may be the second or the third. That reasoning is about a **first** email to somebody who
has not heard from us.

A follow-up is the opposite case. The company has now answered once. Chasing two of their
colleagues about the silence of a thread that is not silent is how a careful sequence turns into
the thing recruiters forward to each other. Employers are matched the way they are matched
everywhere else in this system, so `Samsara` and `Samsara Inc.` are one company here too.

A booking already made comes off when the answer arrives after it: a row booked on Monday for
Thursday has three days in which a colleague can reply, and the run after that reply is recorded
clears the date and writes `Stopped`. Without that half, the rule would only hold for rows nobody
had looked at yet — which is the subset it matters least for.

### What never earns one

`Status` has to be `Sent`. That single line is also the answer to *what about the bounced ones* —
a bounce moves the row to `Bounced`, so it never reaches the question, and neither does `Replied`,
`Cancelled` or `Failed`. Beyond that:

- **no thread to reply on.** Without a `Gmail Message ID` there is nothing to reply *to*, and a
  new message with `Re:` on it is worse than no message.
- **sent over 21 days ago.** Past that the first email is not recent enough for *following up* to
  be a true description of the message. It is inside the 30-day reply-scan window, so a reply
  that lands late is still seen before the row is written off.
- **already decided.** A blank `Follow Up Status` is the only state the planner will touch. That
  is what makes one follow-up permanent rather than something the next run has to be trusted to
  remember.

### Five to ten days, weekends included, six a day

The delay is a **window**, not a number. Five days is the earliest a nudge reads as patience
instead of pestering; ten is the point past which the first email is no longer recent. Anywhere
inside that is equally honest — and having six days to choose from is the whole mechanism that
keeps any one day light.

Weekends count here where `DAILY_CAP` zeroes them. A cold email read on a Saturday is read badly
and a first impression is worth waiting a weekday for; a follow-up is one sentence on a thread
the recipient already has. The two extra days exist for the same reason the window does.

`FOLLOWUP_DAILY_CAP` is six, and it is counted **separately** from the weekday cap. Sharing one
budget would have made every follow-up cost a cold email, and the cold email is the one with the
deadline attached. Six is under half the lightest sending weekday, so both streams together stay
near what one of them used to be.

The first day in the window with room wins, rather than the emptiest. Spreading for its own sake
would hold a nudge back four days to keep a number even, which serves the table and not the
message.

When the window is full the search keeps walking, out to the 21-day ceiling, rather than putting a
seventh row on a day inside the window.

> **This was wrong on the day it shipped, and only the live tab showed it.** The first version put
> the overflow on the emptiest day *inside* the window. Sixty-eight rows were already sent and
> quiet when the feature went out, and every one of their windows is at most six days wide and
> ends at most ten days out — so the whole backlog wanted to land inside nine days, which is
> fifty-four slots for seventy rows. Seven of those nine days came back holding eight or nine, on
> a feature whose stated point is that no day carries a pile. Walking past the window costs a
> follow-up on day twelve instead of day nine. Overloading cost the cap entirely, and the cap is
> the thing that was asked for.

Only when everything out to the ceiling is full does the emptiest day take it. By then the queue
is saturated and there is no day that is not a compromise; the row still goes rather than being
silently dropped.

Because the planner never touches a row that already has a `Follow Up Status`, a change to *how
days are chosen* cannot reach bookings already made under the old rule. `replanOutreachFollowUps`
is the way out: it clears every `Queued` booking and books again. It is deliberately narrow —
nothing `Sent`, `Drafted`, `Skipped` or `Stopped` is touched, so no follow-up can go twice and no
decision about a replying company is undone.

> **Why the first run does not empty the backlog onto one afternoon.** Every row already sent has
> a window that finished before the feature existed. A window that has *already shut* is replaced
> by a fresh one of the same length starting today, so those rows fan out over the next five days
> like anything else instead of collapsing onto a single date. Rows older than 21 days never get
> that far.

### The hour is booked with the day

`Follow Up` is a timestamp, not a date, and that is worth stating because it was a bare date for
the first hour of this feature's life and it was wrong. `outreachProjectSchedule_` already says
why in as many words about `Scheduled At`: *"Aug 24" on fifteen rows reads as fifteen emails at
once, which is the one thing this is built not to do.* Six rows all reading `August 29, 2026` are
six replies at nine in the morning as far as anybody scanning the column can tell.

So the day's six hours are handed out when the day is booked. The row then goes at that hour
exactly as a cold email goes at its `Scheduled At`: `followUpAt <= now` on the whole timestamp, so
a row set for 15:00 is not a row the 08:20 firing may send.

The window is **08:00 to 19:00**, against the cold path's 10:00 to 17:00, and it is wider at both
ends for the same reason: nothing here waits an hour in Drafts. The cold path cannot send in its
first hour because that is the hour it *writes* in, and cannot write in its last because there
would be no hour left to wait; a follow-up is composed and posted in one step, so the first and
last firings of the day are both firings it can go on. The trigger has always fired at these
hours — `everyHours(1)` runs around the clock. 08:00 and 19:00 were never hours nothing ran in,
only hours nothing was allowed to leave in.

Twelve hours for six emails is the point rather than a side effect, and it needs its own
arithmetic. `outreachSpreadHours_`, which the cold path uses, fills from the front taking each
firing's fair share of what is left — right when the count is at or above the hours available
(fifteen across eight comes out 2,2,2,2,2,2,2,1) and right when a light day *should* finish early,
because the application it is about is ageing while it waits. It degenerates when the count is well
under the hours, and for follow-ups that is not the corner case but every case: six across twelve
filled from the front is 08,09,10,11,12,13 and an empty afternoon.

Nothing is ageing here, so there is no reason to finish by lunchtime and every reason to be far
apart. `outreachSpaceHours_` anchors at both ends and spaces the rest between:

```
08:00   10:00   12:00   15:00   17:00   19:00
```

Two and three hours apart, first at the open and last at the close. The window was widened to buy
distance between the six, not an earlier start.

An hour that has already gone by is still due, which is what makes a weekend of downtime catch up
rather than silently drop. A per-firing brake survives from before the hours were booked, and its
job is now only that: after a day nothing ran on, six rows come due together, and sending them in
one firing would undo the point of having booked six different hours.

A day pushed past its cap by the saturation fallback puts the overflow on the last firing rather
than inventing an hour the table does not have.

> **Bookings made before the hour existed are upgraded in place.** A booking is decided, and a
> decided row is one the planner will not touch — which is what makes one follow-up per row
> permanent, and also why a change to *when inside the day* a row goes could not reach the seventy
> rows already carrying midnight. So the planner has a narrow pass that moves the hour and never
> the day, only on `Queued` rows, and never on one the reply rule has just called off. A booking
> that already has a real hour matches nothing, so it stops finding work the moment there is none:
> no flag, and no second run to remember.

### Twenty sentences, and why twenty

Twice the ten the cold path uses, and the number is doing real work. A cold email varies its
subject, its number and its ask across ten variations — plenty of surface to be different on. A
follow-up has one sentence and no subject of its own, so the sentence is the only place variety
can live, and these go to people who are by definition on a thread that already exists. Two
identical nudges landing at one employer in the same week is the failure the list is sized
against.

Each is a `note` and a `close` kept apart, so the two axes multiply when they are read: twenty
openings and twenty sign-offs, paired but never repeating either. House rules are the same as the
cold template — no dash anywhere, nothing over about twenty-five words, and **no claim the first
email did not already make.** There is no new fact in any of them on purpose: a follow-up that
adds an argument is a second pitch, and a second pitch is the thing this is built not to be.

Which one a row gets is stored, not recomputed, for the reason `Template` is stored — what the
tab said before the message went is what you read afterwards to know what went. The company
decides where in the list to start and the count decides how far along, so two people at one
employer never get the same sentence and two employers rarely start in the same place. Run
`previewOutreachFollowUps` to print all twenty; it sends nothing.

### It is a real reply, not a new email with `Re:` on it

`GmailMessage.reply` and `GmailThread.reply` both answer **the sender of the message**, and on a
thread this account started that sender is this account — calling either would have mailed Henry
a follow-up about Henry's own email, and neither offers a `to` override. So the follow-up is the
one place in this project that uses the **Gmail advanced service**: `Gmail.Users.Messages.send`
with the thread's id, and `In-Reply-To` / `References` naming the original `Message-ID`. Gmail
threads on those headers rather than on the subject; without them the nudge arrives as a separate
conversation with `Re:` written on it, which looks like a mistake.

No extra OAuth scope is needed — `https://mail.google.com/` already covers it — but the service
has to be enabled, and `clasp push` does that from the manifest.

The reply is **plain text and carries no attachment.** The resume is already on the thread one
message up, and re-attaching it to a two-sentence nudge is the single loudest bulk-mail signal
this system could send.

### The six follow-up states

| | |
|---|---|
| *(blank)* | nothing has decided about this row yet |
| `Queued` | a day is booked; `Follow Up` says which |
| `Drafted` | `Mode` held it back, so it is a draft for you to send |
| `Sent` | gone, and `Follow Up` now says the day it really went |
| `Skipped` | never going to be chased — too old, no thread, or a colleague had already answered |
| `Stopped` | had a day booked and lost it, because somebody at that company replied in between |

`Skipped` and `Stopped` look alike and are worth telling apart: one is a decision made once, the
other is a decision reversed, and the reversed one is what you go looking for.

`Mode` is honoured exactly as the cold path honours it. A row held to `Draft`, or a global
`OUTREACH_MODE` of `Draft`, produces a draft instead of a sent reply and the row says `Drafted`.
Sending it is then a person's decision, and the row keeps saying `Drafted` afterwards — the same
thing a cold email in `Draft` mode does.

Three checks are made again on the day rather than trusted from planning time, because each is a
thing that can change in between: the application may have closed, a colleague may have answered,
and **this very thread** may have been answered. The third is free — the thread has to be fetched
to reply on it anyway — and it is the one the reply scan can miss, because a reply that landed
inside the same hour has not been recorded yet.

## Reading the tab

The `Email` tab is ordered so the three columns copied straight from `App` lead it —
`Company`, `Role`, `Date Applied` — because those are the only ones a human reads to know which
application a row is about. `Property`, `Recruiters` and `Attempt` follow; everything after
them is the sending machinery, and everything after `Sent At` is an audit reference nobody looks
at until something has gone wrong. `Status` is column K and `Sent At` is column S.

`Drafted At` and `Scheduled At` sit next to each other, in that order, because they are one fact
read left to right: **written at 09:07, goes at 10:00.** While a row is `Queued` both are the
projection; once it is written both are what happened. That pair is the column to check when you
want to intervene, because the gap between them is the hour in which deleting the draft still
calls the send off.

**Almost nothing in this system writes to `App`.** An earlier version put the contact count in
column J there, and it was one more machine-written column on a tab that is already dense enough
to read past. Everything the outreach system knows lives on the `Email` tab instead.

The one exception is a rejection, below — it writes `Process` and appends a line to `Update`,
because an application that has been turned down has to stop being worked within the hour, and
nothing else is watching the mailbox.

`Recruiters` is that count, moved here: how many people could be written to at that company. It
is rewritten every firing, so a name typed into `Contacts (manual)` five minutes ago shows up as
a `2` where there was a `1`. A count stamped once at enqueue would be worse than none, because
it would look current.

### An application nobody can be written to gets no row

If a company has no usable contact, no row is created. The tab is about emails, and that is not
one — an earlier design gave it a `Held` row, and the result was a queue where the common case
was a row describing an email that did not exist.

It is not silent, though. The firing logs `Nobody to write to at: …` by name, so the companies
worth hunting a contact for are still nameable. The moment a name is typed into
`Contacts (manual)`, the next firing queues that application for real.

### One firing does the whole round

There is **one** hourly trigger, not four on separate clocks — four would drift apart and leave
the table describing four different moments. `runOutreachCycle` does the round in the order the
steps depend on each other:

1. **what came back** — replies and bounces, so a reply seen now stops an attempt being created
   in step 4
2. **who said no** — rejections sitting in the mailbox, which close the application in `App` and
   delete any draft already written for it
3. **who said no elsewhere** — applications closed by hand in `App`, whose queue rows nothing had
   called off, because the refusal arrived in a mailbox this project cannot read
4. **what is new** — applications ticked `Applied` since the last firing
5. **what goes out** — the drafts written an hour ago, unless one was deleted in the meantime
6. **what is written** — this hour's share of the day's cap, into `Drafts`, to sit for an hour
7. **what is chased** — follow-ups booked onto a day, and bookings taken back off
8. **what is chased now** — the follow-ups whose day has come, replied onto their own threads
9. **what happens next** — `Drafted At` and `Scheduled At`, recomputed across everything queued
10. **what to expect** — the `Season` tab, rebuilt from `App` after everything that could change it

Reversing any pair leaves the table a firing out of date: projecting before sending would put a
date on rows that are about to leave, and enqueueing before scanning would create an attempt 2
for someone who has already replied. **Step 5 before step 6** is the load-bearing one: drafting
first would let a message be written and sent inside a single firing, and the hour in which it
could have been read would never have existed. **Step 2 before step 4** is the other: a rejection
read now has to close the application before anything opens a fresh attempt underneath it.
**Steps 7 and 8 after 5 and 6** is the third: a follow-up is the cheaper of the two messages and
the cold email is the one with a deadline attached — an application ages while it waits and a
nudge does not — so on the firing where something has to give, the nudge is what gives. It also
means a row sent minutes ago is on the tab as `Sent` before the planner reads it, and gets its day
in the same round. Planning before sending, so a row booked for today can leave on this very
firing rather than waiting an hour for the next one to notice it.

Step 1 only asks Gmail about rows sent in the last 30 days. Every sent row would mean one API
call per row on every firing, growing with the queue forever — and a reply to a two-month-old
cold email is not a thing that happens.

### A rejection in the mailbox closes the application on both tabs

The rejections arrive at `hoanng15.work@gmail.com`, which is the account this project already
runs as — so reading them needs no second credential, no forwarding rule and no extra scope.
Step 2 of each firing searches for them.

When one is recognised and can be pinned to a single open application, two things happen:

| Tab | What changes |
|---|---|
| `App` | `Process` → `Rejected`, and `Update` gains a `Rejected: Aug 19, 2026` line **dated the day the email was sent** |
| `Email` | every `Queued` **and `Drafted`** row for that application → `Cancelled` |

The `Drafted` half is the reason this is worth building. A draft written at 09:00 is addressed,
complete and an hour from leaving; a rejection arriving at 09:30 would otherwise be followed at
10:00 by a cold email to the company that just said no. The draft is deleted from Gmail, not
merely marked.

The date on that line is the message's own, not the hour the scan ran. A rejection that sat unread
for three weeks still happened on the day it was sent, and `Update` is the one place the shape of a
search over months can still be read — stamping the scan time would date every rejection found on a
first run to that single morning. A missing or future header falls back to now.

The `Update` line is written by hand here rather than left to `onEdit`. A simple trigger does not
fire for a write made by another script, and `audit_app` in `job_sync/sheet.py` reports
`UNLOGGED` whenever the bottom line of `Update` disagrees with `Process` — so skipping it would
make every automatic rejection show up as a defect in the next audit.

#### It says no rather than guessing

Recognising the language is the easy half; deciding *which* application it belongs to is where a
wrong answer costs something. A wrong `Rejected` takes a live application out of the queue for
good, and nothing downstream would ever question it.

So three separate things have to line up, and any doubt stops the write:

1. **The wording has to be a refusal**, judged **sentence by sentence** rather than over the body
   as one string. Every phrase in the list was taken from a real message in this account — 52 of
   them, harvested rather than guessed — because the two mistakes that matter are both
   sentence-shaped:

   - **a hypothetical.** *"If you see the job moved to an inactive state, that means … you were
     not selected for the role"* is portal boilerplate inside an acknowledgement, and it reads
     exactly like a refusal to anything matching the body as one string. Seven Microsoft
     acknowledgements in this mailbox carry that line. A sentence opening on `if`, `should you`,
     `unless` or `in the event` is skipped entirely.
   - **a polite closing.** A genuine rejection routinely ends *"we invite you to apply for other
     openings"*, so an invitation only overrules a refusal **when it comes first**. Order is the
     whole rule: invitation-then-nothing is an interview, refusal-then-invitation is still a
     refusal.

   `unfortunately` is deliberately **not** in the list: it opens as many delayed-req mails as
   rejections. Stage nouns are deliberately not blockers either — a real rejection here reads
   *"your application wasn't selected for the next round of interviews"*, and blocking on
   *next round* threw it away.

   Apostrophes are stripped rather than normalised, so one phrase matches `wasn't`, `wasn’t` and
   `wasnt`. Writing each phrase twice was the alternative, and the missing spelling was always the
   one that arrived.
2. **The employer has to come from the sender line or the subject** — never the body. Bodies name
   partners, tools and job boards, and one stray mention in a footer would close an application
   at the wrong company. ATS plumbing is stripped first, so a rejection routed through Greenhouse
   does not read as coming from a company called Greenhouse.
3. **It has to land on exactly one open row.** Two employers matching the sender, or one employer
   with several roles open and an email that names none of them, both stop the write.

Everything the search returns leaves with exactly one Gmail label, so nothing is ever judged
twice and the search window cannot silt up:

| Label | Meaning |
|---|---|
| `Tracker/Rejected` | acted on — `App` and `Email` are already updated |
| `Tracker/Check by hand` | reads as a rejection, could not be pinned to one application |
| `Tracker/Not a rejection` | looked at and ruled out |
| `Tracker/Rejudged` | temporary; worn during a reopen and deleted when one finishes |

#### When the rules improve, the old verdicts are revisited

A label is what stops a thread being read twice, and that is also what would make a
bad run permanent: better rules would never see the mail the old rules got wrong.
`REJECTION_RULES_VERSION` is bumped whenever the phrase lists change, and the first
firing after that reopens the two piles the scan is allowed to be wrong about —
`Check by hand` and `Not a rejection` — clears their labels and judges them again.

`Tracker/Rejected` is never reopened. Those applications are already closed, so
re-judging would find no open row to match and would move every correct closure into
the review pile. That label stays yours to audit, and it is short.

The reopen carries its own marker, `Tracker/Rejudged`, because the verdict labels
cannot do the job: a re-judged thread lands straight back under one of them, which
the reopen query no longer excludes. With more threads than `REJECTION_SCAN_LIMIT`
that is not slow progress but none — the same first forty every firing, the rest
never reached, and the version never recorded because the batch is always full. The
marker is deleted the moment a reopen finishes, which is what lets the next one start
from a clean sheet.

`Tracker/Check by hand` is the review pile. It is meant to be non-empty — that is the design
working, not failing.

#### Measured, not asserted

The lists were built by reading every rejection-shaped message this account received between the
first application on 15 July 2026 and 24 August 2026 — 52 messages across Workday, Greenhouse,
Lever, Ashby, iCIMS, SmartRecruiters, SuccessFactors, Jobvite and half a dozen in-house systems.
**27 are genuine rejections, and the rules classify all 52 the way a person would.**

Three findings from that pass are worth keeping, because each was a defect that only real mail
could have shown:

| Found | Fix |
|---|---|
| 7 acknowledgements read as rejections, all on the same conditional sentence | skip conditional sentences |
| a genuine rejection thrown away by its own polite closing | an invitation only counts if it comes first |
| 6 rejections the Gmail prefilter never returned at all | widened `REJECTION_QUERY_PHRASES` |

One refusal sat past the 4,000th character of an 18KB message, which is why `REJECTION_BODY_CHARS`
is 8,000.

> **What it cannot see.** Only this one mailbox. A rejection sent to `nguyen15@kenyon.edu` is
> invisible to it, and that application stays `Applied` until it is changed by hand. If a real
> share of them land there, a Gmail forwarding rule into the sending account is the fix — the
> original `From` survives forwarding, which is the line the employer is read from.

### A tick made by hand closes the queue too

Most refusals arrive at `hoanng15.work@gmail.com` and step 2 handles them. Some do not: an
application made from another address is answered at that address, and the way it gets recorded
is a person setting `Process` to `Rejected` in the `App` tab. Both routes have to end in the same
place, and for a while only one of them did.

Step 2 closes the application *and* cancels its queue rows in a single call. A tick made by hand
did neither — it changed one cell, and nothing was watching that cell. Belvedere Trading was
marked `Rejected` on 24 August 2026; three days later its three rows were still `Queued`, each
carrying a projected send time.

Step 3 is what closes that gap. Every firing it compares the two tabs and cancels any `Queued` or
`Drafted` row whose application no longer qualifies, whatever put it in that state.

> **Nothing was ever going to be sent.** `outreachStillQualifies_` re-reads the `App` row in the
> last moment before Gmail is touched, and it refused these rows every hour for three days. That
> guarantee did not move. What the gap cost was quieter: a `Queued` row counts in
> `STATUS_SPENDS_CONTACT`, so it holds a recruiter nobody else may be written to, and it takes one
> of the day's slots in the projection — a live application waits in the table behind a row that
> can never go out.

A queue row whose application has disappeared from the tab is deliberately left alone. It cannot
send either, for the same last-moment reason, and a row that is missing this minute is as easily a
half-finished edit as a deletion.

### Every email waits an hour in Drafts, and deleting it is how you call it off

Nothing is composed and sent in the same breath. A row picked at 09:00 becomes a **real Gmail
draft** — the real recruiter in the `To` field, the real subject, the resume attached — and the
firing at 10:00 is what sends it. So there is always an hour in which the finished message
exists and can be read.

The hour is also re-checked, not just waited out. Before a draft is sent, `App` is read again
and its `Process` re-tested — the rejection scan catches the ones that arrive by email, and this
catches every other way an application closes in that hour: a stage moved by hand, or a rejection
that landed in the Kenyon mailbox instead. The draft is thrown away unsent.

**Deleting the draft in Gmail is the cancel button.** The send finds nothing behind the stored
draft id and marks the row `Cancelled` with *"The draft was deleted before its hour, so it was
called off."* — not `Failed`, because nothing failed. That makes review something done when
there is a minute for it rather than a mode that has to be remembered: ignore the drafts and the
system runs, read them and there is always a window to stop one.

It costs nothing on the free tier. The same hourly firing, the same Gmail send quota — a draft
is not a send until it is sent — and at most two or three drafts standing at any moment.

One consequence: the day's **writing** stops one firing before its **sending** does. Drafts are
made 09:00–16:00 and go out 10:00–17:00, because a message written at 17:00 would have no hour
left to wait in. `DRAFT_HOUR_LAST` is `SEND_HOUR_LAST - DRAFT_LEAD_HOURS`, and the same eight
firings the projection divides the day's cap across.

| Question | Where it is answered |
|---|---|
| what is waiting to go out | `Status` = `Queued` |
| how many have been sent | count of `Status` = `Sent` |
| when it appears in Drafts | `Drafted At` |
| when it leaves them | `Scheduled At` |
| which day and hour each went | `Sent At` |
| has it been replied to | `Status` = `Replied` |
| how many people this company has | `Recruiters` |
| which of them this row is | `Attempt` |
| which of the ten hooks it will use | `Template` — filled at queue time, before it goes |

> **A Date Applied in the future is refused.** One row read `August 14, 2029`; the projection
> walked a year of weekday caps without reaching it, held no send date at all, and would have sat
> in the queue until 2029. It is a typing slip, and the skip reason now says so.

### The seven states

| | |
|---|---|
| `Queued` | waiting for its day |
| `Drafted` | a draft in the mailbox, waiting for you |
| `Sent` | gone |
| `Replied` | somebody answered on the thread |
| `Bounced` | the address failed |
| `Cancelled` | the application was rejected or advanced, or the contact left the list |
| `Failed` | Gmail refused it; `Last Error` says why |

Every one is a state the worker itself sets. An earlier list also carried `Approved`,
`Scheduled` and `Sending`, from a design with a separate approval step and a separate scheduler —
`Mode` and `Scheduled At` do both of those jobs now.

It also carried `Opted out`, for someone asking not to be written to again. That one had to be
set by hand, for an outcome `Replied` already produces on its own: a person asking not to be
contacted **has replied**, so the scan marks the row, the address is spent for good, and the
other attempts at that company are called off. A status nobody has to remember beats a status
that does the same thing when remembered.

> **Which states spend a contact.** A row in any state except `Cancelled` and `Failed` means that
> address is spent and is never picked again, across every application — so a bounce, or a reply
> asking not to be contacted, is permanent without needing machinery of its own. Those two are deliberately outside
> that list: nothing reached the person, so the address goes back in the pool. Burning a contact
> nobody was ever emailed is a bug, not caution.

#### `Cancelled` is the one state that sinks

The table is filed by the hour a row goes out, so `Sent` sits at the hour it really left and
`Failed` at the hour it was really attempted. Both are history and both read correctly in place.

`Cancelled` is different: its hour was a plan that was then called off, so filing by it puts a row
that can never go out in among the rows that will. Belvedere Trading held three of them, each
stamped for a lunchtime it was never going to see, sitting between live rows.

Cancelled rows are therefore filed **below every live row**, in time order among themselves. What
had been planned stays readable; it just stops interrupting the queue.

Nothing else has to move for the gap to close. `Drafted At` and `Scheduled At` are recomputed from
scratch every firing across the rows that are still `Queued`, so the moment a row is cancelled it
leaves the projection and everything behind it takes an earlier slot. The whole round happens
inside one firing: cancelled at step 3, reprojected at step 7, and the table refiled last of all.

> **The bottom of the table, not the bottom of the sheet.** The sort rearranges one block of
> values and writes it back over itself, and step 1 has already deleted any empty row inside that
> block. A row cannot be stranded at 1000 by this; that was a different bug, in a different place.

A summary block of formulas, not code — nothing to maintain and nothing to break:

```
Queued             =COUNTIF(J:J,"Queued")
Waiting in Drafts  =COUNTIF(J:J,"Drafted")
Sent today         =COUNTIFS(J:J,"Sent",O:O,">="&TODAY())
Sent this week     =COUNTIFS(J:J,"Sent",O:O,">="&TODAY()-WEEKDAY(TODAY(),3))
Sent in total      =COUNTIF(J:J,"Sent")
Replied            =COUNTIF(J:J,"Replied")
Reply rate         =IFERROR(COUNTIF(J:J,"Replied")/COUNTIF(J:J,"Sent"),0)
Bounced            =COUNTIF(J:J,"Bounced")
Called off by hand =COUNTIF(J:J,"Cancelled")
```

And three filter views, which are a built-in Sheets feature and do not disturb the data:
`Status = Queued` for what is still to go; `Status = Sent` for what has and is waiting;
`Recruiters = 0` for the companies worth adding a name to by hand.

### `Drafted At` and `Scheduled At` — when it is written, and when it goes

`Eligible At` says the earliest day a row *may* go. It does not say when it will: forty rows
eligible today still have a fortnight of weekday caps ahead of them, and the question worth
asking of a queue is which day each row actually lands on.

Both columns carry **an hour, not just a day** — `Aug 24, 9:00 AM` and `Aug 24, 10:00 AM`. A
column of fifteen rows all reading `Aug 24` looks like fifteen emails at once, which is the one
thing this is built not to do. The hours come from the same arithmetic the writer runs, so they
are the real times rather than an estimate of them.

Step 5 walks the caps forward — oldest application first, skipping weekends, respecting each
row's eligibility — and hands each row a writing hour and the sending hour one firing later.
Every queued row is rewritten on every firing, so the whole plan always describes one moment.

It is a projection, not a promise. Anything queued tomorrow moves it. A row that has already
been written stops being projected: from then on the two columns hold the minute the draft was
made and the hour it goes, and neither is guesswork any more.

## The contact list

A second spreadsheet, owned by the sending account, with two tabs:

| Tab | Written by | On the next export |
|---|---|---|
| `Contacts (seed)` | `src/export_contacts.py` in ColdEmail | **overwritten wholesale** |
| `Contacts (manual)` | you, by hand | **never touched** |

The split is the whole point. One tab would mean a single re-export silently destroying months
of contacts gathered by hand. Two tabs make that impossible rather than merely unlikely.

Columns are the same on both: `Company · Recruiter Name · Email · Role · Focus · Hook · Angle ·
Verify · Bucket`. **A hand-typed row needs only the first three.** Hook and angle stay empty and
are borrowed from that company's seed contacts when the email is built — so adding someone at a
company ColdEmail has already written for costs three cells and no prose.

Focus is borrowed from nobody, because it describes the person rather than the employer. An empty
one is read off the recruiter's own title instead: a `Role` that says campus, university, college,
school, student, intern, graduate, or early career/talent is taken as `university`, which is the
one value that matters — it moves the campus subject, the one that asks whether Kenyon sits on the
campus list this cycle, ahead of the industry hook. The test is on whole words, so `Internal
Recruiter` is not a campus recruiter. A `Focus` you typed in yourself always wins over the title.

So the fourth cell is worth filling after all: `Company · Recruiter Name · Email · Role` is enough
to get a campus recruiter the campus subject, with no second column to remember.

Adding someone at a company it has *never* written for leaves no angle to borrow. That email
still reads correctly, but it has lost the one sentence that made it specific, so it is queued
as `Draft` rather than sent unattended. Nothing is silently dropped and nothing weak goes out on
its own.

The export writes 2,098 contacts across 650 companies, leaving out the 171 addresses that were
never really verified. Every one of them carries a company angle; 1,714 also carry a personal
hook.

## The message

> Every subject line, every variation and every bullet is catalogued verbatim in
> [email-templates.md](email-templates.md). This section is why the message has the shape it has.

The template lives in `outreach_compose.gs`, not in a generated CSV. ColdEmail supplies only the
two things that genuinely vary per row — the company angle and the per-person hook — so changing
a sentence is an edit to one file rather than a pipeline run and a re-export of two thousand
rows.

```
Subject: 340K bad records were inflating severity by 8%

Hi Michelle,

Quick intro:
  • I am Henry Nguyen, a Math and Computer Science student at Kenyon College
    (class of 2028, 4.0 GPA).
  • Applied for the Software Engineer Intern role on Jul 20.
  • Removed 340K malformed records from a 2.1M-record dataset that were
    inflating severity rates by 8%.

Why I'm reaching out:
  • I saw that you recruit for engineering roles at Google.
  • I'm especially interested in Google because correctness under concurrency
    is what I work on.

The ask:
Would you be able to take a quick look at my application? Or point me to
whoever is closest to this req. Resume attached.

Thanks either way,
Henry Nguyen
```

Three labelled sections, and **every one of them is bullets or one short sentence**. An earlier
version folded the introduction and the reason into a single ninety-word paragraph, and it read
as a wall: nothing to scan by, and the application — the strongest fact in the message — buried
in the middle of it.

Two things carry bold, and only two: the numbers in the intro, and the request itself in the
ask. Bold on a third thing is bold on nothing.

**Six bullets and one sentence, none of them over twenty words.** The headings survived a rewrite
that the length did not: three labelled sections is what makes an email skimmable, but a section
holding four bullets is a paragraph wearing a label. The body ran to between 140 and 166 words
depending on which hook and angle a contact drew, so each heading was cut back to doing exactly
one job and it now lands at about 105. The ceilings and what each cut removed are in
[email-templates.md](email-templates.md#the-budget-each-section-is-held-to).

### The job is named in three words, not in the job board's

The application bullet says `Software Engineer Intern`, never the posting's own title. Titles are
written for a job board, not for a sentence, and the sheet holds real ones like `Campus
Undergraduate Summer Internship Program - 2027 Software Engineer, Enterprise Technology Services-
Charlotte, NC`. Dropped whole into "Applied for the ... role on Aug 20" it buries the fact the
line exists to carry, and it is the bullet the recipient is most likely to check.

`SHORT_ROLES` in `outreach_compose.gs` maps a title to the kind of job, most specific rule first,
reading the same tokens the wave grouping reads — so the city and state are already gone. Across
the 144 titles in the sheet:

| Name in the email | Titles |
|---|---|
| Software Engineer Intern | 91 |
| Software Developer Intern | 19 |
| Full Stack Engineer Intern | 11 |
| Technology | 7 |
| Web Developer Intern | 4 |
| Quantitative / Embedded / Firmware / Systems / DevOps | 12 |

Every name has to be **true of every title that can reach it**, which is why the list is ordered
and why software beats systems: `Software Engineering Intern - Systems Engineering - Vancouver BC`
is a software job on a systems team. `Technology` is only reached when nothing in the title said
software or engineering at all — the bank programmes that name a department rather than a job,
like `2027 Truist Analyst Program - Technology, Data, and Operations Track`. Calling those a
software internship would be inventing a req.

**A title no rule recognises is left exactly as it was written.** Three of the 144 reach this —
`Ad Infra`, `AI Builder Intern`, `R&D Intern (Fall 2026)` — and all three are already short, so
there is nothing to cut and nothing solid to cut them to. The rules exist to remove job board
padding, not to relabel a job they do not recognise. Only an empty cell falls back to
`Software Engineer Intern`, because "Applied for the  role" is not a sentence.

Since an unrecognised title reaches the reader as written, escaping is still what stands between
the role cell and the message.

**No dashes.** Not in a subject, not in a bullet, not in the ask. Text arriving from ColdEmail
does use them, and `outreachNoDashes_` turns each into a full stop on the way in, so a long
angle becomes two short sentences instead of one long breath.

Each slot is doing one job:

- **Subject** — a true number, stated so it is not yet explained. Its only job is the open, and
  an unopened email has no other qualities. All ten are under 60 characters, because a recruiter
  reads them on a phone.
- **First bullet** — the name and the school. A version that compressed this into
  "Math and Computer Science at Kenyon College…" saved eight words and cost the introduction:
  no name, no verb, and it read as the top of a CV rather than one person writing to another.
- **Second bullet** — the application and its date, on a line of its own, because it is the one
  fact in the message the reader can go and verify in their own system. Gmail shows the first
  ~90 characters as preview text, and these two bullets are what fills it. `Hope you're doing
  well` used to sit there and spent that slot saying nothing.
- **One result bullet** — numbers in bold, prose plain, and it is the bullet the subject is
  about, so the email answers its own subject on the third line. Every number is taken verbatim
  from `henryng_swe.tex`: a recruiter who checks must find the two documents saying one thing.
  There used to be a second, and it bought nothing the subject had not already promised.
- **Why I'm reaching out** — two bullets, never a paragraph. The hook and the angle arrive as
  whole sentences from two different files, and run together they make the block that gets
  skipped. One purpose and one sentence each: why this person, why this company. Neither reaches
  back into the resume, because the bullet above them already carries the number in bold.
- **The ask** — one bolded question and one short way out, so the easiest reply is a useful one.
  Under twenty-five words, and the way out is worded differently in each variation, because it is
  the clause a recruiter forwarding to a colleague actually quotes.

### Ten hooks, matched to what the company does

Identical skeleton, identical bolding. Only the subject, the result bullet and the ask move —
three people at one company must not receive three copies, and a run of identical bodies is a
spam signal in its own right.

| Hook | For |
|---|---|
| `340K bad records were inflating severity by 8%` | data |
| `50 duplicate webhooks, exactly one order` | fintech |
| `500 concurrent requests, zero overbookings` | cloud |
| `Repeat checks: 4 seconds to 400 milliseconds` | ai |
| `Four high-severity CVEs, one export path` | security |
| `A daily report was 3 days stale and nobody knew` | hardware |
| `480 dishes, top 5 matches in under 300ms` | consumer |
| `90 students a semester, zero local setup` | edtech |
| `The model was ignoring location — 0% to 24.7%` | a university recruiter, whatever the industry |
| `Cut a 30-minute research loop to 60 seconds` | fallback where the industry is unknown |

The industry comes from ColdEmail's `bucket`, so it is the same judgement that wrote the opening
line. A university recruiter is served before the industry match, because they are usually not
the person who reads "50 duplicate webhooks" and feels anything.

The hooks are **ordered, not picked**: attempt 2 takes the next one down, attempt 3 the one after.
Three people at one employer therefore never see the same subject line twice.

> **Why the hook is not held back for later attempts.** An earlier draft put the plain
> application subject on attempt 1 so the recruiter could find it in the ATS. That was the wrong
> trade — Gmail indexes the body too, and the role and date are the first line of it, so nothing
> was lost by hooking the subject. An email that is not opened has no other qualities.

The body is HTML — bold and bullets do not exist in plain text — and a plain-text alternative is
sent alongside it. Light HTML like this costs nothing in deliverability; what gets penalised is
the heavy kind with images and tracking pixels, which is why there are none.

`Henry_Nguyen_Resume.pdf` is attached from Drive, 110 KB. The filename is what the recruiter
sees, so it is the name and not `henryng_swe.pdf`.

Age changes one line:

| Application age | The sentence |
|---|---|
| 45 days or less | `I applied for the {Role} role on {date}.` |
| more than 45 days | `I applied for the {Role} role earlier and I'm still hoping to be considered.` |

Naming a date from months ago points the reader straight at the weakest fact in the email.
Dropping it keeps the sentence true without drawing the line under it.

> Applications began on 21 July 2026, so the oldest row crosses 45 days on **4 September 2026**.
> Until then the first variant covers every row and the second is dead code — worth writing
> anyway, because the date it starts mattering is close and fixed.

## Rollout

1. **Enqueue only.** The cycle fills the `Email` tab; nothing sends. Watch for a week that
   it picks the rows you would have picked. Risk is zero.
2. **`Mode` = `Draft`.** The worker creates Gmail drafts in the sending account's mailbox. You
   read them, fix them, send by hand. This is where a wrong-context template shows itself.
   A draft counts against the day's cap exactly as a send does. It has no `Sent At`
   to be counted by, so `Scheduled At` is left standing on a row once it leaves
   `Queued` — that slot is both the honest record of when it went and the only
   timestamp a draft has. Without it the cap never fills while `Mode` is `Draft`,
   and a fifteen-a-day account quietly produces thirty-odd drafts.
3. **`Mode` = `Send`.** The weekday caps above. `hoanng15.work@gmail.com` is an established
   account with real sending history, so there is no warm-up ramp to serve.

The kill switch is one thing and only one thing: `removeOutreachTriggers`. Layers of switches
produce a system that is off in a way nobody can find.

The follow-up gets its own first week the same way, through a second script property,
`FOLLOWUP_MODE = Draft`. It is the one exception to the paragraph above and it earns it: by the
time follow-ups shipped the cold path had been sending unattended for weeks, and stopping *that*
to watch a new feature's first week would have been the more expensive mistake. It can only ever
be more cautious than `OUTREACH_MODE`, never less — either switch alone holds a reply back, and
neither can push one out.

With it set, the whole planner still runs: days are booked, templates chosen, `Follow Up Status`
fills in, and the tab shows exactly what would have gone. Only the last step changes, from a
reply on the thread to a draft in the mailbox. Clear the property when the twenty sentences have
been read against real rows.

## Installing it

Everything below happens in **`hoanng15.work@gmail.com`**, not in the account that owns the
tracker.

1. Share the tracker spreadsheet with `hoanng15.work@gmail.com` as **Editor**.
2. Create a second spreadsheet in that account with tabs `Contacts (seed)` and
   `Contacts (manual)`, both headed `Company · Recruiter Name · Email · Role · Focus · Hook ·
   Angle · Verify · Bucket`.
3. In ColdEmail, `uv run python src/export_contacts.py`, then import `finals/contacts_seed.csv`
   over the seed tab.
4. Upload the resume to that account's Drive as `Henry_Nguyen_Resume.pdf`.
5. script.google.com → **New project**, signed in as the sending account. Push the
   `apps_script/outreach/` project with `clasp push` — see that folder's README; pasting is how a
   stale version reached production once already.
6. Run `setupOutreachProperties`; it logs the four properties it needs. Fill them in under
   Project Settings → Script Properties, and add a fifth, `OUTREACH_MODE = Draft`.
7. Run `runOutreachCycle` **once by hand** and read the `Email` tab before installing anything.
   With `OUTREACH_MODE = Draft` it can only produce drafts.
8. `installOutreachTriggers` when the tab looks right. Leave `OUTREACH_MODE` on `Draft` until
   you have read a few of the drafts it produces.

The manifest turns the **Gmail advanced service** on, which `clasp push` carries over, but the
first run afterwards will ask to be re-authorised: the grant has to match the code, and the code
now reaches Gmail through a second door. No new scope is requested. Run `previewOutreachFollowUps`
once at that point — it prints the twenty sentences and sends nothing, which is the cheapest way
to confirm the file arrived.

Nothing leaves the account until `OUTREACH_MODE` is cleared, whatever else is installed. The
`App` tab is not touched at any point, so nothing above needs undoing if you stop here.
