# target_tab.gs — the Target tab

The 163-company shortlist for sourcing additional referral contacts, separate from the
`Company` tab's current-opening view. It is the 106-company existing Target list, minus
eight companies without a credible Summer SWE-intern footprint, plus 40 non-quant
additions from the multi-source research pass, plus 25 large software and tech-adjacent
employers the research pass had missed; quant firms are deliberately excluded.

The 25 additions were filtered on sponsorship before being added: each one holds a
DOL-certified Software Engineer H-1B LCA in **both** FY2024 and FY2025, the same test
[`job_sync/data/h1b_software_engineer_sponsors.txt`](../../job_sync/data/h1b_software_engineer_sponsors.txt)
records and the `Company` tab's green paint uses. Splunk was considered with them and
left out on that test: it has no certified SWE LCA in FY2025, and Cisco, which now owns
it, was already on P3.

## Connections

- **Reads:** the hidden `Referral Seed Counts` snapshot through the shared
  `companyReferralCounts_()` function in `company_tab.gs`, the hidden
  `Recruiter Seed Counts` and `Target Outreach Status` snapshots from the sender,
  plus the live `Jobs` and `App` tabs for opening evidence.
- **Writes:** the `Target` tab, and nothing else.
- **Runs:** through `syncCompanyTab()` every 15 minutes, and manually through
  `rebuildTargetTab()`.

## The layout

The tab has four compact seven-column blocks, separated by gutters:

| Columns | Group | First column | Second column | Third column | Fourth column | Fifth column | Sixth column | Seventh column |
|---|---|---|---|---|---|---|---|---|
| `A:G` | P0 | company name | `Sendable referral emails` | `Sendable recruiter email` | `Summer 2026 first posted` | `Date open` | `Refer` | `Recruiter?` |
| `I:O` | P1 | company name | `Sendable referral emails` | `Sendable recruiter email` | `Summer 2026 first posted` | `Date open` | `Refer` | `Recruiter?` |
| `Q:W` | P2 | company name | `Sendable referral emails` | `Sendable recruiter email` | `Summer 2026 first posted` | `Date open` | `Refer` | `Recruiter?` |
| `Y:AE` | P3 | company name | `Sendable referral emails` | `Sendable recruiter email` | `Summer 2026 first posted` | `Date open` | `Refer` | `Recruiter?` |

P0 contains 34 companies, P1 contains 50, P2 contains 30, and P3 contains 49 after adding Toast and five
similar-size peers, the non-quant research additions, and the 25 sponsorship-filtered additions
(17 software employers into P1, 8 payments, telecom, data and infrastructure employers into P3). The company columns are 125px wide, the count
columns are 105px wide, recruiter-count columns are 105px wide, the research date columns are 100px wide, the live `Date open` columns are 85px wide, `Refer` columns are 55px wide, and `Recruiter?` columns are 65px wide; headers wrap to keep
the four-block layout compact.

The added cohort is a broad sourcing analogue, not an exact headcount match: Toast's
2025 Form 10-K reported approximately 6,500 employees, and the additions cover nearby
commerce, payments and SaaS companies in the same broad growth-stage band. Supporting
public references include Toast's [2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/1650164/000165016426000057/tost-20251231.htm),
BILL's [2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/1786352/000178635225000037/bill-20250630.htm),
Samsara's [2025/2026 workforce disclosure](https://www.samsara.com/support/modern-slavery-statement),
and Squarespace's [company profile](https://www.squarespace.com/about/company).

`Sendable referral emails` is the current per-company count from the sender's seed
snapshot. It uses the same non-invalid referral pool as `Company`, after permanently
`Sent`-ticked addresses and addresses already reserved or used by Referral have been
deducted. A later delivery bounce remains deducted because that address is known to be
unusable. The Target tab does not create or reserve email addresses; it only reports
where more sourcing is useful.

`Summer 2026 first posted` is the earliest concrete 2025 date found in the research
sources recorded in `target_tab.gs`. Dates are ISO strings (`YYYY-MM-DD`) and each
date cell has a note with its source and evidence scope. `Unknown` means no exact
public date was sufficiently verifiable in this pass; it is not a claim that no role
was opened. In the sheet, unknown dates are left blank to keep the view clean.

A company with no entry in `TARGET_OPENING_EVIDENCE` at all renders blank for the same
reason and reads identically in the sheet, but means something different again: it was
never put through the research pass. The 40 non-quant additions and the 25
sponsorship-filtered additions are all in that state. A blank cell is therefore three
claims at once — researched and unverifiable, researched and nothing found, or not yet
researched — and only the note distinguishes them.

`Date open` is the latest `Date Posted` found in live `Jobs` for a recognized Summer
in-scope role posted on or after `2026-07-20`. It is independent of the
`Applied` and `Expired` flags; a blank means no qualifying `Jobs` row was found after
the cutoff. `App` is scanned after `Jobs` as a fallback: an App-only role can make
the company red using its `Date Applied` as recent-activity evidence, but that date
is never written into `Date open` because it is not a posting date.

`Refer` is the renamed manual `Asked` checkbox and is also ticked automatically
from the hidden `Target Outreach Status` snapshot after a successful referral
send. `Recruiter?` is the corresponding recruiter-send checkbox. Both states are
preserved when the Target tab is rebuilt or its blocks are refreshed; old `Asked`
ticks migrate to `Refer`. Drafted, failed, cancelled, and merely planned rows do
not tick either checkbox.

`Sendable recruiter email` is the current per-company count from the sender's
hidden `Recruiter Seed Counts` snapshot. It counts unique non-invalid recruiter
contacts that are not `Sent`-ticked and are not already committed in the cold
queue. The Target tab only reports the snapshot; it does not reserve addresses.

