# target_tab.gs — the Target tab

The 100-company shortlist plus six Toast-size commerce/fintech/SaaS peers for sourcing
additional referral contacts, separate from the `Company` tab's current-opening view.

## Connections

- **Reads:** the hidden `Referral Seed Counts` snapshot through the shared
  `companyReferralCounts_()` function in `company_tab.gs`.
- **Writes:** the `Target` tab, and nothing else.
- **Runs:** through `syncCompanyTab()` every 15 minutes, and manually through
  `rebuildTargetTab()`.

## The layout

The tab has four compact three-column blocks, separated by gutters:

| Columns | Group | First column | Second column | Third column |
|---|---|---|---|---|
| `A:C` | P0 | company name | `Sendable referral emails` | `Summer 2026 first posted` |
| `E:G` | P1 | company name | `Sendable referral emails` | `Summer 2026 first posted` |
| `I:K` | P2 | company name | `Sendable referral emails` | `Summer 2026 first posted` |
| `M:O` | P3 | company name | `Sendable referral emails` | `Summer 2026 first posted` |

P0, P1 and P2 contain 25 companies each; P3 contains 31 after adding Toast and five
similar-size peers: Block, BILL, Samsara, DigitalOcean and Squarespace. The company columns are 125px wide, the count
columns are 105px wide, and the date columns are 100px wide; headers wrap to keep
the four-block layout compact.

The added cohort is a broad sourcing analogue, not an exact headcount match: Toast's
2025 Form 10-K reported approximately 6,500 employees, and the additions cover nearby
commerce, payments and SaaS companies in the same broad growth-stage band. Supporting
public references include Toast's [2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/1650164/000165016426000057/tost-20251231.htm),
BILL's [2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/1786352/000178635225000037/bill-20250630.htm),
Samsara's [2025/2026 workforce disclosure](https://www.samsara.com/support/modern-slavery-statement),
and Squarespace's [company profile](https://www.squarespace.com/about/company).

`Sendable referral emails` is the current per-company count from the sender's seed
snapshot. It uses the same non-invalid referral pool as `Company`, after addresses
already reserved or used by Referral have been deducted. The Target tab does not
create or reserve email addresses; it only reports where more sourcing is useful.

`Summer 2026 first posted` is the earliest concrete 2025 date found in the research
sources recorded in `target_tab.gs`. Dates are ISO strings (`YYYY-MM-DD`) and each
date cell has a note with its source and evidence scope. `Unknown` means no exact
public date was sufficiently verifiable in this pass; it is not a claim that no role
was opened.

The company-name cell is refreshed from live `Jobs` data on every Target rebuild. A
role must first be a software-engineering role: its title must contain `Software
Engineer`, `Software Engineering`, or `Software Developer` as whole-word phrases.
Among those roles, a `Summer` role counts; an unlabelled role also counts unless its
title explicitly contains the whole word `Winter` or `Spring`:

- green means no qualifying software-engineering opening row exists for the company in `Jobs`;
- white means a qualifying software-engineering opening row exists, but its posting is older than five calendar days;
- red means a qualifying software-engineering opening row was posted within the last five calendar days.

`Applied` and `Expired` are ignored for this color logic. Either flag may mean the
role was applied to, expired, duplicated, or simply not worth pursuing, but the rule
here is that appearance in `Jobs` is enough to count it. A software-engineering role
with no `Summer`, `Winter`, or `Spring` word is therefore counted as opened. Green
is reserved for companies with no qualifying row at all. If the Jobs tab is
unreadable, names stay white rather than being incorrectly marked as not opened.

## Functions

| Function | Does |
|---|---|
| `targetSheet_(create)` | Returns or creates the `Target` tab. |
| `targetRows_(names, referralCounts)` | Pairs each target company with its current sendable count and researched posting date. |
| `targetIsSoftwareEngineerRole_(role)` | Recognizes Software Engineer, Software Engineering and Software Developer titles. |
| `targetCountsAsOpeningRole_(role)` | Counts a software-engineering title when it says `Summer`, or when it is unlabelled and does not say `Winter`/`Spring`. |
| `targetOpeningStatuses_()` | Reads live opening roles from `Jobs` and classifies each Target company for the three-state color rule. |
| `targetAgeDays_(postedDay, todayDay)` | Calculates calendar-day posting age without timezone drift. |
| `targetCompanyFill_(name, statuses)` | Converts the live Target status into green, white or red. |
| `targetPaintHeader_(sheet)` | Writes the three headers, freezes row 1 and sizes the blocks and gutters. |
| `targetWriteBlock_(sheet, col, rows, clearDepth, statuses)` | Replaces one block's values, notes and company-name colors, clearing stale rows. |
| `targetRebuild_()` | Rebuilds all current Target companies across the four blocks and logs the result. |
| `rebuildTargetTab()` | Manual wrapper that rebuilds Target and shows a toast. |
