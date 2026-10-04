# Apps Script

Three files bound to the spreadsheet. They run on Google's side, not Python's. The repository is
the source of truth; `clasp` pushes it. Never paste into the editor — the editor has no history
worth relying on, and a pasted file is a version nobody can identify afterwards.

Per-function detail: [../docs/components/tracker-sync.md](../docs/components/tracker-sync.md) and
[../docs/components/tracker-external-api.md](../docs/components/tracker-external-api.md).

## Run once by hand

| File | Function | |
|---|---|---|
| `sync_applied_to_app.gs` | `setupJobsCheckboxes` | the `Applied` (F) and `Expired` (G) checkboxes on `Jobs` |
| | `setupAppColumns` | `Official` (I), `Alumni` (J), `Recruiter` (K), `Update` (L) on `App` |
| | `setupOutreachQueue` | the empty `Email` tab and its dropdowns. Queues nothing, sends nothing |
| | `setupReferralQueue` | the empty `Referral` tab |
| | `backfillTicksFromApp` | pre-tick in `Jobs` the jobs already in `App` |
| | `installAppOfficialTrigger` | the hourly housekeeping sweep (below) |
| | `migrate*` | walk a tab built on an older layout forward, one column at a time |
| `external_application_api.gs` | `configureExternalApplicationApi` | the Web App endpoint the Chrome extension posts to |
| `setup_process_dropdown.gs` | `setupProcessDropdown` | the coloured `Process` dropdown on `App` |

## The triggers

`onEdit` is a **simple trigger** — Google calls it whenever a cell changes, and nothing has to be
installed. It asks which tab the cell belongs to and hands it on; each half returns at once if the
column is wrong.

| Tab | Column | What it does |
|---|---|---|
| `Jobs` | F `Applied` | copies that row to `App` |
| `App` | F `Process` | appends a `<Stage>: <date>` line to L `Update` |
| `Referral` | M `Cancel` | calls that ask off where you are standing, expanded to the whole ask |
| `Referral` | J `Priority` | spreads the tick across the ask it belongs to |

`runHourlyHousekeeping` is an **installed** clock trigger: it floats the `App` rows still missing
an official link to the top, then sinks the called-off `Referral` rows. It exists because an edit
trigger is not guaranteed — a paste, a fill-down or an undo fires nothing at all.

## Running the tests

```bash
node apps_script/harness.js
```

**387 assertions.** Nothing to install, and it does not touch the real spreadsheet: `harness.js`
stubs `SpreadsheetApp` with an in-memory sheet, loads the `.gs` files through `vm`, and calls the
entry points directly. Non-zero exit if any assertion breaks.

The fake sheet is built to the shape of the real data, junk rows and all — rows carrying nothing
but a link are precisely why `lastEntry()` finds the last row *with a Property number* rather than
using `getLastRow()`.

When editing the harness:

- `onEdit` runs **after** the cell changed, so a test must assign the value before firing the event.
- A `Date` created inside `vm` belongs to another realm, so `instanceof Date` outside is always
  false. Use `Object.prototype.toString.call(...)`.
- `Utilities.formatDate` is stubbed for exactly one format, `'MMM d, yyyy'`, and **throws** on any
  other — so changing `UPDATE_DATE_FORMAT` and forgetting the harness goes red rather than quietly
  comparing the wrong thing.

## Deploying

```bash
cd apps_script && clasp push          # profile `default` (hoanng15.work)
clasp -u kenyon deploy                # deploying needs the owner account
```

**`clasp push` does not update a pinned deployment.** The extension's Web App is pinned to `@6`
as of 2026-09-14 and keeps serving that snapshot; redeploy after any change it depends on, and
verify by pulling that version back and grepping it — never by trusting the command's output.

Before pushing, check the cloud for editor-side edits that never reached git: copy `.clasp.json`
into a scratch directory, `clasp pull` **there**, and diff against the repo. Pulling into the repo
itself is what overwrites local work.

## `outreach/`

A separate standalone project, owned by the sending account rather than by the spreadsheet —
see [outreach/README.md](outreach/README.md).

Install steps: [../docs/setup.md](../docs/setup.md#5-apps-script).
What each column means: [../docs/spreadsheet.md](../docs/spreadsheet.md).
The Chrome extension: [../docs/external-applications.md](../docs/external-applications.md).
