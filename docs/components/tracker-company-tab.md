# company_tab.gs — the Company tab

Which employers worth asking for a referral have opened a role yet, and which of them
already answer the visa question.

## Connections

- **Reads:** the `Jobs` tab and the hidden sender-maintained `Referral Seed Counts` snapshot in the tracker.
- **Writes:** the `Company` tab, and nothing else.
- **Runs:** a time-based trigger, `syncCompanyTab`, every 15 minutes.

The sender refreshes the hidden snapshot after each `Employees (seed)` export. It contains one
row per company and the remaining unique non-invalid DeBounce address count, after deducting
addresses already reserved or used by the Referral tab, allowing this bound script to read
the complete referral pool without needing cross-account access to the contacts spreadsheet.

It shares no constant and calls no function from `sync_applied_to_app.gs`. That is the point
of it: every other tab here is owned by a scheduler that reorders it, and this file is not
allowed to become the second writer of any of them.

It defines **no `onEdit`**. Apps Script binds exactly one per project and silently keeps
whichever definition loaded last, so a second one in this file would take the tracker's with
it. The `Asked` checkbox needs no handler — the sweep reads it back before every rewrite.

## The layout

Two independent blocks of seven columns, back to back: **A:G** and **H:N**.

| | 1st col | 2nd | 3rd | 4th | 5th | 6th | 7th |
|---|---|---|---|---|---|---|---|
| **A:G** | 173 employers that certified a **Software Engineer H-1B in FY2025** | sendable referral emails | `Summer?` | `Asked` | `LinkedIn` | `Email subject` | `Email body` |
| **H:N** | the other 70 employers on the shortlist | sendable referral emails | `Summer?` | `Asked` | `LinkedIn` | `Email subject` | `Email body` |

The blocks are defined by `COMPANY_BLOCK_WIDTH`, not pinned to letters, so the second one moves
right on its own when the first gains a column. It moved from `G` to `H` when the count column was added.

- **`Summer?`** says `Summer`, `Off-cycle`, or nothing. A company with any live row on `Jobs`
  is green in both its name cell and this one.
- **`Asked`** is a checkbox, and it is the one column a person owns. Nothing in this file ever
  writes it except to carry the existing tick forward.
- **`sendable referral emails`** is the number of unique remaining email addresses for that
  company in the generated `Employees (seed)` tab whose DeBounce verdict is non-invalid. It
  covers every company in the referral candidate list, not only top-100 companies or currently
  queued rows. Addresses already in Referral with `Queued`, `Drafted`, `Sent`, `Replied`, or
  `Bounced` status are deducted; `Cancelled` and `Failed` rows are not. Pattern-calibrated,
  upstream-invalid, inactive/former, and blank addresses never enter the seed.
- **`LinkedIn`**, **`Email subject`** and **`Email body`** hold that company's messages, with its
  name and its real posting link already in them. The only thing left to fill is `[Name]`.

The subject is its own column because pasting an email means pasting two things into two fields,
and a body that starts with `Subject:` makes that a manual edit every single time.

The three are drawn **to fit their own header and nothing more** — 84, 122 and 99px, from
`companyHeaderWidth_`. Their contents are a whole message each and no width short of absurd would
show one, so the width is spent on the only thing worth reading in place: which column you are
looking at. It is derived from the header text rather than written down as three numbers, so
renaming a header cannot leave it clipped by a width nobody thought to update — and a header
*does* get clipped, because the cell beside it is another header and there is nothing to overflow
into.

Every data row is pinned to **21px tall** (`COMPANY_ROW_HEIGHT_PX`). Widen a column by hand to
proofread a whole message; the next rebuild puts it back.

**No message uses an em dash.** Every `—` in a string that reaches the sheet is a plain `-`; the
comments and this document keep theirs.

Both are needed, and the second is the one that is easy to miss. **`CLIP` stops a long line
overflowing sideways; it does not stop a newline.** The templates carry real `\n` characters, so
without a pinned row height Sheets grows each row to the ten or fifteen lines the message needs
and the tab becomes a wall of text. The height clips it vertically the way `CLIP` clips it
horizontally.

