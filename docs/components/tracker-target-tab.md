# target_tab.gs — the Target tab

The 100-company shortlist for sourcing additional referral contacts, separate from
the `Company` tab's current-opening view.

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

Each block contains 25 companies. The company columns are 125px wide, the count
columns are 105px wide, and the date columns are 100px wide; headers wrap to keep
the four-block layout compact.

`Sendable referral emails` is the current per-company count from the sender's seed
snapshot. It uses the same non-invalid referral pool as `Company`, after addresses
already reserved or used by Referral have been deducted. The Target tab does not
create or reserve email addresses; it only reports where more sourcing is useful.

`Summer 2026 first posted` is the earliest concrete 2025 date found in the research
sources recorded in `target_tab.gs`. Dates are ISO strings (`YYYY-MM-DD`) and each
date cell has a note with its source and evidence scope. `Unknown` means no exact
public date was sufficiently verifiable in this pass; it is not a claim that no role
was opened.

## Functions

| Function | Does |
|---|---|
| `targetSheet_(create)` | Returns or creates the `Target` tab. |
| `targetRows_(names, referralCounts)` | Pairs each target company with its current sendable count and researched posting date. |
| `targetPaintHeader_(sheet)` | Writes the three headers, freezes row 1 and sizes the blocks and gutters. |
| `targetWriteBlock_(sheet, col, rows, clearDepth)` | Replaces one block's values and clears stale rows. |
| `targetRebuild_()` | Rebuilds all 100 companies across the four blocks and logs the result. |
| `rebuildTargetTab()` | Manual wrapper that rebuilds Target and shows a toast. |