The company-name cell is refreshed from live `Jobs` data on every Target rebuild. A
role is in scope when its title contains the whole word `software`, `technology` or
`engineering`. Application-development and generic SWE titles without one of those
words are excluded. Summer inference is then done per company using all in-scope
rows after the cutoff:

- if there is at least one in-scope role with `Summer`, count those Summer rows;
- if there are no explicit season words in any in-scope role, infer Summer from all of those rows, whether there is one role or several;
- `Winter`, `Spring`, or `Fall` without a `Summer` role does not count as a Summer opening.

Only `Jobs` rows with `Date Posted` on or after `2026-07-20` and `App` rows with
`Date Applied` on or after that cutoff are considered. Older rows do not affect the
Target color, even if they otherwise match the role rule.

Titles containing `PhD`, `Graduate`, `Master`, or `2026` are excluded before the
role test, so graduate/research listings and prior-cycle `2026` listings cannot
make a company look like a qualifying opening.

- `Jobs` is always scanned first. An `App` row for the same company and normalized
  role is ignored when `Jobs` already supplied that role; this remains true when
  the two links differ. Role identity ignores punctuation, season labels, intake
  years and the generic intern/co-op suffix.
- green means no recognized Summer opening exists in either source;
- white means a recognized Summer opening exists, but its source evidence is
  older than five calendar days;
- red means the latest recognized Summer role was posted in `Jobs`, or was applied
  to in `App` when `Jobs` has no matching role, within the last five calendar days.
  Older qualifying rows do not override the latest row's status. Thus, if a company
  first has an `Engineering` role and later adds a `Software` role, the later role's
  date is used for the live status; it also becomes `Date open` when that later role
  is in `Jobs` (App-only dates remain color evidence only).

`Applied` and `Expired` are ignored for this color logic. Either flag may mean the
role was applied to, expired, duplicated, or simply not worth pursuing. Green is
reserved for companies with no recognized Summer row in either source. If both
source tabs are unreadable, names stay white rather than being incorrectly marked
as not opened.

## Functions

| Function | Does |
|---|---|
| `targetSheet_(create)` | Returns or creates the `Target` tab. |
| `targetRows_(names, referralCounts, recruiterCounts, statuses, checkboxStates)` | Pairs each target company with referral/recruiter counts, researched posting date, latest live `Date open` and both manual checkbox states. |
| `targetCheckboxStates_(sheet)` | Reads `Refer` and `Recruiter?` states; migrates the old five-column `Asked` state to `Refer`. |
| `targetRecruiterCounts_()` | Reads the hidden sender-maintained recruiter availability snapshot. |
| `targetIsSoftwareEngineerRole_(role)` | Recognizes titles containing the whole word `software`, `technology` or `engineering`. |
| `targetIsExcludedRole_(role)` | Rejects titles containing `PhD`, `Graduate`, `Master`, or `2026` before Target opening classification. |
| `targetIsExplicitSummerRole_(role)` | Detects an explicit `Summer` intake. |
| `targetIsExplicitOffCycleRole_(role)` | Detects an explicit `Winter`, `Spring` or `Fall` intake. |
| `targetRoleKey_(role)` | Normalizes company-role identity so different links for the same role do not create duplicate evidence. |
| `targetAppLayout_(header)` | Locates the App company, Date Applied and Role columns by header. |
| `targetAddSourceRow_(...)` | Adds one Jobs/App row in source-priority order, deduplicating App against Jobs by normalized role. |
| `targetOpeningStatuses_()` | Groups recognized rows from `Jobs`, then fallback rows from `App`, infers Summer per company, tracks the latest Jobs opening date, and classifies each company from its latest qualifying role for the three-state color rule. |
| `targetAgeDays_(postedDay, todayDay)` | Calculates calendar-day posting age without timezone drift. |
| `targetCompanyFill_(name, statuses)` | Converts the live Target status into green, white or red. |
| `targetPaintHeader_(sheet)` | Writes the seven headers, freezes row 1, grows the sheet to `AE` when needed, and sizes the blocks and gutters. |
| `targetWriteBlock_(sheet, col, rows, clearDepth, statuses)` | Replaces one block's values, resets both count/date number formats, adds notes and company-name colors, and applies both checkboxes. |
| `targetRebuild_()` | Rebuilds all current Target companies across the four blocks and logs the result. |
| `rebuildTargetTab()` | Manual wrapper that rebuilds Target and shows a toast. |
| `scheduleTargetReferralRefresh0909()` | One-off bound-script trigger scheduled for 13:45 America/New_York on 2026-09-09, after the Sierra/Waymo/Mastercard campaign, so the refreshed `Referral Seed Counts` snapshot is written into the visible Target counts. |
| `runTargetReferralRefresh0909_()` | Internal one-shot handler that rebuilds Target from the sender's refreshed snapshot and deletes its own trigger. |
| `scheduleTargetReferralRefresh0910()` | One-off bound-script trigger scheduled for 13:45 America/New_York on 2026-09-10, after the PayPal/Dropbox/Scale AI campaign, so the refreshed `Referral Seed Counts` snapshot is written into the visible Target counts. |
| `runTargetReferralRefresh0910_()` | Internal one-shot handler that rebuilds Target from the sender's refreshed snapshot and deletes its own trigger. |
| `scheduleTargetReferralRefresh0911()` | One-off bound-script trigger scheduled for 13:30 America/New_York on 2026-09-11, after the Datadog/Vercel/Coinbase/Red Hat campaign, so the refreshed `Referral Seed Counts` snapshot is written into the visible Target counts. |
| `runTargetReferralRefresh0911_()` | Internal one-shot handler that rebuilds Target from the sender's refreshed snapshot and deletes its own trigger. |