**It has to be `setRowHeightsForced`, not `setRowHeights`.** The plain one sets a height that
rows are still free to grow past to fit their contents — against a fifteen-line cell it does
nothing at all, and it fails silently: the call succeeds, the rows stay tall, and nothing in the
log says why.

Clipped rather than the Sheets default of overflow, too, which would spill a message sideways
across the block beside it.

**`companyExistingAsked_` scans every column instead of the two the blocks sit at.** Reading at
fixed offsets would be shorter and would have silently dropped every tick in the second block the
day it moved from `F` to `G`: the layout on the sheet is still the old one at the moment that
function runs, so a reader assuming the new offsets reads the wrong columns exactly once — and
what it destroys is the thing it was called to preserve.

The height is set **after** the writes, over both blocks at once: row height belongs to the row
rather than to either block, and pinning it before writing a multi-line cell lets Sheets grow the
row again.

## The templates

Every message, email and LinkedIn alike, follows the same **eight beats in the same order**.
The substantive wording is deliberately consistent: a stranger deserves a clear explanation and
a direct but respectful request, not a different rhetorical strategy for every company.

1. a greeting
2. who is writing: the name and the subject read
3. we have never met, and I saw that you are at this company
4. the open SWE role and why Henry's software-engineering background is relevant
5. the ask: review the resume, then refer only if Henry seems like a fit
6. appreciation for an opportunity to move forward, with the resume and application link below
7. it is completely all right to decline
8. thank you for the time it took to read this

The register is deliberately **clear, courteous and professional**. This is writing to an engineer
who owes the reader nothing and is being asked to spend their own credibility, so it identifies
Henry first, acknowledges there was no prior connection, asks for a resume review before the
referral, and makes the referral conditional on genuine fit. It gives the reader an easy way out
without repeatedly apologising for the message.

Beats 3 to 7 live in `companyMiddleBeats_` and are shared, so the email and the LinkedIn message
can never drift into saying different things.

**The LinkedIn cell is a DM, not a connection note.** Carrying the whole structure puts it far
past the 300 characters a connection note allows. It differs from the email only in dropping the
subject, the signature block and the paragraph breaks.

**The template does not claim that an application has already been submitted.** The Company tab
knows that a posting exists, not whether Henry has applied. It instead gives the recipient the
resume and direct application link, so the sender can apply at the appropriate point without the
message making a false claim.

A company with no opening cannot be asked for a referral against a req that does not exist, and
cannot have been applied to either. Beats 4 to 6 are replaced there by one saying no posting has
appeared and asking whether one is expected.

The company name, role season and direct link make every row specific. Greetings and closings are
still drawn deterministically by company name, so a rebuild gives back the exact message that was
reviewed. That stability matters because this tab is copied from by hand.

**No variant may carry an em dash, and none may repeat another in its own array.** Both are
asserted where the arrays are generated. Comments and this document keep their em dashes; nothing
that reaches the sheet does.

**No variant puts an article in front of the company name.** "a {C} referral" produces *a Amazon
referral*, and the article cannot be chosen without knowing the name, so the subjects that had one
say "a referral at {C}" instead of a rule being written to guess.

## Where the two lists come from

The shortlist is ColdEmail's `data/seed_manual.csv` — 243 employers, deduped. The split is a
name match against the DOL LCA disclosure files, filtered to certified Software Engineer titles
by `scripts/extract_h1b_software_engineer.py` in that repo and aggregated across an employer's
legal entities.

**A company is a sponsor when its FY2025 count is non-zero.** FY2024 alone does not qualify it,
and "both years" needs no separate test because it is already inside the FY2025 half. This
replaced a both-years rule on 2026-08-30 and moved fourteen employers up: AMD, American Express,
BlackRock, Coca-Cola, CoreWeave, DigitalOcean, Lambda, LangChain, Mistral AI, Pinecone, Replit,
Runway, Sierra and Vercel — every one of them a first FY2025 filing.

