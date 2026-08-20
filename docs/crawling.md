# Where jobs come from, and when a row disappears

## Sources

[`sources.toml`](../sources.toml) lists the public trackers, each one a raw
Markdown file on GitHub. Adding a `[[sources]]` block is the whole job — no code
change needed.

| Tracker | Notes |
|---|---|
| Simplify / Pitt CSC — Summer 2027 | |
| sndsh404 — Summer 2027 | |
| speedyapply — 2027 SWE College Jobs | |
| zshah101 — 2027 / Fall 2026 Tech Internships | |
| Jobright — 2026 Software Engineer Internship | no separate Apply column; the link sits inside the Job Title cell and is a `jobright.ai` redirect, not the company's own board URL |

This is a baseline list; there is no reliable way to claim it covers *every*
tracker repo on GitHub.

One broken tracker does not kill the whole sync run: errors are caught per source,
printed as `WARNING`, and the remaining sources still run. Only when **no source at
all** parses out a job does that run fail.

## The second source: the company's own ATS

The Markdown trackers cover already-famous programmes well and cover startups
almost not at all — a company has to be famous enough that somebody volunteers to
type its name in. Those startups do post, on the **applicant tracking system** they
use to receive applications, over public JSON endpoints that need no key.

| ATS | endpoint | date comes from |
|---|---|---|
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{slug}/jobs` | `first_published` |
| Lever | `api.lever.co/v0/postings/{slug}?mode=json` | `createdAt` (epoch ms) |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{slug}` | `publishedAt` |

The boards are read **before** the trackers, and that order means something:
`dedupe_jobs` keeps the first copy of each link it meets, so whichever side comes
first is the side that describes every posting appearing in both places. The board
describes it better on exactly two counts worth caring about — the date is when the
employer published rather than when a volunteer noticed, and the name in the
`Source` column says where the posting actually lives.

Three things make them **better** than the trackers, not merely more of them:

- The link is the employer's own board, so it does not rot the way an aggregator
  redirect does.
- The date is the board's `first_published`, not the day a volunteer noticed.
- A four-person startup stands on the same footing as a forty-thousand-person
  company.

### There is no way to get all of them

Verified, not guessed: **no ATS lets you list boards.** No listing endpoint, no
usable sitemap (`job-boards.greenhouse.io/sitemap.xml` returns 404,
`jobs.ashbyhq.com/sitemap.xml` returns HTML rather than XML).

And the archives do not cover everything either. Verition Group has a real
Greenhouse board with real open jobs that Common Crawl has **never once fetched**:

```
boards.greenhouse.io/veritiongroupllc*      No Captures found
```

A board is only in an archive if something once linked to it. A board nobody links
to cannot be found by machine at all. So the system pools slugs from four sources,
each plugging a different kind of hole:

| source | what it gives | which hole it plugs |
|---|---|---|
| `data/extra_boards.txt` | written by hand | the board nobody knows about — the only escape hatch |
| links inside the trackers | 83 slugs, 26 of them new | a board a tracker has just posted that the archive has not caught up with |
| Common Crawl (via a repo) | 15,862 slugs | breadth |
| `yc-oss/api` | YC companies currently hiring | startups |

### Knowing which boards exist

That is the hard part, and it lives in [`scripts/discover_boards.py`](../scripts/discover_boards.py).
Slugs come from four lists of **names**, not from scraping anybody's pages:

- **`job_sync/data/extra_boards.txt`** — written by hand, one `<ats>:<slug>` per
  line. A separate file so the weekly rebuild can never drop one. See a board
  missing, add a line; it is asked on the very next crawl, not after waiting for
  Sunday.
- **The links the trackers themselves post** — free, accurate, self-growing.
  Whichever company a tracker adds today brings that company's board along today.
