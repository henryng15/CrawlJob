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

The tab has three two-column blocks, separated by gutters:

| Columns | Group | First column | Second column |
|---|---|---|---|
| `A:B` | P0 | company name | `Sendable referral emails` |
| `D:E` | P1 | company name | `Sendable referral emails` |
| `G:H` | P2/P3 | company name | `Sendable referral emails` |

The first two blocks contain 25 companies each. The Extended block contains the
remaining 50 companies. It combines the previous P2 and P3 groups so the sheet has
the three tracking sections requested.

`Sendable referral emails` is the current per-company count from the sender's seed
snapshot. It uses the same non-invalid referral pool as `Company`, after addresses
already reserved or used by Referral have been deducted. The Target tab does not
create or reserve email addresses; it only reports where more sourcing is useful.

## Functions

| Function | Does |
|---|---|
| `targetSheet_(create)` | Returns or creates the `Target` tab. |
| `targetRows_(names, referralCounts)` | Pairs each target company with its current sendable referral-email count. |
| `targetPaintHeader_(sheet)` | Writes the three headers, freezes row 1 and sizes the blocks and gutters. |
| `targetWriteBlock_(sheet, col, rows, clearDepth)` | Replaces one block's values and clears stale rows. |
| `targetRebuild_()` | Rebuilds all 100 companies across the three blocks and logs the result. |
| `rebuildTargetTab()` | Manual wrapper that rebuilds Target and shows a toast. |