Entities are summed so that a company split across legal names counts once; VMware files as both
`VMware LLC` and `VMware, Inc.`. Under the old both-years rule that summing decided membership.
Under this one it mostly decides the counts.

**Absence from A:F is absence from a title-filtered extract, not proof a company never
sponsors.** Oracle, Goldman Sachs and Morgan Stanley file under titles the Software Engineer
regex does not catch and so appear in G:L.

Moving a company between the two arrays is a data change, not a code change. Say which fiscal
year made it move.

## The rules that are easy to get wrong

**Names match on contiguous whole tokens, never on substrings.** Substring matching puts
Maxlinear under Linear, JobTarget under Target and Bloomberg under Loom — every one of those is
a real pair the loose version produced against this data. Whole tokens still catch what
matters: `Amazon Web Services (AWS)` is Amazon and `The Walt Disney Company` is Disney.

A shortlisted name whose first token is under three characters must match exactly, or `X` — the
company — claims every posting with a stray initial in its name.

**The order is three tiers, and the date sorts inside a tier rather than across them:** a summer
opening newest-first, then an off-cycle opening newest-first, then everything with nothing open,
alphabetically. The tier comes before the date deliberately — a summer req from a fortnight ago is
worth more than an off-cycle one from this morning, because summer is the intake being applied
for, and sorting on date alone buried every summer row under whatever the crawler found that day.
The date used is the newest posting the company has, whichever intake it names. Tier 3's order was
called free, and alphabetical is the one free order that keeps a name where it was last seen.

**A role is Summer only if it says "summer"**, as a whole word. "Software Engineer Intern" and
"Software Engineering Intern" are Off-cycle; so is a company with three openings none of which
name the intake. Whole-word matching keeps a company called Summerlin from reading as an intake.

This is the **opposite** of `outreachSeason_`, where an unlabelled role is Summer, and the
disagreement is deliberate. That default is right for the tab it reads: every row on `App` is an
application somebody chose to make, which says more about the intake than a title does. This tab
reads the crawler's `Jobs` tab, and `outreach_config.gs` says of exactly that case that "summer"
was what picked out the intake worth asking about — and that its own reasoning "would not
survive the path being pointed at a different one".

**A role naming a closed intake is dropped outright.** `COMPANY_DEAD_INTAKE_WORDS` is `['2026']`:
such a row is not counted, not coloured and not sorted up, because a company whose only opening
is one you can no longer apply to has not opened. Checked before the season, so "Summer 2026" is
dropped rather than counted as Summer. Whole-word again, so a req number like 20260 is safe.
Rolling the year forward is adding `'2027'` to that one list.

**A row ticked `Expired` on `Jobs` does not count**; a row ticked `Applied` does. A company
whose only opening has expired has not opened. Having applied is the reason to want a referral,
not a reason to drop the row.

**It polls, because nothing can tell it.** `job_sync` writes `Jobs` through the Sheets API from
GitHub Actions, and a change made through the API fires no trigger in this project — not
`onChange`, not `onEdit`. There is no event to hang this on. The sweep fingerprints the `Jobs`
tab instead and rebuilds only when the fingerprint moves, so three firings in four write
nothing. That is what keeps a rewrite from reordering rows under the cursor of somebody about
to tick one.

## Functions

