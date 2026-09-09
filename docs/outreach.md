# Outreach — emailing a recruiter after you have applied

Once an application is in `App` and the tool has ticked `Recruiter`, there is a person at that
company worth writing to. This is the design for doing that on a schedule, from an account that
is **not** the one that owns the spreadsheet, and entirely inside free quotas.

There is a second path, and it runs the other way round: [asking an engineer at that company for a
referral](#the-referral--asking-an-engineer-instead-of-a-recruiter), from a posting that may not
have been applied to yet. Almost nothing is shared between the two but the company-matching rule
and the mailbox they leave from — different reader, different favour, different template, different
caps.

The decision logic is built and tested: `apps_script/outreach/`, with every rule in its own
harness, which runs on a laptop with no Google account and nothing that can send. What is not done
is installing it — that needs the sending account, and is the last section here.

For assistant-requested email work, the operating policy is [`manual-outreach-trigger.md`](manual-outreach-trigger.md):
the assistant must not plan, draft or send through the automatic path unless the user explicitly
triggers that action. The runtime design below documents what the automatic planner would do; the
manual policy also requires its hypothetical daily volume to be included in the final summary.

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
> [`sync.yml`](../.github/workflows/sync.yml) already spends about 1,530 minutes a month and
> `boards.yml` a little more, against the 3,000 it names. Spreading the day's emails needs many
> runs, and Actions bills wall-clock time — so the pauses between sends are billed for sitting
> still, leaving nothing for a retry.
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
**nothing in this system writes to `App` at all**. The `Recruiter` checkbox there keeps its existing meaning —
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

The scheduler projects sending into **09:00–17:00** and the minute tick creates each draft
**20 minutes before its send slot** (08:40–16:40). Each firing writes
`ceil(remaining ÷ firings left)`, which spreads the day evenly without any `sleep`, and
self-corrects if a firing is missed.

The draft lead used to be one hour. A 20-minute lead keeps a short review window while allowing
the first send to leave at 09:00 and the last at 17:00.

Gmail allows a consumer account 100 recipients a day through Apps Script. The busiest day here
asks for a quarter of that.

### Employers take turns there, too

`outreachOrderForSending_` is the cold path's single ordering point — both `outreachDueNow_`, which
picks what goes out this firing, and `outreachProjectSchedule_`, which writes the dates on the tab,
read it, so they cannot disagree about who is next.

It used to sort by ticked-first, then Date Applied, then row number. A wave of three shares one
application and therefore one Date Applied, so those three rows sorted adjacent and went out **back
to back** — three near-identical notes into one office inside a morning, while other employers
waited a day. The current path has no per-company rolling-week cap; wave size, wave gap and the
daily/mailbox caps are the applicable limits.

It now builds two lines exactly as the referral re-plan does — ticked first, served whole — and runs
`outreachInterleaveByCompany_` over each:

```
old   Intuit  Intuit  Intuit  NVIDIA  NVIDIA  NVIDIA  Nuro  Nuro  Nuro  …
new   Intuit  NVIDIA  Nuro  AmEx  Samsara  Figma  Scale AI  HP  Intuit  NVIDIA  …
```

Longest run at one employer: **3 → 1**.

Three things this does *not* change:

- **The wave is not broken up.** This orders; it does not schedule. The same three rows are still
  queued together and still spend the same three attempts — what changes is which hours they land
  on, and where a day fills, which day.
- **Sent rows never reach it.** Both callers hand over rows that are still `Queued`: the projection
  filters on status, the sender on what is due. Ordering only ever concerns what has yet to go.
- **A tick still grants nothing.** It does not make a row eligible early or raise the day's cap.
  It decides which rows get slots that already existed.

The key is `outreachCompanyTokens_`, not `outreachNameKey_`: the legal form has to come off, or
"Stripe" and "Stripe Inc." take two turns each and that office is written to twice as fast as the
interleaver thinks it is.

### One budget for the mailbox

Three features now send from one address: the cold email, the follow-up that chases it, and the
[referral ask](#the-referral--asking-an-engineer-instead-of-a-recruiter). Each was given a daily cap
in isolation and each is defensible on its own — 27 at the cold path's Tuesday peak, 6, and 6. None
of them could see the other two, so the only thing bounding a day's total was arithmetic nobody had
done.

`DAILY_EMAIL_BUDGET` is **47**, and it is a limit on the account rather than on any path: what gets
a sending address penalised is the volume leaving one mailbox in a day, and the mailbox neither
knows nor cares which of three features asked.

**It binds exactly.** 27 at the cold path's Tuesday peak, plus 6 follow-ups, plus 14 referrals,
is 47 on the nose. There is no slack left, so the next raise to any one cap is a raise to this
number whether or not whoever makes it has read this section — which is the first time the guard
rail has been load-bearing rather than decorative.

It was 45, and the guard rail did its job the first time it was tested. Opening the drafting window
at 08:00 gave the cold path a ninth writing hour, `DAILY_CAP` took two rows a weekday for it, and
there was no slack to take them out of — so a decision about one path had to be made as a decision
about the account.

`REFERRAL_DAILY_CAP` went from twelve to fourteen and this number did not move, which is the outcome
worth having: the extra asks came out of hours the day already had rather than out of the account's
allowance. It was briefly 50, for a referral cap of sixteen that reached to nine at night; the
window came back to 19:00 and so did this.

Two ceilings sit above this one and neither binds. Apps Script allows a consumer `gmail.com` account
[100 recipients a day](https://developers.google.com/apps-script/guides/services/quotas), so this is
under half of what the platform permits. The real ceiling is reputation: this is cold mail from a
free Gmail address with no domain and no dedicated IP, and what penalises such an account is bounce
rate and complaint rate rather than volume. Bounces are dealt with upstream — every address on the
employees tab passed an anymail `valid` check in `export_referrals.py` before it was exported, and
the recruiter tab drops `UNSENDABLE_VERIFY` on the way in.

`EMAIL_PATH_ORDER` is `referral`, `cold`, `followup`, and it decides who gives way when the budget
binds:

- **Referral first**, because it is the scarcest thing here. Six people per employer and no second
  attempt ever, so an ask displaced today is not delayed — it is one of six chances at that
  company spent on nothing.
- **Cold email next.** It has by far the most rows, but one it cannot send today still goes tomorrow
  with nothing lost, because the application it is about will still be there.
- **Follow-up last**, and it is the right last. It is the only one of the three that loses nothing by
  slipping: the message it chases has already landed, and the window it may land in is five to ten
  days wide. Being late is what it is designed to be.

The ordering only means something because room is **reserved**, not merely queued for. Before a path
is served, the budget holds back whatever every path above it has not yet spent of its own cap.
Without that, priority would be settled by whichever planner happened to run first — and the cold
path is the one that has been firing hourly for weeks, so it would take the whole budget every
morning and the ordering would be a comment rather than a rule.

> **Counted at sending, not at planning.** A planner writes a date into a cell; it is the send that
> costs the account something, and a budget enforced at planning time can be defeated by a row
> planned last week under a cap that has since changed. A row that loses its place at send time is
> not lost either: all three paths already treat a day they could not absorb as a day to catch up
> on, because all three had to survive a weekend of downtime.
>
> A **`Drafted`** row counts as spent, not only a `Sent` one. A draft is a message that exists,
> addressed and complete, and will leave within the hour unless somebody deletes it — not counting
> it would let the firing at the top of the hour book against a budget the firing before it had
> already committed. Spend is counted on the day a row is booked for, so a row that slipped from
> Tuesday and went on Wednesday is Wednesday's spend, which is what the account actually did.

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
Aug 10  silence for 5 days -> recruiters #4, #5, #6
```

One day apart rather than one morning, because three near-identical emails landing on one team
inside an hour is what reads as spray. Spread over three days it reads as a person working
through a list — which is what it is.

The three subjects, the proof point in the introduction and the ask all differ, so what arrives
is three different emails, not three copies.

### Three at a time, not three in total

Three is the right number to send *together*. It was the wrong number to stop at: a company with
five contacts held two nobody was ever going to write to.

After a wave, **five days of silence opens the next one** — the next three people, and so on
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

That is not enough on its own. Apply to the same company three times and the queue still treats
those as one intake when the role fingerprint matches, and as separate intake waves otherwise.
There is no additional rolling-7-day company cap: a queued wave is limited by its three-person
size, the **5-day gap** before the next wave, available contacts and the daily/mailbox caps.

### One posting, one wave

Before either cap is consulted, an application is skipped if a **sibling application for the same
posting at the same employer** already owns a wave.

This exists because the wave unit alone is the wrong instrument. American Express advertised one
programme in three cities and three applications went in; the matching posting rule keeps those
from becoming three separate waves. The same rule prevents one employer from consuming its
whole contact list on duplicate applications.

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

So the `Role` column in `App` is watched. Type the missing season, press Enter, and two tabs
catch up in the same second:

| | |
|---|---|
| `Email` | every queue row of that application gets the corrected title, and a row **not yet sent** also moves bucket |
| `Season` | rebuilt, so the employer appears — or stops appearing — as two-intake straight away |

> **`Alphabet_Order` is not on that list, and must not be.** It is one array formula in its `A1`
> that reads `App` live, so the corrected title is already there before the trigger runs. This code
> did once write the cell, back when the tab was a copy kept by hand. Writing it now would drop a
> literal into the formula's spill range, which Sheets answers by collapsing the whole tab to
> `#REF!` — a Role correction would blank the tab it was meant to keep in step.

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

2,098 sendable contacts across 650 companies, averaging 3.23. The contact list and daily/mailbox
caps are the practical limits — for most employers the list runs out first.
**At 178 companies there is exactly one person to write to**, so the attempt 1→2→3 cycle
cannot complete at better than a quarter of them, and that is a property of the data rather than
something to fix here.

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

The window is **08:00 to 19:00**, against the cold path's 09:00 to 17:00, and it is wider at both
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
read left to right: **written at 08:07, goes at 09:00.** While a row is `Queued` both are the
projection; once it is written both are what happened. That pair is the column to check when you
want to intervene, because the gap between them is the hour in which deleting the draft still
calls the send off.

**Almost nothing in this system writes to `App`.** An earlier version put the contact count in a
column there, and it was one more machine-written column on a tab that is already dense enough
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
steps depend on each other. **Eighteen steps**, each isolated — `step(name, work)` catches per
step, so a Gmail search that throws in step 2 does not take step 12 with it:

```
schema migration                       ← OUTSIDE the isolation; fatal by design
health stamp: started
 1 layout            the Email tab's table pulled back together
 2 scan              replies and bounces on the Email tab
 3 rejections        rejections in the mailbox close the application in App
 4 stale             applications closed by hand, whose queue rows nothing called off
 5 referralScan      replies on the Referral tab
 6 referralReplanned cancellations settled, hours handed back, the queue tightened
 7 referralPlanned   new asks appended
 8 referralSent      referral drafts whose hour has come
 9 referralDrafted   Referral asks written one hour before their slot
10 queued            applications ticked Applied since the last firing
11 sent              cold drafts whose send slot has arrived
12 written           this hour's share of the day's cap, into Drafts
13 followUpPlanned   follow-ups booked onto a day, and bookings taken back off
14 followUpSent      the follow-ups whose day has come
15 projected         Drafted At and Scheduled At, recomputed across everything queued
16 season            the Season tab, rebuilt from App
17 sorted            the Email tab filed in time order
18 referralSorted    the Referral tab filed the same way
19 appWorklist       App rows waiting on a link painted and lifted; the rest back in Property order
health stamp: finished
```

Five orderings are load-bearing:

- **Send before write** — 11 before 12, and 8 before 9. Drafting first would let a message be
  written and sent inside a single firing, and the hour in which it could have been read would
  never have existed.
- **Rejections before enqueue** — 3 before 10. A rejection read now has to close the application
  before anything opens a fresh attempt underneath it.
- **`referralScan` before `referralReplanned`** — 5 before 6. The replan closes the rest of a group
  somebody answered, and it can only close what the scan has marked; the other way round, a reply
  landing on Monday would not call anything off until Tuesday, by which point Monday's colleague
  has been written to.
- **`appWorklist` last** — 19 after everything. It is the only step that moves rows on `App`, and
  half the steps above hold `App` row numbers taken before it ran: `scanRejectionEmails` writes
  `Process` and `Update` back **by row number**, and `cancelStaleOutreachRows` and both referral
  planners read the tab the same way. Sorting `App` while any of them still held an index would
  file a rejection against a different application. Nothing reads `App` after this step, so nothing
  can.
- **Follow-ups after the cold path** — 13 and 14 after 11 and 12. A follow-up is the cheaper of the
  two messages and the cold email is the one with a deadline attached: an application ages while it
  waits and a nudge does not, so on the firing where something has to give, the nudge is what
  gives. It also means a row sent minutes ago is on the tab as `Sent` before the planner reads it.

Planning comes before sending on both the follow-up and referral paths, so a row booked for today
can leave on this very firing rather than waiting an hour for the next one to notice it.

The **health stamp is written before the schema migration**, which is the one step deliberately
outside the isolation and fatal by design. A run that dies part way leaves a row on `Cycle Health`
that says it started and never says it finished — the only record such a death leaves behind, and
the reason the tab exists.

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

The `Drafted` half is the reason this is worth building. A draft written at 08:00 is addressed,
complete and an hour from leaving; a rejection arriving at 08:30 would otherwise be followed at
09:00 by a cold email to the company that just said no. The draft is deleted from Gmail, not
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

Nothing is composed and sent in the same breath. A row picked at 08:00 becomes a **real Gmail
draft** — the real recruiter in the `To` field, the real subject, the resume attached — and the
firing at 09:00 is what sends it. So there is always an hour in which the finished message
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

One consequence: the writing window is the sending window shifted **20 minutes earlier** at both
ends. Drafts are made 08:40–16:40 and go out 09:00–17:00. `COLD_DRAFT_LEAD_MINUTES` controls this
cold-email lead; Referral keeps its separate one-hour review window.

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
eligible today still have several days of weekday caps ahead of them, and the question worth
asking of a queue is which day each row actually lands on.

Both columns carry **an hour, not just a day** — `Aug 24, 8:00 AM` and `Aug 24, 9:00 AM`. A
column of fifteen rows all reading `Aug 24` looks like fifteen emails at once, which is the one
thing this is built not to do. The hours come from the same arithmetic the writer runs, so they
are the real times rather than an estimate of them.

Step 5 walks the caps forward — oldest application first, skipping weekends, respecting each
row's eligibility — and hands each row a writing hour and the sending hour one firing later.
Every queued row is rewritten on every firing, so the whole plan always describes one moment.

It is a projection, not a promise. Anything queued tomorrow moves it. A row that has already
been written stops being projected: from then on the two columns hold the minute the draft was
made and the hour it goes, and neither is guesswork any more.

## The referral — asking an engineer instead of a recruiter

Everything above is one path: an application exists, a recruiter is paid to read applications, and
the email asks them to go and read this one. The second path asks a different person for a
different thing. An engineer at that company is not paid to read applications and is being asked to
spend their own credibility, which is why almost nothing from the cold path carries over — not the
trigger, not the ordering, not the caps, and not a single sentence of the template.

Three files, split the way the cold path is split — everything that *decides* apart from
everything that can touch a mailbox:

| | |
|---|---|
| [`outreach_referral.gs`](../apps_script/outreach/outreach_referral.gs) | the forty messages, the tier resolver, the composer |
| [`outreach_referral_queue.gs`](../apps_script/outreach/outreach_referral_queue.gs) | which link counts, which posting per company, who is asked and in which hour |
| [`outreach_referral_send.gs`](../apps_script/outreach/outreach_referral_send.gs) | the three entry points that write rows, draft them and send them |

The first two are pure and covered by the same harness as everything else, which still sends
nothing when it runs.

> **What is wired.** All of it. `referralScan`, `referralReplanned`, `referralPlanned`,
> `referralSent` and `referralDrafted` are steps 5–9 of
> [One firing does the whole round](#one-firing-does-the-whole-round). Nothing on this path needs
> starting by hand.

### It starts from an application, not from a posting

Both queues read `App`, and the referral path did not always. It used to read `Jobs`, one step
earlier, on the reasoning that a referral submitted *before* the application is the version of the
favour that helps — the referrer's name goes on the file as it is created rather than being
attached to a record already in the ATS.

That reasoning is sound and the tab was wrong for it. `Jobs` holds every posting the crawler
found: hundreds of rows nobody had chosen, of which a handful were at companies this project has
engineers for. **Having applied is a far stronger statement about which intake matters than a
word in a job board's title** — of 327 rows on the live `App` tab only 81 said "summer", so
filtering `Jobs` on the season word threw away three quarters of the real applications.

The cost is admitted rather than hidden: the ask now arrives after the application, so the
referrer's name is attached to a record already filed. `REFERRAL_REQUIRE_SEASON` is `false` for
the same reason — every row on `App` is a deliberate act, and second-guessing it by title is how
the earlier version lost most of its material.

Three things have to be true, each its own function so a row nobody expected can be argued with one
rule at a time:

| | |
|---|---|
| the employer is one ColdEmail found engineers at | `outreachEmployeesFor_` |
| the role names the intake | `outreachReferralSeason_` |
| the link is one a referral can be submitted against | `outreachReferralLinkOk_` |

`REFERRAL_SEASON_WORD` is `summer`, matched as a **whole word** and case-insensitively, on the role
and never on the company. Whole word because `Summertime Analytics Intern` is not a summer
internship and a surname is not a season; on the role alone because an employer with the word in
its name would otherwise put every posting it has into the queue. Case-insensitive because the
sources write it every way there is — `Summer 2027`, `SUMMER Intern`, `summer analyst`.

### Only a link a referral can actually be submitted against

A referral is a form with a job id in it. A crawled link is not usable merely because it resolves:
half the trackers this project reads republish a posting under an id of their own, and a redirect
is not a requisition. So `outreachReferralLinkOk_` is an **allowlist** — the ~29 domains in
`REFERRAL_ATS_DOMAINS`, plus the employer's own domain out of the ColdEmail dataset — and
everything else is refused.

Deny by default, rather than a list of aggregators to reject. The rejects are unbounded and grow
every time somebody launches another job board; the systems that actually receive applications are
a list of about thirty and change roughly never. Under a rejection list, a new aggregator nobody
had heard of passes silently and a referral ask goes out pointing at a redirect — the recipient
opens it, finds no req, and the ask is spent. Under this one, the same unknown host turns a row
yellow and asks a person to look at it. Being wrong in the second direction costs a minute.

#### The third way in: the company's own name

Two rows on the live tab were refused for the wrong reason —
`blackrock.tal.net` and `amazon.jobs`. Both are the employer's own application system. TalentLink
is on no allowlist worth keeping, and Amazon takes applications on a domain that is not the one its
staff read mail at, so neither the ATS list nor the ColdEmail domain could see it. What does see it
is the thing a person uses at a glance: the company's name, sitting at the front of the host.

Added 2026-08-31 as `outreachReferralNameMatchesHost_`, and it is tried **last**, after everything
decidable from a list:

- **The first label and no other.** `blackrock` in `blackrock.tal.net` is a name TalentLink assigned
  to a customer. The same word further right is a domain somebody else registered, so
  `jobs.amazon.evil.com` is refused.
- **Matched whole, never as a substring** — the lesson `outreachSameEmployer_` already carries.
  `dicerna` is not Dice, `notamazon` is not Amazon. The label is split on hyphens first, so
  `campus-amd` is AMD, and compared undivided as well, so `general-motors` is General Motors.
- **A multi-word company is recognised only by its whole name.** Matching one token would hand
  every host beginning `general` to General Motors. A single-word name survives the legal form
  around it, so `acme.somewhere.net` is Acme Technologies, Inc.
- **Word order is kept.** `outreachCompanyTokens_` sorts, so a key joined from it would be a word
  the company has never been called — Old Mission Capital would become `capitalmissionold`.

`REFERRAL_AGGREGATOR_DOMAINS` **used to gate nothing**, and the reasoning held while it did: a
second list that could also refuse would have been a second place to be wrong, so its only job was
to say which kind of wrong a link is.

The name rule changed that. It is the only rule that can accept a host on no list at all, so it
refuses anything on that list outright — without it, the day a job board starts handing out
`stripe.thatboard.com` is the day referral asks point at redirects again. **Adding a host to
`REFERRAL_AGGREGATOR_DOMAINS` now changes a decision, not just a message.**

Three details the tests pin down:

- **Matched as a suffix on a dot boundary.** Every one of these systems hands an employer its own
  subdomain — `boards.greenhouse.io` and `job-boards.greenhouse.io` are both Greenhouse, and
  Workday gives out numbered ones by the thousand. Without the dot this becomes a substring search
  and `mygreenhouse.io` passes as Greenhouse.
- **The employer's own board is the best link there is**, and no list will ever hold them all, so
  `jobs.apple.com` is recognised by the `Domain` column of the employee dataset rather than by a
  name. Somebody else's domain is still somebody else's: an Apple link does not pass for Google.
- **`http` is refused.** Everything here is a form that will be typed into.

### Yellow on the App tab, and the link pasted into `Official`

A refused row is not dropped. `outreachReferralNeedsLink_` returns it with a reason, and
`syncAppOfficialWorklist` — the last step of every cycle — paints the row yellow on the **`App`**
tab and lifts it to the top. Yellow means exactly one thing: *this is an
application worth asking somebody about and there is no way in yet.* A row nobody would ask about
is never painted — not a rejected application, not a company with nobody in the dataset — because a
colour that appears on rows requiring no action is a colour people stop seeing.

Column **I**, `Official`, is where the link is pasted, and it sits between `Note` and `Alumni`
rather than at the end because it is read next to the application it belongs to. When both it and
`Application Link` hold something usable the pasted one wins: somebody typed it deliberately, and
the only reason to type one over a link that already works is knowing something the row does not
say.

Clearing the colour is half the job, not a tidy-up, and it happens on the same keystroke. The
`onEdit` trigger that already answers a tick in `Applied` repaints the rows an edit touched, so a
link pasted into `Official` stops the row shouting while you are still looking at it. It
deliberately does **not** re-sort: moving the row somebody is currently pasting into pulls it out
from under the cursor, and the row that slides into its place is a different application, so the
next paste lands on the wrong one. The hourly `syncAppOfficialWorklist` does the whole tab in one
read and one write, lifts the waiting rows to the top so the worklist does not decay as
applications are added beneath it, and puts every other row back into `Property` order — so a row
lifted for a missing link goes home to its own number the moment the link arrives.

The `onEdit` repaint is **optimistic** and the sweep is the authority. The bound script cannot
answer the full rule — it cannot open `Employees (seed)` — so it clears the colour on anything
starting with `http`. Paste a Jobright link and the row goes white under your cursor, then yellow
again within the hour. That is the right way round: being briefly too optimistic costs a colour for
a few minutes, being pessimistic would mean the tab arguing with you while you type.

Until 2026-08-30 the bound script owned this sweep and ran it on the looser rule alone, which meant
a row carrying an aggregator link was never painted at all — see
[components/outreach-app-worklist.md](components/outreach-app-worklist.md).

> **This tab reads applications, not postings, and that is the whole design.** The referral path
> read the crawler's `Jobs` tab first, on the reasoning that a referral attached before an
> application helps more than one attached after. The reasoning is sound and the tab was still
> wrong: `Jobs` held six hundred postings nobody had chosen, of which **two** were at a company
> this project has engineers for. Against the `App` tab the same rules clear **thirty-nine**
> employers. An application is a decision, and a favour is worth asking for where a decision has
> already been made.
>
> **A rejected application is never asked about.** Asking somebody to spend their credibility on a
> req that has already turned you down is the one version of this email that cannot lead anywhere,
> and the one most likely to be mentioned to the recruiter who sent the rejection.
>
> **The season word is switched off here.** On `Jobs`, `summer` was what picked the intake worth
> asking about out of hundreds nobody had chosen. Of 327 rows on the live `App` tab only 81 say it,
> and having applied is a far stronger statement about which intake matters than how a title
> happened to be written. `REFERRAL_REQUIRE_SEASON` is `false`; the rule is kept working rather
> than deleted, because switching it back on is one line.

### One posting per company, six people, a company finished in a day

A company with four summer reqs is not four referrals. `outreachPickReferralRole_` chooses **one
representative posting per employer** and everybody there is asked about that one — six people
asked about six different requisitions reads, if any two of them compare notes, as somebody
applying to everything rather than to something.

The choice is ordered and every tie is broken, so the answer does not move between runs: a role the
shortener recognises as a software engineering internship first, because that is the job actually
wanted and the rest are near misses that happen to say summer; then the most recently posted,
because an older req is closer to being filled; then the role text, which settles whatever is left.
A posting with no usable link is never the one chosen, so one aggregator row cannot hide a company's
good link behind it.

**The intake rule refuses a wrong one rather than requiring a right one.** A title naming a
different intake is out — `Fall / Winter 2026`, `Winter/Spring 2027`, `2026 Intern Conversion` —
because asking somebody to spend their credibility on an intake that has closed, or on one you are
not asking about, is the same wasted message as asking about a req that already rejected you. But a
title naming *no* intake is in. `Software Engineering Intern` at NVIDIA, `Software Engineer Intern`
at Figma and `AI Builder Intern` at Scale AI are all the summer intake and none of them says so;
requiring the word threw eighteen employers away for a reason about how a job board worded a heading
rather than about which intake it was. Having applied is the stronger statement. `REFERRAL_SEASON_EXCLUDES`
is the rule that binds; `REFERRAL_REQUIRE_SEASON` is off and is one line from being back on.

**Between two applications at one company, the most recent wins.** This was the other way round and
it was wrong: it ranked by how squarely the title read as a software engineering internship and only
then by date, so Intuit kept being asked about `Intern, Software Engineering` from the 18th instead
of `Summer 2027: Software Engineering Intern - Full Stack` from the 28th, purely because the
shortener recognised the first heading and not the second. The newer application is the one still
moving and the one whose posting is likeliest still open. The title is now only the tie break, for
two applications made on the same day.

**Weekdays only, 06:00 to 19:00.** The follow-up sends at weekends because it is a nudge on a
thread the recipient already has, and a nudge on a Sunday costs nobody anything. A referral ask is a
first message to a stranger asking them to spend their own credibility, and one that turns up on a
Saturday morning says the sender either did not notice or did not mind — it is the same message on
Monday and it reads better. The window is wider than the cold path's nine to five at the early end
only, because that one is shaped around when a recruiter is at their desk reading applications and
this one is not: it lands in a working engineer's mailbox, and 06:00 is the top of that mailbox when
they open it at eight. It is *not* wider at the late end — see
[the hours](#fourteen-a-day-weekdays-only-one-to-an-hour) for why the evening was the wrong place to
buy the extra room.

`REFERRAL_PER_COMPANY` is **6**. Still far short of the twenty-three engineers this dataset holds at
Reddit or the twenty-two at Goldman Sachs; asking all of them is not outreach, it is a mailing list
that happens to be about one person. Six is the number that makes an employer a real attempt rather
than a gesture — at three, two ignored messages were the whole of it.

`REFERRAL_COMPANY_DAILY_CAP` is **1**. This was one, then six, and is one again, and the argument
for six is worth stating because it was never wrong: what makes six notes read as a mailing shot is
six *identical* notes, and the tier, the template, the subject line and the bullet pair all differ
per person. The calendar was buying distance between messages nobody can see side by side.

That argument is still correct and it is still not the reason this is one. The reason is what a day
of sending is **for**. There are 221 employers in the dataset and six people at most of them —
1,326 messages, which at fourteen a day is ninety-five working days whichever order they go in. The
order is therefore the only decision available, and it decides which asks happen while the
application is still recent:

| | Employers reached per day | A first ask at every employer |
|---|---|---|
| Six a day, company at a time | 2 | ~110 working days |
| **One a day, round at a time** | **14** | **~16 working days** |

The first ask at an employer is the one that has to land near the date applied; the sixth is a
message about an application the reader will have to look up either way. 221 employers heard from
once beats 37 worked to exhaustion, because the five extra notes at a company that was never going
to answer are the cheapest thing on the tab to give up.

It is also what makes a reply worth anything. Six on one day are all committed before anybody could
have answered, so a reply cancels nothing; one a day leaves the second ask unwritten while the first
is being read — which is what [the reply gate](#a-reply-calls-off-the-rest-of-the-ask) needs in
order to have something to stop.

> **The cap could not do this on its own.** The planner used to take one employer and book all six
> of its people before looking at the next. Capping the day at one per company spread those six
> across six days — but it did nothing about the order of the *companies*, so the first fourteen
> employers filled the first six days between them and the two-hundredth waited a quarter of a year.
> The loop is now inverted: the outer loop is the attempt number and the inner one is the companies,
> so every employer gets its first ask before any employer gets its second. `openFirst` still orders
> the companies inside each round, so it now decides who goes first within a round where it used to
> decide who was finished first.

Ticking `Priority` raises this cap to `REFERRAL_PRIORITY_COMPANY_CAP`, which is
`REFERRAL_PER_COMPANY` — **the whole group in one day if the day holds it.** The natural ceiling on
a ticked employer is simply everyone this project will ever ask there; a tick cannot conjure a
seventh person.

This was briefly **3**, on the reasoning that two ticked employers taking twelve of a day's fourteen
slots was the clustering the breadth-first planner exists to prevent. That read the tab correctly
and the request backwards. The clustering worth preventing is the *unasked-for* kind, where an
employer nobody singled out quietly absorbs a day. A tick is somebody singling one out on purpose,
and spreading it over two days made a tick mean "slightly sooner" rather than "now".

Two rules make the tick mean what it says:

- **Every ticked row goes before every unticked one**, not merely before the rows due at the same
  minute. `outreachReferralReplan_` builds two lines and serves the ticked one whole.
- **Ticked employers take turns inside that line.** `outreachInterleaveByCompany_` reorders each
  line so the companies alternate — A, B, A, B rather than A, A, A, B, B, B. Ordinary rows get this
  free from the per-employer daily cap, which forces turn-taking whatever order they arrive in; a
  ticked company raises that cap, so without the interleaver its six rows took the first six hours
  in a row. The group arrived at the front, which was right, and arrived as a block, which was not.

The interleaver is [shared with the cold path](#employers-take-turns-there-too), which had the same
bug from the other direction.

The account's own daily cap is never lifted either way, because the mailbox does not care whose idea
the day was. Ticking everything therefore does not raise the volume — it only decides who goes
first. Breadth is
the default because it is right most of the time; depth is a decision somebody makes about one
employer on one day.

`REFERRAL_DAILY_CAP` is **14**, so a day reaches fourteen different employers. Fourteen is also
exactly what the mailbox has room for: 27 at the cold path's Tuesday peak, plus 6 follow-ups, plus
14, is 47 against a budget of 47.

### A reply calls off the rest of the ask

The cold path has had `scanOutreachReplies` since the beginning and this path had **nothing**. A
reply here was invisible: the engineer who answered was marked `Sent` like everybody else, and their
five colleagues were written to on the following days as though nobody had said a word. That is the
one failure this path cannot afford — it is asking for a favour, and asking four more people for it
after somebody has already offered is how the favour gets withdrawn.

`scanReferralReplies` runs first in the referral half of the cycle, before the re-plan, and the
order is the whole value of it: the re-plan is what closes the rest of a group, and it can only
close what the scan has already marked. Run the other way round, a reply landing on Monday would
not call anything off until Tuesday — by which point Monday's colleague has been written to.

No new column was needed. `sendReferralAsks` already writes the sent message's id into `Result`, so
the thread is found again exactly the way the cold path finds its own; the id is then replaced by
the sentence about the reply, which is safe because a row is only read here while it is still `Sent`.

Three rules decide what a reply settles:

- **The unit is the company *and role*,** the same key `Priority` and `Cancel` expand a tick over.
  One engineer answering about the summer intake says nothing about a different req at that
  employer, and everything about the five colleagues queued behind that one.
- **Only `Replied` counts.** `Bounced` is the address failing, not the person declining, and the
  colleague behind them is still worth asking. Which makes telling the two apart load-bearing —
  see below.
- **Both ends are gated.** `outreachReferralReconcile_` closes the rows that already exist and the
  planner refuses to create the next one. With only the first, a reply would call off Monday's
  remaining rows and the planner would book them straight back on Tuesday.

`Replied` and `Bounced` also join `Sent` and `Cancelled` as states reconcile leaves alone. All four
are history: the message went, and something came back or nothing did. Retiring a `Replied` row
would have the gate close the very row that proves the reply.

#### Stopped is not Skipped

Two words in `Follow Up Status` that look alike and mean opposite things:

| | |
|---|---|
| **`Stopped`** | A follow-up that **was booked** and has been called off — somebody at that company replied, or the row itself left `Sent`. Its `Follow Up At` is cleared with it, because a date left on a row that will never use it reads as a plan. |
| **`Skipped`** | A follow-up that was **never booked**. The row reached the question and the answer was no, with the reason written beside it: sent over 21 days ago, no day in the window could carry it, somebody at the company had already replied. |

Both are permanent. `outreachFollowUpEarns_` opens with
`if (row.followUpStatus) return { ok: false, why: 'already decided' }`, so a row carrying either word
is never reconsidered — which is what makes one follow-up per row a rule rather than a tendency, and
also what made the bug below expensive.

#### Counting messages is not reading them

The first version of `scanReferralReplies` decided by `thread.getMessageCount() > 1`, copied from
the cold path. That is true of a delivery failure as well as of a person, and it went wrong the
first time it ran: a dead address at Nuro came back as a mailer-daemon message on the same thread,
the row was marked `Replied`, and because a reply retires the whole group **the five colleagues
behind it were cancelled** — the exact opposite of what a bounce is supposed to mean, and a direct
contradiction of the rule two paragraphs up.

**The same check was wrong on the cold path too, and worse.** The follow-up is posted onto the very
thread the scan is reading, so five days after any cold email the count reached two on its own and
the row came back `Replied` — the queue reading *its own second message* as the recruiter's first.
The Google thread that exposed it held exactly two messages, both `From: Henry Nguyen`. One wrong
cell then did two things: `Replied` is terminal, so that row's wave arithmetic thought the company
had answered; and `outreachCompanyHasReply_` marked every colleague's booked follow-up `Stopped`,
which as above is permanent.

`outreachThreadVerdict_` decides by **who sent the messages**, not how many there are. Anything from
`mailer-daemon` or `postmaster` is a bounce; anything else that is not ours is a reply. Four details
carry their weight:

- **Ours is decided by address, not by id.** The id finds our first message; every later message
  from that same address is also ours. Skipping only the id is exactly what let the follow-up count
  as an answer — and it is why this takes a thread rather than a number.
- **Our own message is found by id, not by position.** It is usually first, but a thread the
  recipient had already started puts it second, and counting from index one would read our own
  email as their answer.
- **A reply outranks a bounce** when a thread somehow holds both. One address failing does not
  unsay what a person wrote.
- **The verdict is a pure function over `{id, from}`,** not over Gmail messages, so the harness can
  argue with it without a mailbox.

It is used at all three scan points — `scanOutreachReplies`, `sendFollowUpReplies` and
`scanReferralReplies` — and lives in `outreach_config.gs` beside the interleaver rather than in any
one path's file. `repairMisreadReplies` undoes the cold-path damage: rows whose thread holds nothing
but our own messages go `Replied` → `Sent`, and the follow-ups their company stopped are handed back
as blank so `planFollowUpReplies` books them normally. It leaves alone any row whose thread holds a
real reply or a real bounce, and any `Stopped` whose company still has a genuine answer.

`repairMisreadReferralBounces` fixes rows already written wrong. It cannot find the thread by id —
marking a row `Replied` overwrote `Result`, which is where the sent message id lives — so it reads
what `mailer-daemon` has sent in the last thirty days and takes the addresses out of the bodies, the
way the cold path finds its own bounces. Rows it corrects go `Replied` → `Bounced`; the group-mates
it cancelled go back to `Queued` with their hours cleared, but **only** where nothing in that group
is a genuine reply, and **only** where `Last Error` still carries the sentence this wrote. A row
somebody called off by hand is theirs to un-cancel. Nothing is sent, and running it twice finds
nothing the second time.

### The tab in time order

The `Referral` tab used to sit in the order the planner appended, which grouped an employer's six
people together because that is how they were booked. It read as a record of decisions and not as a
queue: the next thing due could be anywhere. Once the planner became breadth-first those clusters
stopped even being contiguous, which is the worst of both.

#### Ticking Cancel used to do nothing

The symptom was "I tick `Cancel` on one row and the tab just re-clusters". The cause was not the
sort and not the planner: **`onEdit` was never listening to this tab at all.**
`outreachEditTouchesPriority_` filters for `TAB_QUEUE`, `outreachEditTouchesRole_` for `TAB_APP`,
and the `Referral` tab was given neither. A tick therefore did nothing until the hourly cycle came
round — and running `replanReferralAsks` by hand in the meantime changed the *hours* without
changing the *order*, so the table still showed the clusters the old depth-first planner had
appended, with the cancelled rows still sitting between live ones.

`outreachEditTouchesReferral_` closes it, for `Cancel` **and** `Priority` — the latter matters now
that a tick is the [depth switch](#a-reply-calls-off-the-rest-of-the-ask) rather than a reordering.
`settleReferralTab_` is what the trigger runs, and it is three steps whose order is the point:
cancelling frees hours, re-timing spends them on the rows behind, refiling puts the table in the
order those new hours imply with the called-off rows at the bottom. **Any two of the three leaves
the tab describing something that is no longer true**, which is exactly what was being seen.

It is sheet-only, so it is quick enough to hang off a keystroke. The Gmail half — discarding the
drafts a cancellation orphans — stays in `replanReferralAsks`. That split is safe in this direction
only: the row goes `Cancelled` at the keystroke and its draft is binned within the hour, and a draft
outliving its row sends nothing because `sendReferralAsks` only sends rows the tab still calls
`Drafted`. The two paths share `outreachApplyReferralCancels_` and `outreachApplyReferralTimes_`
rather than spelling the rules twice, because they used to disagree and a person reads the tab in
between.

#### Who owns the sort

The rule is written on `outreachSortReferralByTime_` so it stays true rather than happening to be
true: **whatever changes a sort key calls the sort before it returns.** The keys are `Scheduled At`
and whether the row is `Cancelled`; nothing else moves a row. That gives three groups:

| | |
|---|---|
| **Owns the sort** | `planReferralAsks`, `replanReferralAsks`, `settleReferralTab_`, `repairMisreadReferralBounces`, `sortReferralTab` — each runnable alone, each leaves a readable tab |
| **Cannot move a row** | `draftReferralAsks`, `scanReferralReplies` — `Drafted`, `Replied` and `Bounced` are not `Cancelled`, and none of them touches `Scheduled At` |
| **Covered by the cycle** | `sendReferralAsks`, harmless except on the branch where a deleted draft makes a row `Cancelled`; it only ever runs inside `runOutreachCycle`, whose last step refiles |

The cycle's `referralSorted` step is the backstop for that third group, and it is why the group is
allowed to exist at all. A fourth caller that writes a status or an hour outside the cycle belongs
in the first group, not the third.

`outreachSortReferralByTime_` runs last in the cycle, after every step that could change an hour,
and files the tab the way the `Email` tab is already filed — earliest first, `Cancelled` sunk to the
bottom. Sent rows keep their place in the timeline rather than sinking, because the past above the
future is what makes the tab answer *what has gone, and what is next*.

`Cancelled` sinks because its time is not a fact about anything: the row is not going out at that
hour or any other, and left in line it puts a dead row between two live ones. This mirrors
`outreachTimeOrder_` on the cold path deliberately — two tabs side by side have to be read the same
way. Sorting the values rather than calling `Range.sort` is what makes it testable, and it is safe
because every data row carries identical dressing: the colours are keyed off the values themselves
and the dropdowns and formats are applied by column to every row alike.

### Calling a row off, and the line moving up

Tick `Cancel` on the `Referral` tab and the row goes `Cancelled` and loses both its timestamps on
the keystroke. Everything else waits for the hourly cycle, because everything else is heavy and
because the two halves of it live in different Apps Script projects.

`replanReferralAsks` runs first in the cycle, ahead of the planner, and does three things in an
order where each is the reason the next has anything to do:

1. **It settles the state.** A tick that arrived by paste, fill-down or undo never fired the
   `onEdit` trigger at all, so the box itself is what counts, not whether the trigger saw it.
2. **It discards the orphaned draft.** A cancelled row leaves a written, addressed message sitting
   in Gmail. The bound script cannot reach it — that script runs as the tracker's account and the
   drafts belong to the sender's — so this is the only place it can happen. A draft already gone is
   the outcome this wanted; any other failure is written to `Last Error`, because a draft that
   cannot be deleted is a message somebody can still send by hand from a mailbox the tab says is
   finished with it.
3. **It hands the hour back.** Cancelling six rows on one day should move the line up, not leave
   six unused hours with everything behind them still waiting a week.

Only `Queued` rows are re-timed, and that restriction is the whole safety of it. A `Drafted` row has
a message written and sitting in Gmail against a particular hour; moving that hour earlier would
send it before the hour it was supposed to be readable in, which is the one guarantee the drafting
step exists to give. `Sent` rows are history. Both still occupy their day, so the caps keep counting
them. The order rows were already going out in is preserved, so a re-plan tightens the queue without
reshuffling who is next, and a queue that is already tight reports no movement rather than rewriting
every row to the value it already held.

The planner runs after it, so the freed days are days it can top up into.

> **This is where the three paths meet.** Re-timing and planning both ask
> `outreachBudgetRoom_` what each day has left across the cold path, the follow-ups and this queue
> together, and refuse a day the mailbox cannot afford rather than booking into it and discovering
> the problem at sending time. `REFERRAL_DAILY_CAP` is what this queue may take; the budget is what
> the account may send.

> **A person is asked once, ever.** By address, and by address only. There is no second attempt in
> this design, because what is being asked for is a favour, and asking twice for a favour that was
> not granted is not persistence.
>
> **`Cancelled` rows still count as asked**, and so do `Failed` ones. The row was made, the person
> was chosen, and somebody decided against it; handing them back to the queue would undo that
> decision every hour. A failure is almost never about the person either — retrying by picking
> somebody else spends an employer's remaining names on one broken run. This is the plain opposite
> of [which states spend a contact](#the-seven-states) on the cold path, and it is opposite because
> the scarce thing is different: there a contact is spent only if the message reached them, here
> the count is of decisions already made about a company with three names in it.

### Fourteen a day, weekdays only, one to an hour

`REFERRAL_DAILY_CAP` is **14**, counted across every employer rather than within one. It is this
path's own cap; what the *account* may send in a day across all three paths is a second, smaller
question, and it has [its own section](#one-budget-for-the-mailbox).

Fourteen is the window rather than a preference. The hours run 06:00 to 19:00, which is fourteen
hours, and `outreachSpaceHours_(14, 6, 19)` puts exactly one ask in each of them:

```
06:00  07:00  08:00  09:00  10:00  11:00  12:00
13:00  14:00  15:00  16:00  17:00  18:00  19:00
```

Fifteen is the first number that has to double up, and two notes leaving one mailbox inside one hour
is the shape a reader recognises as a machine even when they went to different companies. So the cap
is not *how many can the account afford* — it is *how many fit one to an hour*, and past fourteen
raising it is a change to the hours as well as to the budget. `every referral in a full day leaves
in an hour of its own` in the harness is the sentence that keeps it that way.

**The two ends are not symmetric, and that is the rule rather than an oversight.** The early end is
wide because it is the best hour of the day: this lands in a working engineer's mailbox rather than
on a recruiter's desk, and 06:00 is the top of the inbox for somebody who opens their mail at eight.

The late end used to be 21:00, on the reasoning that it caught the read somebody does before bed.
That reasoning was wrong in a way worth recording rather than quietly deleting. A message arriving
at nine in the evening is not read before bed — it is buried by everything that arrives overnight
and is down page two by eight the next morning. 20:00 and 21:00 were the two *worst* slots in the
day, not the two most patient ones. There is a second reason and it is about the sender: a mailbox
that emits a message at exactly 06:00 and again at exactly 21:00 every weekday is not a shape a
person produces. Cutting the tail cost two sends and bought back the part of the day that was
advertising the machine.

For the same reason the cold path stays at 09:00–17:00 for sending and the follow-up at
08:00–19:00. Only this
path ever reached past seven in the evening, and it no longer does.

Weekends **are** skipped, and this is the reversal that separates the path from the follow-up. A
follow-up is one sentence on a thread the recipient already has, and a nudge arriving on a Sunday
costs nobody anything. A referral ask is a first message to a stranger asking them to spend their
own credibility, and one that turns up on a Saturday morning says the sender either did not notice
or did not mind. It is the same message on Monday and it reads better.

`outreachReferralSlot_` walks forward a day at a time from today and takes the first slot clearing
both caps. **There is no window and no ceiling.** A follow-up has a window it can miss — past
twenty-one days, *following up* stops being a true description of the message — but a referral ask
is about a posting that is either open or not, so a backlog is spread rather than dropped, out to
180 days if that is what the arithmetic asks for.

An hour that has already gone by is never booked. A slot in the past would be sent by the very next
firing whatever hour it claims, which quietly defeats the spreading the function exists to do — so
a plan made at 23:00 starts tomorrow.

### Booked, drafted an hour early, then sent

Three steps rather than two, in the order they are written here, and each one is its own entry
point:

| | |
|---|---|
| `planReferralAsks` | reads `App`, `Referral` and the employee export, and appends the rows the planner booked. Touches no mailbox, so it is safe at any hour and from any button |
| `draftReferralAsks` | writes the message `DRAFT_LEAD_HOURS` (1 hour) before its Referral slot — resume attached, real address in the `To` field — and leaves it in Drafts |
| `sendReferralAsks` | sends whatever is still there when the hour arrives |

The hour in the middle is the entire review mechanism, exactly as it is for a cold email:
**deleting the draft in Gmail is how a referral ask is called off.** The send finds nothing behind
the stored id, and the row says `Cancelled` with *"The draft was deleted before its hour, so it was
called off."* — not `Failed`, because nothing failed. That line is not cosmetic. `Failed` is what
the tab says when a send broke and the reason is worth reading, so a column of `Failed` rows that
are really a person's own decisions is a column nobody can scan for problems any more.

Appending only, like `enqueueOutreach`: nothing in the planning step edits a row that already
exists, so a run that dies halfway leaves a shorter tab rather than a corrupted one. Running it
twice books nothing the second time, and that property is not maintained anywhere — it falls out of
the planner reading the tab it is about to append to. Every row carries the person's address, and an
address on the tab is spent whatever became of the row, so the second run sees the first run's work
as history. An idempotence that had to be remembered would be one that failed the first time
somebody clicked Run out of curiosity.

A slot that has already gone by is still drafted. Triggers miss firings — a quota, a deploy, a
weekend of downtime — and a row whose hour passed unattended has to be able to catch up rather than
sit on the tab with a date in the past and no explanation anywhere.

Every row is drafted inside its own `try`. One address Gmail refuses is one `Failed` row with the
reason on it; without the isolation it would be a thrown run, and the rows behind it — whose slots
are the same afternoon — would never be written at all. `Failed` is terminal by design here, because
[a failed row still spends the person and the place](#one-posting-per-company-three-people-never-two-on-a-day).

> **Three columns doing something slightly different from the `Email` tab.**
>
> `Queue ID` is `R-` and the address, not a generated id. The id on this tab is not decoration: this
> path asks one person once and never again, and an id drawn fresh each time it was computed would
> let the same person be claimed by two rows without either row looking wrong. Derived from the one
> field that identifies a referral row, a duplicate is visibly a duplicate.
>
> `Gmail Draft ID` is its own column, between `Mode` and `Sent At`, because that is where it sits in
> the row's life: the draft exists under that id for an hour, and deleting it in Gmail is what calls
> the message off. An earlier layout had no room for it and let the id ride in `Result` until the
> send replaced it with the sent message's id — two different kinds of Gmail id in one cell,
> tellable apart only by also reading `Status`, in the column whose entire job is to say how it
> went. `Result` now holds one kind of thing and is empty until there is a result.
>
> `Mode` is left **blank** when a row is written, on purpose. The column carries the tab's own
> default, and a value written at planning time would be this code overruling a person who set that
> cell to `Draft` — the one direction the mode rules never allow.

`checkReferralService` is the probe: it reads and sends nothing, and reports **all** the problems
rather than the first. The three things that fail late and quietly are a `Referral` tab that was
never created, an employee export nobody has run, and a resume id pointing at a file this account
cannot open — the second books nothing and logs a perfectly ordinary zero, and the third throws once
per row inside the per-row `try` and turns a whole afternoon of good rows into `Failed`. Every one of
them is cheaper to find here.

### Four tiers, ten templates each

Forty messages, in `REFERRAL_TEMPLATES`. The tier is how far above the writer the reader sits, and
it moves exactly two things: **how small the ask is, and whether the note admits it is reaching.**

| Tier | Who | The ask, roughly |
|---|---|---|
| `peer` | interns, new grads, juniors, associates | *would you be willing to put a referral in for me* |
| `mid` | the largest group by far | *would you be open to referring me for it* |
| `senior` | senior, staff-adjacent, leads | *if it is something you do, would you consider referring me* |
| `staff` | staff and above, plus managers and directors | *if you ever refer interns, would you consider doing it for me* |

Read the four next to each other and the ask shrinks as the reader gets more senior. That is the
whole gradient. Everything above the ask stays the same length in all four tiers, because seniority
is not a reason to write more.

What the tier deliberately does not move is the number of apologies. Only the **staff** openings
name the reach, in half a sentence, once — and a test holds all ten of them to it and holds the
other thirty to naming it nowhere. A full sentence of self-deprecation is not humility, it is an
invitation to agree the email should not have been sent, and some readers will take it. Real
humility in a cold email is being brief, being specific, and making the no easy.

**No template asks for a call, a chat, a coffee or a meeting, and a test enforces the list.** A call
turns a two-minute favour into a calendar item, and the safe answer to a calendar item is silence.
The offer line runs the other way: resume attached, questions by email, and on several of them no
reply needed at all if the answer is no.

Ten per tier for the same reason the recruiter email has ten variations — twenty-three engineers at
one employer means a run of identical bodies out of one mailbox, which is a spam signal on its own.
Which of the ten a person gets is seeded on the company name and offset by the attempt, so the first
person at an employer does not always draw template one and the second and third take the next ones
down. No two templates inside a tier share an opening, an ask, an offer or a close; nothing uses a
dash; everything is ASCII, so no client has to guess an encoding.

### The tier is read off the title, not off the seniority column

`outreachReferralTier_` walks `REFERRAL_TIER_TITLES` in order, most senior word first, matching
**whole words** — `Senior Staff Software Engineer` holds both words and staff is the answer, `lead`
must not fire inside `Leadership` or `misleading`, `sr` must not be found inside a longer word, and
`ii` must not be found inside `iii`. Manager and director sit with staff: they are further from the
work than a Principal engineer is, but they are the same distance above an intern, and it is that
distance the tier measures.

ColdEmail's `Seniority` column is read only when the title settles nothing, and the fallback of the
fallback is `mid`. The column is blank on 361 of the 2,145 exported rows, so believing it first
would send a Principal engineer the peer email on a blank cell alone.

> **The numbered ladder is why this is title-first.** ColdEmail's `seniority` labels a
> `Software Engineer II` as junior. On that column alone, every II and III in the dataset was being
> sent the new-grad email — dozens of people who have shipped things for a couple of years being
> written to as peers of somebody applying to intern. The ladder is now read from the title, last of
> all so that a named level in the same title still wins: `Senior Software Engineer II` is senior,
> `Software Engineer II` and `III` are mid, `IV` is senior, and a bare `I` is peer.

### The openings say only that the note is cold

Every one of the forty opens by admitting the note is cold and unasked for, and **none of them says
why this person was chosen.**

That is a deletion, not an omission. An earlier draft explained the choice, and with 2,145
recipients every reason available is generic: *you do the work rather than recruit for it* is true
of every single person being written to. A reason that is true of everybody is flattery
reverse-engineered from the ask, and it reads as exactly that. The warmth lives in the sentences
after the request instead, where it costs the reader nothing to believe.

The admission is made once, and either the opening or the ask may be where it happens — different
templates do it differently, but doing both is what made the first draft read as awkward, and a test
refuses any template that does. Inside the ask it earns its place twice over, because whether this
is a lot to ask of somebody never met is the reason the request is tentative at all.

What follows is one paragraph of the admission and the company sentence together, one line of who is
writing and what they have **already applied to**, a clause introducing two resume bullets, the
bolded ask with the easier favour beside it, the close, and the posting link on a line of its own at
the foot. Around a hundred and fifty words — longer than the recruiter email's, because the ask is
bigger and earns a little more room to be honest in, and nowhere near double, because seven beats at
two sentences each is a page and a page to a working engineer is an archive.

### The application is already in, and the email says so

The sentence naming the role reads *"I have already applied for the X role at Y"*, and then one
short line saying why the note followed it anyway. Both halves are new; the line used to read *"I
am … applying for the X role at Y"* and stopped there.

**The tense was left over from the `Jobs` tab.** While this path read postings rather than
applications there was often nothing applied to yet, and the present tense was the honest wording.
Every row now comes from an application actually made, so the same words are the same falsehood
pointing the other way — which is the argument `outreach_referral_send.gs` already made in a comment
when it started looking the applied date up, three changes before the sentence itself was fixed.

**Implied is worse than said.** Left unstated, the reader supplies the version that costs the most:
that they are being asked to attach their name to somebody who has not bothered to apply. Two
thousand engineers filling that gap themselves is worse than seventeen words spending it.

**Ten reasons, indexed with the template.** `REFERRAL_APPLIED_LINES` holds ten one-line answers to
the question the admission raises — *the form is in, so what are you asking me for* — and the same
company-seeded index that picks the body picks one of these, so the six people at one employer do
not read an identical sentence on one morning. Each is under twenty words, dash-free and ASCII like
everything else here, and none of them asks to skip any part of the process: the honest version of
the ask is that a submitted application is one of a few thousand read in the order they arrived, and
a referral is the only part of that the sender cannot do alone.

### The posting link at the foot, and no date

The link is required: a row without one is never due, whatever hour it is booked for. Refusing to
send is the right failure — a referral ask that cannot be acted on has spent the only message that
person will ever get. Naming the role alone is enough for a recruiter, because the req is already
theirs; it is not enough for an engineer, who has to find the posting before they can do anything,
and that errand is where a willing reader quietly becomes a reader who meant to get to it. A
referral is a form with a job id in it, and the email hands over the id.

**At the foot, not in the sentence.** It used to sit inside the line naming the role, which put a
Workday URL — two lines of query string — exactly where the reader was working out who was writing.
Down at the bottom, labelled, it is out of the prose and easy to copy, which is the only thing
anybody ever does with it.

**And no date.** The recruiter email names the day the application went because that is a fact a
recruiter can look up. The person being asked for a favour will not check, does not care, and reads
it as filler in a message that has already asked them for something.

### The bullets are introduced, and the easier favour is offered

Two numbers arriving under a paragraph that never mentioned them read as a fragment of a CV somebody
pasted in. Each of the forty templates carries its own clause pointing at them, so they arrive as
the thing being offered rather than as an attachment that leaked into the body.

Every message also offers to have the resume forwarded to whoever runs hiring. A referral spends the
reader's own credibility; a forward spends nothing. A reader who will not do the first will often do
the second, and a message that does not offer it never finds out — so the ask paragraph is the
bolded request, then that second route, then where the resume is.

### The `Referral` tab holds the name and the address

This is the plain opposite of the rule the `Email` tab keeps, and it is a deliberate decision by the
sheet's owner rather than an inconsistency nobody noticed.

The `Email` tab sends in bulk and unattended, so a recruiter's name and address staying out of the
tracker costs nothing and removes a whole class of accident — see
[What this is not](#what-this-is-not). The `Referral` tab is read by a person before anybody is
asked: the question it exists to answer is *who at this company have I already asked*, and a tab
that answers it with a fingerprint is a tab you have to open the contacts spreadsheet to use.
`Person`, `Email` and `Title` therefore lead the row, because they are the row. The columns are in
[spreadsheet.md](spreadsheet.md#tab-referral--who-has-been-asked).

## The contact list

A second spreadsheet, owned by the sending account, with three tabs:

| Tab | Written by | On the next export |
|---|---|---|
| `Contacts (seed)` | `src/export_contacts.py` in ColdEmail | **overwritten wholesale** |
| `Contacts (manual)` | you, by hand | **never touched** |
| `Employees (seed)` | `src/export_referrals.py` in ColdEmail | **overwritten wholesale** |

The split between the first two is the whole point. One tab would mean a single re-export silently
destroying months of contacts gathered by hand. Two tabs make that impossible rather than merely
unlikely.

`Employees (seed)` is separate from both for a different reason: it holds different people, asked
for a different thing. Recruiters and engineers on one tab would mean one export able to erase the
other's rows, and a referral ask and a cold email drawing from one list would eventually pick the
same person for both.

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

### `Employees (seed)` — the people who could make a referral

`src/export_referrals.py` is the recruiter export's sibling: the same join, done for the people who
would actually put the referral in. It writes **2,145 people across 221 companies** to
`finals/employees_seed.csv`, and that file is imported over the tab wholesale, so nothing typed by
hand belongs on it. There is no `Employees (manual)`; a name added by hand would be erased by the
next export.

Ten columns: `Company · Person Name · Email · Title · Domain · Seniority · LinkedIn · Angle ·
Bucket · Verify`. Four of them are read by the sender and each answers one question — `Title`
decides the tier, `Domain` is what lets a link on the employer's own careers site be told apart from
an aggregator republishing the same posting, `Bucket` picks the two resume numbers, and `Angle` is
the one company-specific sentence, borrowed from the same file the recruiter email borrows it from.
1,990 of the rows carry an angle.

Everything interesting is in what is left out, because a referral ask lands in a personal inbox and
a bad address costs more there than it does in a recruiter queue:

| Left out | Why |
|---|---|
| `anymail_status` short of `valid` | the cheapest bounce is the one never queued |
| `active` explicitly `no` | confirmed gone from the company, so they cannot refer anybody |
| a title reading `ex-` or `former` | the same fact written a different way |
| a repeated address | one person, one message; the first occurrence wins |

Only a positive `no` disqualifies on the active check. `unchecked` and `unknown` stay in, because
absence of evidence is not evidence of absence and dropping them would throw away a hundred
otherwise good people. `Seniority` is deliberately left **empty** rather than guessed when the source
does not say — 361 rows are blank — because a guessed level would be believed by the tier resolver,
and a wrong tier is the wrong email rather than a missing one.

## The message

> Every subject line, every variation and every bullet is catalogued verbatim in
> [email-templates.md](email-templates.md). This section is why the message has the shape it has.

The template lives in `outreach_compose.gs`, not in a generated CSV. ColdEmail supplies only the
two things that genuinely vary per row — the company angle and the per-person hook — so changing
a sentence is an edit to one file rather than a pipeline run and a re-export of two thousand
rows.

```
Subject: I applied. What happens next?

Hi Michelle,

A quick introduction:
I’m Henry Nguyen, a Math and Computer Science student at Kenyon College. I applied for the
Software Engineer Intern position at Google on Jul 20, and I’m genuinely hoping to move forward
to the next stage of the process. Removed 340K malformed records from a 2.1M-record dataset that
were inflating severity rates by 8%.

Why I'm reaching out:
I noticed you recruit for engineering roles at Google, so I wanted to reach out directly about my
Software Engineer Intern application. I’m especially interested in Google because correctness
under concurrency is what I work on.

A quick question:
Would you be able to take a quick look at my application? Or point me to
whoever is closest to this req. Resume attached.

Thanks either way,
Henry Nguyen
```

Three labelled sections with short paragraphs. The labels provide scan points, while the prose
keeps the message sounding like one person writing to another.

Bold is selective: sender identity, role/company, one proof point and the request are emphasized;
everything else stays plain.

**Short paragraphs, with no statistics-led subject.** The three headings now do exactly one job
each: introduce the sender and application, explain why this recruiter, and make the ask. The
ceilings and what changed are in
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

**No dashes.** Not in a subject, not in a paragraph, not in the ask. Text arriving from ColdEmail
does use them, and `outreachNoDashes_` turns each into a full stop on the way in, so a long
angle becomes two short sentences instead of one long breath.

Each slot is doing one job:

- **Subject** — a short curiosity hook or pattern break, never a dangling resume statistic. All
  ten are under 60 characters, because a recruiter reads them on a phone.
- **A quick introduction** — identity, application, genuine next-stage intent and one proof point.
- **Why I'm reaching out** — the normalized profile hook explains why this person received the
  email; the company angle then explains why the role is interesting.
- **A quick question** — one bolded request and one short way out, so the easiest reply is useful.
  Under twenty-five words, and the way out is worded differently in each variation, because it is
  the clause a recruiter forwarding to a colleague actually quotes.

### Ten subjects, matched to what the company does

The three sections stay stable, while the subject, proof point and ask move —
three people at one company must not receive three copies, and a run of identical bodies is a
spam signal in its own right.

| Subject | For |
|---|---|
| `Could this application move forward?` | data |
| `I may have the wrong person` | fintech |
| `Is this application still moving?` | cloud |
| `I’d really like to continue` | ai |
| `Could you help me find the next step?` | security |
| `Could you take a look?` | hardware |
| `One honest question about the role` | consumer |
| `Could you point me in the right direction?` | edtech |
| `Is Kenyon part of your campus hiring?` | a university recruiter, whatever the industry |
| `I applied. What happens next?` | fallback where the industry is unknown |

The industry comes from ColdEmail's `bucket`, so it is the same judgement that chooses the resume
proof point. A university recruiter is served before the industry match, because the campus
question is more relevant to them than an engineering result.

The hooks are **ordered, not picked**: attempt 2 takes the next one down, attempt 3 the one after.
Three people at one employer therefore never see the same subject line twice.

> **Why the subject hook is not held back for later attempts.** An earlier draft put the plain
> application subject on attempt 1 so the recruiter could find it in the ATS. That was the wrong
> trade — Gmail indexes the body too, and the role and date are the first line of it, so nothing
> was lost by hooking the subject. An email that is not opened has no other qualities.

The body is HTML, and a plain-text alternative is sent alongside it. Light HTML like this costs
nothing in deliverability; what gets penalised is
the heavy kind with images and tracking pixels, which is why there are none.

`Henry_Nguyen_Resume.pdf` is attached from Drive, 110 KB. The filename is what the recruiter
sees, so it is the name and not `henryng_swe.pdf`.

Age changes one line:

| Application age | The sentence |
|---|---|
| 45 days or less | `I applied for the {Role} position at {company} on {date}, and I'm genuinely hoping to move forward.` |
| more than 45 days | `I applied for the {Role} position at {company} earlier this year, and I'm genuinely hoping to move forward.` |

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

### Preparing the referral path

The referral path **is** part of `runOutreachCycle` — steps 5–9. The setup below is what has to
exist before those steps have anything to work with; once it does, the path runs on the hourly
trigger like the other two, and `OUTREACH_MODE` is what holds it back.

1. Add an `Employees (seed)` tab to the contacts spreadsheet, headed `Company · Person Name ·
   Email · Title · Domain · Seniority · LinkedIn · Angle · Bucket · Verify`. In ColdEmail,
   `uv run python src/export_referrals.py`, then import `finals/employees_seed.csv` over it.
2. In the **bound** script — the one owned by the tracker's account, not the sender — run
   `setupReferralQueue`. It creates the empty `Referral` tab with its headers, its dropdowns and
   its timestamp formats, contacts nobody, and refuses to write over any header cell that already
   holds something else, which would mean this is a different table.
3. In the same bound script, run `migrateAppOfficialColumn`. It opens column I on `App` and moves
   `Alumni`, `Recruiter` and `Update` one to the right, carrying their values, validation and
   colour rules with them. Safe to run twice, and it refuses a layout it does not recognise rather
   than inserting blind.
4. Run `installAppOfficialTrigger` once. It puts `runHourlyHousekeeping` — which sinks called-off
   `Referral` rows — on an hourly trigger. It is on a clock rather than run by hand because an
   edit trigger is not guaranteed and a tick deliberately does not move its row.

   It no longer touches `App`. Colouring the rows needing a link and lifting them to the top is
   `syncAppOfficialWorklist`, the last step of the sender's own hourly `runOutreachCycle`, and it
   needs nothing installed beyond the cycle's existing trigger.

> **Redeploy the Python half before running the migration.** `job_sync/highlight.py` writes the
> `Alumni` and `Recruiter` checkboxes, and it now finds those columns by reading the header row
> rather than by a fixed index, precisely so that inserting a column cannot make it write
> checkboxes over the pasted links. That header-driven version has to be the one in use: an older
> copy addresses columns I and J by position and would tick straight into `Official`. It fails
> safe — it guards on those cells reading `Alumni` and `Recruiter` and writes nothing when they do
> not — but a run that writes nothing is still a run that ticks nothing.

5. In the sender project, run `checkReferralService`. It reads and sends nothing and names every
   missing piece at once — no tab, no export, a resume that will not open. `previewReferralTemplates`
   logs all forty messages, which is the cheapest way to confirm the templates arrived in the push.
6. Then `planReferralAsks` by hand once, and read the `Referral` tab before letting anything near
   a mailbox. It appends rows and touches no mailbox at all, so this step is free. After that the
   hourly cycle does it.

`draftReferralAsks` and `sendReferralAsks` are the two that can reach Gmail, in that order and an
hour apart. `OUTREACH_MODE = Draft` holds this path back exactly as it holds the cold one:
`sendReferralAsks` reads the same property, so with it set the drafts are written and left for you.
A blank `Mode` cell on a row means the tab's default, and a row set to `Draft` by hand is never
overruled by the global switch being clear.
