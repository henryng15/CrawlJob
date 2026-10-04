# When two rows are one job

The same posting arrives from five different trackers, each writing it its own way. Deciding
"these two rows are one" has to answer two very different questions, and **those two questions
must not share one rule**:

| Question | Used for | Cost of getting it wrong |
|---|---|---|
| Are two `Jobs` rows one job? | **deleting a row** | a real opening lost, and never known about |
| Is this `Jobs` row already in `App`? | **ticking a box** | a note in column H undoes it |

Because the damage is that lopsided there are three layers, loosening as they go, and the
loosest one is **never** used to delete.

---

## Layer 1 — by link (`normalize_link`)

The strictest and the most certain. Two URLs that reduce to the same string are one posting.

Four things are dropped:

**Tracking params** — `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`,
`utm_term`, `ref`, `gh_src`, `src`. Simplify appends `?utm_source=Simplify&ref=Simplify` to the
very link speedyapply leaves bare.

**Params that only change how the page renders** — `embed`, `mobile`, `needsredirect`. They
change how the page draws itself, not which page it is.

**A trailing `/application` or `/apply` path segment** — some trackers link the apply form,
others the posting sitting right above it. Ashby hangs the form off `/application` and Lever
off `/apply`, both one segment under the same id:

```
jobs.ashbyhq.com/replit/7e0dafe8-.../application?embed=true&utm_source=Simplify
jobs.ashbyhq.com/replit/7e0dafe8-...
```

The two Replit rows that once sat in the sheet together were this pair. This rule on its own
merged **15 pairs**.

There is a guard: a path that is nothing but `/apply` is not cut, because cutting it would
leave a bare host and merge everything on that host into one.

**`gh_jid` where it repeats the id already in the path** — Greenhouse writes the id in both
places:

```
boards.greenhouse.io/spacex/jobs/8621757002?utm_source=Simplify
boards.greenhouse.io/spacex/jobs/8621757002?gh_jid=8621757002
```

Dropped conditionally rather than outright: the embedded form `/embed/job_app?gh_jid=...` has
**no** id in the path, and dropping `gh_jid` there would merge every posting on that board into
one row.

## Layer 2 — by conservative `(company, role)` identity (`company_identity`, `role_identity`)

For postings whose links genuinely do differ — jobright mirroring a company's board, say.

Company legal-form words are ignored only when the remaining complete token set is identical;
`Acme` and `Acme Robotics` remain separate. Role identity also settles the word endings and
common acronyms two sources write differently while describing one job:

```
engineering, engineers  → engineer
internship, internships, interns → intern
development, developers → developer
swe, sde → software engineer
```

**Word order is ignored, while the intake and descriptive words stay.** This catches a
reordered repost without merging a Backend/Platform specialization or two intakes:

```
Notion — Software Engineer Intern (Summer 2027)
Notion — Software Engineer Intern (Winter 2027)
```

Two different intakes. A rule loose enough to merge them **deletes a real opening**. The same
goes for SpaceX (Spring / Summer), Melius (Fall/Winter / Spring/Summer), Heliux. A test pins
it: `test_two_intakes_are_not_merged_out_of_the_sheet`.

Where two rows share an identity, which one to keep is decided by the priority order in
`_preference`:

1. A row already carrying a tick or a note of yours — wins outright.
2. The company's own link, rather than an aggregator's redirect.
3. Whichever came first.

## Layer 3 — by word set (`role_tokens`) — **only for ticking, never for deleting**

Word order goes too, along with the year (`20\d\d`) and the season (`summer`, `fall`, `winter`,
`spring`, `program`). The two sides are compared as sets.

This layer is needed because the two tabs describe one job from opposite ends:

```
App  — "2027 Internship - Software Engineer"
Jobs — "Software Engineer Intern - Software Engineer"
        → both are {engineer, intern, software}
```

This is the Virtu Financial case: plainly applied to, and nothing would tick it until this
layer existed. Layer 1 missed it (applied through the company career site, while Jobs holds a
different link) and layer 2 missed it too (different word order).

It is loose, but still not careless: one distinguishing word is enough to make it not match.
`Frontend Developer Internship` ≠ `Software Engineer Intern`.

### The known trade-off of layer 3

Because the season is dropped, a `Jobs` row belonging to a **different intake** can be ticked
from an `App` row that names no intake. On the last run, 2 of the 9 rows matched by name fell
into this category:

```
Figma    — Software Engineer Intern - Winter 2027
Deepgram — Software Engineering- Internship - Fall 2026/Summer 2027
```

This is a deliberate trade-off, not a bug: dropping the year is precisely what makes Virtu
match. Keeping the season would avoid the two cases above, but would then miss the `App` rows
that do name a season where `Jobs` does not.

The current choice leans towards **ticking more**, because an extra tick has a way back (a note
in column H) while a miss tells you nothing. To lean the other way, drop `ROLE_NOISE` from
`role_tokens`, one line — Virtu still matches, since all it needs is the year gone.

Every row ticked by layer 3 is named in the Actions log, exactly so it can be checked:

```
Ticked by company and role: Virtu Financial — Software Engineer Intern - Software Engineer
```

---

## Why `Applied` does not use layer 3 when you tick it yourself

When you tick `Applied` by hand, Apps Script dedupes **by link** only, not by name. You have
just genuinely applied; a row skipped as a "name duplicate" is **a lost record**, which is far
worse than one extra row in `App`.

A small consequence: a row the tool ticked by name will create a new `App` row if you untick it
and tick it again by hand.
