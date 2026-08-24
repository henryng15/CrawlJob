# Outreach — emailing a recruiter after you have applied

Once an application is in `App` and the tool has ticked `Recruiter`, there is a person at that
company worth writing to. This is the design for doing that on a schedule, from an account that
is **not** the one that owns the spreadsheet, and entirely inside free quotas.

The decision logic is built and tested: `apps_script/outreach/`, with 164 tests in its own
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
- `Process` (F) is exactly `Applied` — not `Rejected`, and not `OA` / `Interview` / `Offer`,
  where a human contact already exists and a cold email is the wrong message
- `Company`, `Role` and `Date Applied` are all filled — an empty one cannot be written into a
  sentence, and an empty date cannot be ordered
- the contact's `verify_tool` is not `local:Unknown`
- no queue row exists for this `Property` yet

`Eligible At` is `Date Applied` + 2 days. Sending the same day reads as automation; two days in,
the application has reached the ATS.

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

The three subjects and the two bullets under each differ, so what arrives is three different
emails, not three copies.

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
written to twice across different applications.

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

## Reading the tab

The `Email` tab is ordered so the three columns copied straight from `App` lead it —
`Company`, `Role`, `Date Applied` — because those are the only ones a human reads to know which
application a row is about. `Property`, `Recruiters` and `Attempt` follow; everything after
them is the sending machinery, and everything after `Sent At` is an audit reference nobody looks
at until something has gone wrong. `Status` is column J and `Sent At` is column O.

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
   in step 3
2. **who said no** — rejections sitting in the mailbox, which close the application in `App` and
   delete any draft already written for it
3. **what is new** — applications ticked `Applied` since the last firing
4. **what goes out** — the drafts written an hour ago, unless one was deleted in the meantime
5. **what is written** — this hour's share of the day's cap, into `Drafts`, to sit for an hour
6. **what happens next** — `Drafted At` and `Scheduled At`, recomputed across everything queued

Reversing any pair leaves the table a firing out of date: projecting before sending would put a
date on rows that are about to leave, and enqueueing before scanning would create an attempt 2
for someone who has already replied. **Step 4 before step 5** is the load-bearing one: drafting
first would let a message be written and sent inside a single firing, and the hour in which it
could have been read would never have existed. **Step 2 before step 3** is the other: a rejection
read now has to close the application before anything opens a fresh attempt underneath it.

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
Verify · Bucket`. **A hand-typed row needs only the first three.** Focus, hook and angle stay empty and
are borrowed from that company's seed contacts when the email is built — so adding someone at a
company ColdEmail has already written for costs three cells and no prose.

Adding someone at a company it has *never* written for leaves no angle to borrow. That email
still reads correctly, but it has lost the one sentence that made it specific, so it is queued
as `Draft` rather than sent unattended. Nothing is silently dropped and nothing weak goes out on
its own.

The export writes 2,098 contacts across 650 companies, leaving out the 171 addresses that were
never really verified. Every one of them carries a company angle; 1,714 also carry a personal
hook.

## The message

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
  • Applied for the Software Engineering Intern role on Jul 20.
  • Removed 340K malformed records from a 2.1M-record dataset that were
    inflating severity rates by 8%.
  • Fixed a crash model that ignored location, raising the share of groups
    reflecting it from 0% to 24.7%.

Why I'm reaching out:
  • Since you recruit on the engineering side at Google, I wanted to reach
    you directly.
  • What I find interesting about Google is that infrastructure earns its
    keep under concurrency, when correctness is easiest to lose.

The ask:
Would you be able to take a look at my application? A pointer to whoever is
closest to this req would help just as much. Resume attached.

Thanks either way,
Henry Nguyen
```

Three labelled sections, and **every one of them is bullets or two short sentences**. An earlier
version folded the introduction and the reason into a single ninety-word paragraph, and it read
as a wall: nothing to scan by, and the application — the strongest fact in the message — buried
in the middle of it.

Two things carry bold, and only two: the numbers in the intro, and the request itself in the
ask. Bold on a third thing is bold on nothing.

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
- **Two result bullets** — numbers in bold, prose plain. Every number is taken verbatim from
  `henryng_swe.tex`: a recruiter who checks must find the two documents saying one thing.
- **Why I'm reaching out** — two bullets, never a paragraph. The hook and the angle arrive as
  whole sentences from two different files, and run together they make the block that gets
  skipped.
- **The ask** — one bolded question and one short way out, so the easiest reply is a useful one.

### Ten hooks, matched to what the company does

Identical skeleton, identical bolding. Only the subject, the two bullets and the ask move —
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
5. script.google.com → **New project**, signed in as the sending account. Paste in the five
   `apps_script/outreach/*.gs` files.
6. Run `setupOutreachProperties`; it logs the four properties it needs. Fill them in under
   Project Settings → Script Properties, and add a fifth, `OUTREACH_MODE = Draft`.
7. Run `runOutreachCycle` **once by hand** and read the `Email` tab before installing anything.
   With `OUTREACH_MODE = Draft` it can only produce drafts.
8. `installOutreachTriggers` when the tab looks right. Leave `OUTREACH_MODE` on `Draft` until
   you have read a few of the drafts it produces.

Nothing leaves the account until `OUTREACH_MODE` is cleared, whatever else is installed. The
`App` tab is not touched at any point, so nothing above needs undoing if you stop here.
