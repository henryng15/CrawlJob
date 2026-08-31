# outreach_diag.gs — read-only probes against the live script

Temporary. Every function here reads; none writes. Delete the file once the open question below
is settled, and remove this document with it.

## Why it exists

Every rule in this project is a pure function with a passing test, and none of that says whether
the function **ran against the sheet**. `step()` swallows each failure into a `summary` that only
reaches `Logger.log`, which nobody reads. The result was a fix that verified green for weeks
while the tab it was meant to fix never changed.

These probes answer the question the tests cannot: *what is actually true on the live sheet
right now.*

| Function | Returns |
|---|---|
| `pingOutreach()` | `'pong'`. If this fails, the failure is not in the code — it is the API or the manifest. |
| `diagnoseOutreachAccess()` | The account the script runs as, both spreadsheet ids, whether each opens, the installed triggers, and the three effective send/draft switches. |
| `diagnoseReferralReplan()` | What `replanReferralAsks` **would** do — budget per day, live queued/drafted rows grouped by their scheduled day, movable rows, rows it would move, first moves — computed without writing a cell. |
| `diagnoseReferralTab()` | `maxRows`, `lastRow`, rows with a company, blank rows still holding something, which columns keep them alive, and read/parse timings. |
| `diagnosePhantomRows()` | The statuses and error text on rows with no company, with samples. |

## Running them

```
cd apps_script/outreach
clasp -u workgcp run diagnoseOutreachAccess
```

`clasp run` needs three things, and the third is the one that wastes a day:

1. The Apps Script project linked to a **standard GCP project**.
2. clasp logged in with a **Desktop-app OAuth client from that same project**
   (`show-authorized-user` must print `(user-provided)`).
3. **`"executionApi": { "access": "MYSELF" }` in `appsscript.json`.**

Without (3), `scripts.run` returns `Exception: ... a server error occurred while reading from
storage. Error code NOT_FOUND. []` for *every* function, including one that only returns a
constant. The message names neither the manifest nor the API and reads exactly like a
permissions failure. **The cheap discriminator:** call a function name that does not exist. A
different message (`Unable to run script function`) means the API reached the script and refused
to execute — so the problem is the manifest, not the linkage.

## Open question

`runOutreachCycle` fires hourly and does not reach its later steps. Ruled out with these probes:
code drift, missing trigger, sheet access, budget starvation, and the planner logic itself
(`replanReferralAsks` standalone returns `moved: 97, sorted: 98`, clean).

The blank-row bug in [outreach-referral-queue.md](outreach-referral-queue.md) was found on the
way and is fixed, but it does **not** explain this: reading 499 rows measured 443 ms, so row
volume is not a six-minute timeout. The remaining suspects are the Gmail-heavy early steps
(`scan`, `rejections`, `referralScan`).

**The `Cycle Health` tab is what will answer it.** A run that dies part way leaves a row stuck on
`running`. Read that, or the Executions screen in the editor — Cloud Logging only holds data from
2026-08-30, when the GCP project was first linked.
