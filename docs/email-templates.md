# Email templates — every subject line and every body that can go out

The full catalogue of everything this project can put in somebody's mailbox: the **10** factual cold
recruiter variations with **3** copy forms each, the **20** follow-up nudges, and the **40** referral bodies with the **36**
subjects and **10** applied lines they draw from, plus the **13** resume bullets all three share.
[outreach.md](outreach.md) covers *when* an email is sent and to whom; this page covers *what* is in
it.

Nothing here is a summary of the code. Every string below is verbatim from the file named beside
it, so a change to one has to be a change to both.

Read it before changing any of them. A template is not a string in a config file: the same sentence
goes to hundreds of people, once, and **there is no second attempt at a person on the referral path
at all**, so a template bug is not a retry, it is a chance spent.

## Three paths, one voice

| | Cold | Follow-up | Referral |
|---|---|---|---|
| Reads | a recruiter | the same recruiter, on the same thread | an engineer at the company |
| Asks for | a look at the application | nothing new | a referral, or a forward |
| Lives in | `outreach_compose.gs` | `outreach_followup.gs` | `outreach_referral.gs` |
| Variations | 10 factual bases × 3 copy forms | 20 note + close pairs | 40 bodies × 36 subjects × 10 applied lines |
| Picked by | least-used base/form, with industry relevance as tie-breaker | least-used note, with company ordering as tie-breaker | least-used body per tier, with company ordering as tie-breaker |
| Length | ~90 words | 2 sentences | ~150 words |
| Attachment | resume | **none** | resume |
| Daily cap | 25 at peak | 6 | 14, and 6 people per employer ever |

The three do not share a sentence, and that is deliberate. A recruiter is paid to read
applications; an engineer is not and is being asked to spend their own credibility; and a follow-up
is a nudge on a thread that already exists. Only the resume bullets cross between them, because a
number is a number whoever reads it.

## The house rules

Every string in this document obeys all of these. The harness enforces the ones that can be
checked mechanically, and the tests carry the argument in their comments.

- **No dash anywhere.** Not a hyphen used as punctuation, not an en dash, not an em dash. Every
  dash arriving from ColdEmail's angle text is turned into a full stop by `outreachNoDashes_`, and
  nothing written by hand here has ever used one. A template that did would be the only line in the
  message that reads as one long breath.
- **ASCII only.** Nothing depends on how a mail client guesses an encoding.
- **One bolded thing per message**, and it is the ask. Bold is a pointer, and two pointers point
  nowhere. `**double asterisks**` render as `<b>` in HTML and are stripped in the plain part, so
  both halves of the message say the same thing.
- **Word ceilings.** Resume bullets ≤ 20 words and cold asks ≤ 25, both enforced by the harness;
  referral applied lines ≤ 20, likewise. The referral asks and the follow-up notes have no test on
  them and are held to the same budget by hand, and today the longest of each is 19 and 18 words.