- [`Feashliaa/job-board-aggregator`](https://github.com/Feashliaa/job-board-aggregator) —
  15,862 slugs, harvested from the Common Crawl index of public ATS URLs.
  The data is **CC BY-NC 4.0**; the attribution is written straight into the output
  file, and this tracker is personal and non-commercial.
- [`yc-oss/api`](https://github.com/yc-oss/api) — YC companies currently hiring,
  rebuilt daily from YC's own Algolia index. Only slugs the lists above do not
  already have are tried.

### Why it is split into two tiers

A sync run cannot ask 19,899 boards seven times a day — that is half a month of
Actions minutes spent on companies that have never taken an intern. So:

| | frequency | scope | keep criterion |
|---|---|---|---|
| `discover_boards.py` | weekly, its own workflow | all 19,899 | boards **advertising an internship in any field** |
| `boards.py` | **every scheduled run**, every 90 minutes from 09:00 to 18:00 ET | the 903 boards in the shortlist | roles matching `roles.py` |

First measurement (2026-08-19): 9,062 boards still alive, **902** hiring interns,
of which **312 roles matched** the SWE filter. Asking all 903 boards takes
**36 seconds**.

The first tier's criterion is "does this company take interns at all" rather than
"does it have an SWE intern today" — a company that has already run an intern
programme is a company that could post an SWE intern next week.

The trade-off: a new posting at a company that **already** takes interns is caught
within ninety minutes; a company opening a programme for the first time, within a
week. Said out loud here instead of hidden inside a number.

Why every run rather than a chosen two of them: the cost is not Actions minutes —
36 seconds nearly vanishes into GitHub rounding a run that already takes 4.1
minutes up to the whole minute. The cost is **903 requests against somebody else's
API**, every run. But gating them would have made the tighter schedule a gesture:
the trackers are five Markdown files a volunteer edits once or twice a day, so a
run reading only those turns up what the run before already had. The boards are the
half that changes hourly, and the only half that reports the date a posting went
up.

What that traffic comes to: 903 boards × 7 runs = **6,321 requests a day**, split
greenhouse 467 / ashby 251 / lever 185 — 0.038 requests a second averaged against
Greenhouse, the busiest of the three hosts. Seven runs ninety minutes apart hold
the worst-case lag at ninety minutes, where a morning-and-afternoon pair held it at
about six hours.

There is no hour list to edit any more: every scheduled run asks the boards, and
`--no-boards` is how you skip them for a single run. Need one now, press **Run
workflow**: a manual run skips the window check and always crawls.

The shortlist lives in `job_sync/data/ats_boards.json` and travels with the wheel
through `package-data`. A missing file means the feature is off, and the sync still
runs on the Markdown trackers as before. Bypass it with `--no-boards`.

## The "inside the US" filter

The Markdown trackers are US lists by their nature — the people curating them are
working for readers in the US. ATS boards are **not**: a board is every job a
company has open anywhere. The first crawl showed **137 of 312 roles (44%)**
outside the US — Munich, Singapore, London, Auckland, Berlin, Ho Chi Minh, Taipei,
Colombia, Toronto.

[`places.py`](../job_sync/places.py) reads the location line. It is **prose, not a
field**: `San Francisco`, `New York, NY`, `Austin, Texas, United States; South San
Francisco, California, U`, `Colombia, Remote` are all real values from one crawl.
There is no way to be exactly right.

So the rule is deliberately **lopsided**, because the two kinds of mistake do not
cost the same:

> Wrongly dropping a US internship is **invisible** — that row simply never
> appears, and nobody can miss what they never saw. Wrongly keeping a job in Berlin
> costs exactly one glance.

So: **keep, unless the text says otherwise.**

1. A state name, a state code, or the words `United States` / `USA` → **keep**,
   settled there and then. Runs first so `Vancouver, WA` is not mistaken for
   Vancouver BC.
2. Only when there is none of that, check for a country / city / region certainly
   not in the US → **drop**.
3. Everything else → **keep**. A bare US city with no state (`San Francisco`) is
   the most common case, and it lands in this branch.

An empty location cell is also **kept**: a board that has not said where the job is
has not said the job is abroad.

State codes only match against the **original** string, not a lowercased one —
`IN`, `OR`, `ME`, `OK`, `HI`, `DE`, `LA`, `PA` are all ordinary English words, and
folding case would turn "Remote **in** Europe" into Indiana and then keep it.

Lever alone has a `country` field holding an **ISO-3166 code** (`US`, `GB`, `KR`,
`JP`…) — the one unambiguous location field across all three APIs, so it is read
before anything has to be guessed out of prose.

### Non-US rows that already made it into the sheet

The sheet **cannot work it out for itself**: the Jobs tab has no location column,
and by the time a posting has become a row the only thing left is the link. The
board is the only thing that knows, and it only knows while the posting is still
up.

So every crawl also returns **the set of links for roles that matched but sit
abroad**, and `_drop_foreign_rows` takes them out of the sheet by the same
normalized link dedupe uses. That is how a filter added today takes back what
yesterday's run wrote in.

Removed outright rather than kept as a tombstone the way Applied/Expired rows are:
a tombstone exists to stop a job being appended a second time, and a posting that
fails the location test was never in the set to be appended in the first place.

**A row you have written into is not touched.** Ticking Applied for a job in London
is a decision, and this has no authority to reverse it — the same rule that lets a
note in column H block an auto-tick.

## Which roles are kept

[`roles.py`](../job_sync/roles.py) holds all the regexes. A role must satisfy
**both**:

1. It has `intern`, `internship`, `co-op`, `placement`, `student`,
   `summer analyst`, or **both** `summer` and `analyst` anywhere in the title.

   Banks and funds never use the word *intern*. Verition posts
   "2027 Technology Internship (US)"; the same position elsewhere is called
   "Technology Summer Analyst" — one applicant, one job, and one of the two used to
   be invisible here. Widening this is only safe because the second half still has
   to agree: "Investment Banking Summer 2027 Analyst" carries no technical word and
   is still rejected.
2. It matches one of the families: software engineering/engineer/developer/dev/SWE/SDE;
   frontend, backend, full-stack, web, mobile, iOS, Android; platform,
   infrastructure, production infrastructure, developer experience; cloud/cloud
   operations, DevOps, SRE, build/release, MLOps; embedded, firmware, systems,
   application; FDE/forward deployed; ML/data platform engineer; quantitative
   developer.

   And **the family name standing alone is enough too**: `technology`, `cloud`,
   `infra`/`infrastructure`, `devops`, `software`, `ai` / `artificial intelligence`
   / `generative ai` / `llm`, `machine learning` / `deep learning`, `ml` / `mlops`,
   `programming` / `coding`.

   Letting the family name stand alone is deliberate. A company writing "Cloud
   Intern" or "AI Summer Analyst" is naming exactly what this tracker looks for;
   making them also write "engineer" only filters out the ones who keep their titles
   short. Finance even names a whole function "Technology" instead of naming the
   discipline, so there is no second word to anchor on there.

   It **only holds up because the internship half still has to agree**. "Cloud
   Solutions Architect", "Head of AI" and "Senior Machine Learning Engineer" all
   carry no intake word and stay out. Without that half, every family name would
   drag in the entire senior headcount of every company on the list.

   The known price: `Cloud Sales Intern`, `Marketing Technology Intern`, or an
   `Infrastructure` position that turns out to be civil engineering. Each one is a
   row to glance past and drop. Tightening it would take an exclusion list (sales,
   marketing, recruiting) — which would start rejecting "Sales Engineering Intern"
   along with the rest.

   Measured on real data: loosening to `technology` + `summer analyst` recovers
   **37 roles**; loosening further to `cloud` / `infra` / `devops` / `ai` / `ml`
   recovers **154 roles** more — the total through the filter goes from 421 to
   **561**.

To loosen or tighten, edit that file; the pipeline does not need to know.

## Where `Date Posted` comes from

In priority order:

**From the ATS board** — accurate, always there:

| Greenhouse | `first_published`, falling back to `updated_at` |
|---|---|
| Lever | `createdAt`, epoch ms read as UTC |
| Ashby | `publishedAt` |

Greenhouse uses `first_published` rather than `updated_at`: the latter jumps every
time somebody fixes a typo in the description, and this column is the sort column —
one corrected typo would push a month-old posting to the top of the list of work
still to do.

All three are read as UTC, or the date half of the ISO string is sliced straight
off rather than parsed and reformatted: the runner runs on UTC and you are on ET,
and one posting must not carry two different dates depending on who ran the sync.

**From the Markdown trackers** — in priority order:

1. The tracker's `Added` / `Posted` column, if it has one.
2. If the tracker records only an age (`3d`, `2mo`), convert that into a date.
3. If neither is there, use **the date the tool first saw that job**.

The date is always ISO `YYYY-MM-DD` because sorting compares it as a string — which
is also why columns A–D have to be written with `RAW`, see
[spreadsheet.md](spreadsheet.md).

There is a cutoff: jobs posted before **2026-01-01** are skipped. Change it with
`--since`.

That cutoff is needed. Trackers and boards hold on to old postings far longer than
you would expect — one real crawl dug up a matching role posted in **October 2016**
whose link still opened. Without a cutoff the sheet takes in a decade of history.

It used to be **2026-07-01**, and that was too tight. A board dates a posting from
when it went up, and this season's roles — Fall 2026, Spring 2027, Summer 2027 —
start appearing in the spring. At the July cutoff it was cutting Palantir, Optiver
and Rippling postings from the last week of June, all still open.

January keeps the whole 2026 posting year and drops the previous season outright.
In exchange, it takes in some postings a board never takes down. The `Expired`
column exists for exactly that kind — **an old row you tick away beats an open role
you never see.**

## When a row is deleted from `Jobs`

Three reasons, and only three:

1. **The board says the posting is closed** — see below.
2. **The company is on the do-not-track list** — currently TikTok and ByteDance.
   Their boards return 200 even for a requisition that never existed, so their rows
   would never clean themselves up. Once blocked, old rows are removed too, not just
   new ones stopped.
3. **It duplicates another row** — see [matching.md](matching.md).

Your ticks and notes from column F onward are **not** a reason to keep or delete a
row, except that they win when choosing which of two duplicate rows to keep.

## Liveness: asking the board whether a posting is still open

Most job boards return HTTP 200 whether the posting is there or gone, because the
page is only an empty shell and the content arrives afterwards over JavaScript. So
a status code on its own decides almost nothing, and
[`liveness.py`](../job_sync/liveness.py) asks in three different ways:

- **Workday** — there is a JSON endpoint hiding behind the same path. It returns
  404 once the requisition is taken down.
- **Jobright** — renders the title server-side. When a posting is gone the title
  falls back to the site name.
- **Everything else** (Greenhouse, Lever, Ashby, workatastartup) — an honest 404.

Three layers of protection against deleting the wrong thing:

- **What cannot be read is not deleted.** A board returning 200 for an id that does
  not exist is a board with no verdict; the result is `UNKNOWN` and the row is
  **kept**.
- **Ask a second time.** Hit with 16 parallel requests, Jobright once returned the
  generic shell for 41 of 83 live postings — all of which came back alive when asked
  on their own. So hosts are scanned in parallel with each other but sequentially
  within a host, and any row that still looks dead is asked once more before it is
  deleted.
- **A cell that is not a link is not asked.** A note or a stray full stop is not a
  posting at all.

### Measured in practice

Scanning 291 links from a recent run:

```
alive = 267      dead = 8      UNKNOWN (kept) = 16
```

The 16 with no verdict are mostly Workday tenants not answering. Beyond that, the
content of 142 non-Workday/Jobright pages was downloaded looking for "no longer
accepting", "position has been filled" and the like — and **not one page had any of
them**, meaning these boards really do 404 when a posting expires rather than
returning 200 and hiding it.

The rest is a human's job: tick [the `Expired` column](spreadsheet.md#column-g--expired)
for postings that closed in a way the machine cannot read.
