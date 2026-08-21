# Apps Script

These two files run on Google's side, not on Python's. They live in the Apps Script editor
attached to the spreadsheet; the copy in the repo is the original, kept for version control,
because the Apps Script editor has no history worth relying on.

| File | Function to run by hand | |
|---|---|---|
| `sync_applied_to_app.gs` | `setupJobsCheckboxes` | builds the `Applied` (F) and `Expired` (G) checkboxes on the Jobs tab |
| | `setupAppColumns` | builds `Alumni` (I), `Recruiter` (J), `Update` (K) on the App tab |
| | `setupOutreachQueue` | creates the empty `Outreach Queue` tab and its queue-state dropdowns; it does not queue an application or send email |
| | `backfillTicksFromApp` | scans the App tab and pre-ticks in Jobs the jobs already applied to |
| `external_application_api.gs` | `configureExternalApplicationApi` | prepares the secure Web App endpoint used by the personal Chrome extension to add an external application to App |
| `setup_process_dropdown.gs` | `setupProcessDropdown` | builds the coloured `Process` dropdown on the App tab |

`onEdit` in `sync_applied_to_app.gs` is a **simple trigger** — Google calls it itself
whenever a cell is edited, and no trigger has to be installed. The first thing it does is ask
which tab the edited cell belongs to and hand it to the right half, and each half returns at
once if the column is wrong:

| Tab | Column | What it does |
|---|---|---|
| Jobs | F `Applied` | copies that row to the App tab |
| App | F `Process` | appends a `<Stage>: <date>` line to column K `Update` |

How to install it: [../docs/setup.md](../docs/setup.md#5-apps-script).
What each column means: [../docs/spreadsheet.md](../docs/spreadsheet.md).
How to add external applications from Chrome: [../docs/external-applications.md](../docs/external-applications.md).

## Running the tests

```bash
node apps_script/harness.js
```

Nothing to install, and it does not touch the real spreadsheet. `harness.js` stubs
`SpreadsheetApp` with a fake in-memory sheet, loads the `.gs` files through `vm`, then calls
`onEdit`, `backfillTicksFromApp`, `setupJobsCheckboxes` and `setupAppColumns` directly. 56
assertions, printing `ok` / `FAIL` a line and returning a non-zero exit code if any of them
breaks.

The fake sheet is built to the shape of the real data, including the junk rows carrying
nothing but a link that the App tab currently holds — they are precisely why `lastEntry()`
has to find the last row *with a Property number* instead of using `getLastRow()`.

A few things to know when editing the harness:

- `onEdit` runs **after** the cell has changed value, so a test has to assign
  `grid[r][4] = true` before firing the event.
- A `Date` created inside `vm` belongs to another realm, and `instanceof Date` outside is
  always false. Use `Object.prototype.toString.call(...)`.
- `Utilities.formatDate` is stubbed for exactly one format, `'MMM d, yyyy'`, and **throws**
  on any other. Change `UPDATE_DATE_FORMAT` in the `.gs` and forget the harness, and the
  test goes red rather than quietly comparing the wrong thing.
