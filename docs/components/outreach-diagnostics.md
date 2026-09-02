# outreach_diag.gs — diagnostics and seed maintenance against the live script

Most functions here are read-only probes. `replaceEmployeeSeed` is the deliberate exception:
it replaces only the generated `Employees (seed)` tab and leaves `Contacts (manual)` and
`Referral` untouched.

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
| `refreshReferralSeedCounts()` | Recompute the hidden `Referral Seed Counts` snapshot from non-invalid `Employees (seed)` rows, deducting referral addresses already reserved or used (`Queued`, `Drafted`, `Sent`, `Replied`, `Bounced`), so the bound Company script shows what remains available without cross-account access. |
| `auditReferralSeedGate()` | Read-only check that every active `Queued`/`Drafted` Referral row is present in the non-invalid DeBounce seed. |
| `restoreReferralPolicyCancelledRows()` | Reopen only rows cancelled by the former risky-address gate when their current seed verdict is non-invalid, then replan them; does not send. |
| `replaceEmployeeSeed(rows)` | Clears generated employee-seed contents while preserving formatting, then writes the supplied 10-column export. Does not touch manual contacts or Referral. |
| `replaceEmployeeSeedChunk(rows, startRow, clearExisting)` | The same seed-only write with a starting row and optional one-time clear, so a large export can be sent in multiple Apps Script calls without exceeding clasp's argument limit. |
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
