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
| `sendRemainingAdobeReferralBatch()` | One-off, non-Queue send: skips Adobe addresses already in Sent, sends the remaining approved short-template messages one minute apart with the resume attached, and writes no queue rows. |
| `sendMicrosoftReferralBatch()` | One-off, non-Queue send: excludes Truc Nguyen, sends four Microsoft CoreAI Boston and four Mountain View requests, and schedules the seven remaining messages two minutes apart using one-shot triggers so the batch stays within Apps Script's execution limit. It is intentionally independent of the shared hourly-sender lock, attaches the resume, and writes no queue rows. |
| `stopMicrosoftReferralBatch()` | Cancels pending Microsoft direct-send triggers and marks the one-off batch cancelled; it does not alter messages already sent or any Queue rows. |
| `cleanupMicrosoftReferralBatchTriggers()` | Removes completed Microsoft one-shot triggers without changing the batch state or any sent mail. |
| `sendMicrosoftBostonLinkCorrection()` | Sends Trung Nguyen a short direct correction with the official Boston CoreAI link, without a resume or queue row; it is idempotent by recipient and subject. |
| `scheduleMicrosoftColdDrafts0909()` | One-off schedule for the seven existing Microsoft recruiter drafts on 2026-09-09, using seven ten-minute one-shot triggers from 07:00 through 08:00 America/New_York; it refuses missing, duplicate, or already-sent drafts. |
| `diagnoseMicrosoftColdDrafts0909()` | Read-only state for those seven Microsoft recruiter draft slots, including each recipient, scheduled time, send result and error if any. |
| `sendMicrosoftColdDraftSlot_()` | Internal one-shot handler: sends the assigned Microsoft draft, records the result in script properties, and removes the seven temporary triggers after completion. |
| `scheduleTargetReferralCampaign0909()` | One-off Target campaign for Sierra, Waymo and Mastercard: at most ten unsent Employees (seed) contacts per company, all ten referral templates, nine-minute spacing from 09:00 through 13:21 America/New_York, resume attachment, and Referral history rows. It is intentionally outside the paused Target-excluding planner. |
| `runTargetReferralCampaignTick_()` | Internal every-minute handler for the Target campaign. Sends only the next due entry with an eight-minute minimum gap, ticks Employees (seed), records Sent history, and refreshes Referral Seed Counts after the final entry. |
| `scheduleTargetReferralCampaign0910()` | One-off Target campaign for PayPal, Dropbox and Scale AI on 2026-09-10: at most ten unsent Employees (seed) contacts per company, all ten referral templates, nine-minute spacing from 09:00 through 13:03 America/New_York, the official resume attachment and Referral history rows. |
| `runTargetReferralCampaignTick0910_()` | Internal every-minute handler for the 2026-09-10 Target campaign. Sends only the next due entry with an eight-minute minimum gap, ticks Employees (seed), records Sent history, and refreshes Referral Seed Counts after the final entry. |
| `scheduleTargetReferralCampaign0910Datadog()` | One-off Target referral campaign for five additional Datadog contacts on 2026-09-10, using the shared referral templates from 15:15 through 15:51 America/New_York. It excludes the ten Datadog contacts already reserved for the 2026-09-11 campaign, so a person cannot receive both asks. |
| `runTargetReferralCampaignTick0910Datadog_()` | Internal every-minute handler for the 2026-09-10 Datadog referral campaign. It applies the same eight-minute gap, accepted-send employee tick, Sent history, and Target count/status sync as the other direct Target referral handlers. |
| `scheduleTargetReferralCampaign0911()` | One-off Target campaign for Datadog, Vercel, Coinbase and Red Hat on 2026-09-11: at most ten unsent Employees (seed) contacts per company, all ten referral templates where available, six-minute spacing from 09:00 through 12:54 America/New_York, the official resume attachment and Referral history rows. |
| `runTargetReferralCampaignTick0911_()` | Internal every-minute handler for the 2026-09-11 Target campaign. Sends only the next due entry with a five-minute minimum gap, ticks Employees (seed), records Sent history, and refreshes Referral Seed Counts after the final entry. |
| `scheduleTargetReferralCampaign_(config)` | Internal direct-referral scheduler. It selects each company’s eligible unsent employees, checks prior Gmail and Referral history, respects an optional recipient reservation list, and limits each company to its configured `maxContacts` (ten by default) before creating a one-minute send trigger and refreshing the Target mirrors. |
| `targetReferralCampaignEmails_(propertyKey, company)` | Internal reservation reader for a direct referral campaign. It returns normalized campaign-recipient addresses, optionally filtered to one company, so an additional campaign can select a disjoint group of people. |
| `diagnoseTargetReferralCampaigns()` | Read-only live status for the four explicit Target referral waves, grouped by company with pending/sent/failed counts and the first/last scheduled times. |
| `diagnoseDatadogLisaHuynh()` | Read-only comparison of Lisa Huynh’s Datadog employee-seed record with her 2026-09-11 campaign entry. It returns the visible name plus Unicode code points, source row, role metadata and scheduled status without returning her email address. |
| `diagnoseVietnameseGreetingCatalog()` | Read-only grouped list of every sendable Vietnamese-style given name in the recruiter and referral seeds, with its present `anh`/`chị`/untitled decision and frequency. It returns no addresses. |
| `scheduleTargetRecruiterCampaign0909()` | One-off Target recruiter campaign for Replit and five NVIDIA contacts on 2026-09-09: at most ten unsent Contacts for Replit and five for NVIDIA, using the shared cold templates every ten minutes from 13:30 through 14:50 America/New_York, with the official resume and footer. |
| `scheduleTargetRecruiterCampaign0910()` | One-off Target recruiter campaign for the five remaining NVIDIA contacts on 2026-09-10, using the shared cold templates every ten minutes from 13:30 through 14:10 America/New_York. It excludes the contacts reserved by the 09/09 half. |
| `scheduleTargetRecruiterCampaign0910Google()` | One-off Target recruiter campaign for up to seven available Google contacts on 2026-09-10, using the shared cold templates every ten minutes from 14:20 America/New_York. Live eligibility determines the final count, so a request for seven safely schedules fewer when fewer contacts are sendable. |
| `cancelTargetRecruiterCampaign0910Google()` | Cancels only pending 2026-09-10 Google Target recruiter entries, removes the campaign’s every-minute trigger, and refreshes `Email_target`. It preserves any Gmail-accepted sends and does not change NVIDIA or referral campaigns. |
| `rescheduleTargetRecruiterCampaignSplit0909()` | Cancels the original unsplit Replit/NVIDIA 09/10 state and installs the requested two-day split. It is an idempotent setup operation and does not send mail. |
| `runTargetRecruiterCampaignTick0909_()` | Internal every-minute handler for the 2026-09-09 Replit/NVIDIA half. Sends only the next due entry with a nine-minute minimum gap, then applies the shared contact and Target sync rule. |
| `runTargetRecruiterCampaignTick0910_()` | Internal every-minute handler for the 2026-09-10 Target recruiter campaign. Sends only the next due entry with a nine-minute minimum gap, ticks the cold contact Sent column after Gmail accepts the message, records the company-level Recruiter status, and refreshes both Target count snapshots. |
| `runTargetRecruiterCampaignTick0910Google_()` | Internal every-minute handler for the 2026-09-10 Google Target recruiter campaign. It applies the same nine-minute gap, accepted-send contact tick, company Recruiter status, and both Target-count refreshes as the NVIDIA handler. |
| `diagnoseTargetRecruiterCampaign0910()` | Read-only live status for the Replit/NVIDIA/Google Target recruiter campaigns, grouped by company without returning recipient addresses. Its status totals distinguish accepted sends from delivery failures. |
| `scanTargetDeliveryFailures()` | Writes the delayed final delivery result for direct Target campaigns. It reads recent `mailer-daemon` and `postmaster` notices, including recipients named only in raw failure headers, changes matching accepted sends to `Bounced`, and refreshes the Target mirrors and both hidden sendable-count snapshots. |
| `reconcileTargetDeliveryState()` | Safe manual equivalent of the delivery scanner: checks delivery failures, recomputes both sendable-count snapshots, and rebuilds both Target mirrors. It never creates, drafts, or sends email. |
| `installTargetDeliveryFailureScanner()` | Installs the safe 15-minute trigger for `scanTargetDeliveryFailures`. It does not schedule or send any email. |
| `initializeTargetQueueTabs()` | Creates or refreshes the visible `Referral_target` and `Email_target` mirrors from all currently configured Target campaign properties, including the separate Microsoft recruiter-draft scheduler; writes no Gmail messages and does not add rows to the operational queues. |
| `refreshTargetQueueTabs_()` | Internal mirror writer used after Target scheduling/send state changes. `Referral_target` mirrors the referral schema with recipients; `Email_target` mirrors the cold schema without recruiter names or addresses. Both Status columns use visible colors for Queued, Drafted, Sent, Replied, Bounced and Failed. `Cancelled` is deliberately not offered: skipped or cancelled campaign entries display as Failed because neither was sent. Microsoft draft role metadata is recovered from the saved draft body once, then persisted with the schedule state. Normal workers never read either tab. |
| `refreshReferralSeedCounts()` | Recompute the hidden `Referral Seed Counts` snapshot from non-invalid `Employees (seed)` rows, deducting any permanently `Sent`-ticked address plus addresses reserved or used in `Referral` (`Queued`, `Drafted`, `Sent`, `Replied`, `Bounced`). This keeps direct Target referral sends deducted even if their operational-history write was unavailable. |
| `refreshRecruiterSeedCounts()` | Recompute the hidden `Recruiter Seed Counts` snapshot from unique non-invalid Contacts rows, excluding `Sent`-ticked or cold-queue-committed contacts, so the bound Target script shows current recruiter availability. |
| `markTargetOutreachStatus_(company, kind)` | Record a successful referral (`refer`) or recruiter (`recruiter`) send in the hidden tracker snapshot; the bound Target script consumes it on rebuild. |
| `refreshTargetSendableCounts_()` | Refresh both hidden Target count snapshots after a successful direct send. |
| `syncTargetAfterSend_(company, kind)` | Best-effort wrapper for direct sends outside the normal queue: records the company-level status and refreshes both Target snapshots without turning a successful Gmail send into a failed send if tracker sync is temporarily unavailable. |
| `auditReferralSeedGate()` | Read-only check that every active `Queued`/`Drafted` Referral row is present in the non-invalid DeBounce seed. |
| `restoreReferralPolicyCancelledRows()` | Reopen only rows cancelled by the former risky-address gate when their current seed verdict is non-invalid, then replan them; does not send. |
| `replaceEmployeeSeed(rows)` | Clears generated employee-seed contents while preserving formatting, then writes the supplied 10-column export. Does not touch manual contacts or Referral. |
| `replaceEmployeeSeedChunk(rows, startRow, clearExisting)` | The same seed-only write with a starting row and optional one-time clear, so a large export can be sent in multiple Apps Script calls without exceeding clasp's argument limit. |
| `diagnoseReferralReplan()` | What `replanReferralAsks` **would** do — budget per day, live queued/drafted rows grouped by their scheduled day, movable rows, rows it would move, first moves — computed without writing a cell. |
| `diagnoseReferralActiveRows()` | Read-only list of active Referral rows with company, status, exact scheduled time, Priority and last error. It exposes the live two-day scheduler without recipient addresses. |
| `diagnoseReferralRecentRows()` | Read-only recent Referral rows with selected role and cancellation reason, without recipient addresses. |
| `diagnoseReferralCompanyRows(company)` | Read-only Referral rows for one named company, including the selected role and status. |
| `diagnoseReferralTab()` | `maxRows`, `lastRow`, rows with a company, blank rows still holding something, which columns keep them alive, and read/parse timings. |
| `diagnosePhantomRows()` | The statuses and error text on rows with no company, with samples. |
| `diagnoseSpentColdContacts(offset, limit)` | Read-only: the cold-path addresses the `Email` tab has already spent, resolved by hashing the contact list rather than by unhashing the tab — the salt never leaves the script. Spends on `Queued`, `Drafted`, `Sent`, `Replied` and `Bounced`, matching `outreachPlanEnqueue_`; `Cancelled` hands the address back. Paged (150 by default) because `clasp run` prints the return through `util.inspect`, which silently stops an array at a hundred entries and a string at ten thousand characters. It is what answers "who has not been written to yet", which no reader of the tab can answer. |

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
