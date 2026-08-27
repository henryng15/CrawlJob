# Email templates — every subject line and every body that can go out

One skeleton, ten variations. This page is the full catalogue: the subject line of each
variation, the bullets it carries, the ask it closes with, and the two sentences that are written
per recipient rather than chosen from a list. [outreach.md](outreach.md) covers *when* an email
is sent and to whom; this page covers *what* is in it.

Nothing here is a summary of the code. Every string below is verbatim from the file named beside
it, so a change to one has to be a change to both.

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
  • I am Henry Nguyen, a Math and Computer Science student at Kenyon College
    (class of 2028, 4.0 GPA).
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
| `SENDER_STUDY` | `a Math and Computer Science student at **Kenyon College** (class of 2028, 4.0 GPA)` |
| `SENDER_LINKS` | `hoanng15.work@gmail.com · linkedin.com/in/hoanng15 · github.com/henryng15` |
| Sign-off | `Thanks either way,` |
| Attachment | `Henry_Nguyen_Resume.pdf`, 110 KB, from Drive |

Bold carries exactly two things: the numbers in the intro bullets, and the request itself in the
ask. Bold on a third thing is bold on nothing.

**No dashes anywhere** — not in a subject, not in a bullet, not in the ask. Text arriving from
ColdEmail does use them, and `outreachNoDashes_` turns each into a full stop on the way in.

## The ten variations

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

## Which variation a contact gets

`outreachVariantOrder_` builds an ordered list, best first, and the attempt number indexes into
it. The list is **ordered, not picked**, so attempts 2 and 3 — different people at the same
employer — take the next one down and never repeat a subject.

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

## Appendix — the retired v1 template

ColdEmail's `src/process9_emails.py` assembled a full email per recruiter into
`finals/9_emails.csv`. It has been superseded by `outreach_compose.gs` and nothing sends from it
any more, but it is what the first version of the message looked like: one subject for everyone,
prose paragraphs rather than labelled bullets.

```
Subject: Applied for Software Engineer Intern (Summer 2027) — Henry Nguyen, Kenyon College '28

Hi {first name},

{company angle}

I'm a Math and Computer Science student at Kenyon College (class of 2028), and I
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