- **Never a meeting.** No template on the referral path may contain *chat*, *call*, *meeting* or
  *coffee*. A call turns a two-minute favour into a calendar item, and the safe answer to a
  calendar item is silence. (The cold path's `ai` variant is the one deliberate exception: a
  recruiter's job *is* the call.)
- **No new fact in a follow-up.** A follow-up that adds an argument is a second pitch, and a second
  pitch is exactly what it is built not to be.
- **Nothing rounded up.** Every number in a subject or a bullet is a true number from the resume,
  because a recruiter who checks must find the two documents saying one thing.

## Why there are so many of each

The counts are not decoration. Two thousand messages leave one mailbox, and **a run of identical
bodies is a spam signal on its own** — independently of anything a filter thinks about the sender.

The dataset has 23 engineers at Reddit and 22 at Goldman Sachs. `REFERRAL_PER_COMPANY` allows 6 of
them, and `REFERRAL_COMPANY_DAILY_CAP` used to spread those 6 across six days. It is now **1 per
employer per day**, but the argument for six-in-a-morning was never wrong: what makes six notes
read as a mailing shot is six *identical* notes. So the tier, the template, the subject, the applied
line and the bullet pair all move per person. New rows fill the least-used live template first;
`outreachVariantOrder_`, `outreachReferralIndex_` and `outreachFollowUpStartFor_` use company
relevance or a company name only to break a tie. The selected number is written to the tab before
drafting, so it remains reproducible for a row that gets replanned.

The follow-up gets 20 rather than 10 for a reason worth knowing: a cold email varies its subject,
its number and its ask, which is a lot of surface. A follow-up is one sentence with no subject of
its own, so the sentence is the only place variety can live.

---

# Part 1 — the cold recruiter email

## Where each piece lives

| Piece | File |
|---|---|
| The skeleton, the ten variations, the resume bullets, the ask lines | [`apps_script/outreach/outreach_compose.gs`](../apps_script/outreach/outreach_compose.gs) |
| The role name shown in the application bullet (`SHORT_ROLES`) | same file |
| The per-person hook (`Why I'm reaching out`, first bullet) | ColdEmail `src/process7_personalize.py` |
| The per-company angle (`Why I'm reaching out`, second bullet) | ColdEmail `src/process8_company_angle.py` |
| Both, exported per contact | ColdEmail `finals/contacts_seed.csv` → the `Contacts (seed)` tab |

The template is **not** generated into a CSV. ColdEmail supplies only the two sentences that
genuinely vary per row, so changing a sentence in the body is an edit to one file instead of a
pipeline run and a re-export of two thousand rows.

## The skeleton

Three labelled sections. Six bullets and one sentence, and none of them over twenty words.

```
Subject: {variant subject}

Hi {first name},

Quick intro:
  • I am Henry Nguyen, a Math and Computer Science student at Kenyon College.
  • Applied for the {Short Role} role on {date}.
  • {resume bullet}

Why I'm reaching out:
  • {per-person hook}
  • {per-company angle}

The ask:
{variant ask} Resume attached.

Thanks either way,
Henry Nguyen
hoanng15.work@gmail.com · linkedin.com/in/hoanng15 · github.com/henryng15
```

The three headings — `Quick intro:`, `Why I'm reaching out:`, `The ask:` — are fixed and bold in
every variation. They are what makes the email skimmable, which is the only kind that gets
answered.

### The budget each section is held to

The headings survived a rewrite that the length did not. Three labelled sections is what makes
the email skimmable, but a section holding four bullets is a paragraph wearing a label, and that
is what the previous version had become: a `Quick intro` of four lines, a `Why I'm reaching out`
whose two sentences each bridged into a resume item the intro had already stated, and an ask of
twenty-eight words. **140 to 166 words** depending on which hook and angle a contact drew, and
the `Why I'm reaching out` block alone ran from 50 to 78 of them — longer, at its worst, than
everything above it put together.

Each heading now does exactly one job, and each has a ceiling:

| Section | Holds | Ceiling |
|---|---|---|
| `Quick intro` | 3 bullets: who is writing, what they applied to, one result | 20 words a bullet |
| `Why I'm reaching out` | 2 bullets: why this person, why this company | 20 words a bullet |
| `The ask` | 1 sentence: the bolded request, then one way out | 25 words |

That lands a body of **about 105 words** including the greeting and `Resume attached.`, and a
`Why I'm reaching out` of 26 to 30. The three rules that get it there, each cutting one specific
thing:

- **One result bullet, not two.** The second was always the weaker of the pair and it bought
  nothing the subject had not already promised. The reader who wants a second number opens the
  attachment; the reader who does not was going to skip the fourth line either way.
- **The hook stops after one sentence.** It used to carry a tail explaining why the sender wrote
  to this person rather than the careers inbox. A reader told you know what they recruit for can
  work that out.
- **The angle stops before the resume.** It used to bridge into a thirty-word retelling of a
  bullet printed in bold two lines above it.

Anything a recruiter wants past this is in the attachment. That is what the attachment is for.

Constants that never move:

| Slot | Value |
|---|---|
| `SENDER_NAME` | `Henry Nguyen` |
| `SENDER_STUDY` | `a Math and Computer Science student at **Kenyon College**` |
| `SENDER_LINKS` | `hoanng15.work@gmail.com · linkedin.com/in/hoanng15 · github.com/henryng15` |
| Sign-off | `Thanks either way,` |
| Attachment | `Henry_Nguyen_Resume.pdf`, 110 KB, from Drive |

Bold carries exactly two things: the numbers in the intro bullets, and the request itself in the
ask. Bold on a third thing is bold on nothing.

**No dashes anywhere** — not in a subject, not in a bullet, not in the ask. Text arriving from
ColdEmail does use them, and `outreachNoDashes_` turns each into a full stop on the way in.

## The ten factual variations

Format, bolding and order are identical across all ten. Only the **subject**, the **result
bullet** and the **ask** move — three people at one company must not receive three copies, and a
run of identical bodies is a spam signal in its own right.

Every subject is a true number from `henryng_swe.tex`, stated so that it is not yet explained.
The subject's only job is the open. All ten are under 60 characters, because a recruiter reads
them on a phone.

**The bullet is the one the subject is about**, so the email answers its own subject on the third
line. **Every ask is one sentence under twenty-five words**: the bolded request, then one short
way out. The way out is worded differently in each, because it is the clause a recruiter
forwarding to a colleague actually quotes.

### 1. `application` — the fallback, used where the industry is unknown

> **Subject:** Cut a 30-minute research loop to 60 seconds

- Cut analyst research from **30 minutes to 1 minute** with a Python MCP server over validated DuckDB data.

**The ask:** Would you be able to **take a quick look at my application**? If someone else owns
the req, a pointer would help just as much.

### 2. `data` — bucket `data`

> **Subject:** 340K bad records were inflating severity by 8%

- Removed **340K** malformed records from a **2.1M**-record dataset that were inflating severity rates by **8%**.

**The ask:** Would you be able to **take a quick look at my application**? Or point me to
whoever is closest to this req.

### 3. `fintech` — bucket `fintech`

> **Subject:** 50 duplicate webhooks, exactly one order

- Made repeat Stripe webhooks safe in one PostgreSQL transaction. **50 concurrent webhooks**, exactly **one** order.

**The ask:** Would you be able to **take a quick look at my application**? If someone else owns
this req, I will go to them.

### 4. `cloud` — bucket `cloud`

> **Subject:** 500 concurrent requests, zero overbookings

- Held seat limits across **500 concurrent requests** on EKS with PostgreSQL row locks. No overbooking got through.

**The ask:** Would you be able to **take a quick look at my application**? Or tell me who runs
intern hiring this cycle.

### 5. `ai` — bucket `ai`

> **Subject:** Repeat checks: 4 seconds to 400 milliseconds

- Cut repeat claim checks from **4s to 400ms** by caching embeddings in Redis over **120** SEC filings.

**The ask:** Would you be open to a **short chat about the role**? If it is not yours, a pointer
to the closest team helps.

*The only variation whose ask is a conversation rather than an application review.*

### 6. `security` — bucket `security`

> **Subject:** Four high-severity CVEs, one export path

- Removed **4 high-severity CVEs** from customer-data exports by swapping xlsx for ExcelJS, with **11** tests behind it.

**The ask:** Would you be able to **take a quick look at my application**? Or tell me who I
should be talking to.

### 7. `hardware` — bucket `hardware`

> **Subject:** A daily report was 3 days stale and nobody knew

- Caught a silent Lambda failure after a report ran **3 days** stale, by emitting freshness metrics to Prometheus.

**The ask:** Would you be able to **take a quick look at my application**? If the intern cohort
is not yours, a pointer helps.

### 8. `consumer` — bucket `consumer`

> **Subject:** 480 dishes, top 5 matches in under 300ms

- Matched a **480**-dish catalog to calorie, protein and budget targets, returning the top **5** in under **300ms**.

**The ask:** Would you be able to **take a quick look at my application**? Or point me at
whoever owns intern hiring there.

### 9. `edtech` — bucket `edtech`

> **Subject:** 90 students a semester, zero local setup

- Built browser coding workspaces for **90** students a semester with Skulpt and WebSockets. No local setup.

**The ask:** Would you be able to **take a quick look at my application**? Or send me toward
whoever is reading these applications.

### 10. `campus` — a university recruiter, whatever the industry

> **Subject:** The model was ignoring location: 0% to 24.7%

- Fixed a crash model that ignored location, raising the share of groups reflecting it from **0% to 24.7%**.

**The ask:** Would you be able to **take a quick look at my application**? I would also like to
know whether Kenyon is on the campus list.

*The only ask that asks a second question, and the only one that names Kenyon.*

## The three copy forms

The subject, section labels and closing are paraphrased; the application fact, resume bullet,
recipient-specific hook, company angle and ask remain exactly the same. A row stores this as
`base:form`, for example `fintech:2`; a legacy base-only value is form 1.

| Form | Introduction | Reason | Ask label | Closing |
|---|---|---|---|---|
| 1 | Quick intro: | Why I'm reaching out: | The ask: | Thanks either way, |
| 2 | A brief introduction: | Why I thought to write: | A quick question: | Thank you for considering it, |
| 3 | A little context: | Why I reached out: | My question: | Thank you for your time, |

### Alternate subjects

| Base | Form 2 | Form 3 |
|---|---|---|
| `application` | A 30-minute research step, reduced to 60 seconds | Research that went from 30 minutes to 60 seconds |
| `data` | 340K malformed rows were distorting severity by 8% | An 8% severity distortion traced to 340K bad rows |
| `fintech` | 50 repeat webhooks, one recorded order | One order from 50 concurrent webhooks |
| `cloud` | 500 concurrent requests, without an overbooking | No overbookings across 500 concurrent requests |
| `ai` | Repeat claim checks, from 4 seconds to 400ms | A 4-second repeat check reduced to 400ms |
| `security` | Four high-severity CVEs removed from one export path | One export path, four high-severity CVEs removed |
| `hardware` | A report ran stale for 3 days before the alert existed | Making a 3-day stale report visible |
| `consumer` | 480 dishes, five matches in under 300 milliseconds | Top five matches from 480 dishes in under 300ms |
| `edtech` | 90 students each semester, no local setup | No local setup for 90 students a semester |
| `campus` | Location was ignored: 0% to 24.7% coverage | A crash model began reflecting location: 0% to 24.7% |

## Which variation a contact gets

`outreachVariantOrder_` builds the relevance order. `outreachVariantTemplateLoad_` counts every
non-cancelled row already committed to `Email`, and `outreachBalancedVariantFor_` gives a new row
the least-used factual base; relevance chooses among bases tied for that minimum. The copy form is
then chosen the same way inside that base. Existing rows keep the subject/body form already stored
on their tab.

1. `campus`, if the contact's focus is `university`. They are usually not the person who reads
   "50 duplicate webhooks" and feels anything.
2. The variation matching the company's `bucket`, via `BUCKET_VARIANT`. The bucket comes from
   ColdEmail's company angle file, so it is the same judgement that wrote the opening line.
3. `application`, the industry-free fallback.
4. Everything else, in declaration order, so a fourth or fifth attempt still has somewhere to go.

## The resume bullet library

Thirteen bullets, **one per email**. Every number is taken verbatim from `henryng_swe.tex` —
nothing is rounded up, and nothing is a claim the resume does not already make, because a
recruiter who checks must find the two documents saying one thing.

Each variation takes the bullet its subject is about, so the third line of the email answers the
line that got it opened. Ten of the thirteen are in use; the other three are the pair members
that the second bullet used to carry, and they stay here because a new variation is a subject and
a bullet, and the bullet is already written.

| Key | Bullet | Variation |
|---|---|---|
| `mcp` | Cut analyst research from **30 minutes to 1 minute** with a Python MCP server over validated DuckDB data. | application |
| `polars` | Removed **340K** malformed records from a **2.1M**-record dataset that were inflating severity rates by **8%**. | data |
| `locks` | Held seat limits across **500 concurrent requests** on EKS with PostgreSQL row locks. No overbooking got through. | cloud |
| `webhooks` | Made repeat Stripe webhooks safe in one PostgreSQL transaction. **50 concurrent webhooks**, exactly **one** order. | fintech |
| `calibration` | Fixed a crash model that ignored location, raising the share of groups reflecting it from **0% to 24.7%**. | campus |
| `coverage` | Raised checkout test coverage from **34% to 82%** with a Vitest pipeline that blocks failing pull requests. | *held in reserve* |
| `rag` | Cut repeat claim checks from **4s to 400ms** by caching embeddings in Redis over **120** SEC filings. | ai |
| `freshness` | Caught a silent Lambda failure after a report ran **3 days** stale, by emitting freshness metrics to Prometheus. | hardware |
| `cves` | Removed **4 high-severity CVEs** from customer-data exports by swapping xlsx for ExcelJS, with **11** tests behind it. | security |
| `lambda` | Automated a daily collateral report across **120 branches** with scheduled AWS Lambda jobs, saving **30 minutes** a run. | *held in reserve* |
| `menulens` | Matched a **480**-dish catalog to calorie, protein and budget targets, returning the top **5** in under **300ms**. | consumer |
| `workspaces` | Built browser coding workspaces for **90** students a semester with Skulpt and WebSockets. No local setup. | edtech |
| `integrity` | Detected edits to legal-evidence files by storing each keccak256 hash in a Solidity contract on Polygon. | *held in reserve* |

## The two sentences that are not chosen from a list

`Why I'm reaching out` is two bullets, never a paragraph: the hook and the angle arrive as whole
sentences from two different files, and run together they make the block a recruiter skips.

**Each bullet has one purpose and one sentence.** The first says why this person, the second says
why this company, and neither reaches back into the resume — the intro bullet above them already
carries the number, in bold. Both are under twenty words.

### Bullet one — the per-person hook

`build_hook` in ColdEmail's `process7_personalize.py`. The school is quoted verbatim because it
is a clean proper noun; everything else is driven by a focus classifier rather than by quoting a
raw search snippet, which is too noisy to drop into a sentence.

Ordered, most specific first. The first three are facts about the person; `FOCUS_LINE` is the
floor, reached only when neither a school nor a headline was found.

| Shape | Sentence | Words |
|---|---|---|
| school + role | `I noticed you studied at {school}, and that you're now {role} at {company}.` | 15 to 22 |
| school only | `I noticed you studied at {school}.` | 7 |
| role only | `I saw your work as {role} at {company}.` | 9 |
| focus `university` | `I saw that you work on university hiring at {company}.` | 10 |
| focus `technical` | `I saw that you recruit for engineering roles at {company}.` | 10 |
| focus `leadership` | `I saw that you lead technical recruiting at {company}.` | 9 |
| focus `sourcing` | `I saw that you source engineering candidates at {company}.` | 9 |
| nothing found | *(empty — the bullet is dropped)* | 0 |

**The ceiling does not hold on the school + role shape.** `{role}` is a headline scraped from a
search snippet, and 57 of the 1,863 hooks in the current export (3.1%) run past twenty words
because the snippet was a LinkedIn tagline rather than a job title: *"and that you're now (He/Him).
Principal Technical Recruiter..."*, *"and that you're now Recruiting the experts who keep the
world..."*. This predates the rewrite, which only made it measurable. `extract_headline` is where
it would be fixed.

`recruiting` is deliberately not in the table. The classifier falls back to it for anything with
"recruit" or "talent" in the blob, which is every recruiter alive, and a line saying so tells the
reader nothing they did not already know. Those contacts lose the bullet instead.

**`FOCUS_LINE` fires on nothing in the current export.** All 406 contacts without a hook have an
empty `person_focus`, not `leadership` or `sourcing`, so the four focus shapes are reached only by
rows that do not exist yet. They cost nothing and are correct when the classifier starts labelling
those people; they are not why anyone gains a bullet today.

**The tail is gone.** Every one of the first three shapes used to append a second sentence off a
`FOCUS_TAIL` table — `Since you own early-career and intern hiring there, I wanted to reach you
directly rather than the general careers inbox.` Twenty-two words to state what the first sentence
had already implied: a reader told you know what they recruit for can work out why you wrote to
them and not to the careers inbox. Dropping it is what let `leadership` and `sourcing` get a
bullet of their own, which they never had.

### Bullet two — the per-company angle

`sentence()` in ColdEmail's `process8_company_angle.py`. Two forms, and both end on `PULL` — the
problem the sender actually works on, in one clause of under a dozen words.

**Form A, a dated event** — used when a headline parses into a clean event phrase. Two sentences
rather than a comma splice, for the same reason `outreachNoDashes_` exists on the sending side:

```
I saw {company} {event phrase}{ on {date} | back in {year}}. {Pull for the bucket}.
```

> I saw Stripe acquire Bridge on October 20, 2024. Correctness under retries and races is what I
> work on.

**Form B, an honest technical interest** — the fallback when nothing concrete parses. Deliberately
not "I love your product": most of these products have never been used by the sender, and claiming
otherwise is the fake personalisation that reads as spam.

```
I'm especially interested in {company} because {pull for the bucket}.
```

| Bucket | `PULL` |
|---|---|
| `ai` | making models answer from validated data is what I work on |
| `data` | the malformed rows nobody notices are what I work on |
| `fintech` | correctness under retries and races is what I work on |
| `security` | integrity checks that fail loudly are what I work on |
| `cloud` | correctness under concurrency is what I work on |
| `edtech` | setup friction is the part of teaching tools I work on |
| `consumer` | ranking hidden behind a simple screen is what I work on |
| `hardware` | making unattended systems fail loudly is what I work on |

Longest sentence either form can produce: **20 words**.

**One table replaced two.** There used to be an `INTEREST` opener and a separate `BRIDGE`, and the
bridge spent thirty-odd words apiece narrating a resume line — *"at Todd Agriscience I made repeat
Stripe webhooks safe by creating the order and reducing stock in a single Postgres transaction, so
50 concurrent webhooks still produced exactly one order"* — inside the bullet whose only job is to
say why this company. The email already carries that number, in bold, two lines above. Saying it
twice at four times the length made the second section longer than the first.

The event form kept its bridge for a real reason, and the reason still holds: a company fact on
its own is flattery with a date attached. `PULL` is that bridge at a third of the length. It names
the problem and stops; whoever wants the implementation has the attachment.

An angle is mandatory for an unattended send. A contact without one — a hand-typed row at a
company ColdEmail never wrote for — is queued as `Draft` rather than sent.

**Regenerating after a wording change.** Both sentences are assembled at write time, so a change
to `build_hook` or to `PULL` only needs the profiles already cached on disk. `--no-lookup` writes
the CSV straight from that cache and returns before the search loop:

```bash
.venv/bin/python src/process7_personalize.py --no-lookup   # -> finals/7_hooks.csv
.venv/bin/python src/process8_company_angle.py --no-lookup # -> finals/8_company_angle.csv
.venv/bin/python src/export_contacts.py                    # -> finals/contacts_seed.csv
```

**The flag is not optional.** Without it `process7_personalize.py` sees 340 rows that were parked
as `no_budget` on an earlier run and spends 340 Serper credits looking them up, which has nothing
to do with a wording change. Run it bare only when the intent is to buy those 340 profiles.

Until the export is re-run and the `Contacts (seed)` tab re-imported, the sheet still holds the
old sentences and the old sentences are what sends.

## The lines that change with the application, not with the variation

**The application bullet.** Three shapes, and the one used depends on age and stage:

| Condition | Sentence |
|---|---|
| applied within 45 days | `Applied for the **{Short Role}** role on {Mon d}.` |
| older than `STALE_APPLICATION_DAYS` (45) | `Applied for the **{Short Role}** role earlier this year.` |
| `Process` is `Completed OA` | the same line plus ` and have since completed the online assessment` |

Naming a date from months ago points the reader straight at the weakest fact in the email.
The assessment clause is appended rather than given a bullet of its own: it is the same fact one
stage stronger, and split across two lines the reader has to join them back up.

**The role name.** Always the three-word kind, never the posting's own title —
`SHORT_ROLES` maps `Campus Undergraduate Summer Internship Program - 2027 Software Engineer,
Enterprise Technology Services- Charlotte, NC` down to `Software Engineer Intern`. A title no
rule recognises is left exactly as written; only an empty cell falls back to
`Software Engineer Intern`. See [outreach.md](outreach.md#the-job-is-named-in-three-words-not-in-the-job-boards).

**The greeting.** `Hi {first token of the recruiter's name},` and `Hi there,` when the name cell
is empty.

## How it is rendered

Two bodies from one template. `**bold**` becomes `<b>` in the HTML part and is stripped in the
plain-text part; bullets become `<ul><li>` and `  - ` respectively. Light HTML like this costs
nothing in deliverability — what gets penalised is the heavy kind with images and tracking
pixels, and there are none here: no open tracking, no link redirector.


---

# Part 2 — the follow-up

## The twenty nudges (`FOLLOWUP_TEMPLATES`, outreach_followup.gs)

Twenty ways to say the same short thing. `note` is what the message is, `close` is the wish it ends
on, and they are stored apart so the two axes multiply when read: twenty openings and twenty
sign-offs.

It is a **plain-text reply on the existing thread with no attachment**. The resume is already one
message up, and re-attaching it to a two-sentence nudge is the single loudest bulk-mail signal this
system could send. There is no subject of its own and no new fact anywhere in the list.

The number a row gets is stored in the `Follow Up Template` column and is 1-based, because a person
reads that column and "template 0" is not a thing anybody says.

| # | Note | Close |
|---|---|---|
| 1 | Floating this back to the top of your inbox in case it slipped by. | Have a great rest of your week, |
| 2 | Following up briefly on the note below, in case it is easier to answer now. | Hope your week is going well, |
| 3 | Circling back once on this one. No rush at all if the timing is wrong. | Wishing you a good week, |
| 4 | A short nudge on the message below, in case it got buried. | Have a lovely day, |
| 5 | Bumping this gently in case it landed in a busy week. | Enjoy the rest of your day, |
| 6 | Following up once on my note below. Happy to be pointed elsewhere if this req is not yours. | Have a great day, |
| 7 | Checking in briefly on the application below. Still very interested. | Hope the week treats you kindly, |
| 8 | One quick follow up, in case the note below slipped past. | Have a good one, |
| 9 | Sending this back up in case it is a better moment to look at it. | Wishing you a smooth week, |
| 10 | A brief nudge, and no reply needed if the answer is not right now. | Take care, |
| 11 | Following up in case there is anything else you need from my side. | Have a great week ahead, |
| 12 | Just checking this reached you. Happy to resend anything that did not. | Hope you have a good day, |
| 13 | Bringing this back once, in case the timing is better this week. | Enjoy your week, |
| 14 | A short follow up on the note below. I know inboxes fill fast. | Wishing you a good rest of the week, |
| 15 | Nudging this once. If someone else owns the req, a name is plenty. | Have a great rest of your day, |
| 16 | Following up briefly, and I will leave it here after this. | Hope your week goes well, |
| 17 | Quick check in on the application below. Still keen on it. | Have a good week, |
| 18 | One more note in case this is easier to answer today. | Wishing you a good day, |
| 19 | A short reminder about the message below, nothing more. | Enjoy the rest of the week, |
| 20 | Following up once, and no need to reply if it is not the right fit. | All the best, |

### Rendered

```
Hi Dana,

Following up once on my note below. Happy to be pointed elsewhere if this req is not yours.

Have a great day,
Henry Nguyen
```

---

# Part 3 — the referral ask

A different email from the recruiter one, because it is a different favour. A recruiter is
paid to read applications; an engineer is not, and what is being asked of them is to spend
their own credibility. The recruiter template opens with a number and asks for a look. This
one opens by admitting it is a cold note and asks for a name in a form.

```
Subject: {referral subject}

Hi {first name},

{open}  {company angle, if there is one}

I am Henry Nguyen, a Math and Computer Science student at Kenyon College,
and I have already applied for the {Short Role} role at {Company}. {applied line}

{lead}
  - {resume bullet}
  - {resume bullet}

{ask} {offer}

{close}
Henry Nguyen
hoanng15.work@gmail.com · linkedin.com/in/hoanng15 · github.com/henryng15

The posting: {link}
```

Seven beats: the cold-contact admission, who is writing and what was already applied to, a
clause introducing two numbers, the two numbers, the bolded ask with the easier favour beside
it, the close, and the posting link on a line of its own at the foot.

## Cold-contact openings

This first sentence is paired with the stored referral body-template number. All ten say only
that this is a brief cold note to someone at the company; the underlying ask and facts do not
change.

| # | Opening |
|---|---|
| 1 | We have not met before, but I came across your profile and saw that you work at {company}. |
| 2 | We have not spoken before, but I found your profile while learning more about {company}. |
| 3 | I do not know you personally, but I came across your work at {company}. |
| 4 | We have not met, but your profile came up while I was looking into {company}. |
| 5 | I came across your profile while researching {company}, although we have not spoken before. |
| 6 | This is a cold note, but I found your profile while learning about the team at {company}. |
| 7 | We have not connected before, but I noticed your work at {company} while researching the company. |
| 8 | I hope you do not mind a brief note from someone who found your profile while looking at {company}. |
| 9 | Although we have not met, I came across your profile while learning more about {company}. |
| 10 | This is the first time I am writing to you, after coming across your profile at {company}. |

**The graduation year is left out**, unlike the cold email. A recruiter is checking
eligibility for an intake and the year is the fact that decides it; the engineer is checking
nothing, and the room is better spent on the school and the subject.

**And no date.** The recruiter email names the day the application went because that is a fact
a recruiter can look up. The person being asked for a favour will not check, does not care, and
reads it as filler in a message that has already asked them for something.

**The link is at the foot, not in the sentence.** It used to sit inside the line naming the
role, which put a Workday URL, two lines of query string, exactly where the reader was working
out who was writing. Down at the bottom, labelled, it is out of the prose and easy to copy,
which is the only thing anybody ever does with it. A row without a usable link is never sent.

## The forty bodies (`REFERRAL_TEMPLATES`)

Four tiers of ten. The **tier** is how far above the writer the reader sits, resolved by
`outreachReferralTier_` from the job title first and ColdEmail's seniority column only as a
fallback — the column is empty on 361 of 2148 rows and calls a Software Engineer II junior.

| Tier | Who | Matched on |
|---|---|---|
| `peer` | interns, new grads, associates, SWE I | `intern`, `associate`, `junior`, `graduate`, `apprentice`, `i`/`1` |
| `mid` | the largest group by far, SWE II and III | nothing else matched, or `ii`/`2`, `iii`/`3` |
| `senior` | Senior, Lead, SWE IV | `senior`, `sr`, `lead`, `iv`/`4` |
| `staff` | Staff, Principal, Distinguished, Fellow, and managers up to VP | `staff`, `principal`, `distinguished`, `fellow`, `manager`, `director`, `head`, `vp`, `leader` |

Manager and director sit with staff. They are further from the work than a Principal engineer is,
but they are the same distance above an intern, and it is that distance the tier measures.

Read the four next to each other and **the ask shrinks as the reader gets more senior**: *"would you
be willing to refer me"* at peer, *"if you ever refer interns, would you consider doing it for me"*
at staff. That is the whole gradient. The staff openings are also the only ones that name the reach,
in half a sentence, once — a test refuses any `peer`, `mid` or `senior` template that admits it.

The tier moves exactly two things: how small the ask is, and whether the note admits it is reaching.
It does **not** move the number of apologies. Real humility in a cold email is being brief, being
specific and making the no easy; an extra self-deprecating sentence is not humility, it is an
invitation to agree that the email should not have been sent. Everything above the ask stays the
same length in all four tiers, because seniority is not a reason to write more.

Each row is four strings plus the lead-in. `open` is the cold-contact admission and nothing else;
`lead` introduces the bullets; `ask` is the one bolded request; `offer` is the easier favour beside
it — **every message offers to have the resume forwarded to whoever runs hiring**, because a
referral spends the reader's credibility and a forward spends nothing, and a reader who will not do
the first will often do the second.

New rows use the least-used live body within their tier. The company-seeded index only breaks a
tie; it does not allow a common body to keep being chosen while another is underused. The template
number is stored when the row is booked and is never changed under a queued or drafted row.


### Tier `peer`

| # | Opening | Lead-in | The ask | The offer | Close |
|---|---|---|---|---|---|
| 1 | We have never met, and I will keep this to a few lines. | Two things I have built that are closest to the work: | Would you be willing to **refer me**? | If it is easier to pass my resume to whoever runs hiring there, that helps just as much. It is attached. | Thanks for reading this far, |
| 2 | A short note from a stranger, and the only one I will send. | The two pieces of my own work I would point at: | May I ask you for **a referral**, even though this is the first you are hearing from me? | And if forwarding the attached resume to someone in recruiting is the easier favour, I would be just as grateful. | Have a good week, |
| 3 | This will take you under a minute. | Two things I have shipped that are nearest to it: | Would it be too forward to ask you for **a referral**, given that we have never spoken? | If pointing it at whoever handles intern hiring is simpler, that helps too. Resume attached. | Wishing you a good one, |
| 4 | We have not met, so I will be brief. | Two of my own projects that speak to the same problems: | Would you **refer me**? Please treat it as easy to refuse. | Or forward the attached resume to whoever owns this req, if that is the easier thing to do. | Thanks a lot, |
| 5 | A few lines and I will leave you to your day. | Two results from my own work that seem closest: | Might I ask you for **a referral**, even though we are strangers? | If passing the attached resume to someone in recruiting is easier, I would be grateful for that instead. | Have a great week, |
| 6 | We have never spoken, so I will say this quickly. | Two things I have built that are closest to what the team does: | Would you be open to **referring me**? | And if the simpler favour is forwarding my resume to hiring, please do that instead. It is attached. | Thank you for your time, |
| 7 | Short, and only this once. | The two results of mine I would put forward: | Would you **refer me**, knowing that I am a stranger asking? | If handing the attached resume to whoever runs this hire is easier, that would help just as much. | Hope your week goes well, |
| 8 | A few sentences from somebody you have not met, and no more. | Two things I have made that are near this work: | May I ask you for **a referral**? | Or send the attached resume on to someone in recruiting, if that costs you less. | All the best, |
| 9 | I will keep it short. | Two pieces of my own work that fit closest: | We have not spoken before, so a no is easy: would you consider **referring me**? | If forwarding it to whoever handles intern hiring is the easier route, I would be grateful. Resume attached. | Thanks for your time, |
| 10 | Only a few lines, I promise. | Two things I have built that come nearest to it: | Would you be willing to **refer me**, even though we have never met? | And passing the attached resume to someone in recruiting would help just as much, if that is simpler. | Have a lovely day, |

### Tier `mid`

| # | Opening | Lead-in | The ask | The offer | Close |
|---|---|---|---|---|---|
| 1 | We have never met, and I will be brief. | Two things I have built that are closest to the work: | Would you be open to **referring me**? | If it is easier to pass my resume to whoever runs hiring there, that helps just as much. It is attached. | Thanks for reading, |
| 2 | A short note on a working day, and I will keep it that way. | The two pieces of my own work I would point at: | Would it be presumptuous to ask you for **a referral**, given that we have never spoken? | And if forwarding the attached resume to someone in recruiting is the easier favour, I would be just as grateful. | Have a good week, |
| 3 | This will take a minute at most. | Two results from my own projects that seem nearest: | May I ask you for **a referral**, even though this is the first you are hearing from me? | If pointing it at whoever handles intern hiring is simpler, that helps too. Resume attached. | Wishing you a good week, |
| 4 | We have not met, and I will not take much of your day. | Two things I have shipped that are closest to it: | Would you **refer me**? Please say no freely. | Or forward the attached resume to whoever owns this req, if that is the easier thing to do. | Thank you for your time, |
| 5 | A few lines, and an easy one to ignore. | Two of my own results that speak to the same problems: | Might I ask a stranger for **a referral**? That is what this is, and I would be grateful. | If passing the attached resume to someone in recruiting is easier, I would be grateful for that instead. | Have a great week, |
| 6 | We have never spoken. Short and to the point, then. | Two things I have built that are nearest to the work of your team: | Would you consider **referring me**? | And if the simpler favour is forwarding my resume to hiring, please do that instead. It is attached. | Thanks either way, |
| 7 | I will keep this out of your way. | The two pieces of work of mine I would put forward: | Would you be willing to **refer me**, knowing that we have never met? | If handing the attached resume to whoever runs this hire is easier, that would help just as much. | Hope the week treats you well, |
| 8 | A short one from a stranger, and the only one. | Two things I have made that fit closest: | May I ask you for **a referral**? | Or send the attached resume on to someone in recruiting, if that costs you less. | All the best, |
| 9 | This is short. | Two results of my own that come nearest to it: | We have not met, so a no costs me nothing: would you consider **referring me**? | If forwarding it to whoever handles intern hiring is the easier route, I would be grateful. Resume attached. | Thanks for your time, |
| 10 | We have never met, and I will be quick. | Two things I have built that are closest to what you work on: | Would it be too much to ask you for **a referral**? | And passing the attached resume to someone in recruiting would help just as much, if that is simpler. | Have a good one, |

### Tier `senior`

| # | Opening | Lead-in | The ask | The offer | Close |
|---|---|---|---|---|---|
| 1 | I know an unexpected email is a claim on a busy day, so I will be brief. | Two things I have built that are closest to the work: | We have never met, so please refuse freely: would you consider **referring me**? | If it is easier to pass my resume to whoever runs hiring there, that helps just as much. It is attached. | Thank you for your time, |
| 2 | A few lines from somebody you have not heard of. | The two pieces of my own work I would point at: | Might I ask you for **a referral**? | And if forwarding the attached resume to someone in recruiting is the easier favour, I would be just as grateful. | Have a good week, |
| 3 | I appreciate that your inbox does not need one more stranger in it. | Two results of mine that seem nearest to it: | If it is something you ever do, may I ask you for **a referral**? | If pointing it at whoever handles intern hiring is simpler, that helps too. Resume attached. | Wishing you a good week, |
| 4 | Your time is the scarce thing here, so this is short. | Two things I have shipped that are closest to the same problems: | We have not met, which makes this presumptuous, but would you be willing to **refer me**? | Or forward the attached resume to whoever owns this req, if that is the easier thing to do. | Thank you sincerely, |
| 5 | A short note from a stranger, and I will not send a second. | Two pieces of my own work that fit closest: | May I ask you for **a referral**? | If passing the attached resume to someone in recruiting is easier, I would be grateful for that instead. | Thanks for reading this far, |
| 6 | I know this is the least welcome kind of email. | Two things I have built that come nearest to the work: | Would it be too much to ask you for **a referral**, given that we are strangers? | And if the simpler favour is forwarding my resume to hiring, please do that instead. It is attached. | Have a great week, |
| 7 | We have never spoken, so I will keep the ask small and the note shorter. | The two results of mine I would put forward: | Would you **refer me**? Please ignore this freely if not. | If handing the attached resume to whoever runs this hire is easier, that would help just as much. | Thank you for reading, |
| 8 | This costs you a moment you did not plan to spend, and I am sorry for it. | Two things I have made that speak to the same work: | Might I ask a stranger's favour and put my name to you for **a referral**? | Or send the attached resume on to someone in recruiting, if that costs you less. | All the best, |
| 9 | A cold note from a student, made plainly rather than dressed up. | Two pieces of my own work that seem closest: | We have never met, so a no is an easy answer: would you consider **referring me**? | If forwarding it to whoever handles intern hiring is the easier route, I would be grateful. Resume attached. | Thanks very much, |
| 10 | I know a senior inbox gets a lot of these, so here is mine in three lines. | Two things I have built that are nearest to it: | May I ask you for **a referral**, even though this is the first you are hearing from me? | And passing the attached resume to someone in recruiting would help just as much, if that is simpler. | Thank you for the time, |

### Tier `staff`

| # | Opening | Lead-in | The ask | The offer | Close |
|---|---|---|---|---|---|
| 1 | We have never met, and writing to somebody at your level is a reach on my part. | Two things I have built that are closest to the work: | I ask this knowing it is a lot: would you consider **referring me**? | If it is easier to pass my resume to whoever runs hiring there, that helps just as much. It is attached. | Thank you for the time either way, |
| 2 | This is aimed well above the level I am applying at, which I know is presumptuous. | The two pieces of my own work I would point at: | May I presume on somebody I have never met and ask for **a referral**? | And if forwarding the attached resume to someone in recruiting is the easier favour, I would be just as grateful. | Thank you sincerely, |
| 3 | Reaching this far up for an internship is a long shot and I am aware of it. | Two results of mine that seem nearest to it: | If it is something you ever do, and knowing we have never spoken, may I ask for **a referral**? | If pointing it at whoever handles intern hiring is simpler, that helps too. Resume attached. | Thanks very much for reading, |
| 4 | I am a little out of my depth writing this, and would rather say so. | Two things I have shipped that are closest to the same problems: | We have never met, so please refuse without a thought: would you be willing to **refer me**? | Or forward the attached resume to whoever owns this req, if that is the easier thing to do. | Thank you for your time, |
| 5 | You are several levels past where I am starting, so this is a bold note to send. | Two pieces of my own work that fit closest: | Might I ask you for **a referral**, knowing that we are strangers and that I am asking a lot? | If passing the attached resume to someone in recruiting is easier, I would be grateful for that instead. | All the best, and thank you, |
| 6 | A slightly nervy note, given the distance between your role and the one I want. | Two things I have built that come nearest to the work: | We have never spoken, which makes this presumptuous, but would you consider **referring me**? | And if the simpler favour is forwarding my resume to hiring, please do that instead. It is attached. | Thank you for the moment this took, |
| 7 | Writing to somebody this senior about an internship feels like a stretch. | The two results of mine I would put forward: | May I ask a stranger's favour of you and request **a referral**? | If handing the attached resume to whoever runs this hire is easier, that would help just as much. | Thanks very much, |
| 8 | This is aimed higher than it probably should be, and I sent it anyway. | Two things I have made that speak to the same work: | We have never met, so ignore this freely: would you be open to **referring me**? | Or send the attached resume on to someone in recruiting, if that costs you less. | With thanks for the read, |
| 9 | I know an intern application is well below what usually reaches you. | Two pieces of my own work that seem closest: | Knowing that we have never spoken, may I still ask you for **a referral**? | If forwarding it to whoever handles intern hiring is the easier route, I would be grateful. Resume attached. | Thank you sincerely for reading, |
| 10 | Writing to somebody a long way ahead of me, which I recognise is a liberty. | Two things I have built that are nearest to it: | We have never met and I am asking a great deal, but would you be willing to **refer me**? | And passing the attached resume to someone in recruiting would help just as much, if that is simpler. | Thanks for the time, |

## The thirty six subjects (`REFERRAL_SUBJECTS`)

Thirty six, and deliberately **not** the cold email's trick. That subject is a bare number written
so it is not yet explained, because a recruiter's inbox is a competition for the open. This one goes
to an engineer who is not expecting mail about hiring at all, and a teaser subject on an unexpected
favour reads as marketing.

So almost every one says *referral*, and that is the hook rather than a label: naming the ask lets
the reader decide in the preview pane, which is the respectful version of the transaction. The
reader who would say no spends two seconds instead of ninety.

Thirty six rather than ten because a repeated subject across two people at one company is the
pattern a spam filter is actually built to notice. Each stays under 66 characters with the longest
company and role in the dataset substituted in. `{company}` and `{role}` are filled at compose time.
None of them is clever: a joke in the subject of a request for a favour asks the reader to be amused
before they have agreed to be interested.

| # | Subject |
|---|---|
| 1 | A non target student asking about a referral |
| 2 | Referral ask from a school you have not heard of |
| 3 | Non target student, big dream, small ask |
| 4 | A referral ask I know is a long shot |
| 5 | Referral ask: no network, a few real numbers |
| 6 | One referral ask from a Kenyon College student |
| 7 | A small referral ask with a big dream behind it |
| 8 | Non target student asking about a referral |
| 9 | Referral ask for {role} |
| 10 | A long shot referral ask about {company} |
| 11 | Would you consider a referral at {company}? |
| 12 | Referral ask from a liberal arts CS student |
| 13 | A referral ask, and no reply needed if not |
| 14 | Non target student hoping for a referral |
| 15 | A referral ask, honestly a long shot |
| 16 | One quiet referral ask from a 2028 student |
| 17 | A big dream and a two minute referral ask |
| 18 | Referral ask from outside the usual pipeline |
| 19 | A referral ask that should take you two minutes |
| 20 | Asking a stranger for a referral, briefly |
| 21 | Referral ask, and I know how it sounds |
| 22 | A student with no connections asking for a referral |
| 23 | Referral ask for a summer role at {company} |
| 24 | Long shot referral ask, short email |
| 25 | A referral ask from someone starting from zero |
| 26 | Non target student, one referral ask |
| 27 | A hopeful referral ask about {company} |
| 28 | Small referral ask from a Kenyon student |
| 29 | A referral ask, respectfully and briefly |
| 30 | Asking about a referral, with no claim on your time |
| 31 | Referral ask from a student who admires the work |
| 32 | A referral ask from someone who follows {company} |
| 33 | Referral ask: small school, serious about this |
| 34 | One referral ask, and I will not write again |
| 35 | A referral ask from far outside your usual pool |
| 36 | Referral ask: 2028 graduate, summer internship |

## The applied line (`REFERRAL_APPLIED_LINES`)

The sentence naming the role reads **"I have already applied for the X role at Y"**, and one of
these follows it.

Every row on the `Referral` tab comes from an application actually made, so the email says so. It
did not always: while this path read the crawler's `Jobs` tab there was often nothing applied to yet
and *"applying for the role"* was the honest wording. Against the `App` tab the same words are the
same falsehood pointing the other way.

Saying it out loud rather than leaving it implied, because implied is where the reader supplies the
expensive version: that their name is wanted for somebody who has not bothered to apply.

Once the email says the application is in, the reader's next question is immediate and fair, and
these ten are the answer. **The register is the constraint.** One sentence, under twenty words, and
none of them argues. The two failure modes are both a line longer than they need to be: defensive
("I am not trying to skip the queue, but") makes the reader wonder who accused the writer of it, and
aggrieved ("I would rather not be left in the pile") asks a stranger to fix a system on the writer's
behalf. What is left when both are cut is the humble version, which is also the short one.

| # | Line |
|---|---|
| 1 | It is already in, and I am writing only in the hope that it reaches a person. |
| 2 | That part is done. What I am hoping for is that it is read rather than filtered. |
| 3 | It sits with a few thousand others, which is the only reason I am writing to you. |
| 4 | I would not ask you to shorten any of that, only to help it be seen. |
| 5 | It is in the system, and I am hoping a referral gives it a chance of being read. |
| 6 | It went in a while ago, and I am writing in the hope of it reaching a person. |
| 7 | I have taken the ordinary route, and a referral is the one part I cannot do myself. |
| 8 | I am not asking for anything to be skipped, only for what I sent to be seen. |
| 9 | It is in, and a referral is the one thing that might lift it out of the pile. |
| 10 | That is the process and I have followed it. The rest is not in my hands. |

## Which two numbers a company earns (`REFERRAL_BULLET_ORDER`)

Which two numbers a company earns, chosen by **what the company does** rather than by who is
reading: a Staff engineer at Stripe and a new grad at Stripe both care about the payments number,
and the tier is already doing its own job on the wording.

Twelve keys per bucket, read as six pairs, one per person a company is allowed. It was six keys and
three pairs while three people were the limit; raising it to six without this would have had the
fourth, fifth and sixth person repeat the first three lists. That mattered little while six people
were spread over six days and matters a great deal now they can arrive on one morning.

| Bucket | Pair 1 | Pair 2 | Pair 3 | Pair 4 | Pair 5 | Pair 6 |
|---|---|---|---|---|---|---|
| `ai` | `rag` + `mcp` | `freshness` + `coverage` | `polars` + `locks` | `calibration` + `webhooks` | `cves` + `lambda` | `menulens` + `integrity` |
| `data` | `polars` + `mcp` | `freshness` + `calibration` | `rag` + `lambda` | `coverage` + `locks` | `webhooks` + `cves` | `integrity` + `menulens` |
| `fintech` | `webhooks` + `locks` | `lambda` + `cves` | `coverage` + `mcp` | `freshness` + `polars` | `rag` + `integrity` | `calibration` + `menulens` |
| `cloud` | `locks` + `freshness` | `webhooks` + `coverage` | `mcp` + `rag` | `lambda` + `polars` | `cves` + `calibration` | `integrity` + `workspaces` |
| `security` | `cves` + `integrity` | `coverage` + `webhooks` | `locks` + `mcp` | `freshness` + `rag` | `lambda` + `polars` | `calibration` + `menulens` |
| `hardware` | `freshness` + `locks` | `polars` + `lambda` | `coverage` + `mcp` | `calibration` + `webhooks` | `cves` + `rag` | `integrity` + `menulens` |
| `consumer` | `menulens` + `coverage` | `locks` + `webhooks` | `rag` + `polars` | `mcp` + `freshness` | `calibration` + `lambda` | `cves` + `workspaces` |
| `edtech` | `workspaces` + `coverage` | `mcp` + `menulens` | `locks` + `polars` | `rag` + `freshness` | `calibration` + `webhooks` | `lambda` + `integrity` |
| *(none)* | `mcp` + `polars` | `locks` + `coverage` | `rag` + `webhooks` | `freshness` + `calibration` | `cves` + `lambda` | `menulens` + `integrity` |

## A full referral, rendered

Tier `mid`, template 5, bucket `consumer`, first person at the company.


```
Subject: Would you consider a referral at Reddit?

Hi Priya,

A few lines, and an easy one to ignore.

I am Henry Nguyen, a Math and Computer Science student at Kenyon College, and I have already applied for the Software Engineer Intern role at Reddit. It is in the system, and I am hoping a referral gives it a chance of being read.

Two of my own results that speak to the same problems:

  - Matched a 480-dish catalog to calorie, protein and budget targets, returning the top 5 in under 300ms.
  - Raised checkout test coverage from 34% to 82% with a Vitest pipeline that blocks failing pull requests.

Might I ask a stranger for a referral? That is what this is, and I would be grateful. If passing the attached resume to someone in recruiting is easier, I would be grateful for that instead.

Have a great week,
Henry Nguyen
hoanng15.work@gmail.com · linkedin.com/in/hoanng15 · github.com/henryng15

The posting: https://job-boards.greenhouse.io/reddit/jobs/7123456
```


---

# Changing one safely

```bash
node apps_script/outreach/harness.js       # 574 assertions, sends nothing
```

Then log a real render before anything goes out. All three preview functions send nothing:

| Function | File | Logs |
|---|---|---|
| `previewOutreachEmail()` | `outreach_send.gs` | one cold email |
| `previewOutreachFollowUps()` | `outreach_followup.gs` | all 20 follow-ups |
| `previewReferralTemplates()` | `outreach_referral.gs` | every tier and every template |

Then push, and **verify by pulling the live project back and diffing it** rather than by trusting
what `clasp push` printed:

```bash
cd apps_script/outreach && clasp push
```

Before pushing, copy `.clasp.json` into a scratch directory, `clasp pull` **there**, and diff the
pulled `.js` against the repo's `.gs` — that catches edits made in the web editor that never
reached git. Pulling into the repo itself overwrites local work.

---

## Appendix — the retired v1 template

ColdEmail's `src/process9_emails.py` assembled a full email per recruiter into
`finals/9_emails.csv`. It has been superseded by `outreach_compose.gs` and nothing sends from it
any more, but it is what the first version of the message looked like: one subject for everyone,
prose paragraphs rather than labelled bullets.

```
Subject: Applied for Software Engineer Intern (Summer 2027) — Henry Nguyen, Kenyon College '28

Hi {first name},

{company angle}

I'm a Math and Computer Science student at Kenyon College, and I
applied for the Software Engineer Intern role on {date}.

Two things from my resume that seem most relevant:
- {resume bullet}
- {resume bullet}

{ask}

Thanks for your time,
Henry Nguyen
linkedin.com/in/hoanng15  |  github.com/henryng15
```

Its two asks:

| Focus | Ask |
|---|---|
| `university` | Would you be able to take a look at my application — or point me to the right person if the 2027 intern cohort isn't yours? |
| everyone else | Would you be able to take a look at my application — or point me to the right person if SWE intern hiring isn't your team? |

Three things changed on the way to the current template, and each is worth keeping in view:

- **The subject stopped describing the email and started earning the open.** `Applied for
  Software Engineer Intern (Summer 2027)` is true, complete, and gives a recruiter on a phone no
  reason to tap it.
- **The paragraphs became labelled sections.** The v1 body opens with the company angle and
  buries the application — the strongest fact in the message, and the only one the reader can
  verify in their own system — in the middle of a wall of prose.
- **One template became ten.** v1 sent the same subject to three people at one employer.