| Function | Does |
|---|---|
| `companyTokens_(name)` | One name reduced to identifying tokens: upper case, punctuation to spaces, legal forms dropped. |
| `companyNameMatches_(shortlisted, posting)` | Whether the shortlisted name is a contiguous run of whole tokens in the posting's name. |
| `companyIsSummerRole_(role)` | Whether a title says "summer" as a whole word. |
| `companyIsDeadIntake_(role)` | Whether a title names a closed intake, and so should not count as an opening at all. |
| `companyJobsLayout_(header)` | Where Company, Role and Expired sit, read off the `Jobs` header row — never hard-coded. `null` when the header does not name what is needed, and the caller then leaves the tab alone. |
| `companyLivePostings_()` | Every `Jobs` row still worth counting — not Expired, not a closed intake — as `{tokens, summer}`. |
| `companyIsTicked_(cell)` | A checkbox reads back boolean; a hand-typed one reads as text. |
| `companyPostedTime_(cell)` | A `Date Posted` cell as a sortable number, from either a Date or an ISO string. Unparseable sorts oldest rather than throwing. |
| `companyHeaderWidth_(text)` | How wide a template column is drawn: enough for its own header and no more. |
| `companyHash_(text)` | A stable unsigned djb2 hash — enough to spread a few hundred names, four lines rather than a dependency. |
| `companyPick_(company, salt, list)` | One beat, drawn for this company. The salt is what decorrelates the beats. |
| `companyMiddleBeats_(company, label)` | Beats 3 to 6, shared by both messages so they cannot drift apart. |
| `companyIntro_(study)` | Beat 2, the one fixed sentence in the message. |
| `companyFill_(text, company, label)` | Substitutes `{C}` and `{S}` in a variant. |
| `companyLinkedInTemplate_(company, label, link)` | The DM. No signature block — the profile is the signature. |
| `companyEmailSubject_(company, label)` | The subject line, alone, for its own column. |
| `companyEmailBody_(company, label, link)` | The body, link on its own line at the foot. |
| `companyBlockRows_(names, postings, asked, referralCounts)` | One block, ordered: open first, Summer before Off-cycle, alphabetical inside each group. Adds each company's exact DeBounce-valid referral count and picks the posting whose link the templates name — a summer one if there is one. |
| `companyExistingAsked_(sheet)` | The ticks now on the tab, keyed by company rather than by row, so rows can move underneath them. Scans every column and pairs a name cell with the checkbox three to its right, while accepting the old two-column offset during migration. |
| `companyReferralCounts_()` | Reads the sender-maintained hidden snapshot of unique `debounce:valid` addresses across `Employees (seed)`, for every company on the referral candidate list. |
| `companyJobsFingerprint_(postings)` | What `Jobs` says, reduced to the two things this tab reads off it. |
| `companySheet_(create)` | The tab, made if absent. |
| `companyPaintHeader_(sheet)` | Header, widths, frozen row. Run on every rebuild, so a tab somebody widened comes back to itself. |
| `companyWriteBlock_(sheet, col, rows, clearDepth)` | Values, the green, the checkbox. Clears to the tab's current depth, not the new one, so a dropped company leaves no orphan row. |
| `companyRebuild_(force)` | Both blocks. `force` skips the fingerprint check. |
| `syncCompanyTab()` | The trigger handler. |
| `rebuildCompanyTab()` | Rebuild now, whatever the fingerprint says. |
| `setupCompanyTab()` | **The one function to run by hand.** Builds the tab and installs the trigger. Safe to run again. |
| `removeCompanyTrigger()` | The kill switch. Leaves the tab as it stands. |

## Setting it up

```
cd apps_script
clasp -u kenyon run setupCompanyTab
```

Run once. It builds the tab and installs the trigger, and is safe to run again.

The bound script became reachable from `clasp run` on 2026-08-30: it is now linked to the GCP
project `update-job-504720` in the kenyon.edu Cloud Organization, and the `kenyon` clasp profile
holds a Desktop OAuth client from that project. `appsscript.json` must keep
`"executionApi": { "access": "MYSELF" }` — `ANYONE` is dropped by the organisation policy and
every call then answers "Script function not found". See the access notes in
[`AGENTS.md`](../../AGENTS.md).

Its trigger is deliberately **not** folded into the `installAppOfficialTrigger` pair. That pair
is documented as the kill switch people reach for when the Python half or the sender is being
worked on, and this tab has nothing to do with either.

## Known limit

Matching is on names, because the ATS links on `Jobs` point at jobright.ai or gusto.com rather
than at the employer, so there is no domain to match on. `Persona.Ai`, a robotics company,
therefore reads as Persona, the identity company on the shortlist. The cost is a green cell on
a company that has not opened.
