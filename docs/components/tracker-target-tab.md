# target_tab.gs — the Target tab

The 138-company shortlist for sourcing additional referral contacts, separate from the
`Company` tab's current-opening view. It is the 106-company existing Target list, minus
eight companies without a credible Summer SWE-intern footprint, plus 40 non-quant
additions from the multi-source research pass; quant firms are deliberately excluded.

## Connections

- **Reads:** the hidden `Referral Seed Counts` snapshot through the shared
  `companyReferralCounts_()` function in `company_tab.gs`.
- **Writes:** the `Target` tab, and nothing else.
- **Runs:** through `syncCompanyTab()` every 15 minutes, and manually through
  `rebuildTargetTab()`.

## The layout

The tab has four compact five-column blocks, separated by gutters:

| Columns | Group | First column | Second column | Third column | Fourth column | Fifth column |
|---|---|---|---|---|---|---|
| `A:E` | P0 | company name | `Sendable referral emails` | `Summer 2026 first posted` | `Date open` | `Asked` |
| `G:K` | P1 | company name | `Sendable referral emails` | `Summer 2026 first posted` | `Date open` | `Asked` |
| `M:Q` | P2 | company name | `Sendable referral emails` | `Summer 2026 first posted` | `Date open` | `Asked` |
| `S:W` | P3 | company name | `Sendable referral emails` | `Summer 2026 first posted` | `Date open` | `Asked` |

P0 contains 34 companies, P1 contains 33, P2 contains 30, and P3 contains 41 after adding Toast and five
similar-size peers plus the non-quant research additions. The company columns are 125px wide, the count
columns are 105px wide, the research date columns are 100px wide, the live `Date open` columns are 85px wide, and `Asked` columns are 55px wide; headers wrap to keep
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
was opened. In the sheet, unknown dates are left blank to keep the view clean.

`Date open` is the latest `Date Posted` found in live `Jobs` for a recognized Summer
software-engineering role posted on or after `2026-07-20`. It is independent of the
`Applied` and `Expired` flags; a blank means no qualifying row was found after the
cutoff.

`Asked` is a manual checkbox only. It has no sending or filtering logic, and its
state is preserved when the Target tab is rebuilt or its blocks are refreshed.

The company-name cell is refreshed from live `Jobs` data on every Target rebuild. A
role must first be a software-engineering role: its title must contain `Software
Engineer`, `Software Engineering`, `Software Developer`, `SWE`, or `Application
Development` as whole-word phrases.
Summer inference is then done per company using all SWE rows after the cutoff:

- if there is at least one SWE role with `Summer`, count those Summer rows;
- if there are no explicit season words in any SWE role, infer Summer from all of those rows, whether there is one role or several;
- `Winter`, `Spring`, or `Fall` without a `Summer` role does not count as a Summer opening.

Only rows with `Date Posted` on or after `2026-07-20` are considered. Older Jobs
rows do not affect the Target color, even if they otherwise match the role rule.

- green means no recognized Summer SWE opening exists for the company in `Jobs`;
- white means a recognized Summer SWE opening exists, but its posting is older than five calendar days;
- red means a recognized Summer SWE opening was posted within the last five calendar days.

`Applied` and `Expired` are ignored for this color logic. Either flag may mean the
role was applied to, expired, duplicated, or simply not worth pursuing, but the rule
here is that appearance in `Jobs` is enough to count it. Green is reserved for
companies with no recognized Summer row at all. If the Jobs tab is unreadable,
names stay white rather than being incorrectly marked as not opened.

## Functions

| Function | Does |
|---|---|
| `targetSheet_(create)` | Returns or creates the `Target` tab. |
| `targetRows_(names, referralCounts, statuses, askedStates)` | Pairs each target company with its current sendable count, researched posting date, latest live `Date open` and manual `Asked` state. |
| `targetAskedStates_(sheet)` | Reads manual `Asked` checkbox states so they survive a Target rebuild. |
| `targetIsSoftwareEngineerRole_(role)` | Recognizes Software Engineer, Software Engineering, Software Developer, SWE and Application Development titles. |
| `targetIsExplicitSummerRole_(role)` | Detects an explicit `Summer` intake. |
| `targetIsExplicitOffCycleRole_(role)` | Detects an explicit `Winter`, `Spring` or `Fall` intake. |
| `targetOpeningStatuses_()` | Groups SWE rows from `Jobs` posted on or after `2026-07-20`, infers Summer per company, tracks the latest recognized opening date, and classifies each Target company for the three-state color rule. |
| `targetAgeDays_(postedDay, todayDay)` | Calculates calendar-day posting age without timezone drift. |
| `targetCompanyFill_(name, statuses)` | Converts the live Target status into green, white or red. |
| `targetPaintHeader_(sheet)` | Writes the five headers, freezes row 1 and sizes the blocks and gutters. |
| `targetWriteBlock_(sheet, col, rows, clearDepth, statuses)` | Replaces one block's values, resets count/date number formats, adds notes and company-name colors, and clears stale rows. |
| `targetRebuild_()` | Rebuilds all current Target companies across the four blocks and logs the result. |
| `rebuildTargetTab()` | Manual wrapper that rebuilds Target and shows a toast. |
