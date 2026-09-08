# outreach_config.gs — constants, seasons, shared helpers

Loaded first. Every other outreach file reads its column numbers, caps and status words from
here. Nothing in this file touches a sheet or Gmail.

## Connections

- **Read by:** every other `outreach_*.gs`.
- **Column constants must match the live tabs.** `Q_*` describes `Email` (23 columns), `R_*`
  describes `Referral` (20), `APP_*` describes `App`, `C_*`/`E_*` the contacts spreadsheet.
  Layout migrations live in [tracker-sync.md](tracker-sync.md); this file only names positions.
- The referral sender's cross-project handoff is `Employees (seed)` plus the hidden tracker tab
  `Referral Seed Counts`; every Verify value except `debounce:invalid` is sendable, including blank.

## Script properties

| Property | Holds |
|---|---|
| `TRACKER_SHEET_ID` | The tracker spreadsheet. Despite the comment saying "Track App", it points at **Job and Update - SWE Intern**. |
| `CONTACTS_SHEET_ID` | The contacts spreadsheet, owned by the sending account. |
| `RESUME_FILE_ID` | The resume PDF in Drive. It must point to `OFFICIAL_RESUME_FILE_ID`, the stable Drive file that the Resume repository's GitHub workflow overwrites on every `main` push changing `official/henryng_swe.pdf`. |
| `FINGERPRINT_SALT` | Salts the contact fingerprint. Changing it re-opens every past contact. |
| `OUTREACH_MODE`, `FOLLOWUP_MODE`, `REFERRAL_MODE` | `Draft` holds messages in Drafts; blank sends them. `REFERRAL_MODE = Pause` stops referral planning, drafting, sending and reply scanning only. |
| `REFERRAL_REJECTED_VERIFY` | `debounce:invalid` — the only Verify verdict that blocks a referral recipient; blank and all other verdicts are accepted. |

## The caps that decide volume

| Constant | Value | Means |
|---|---|---|
| `DAILY_EMAIL_BUDGET` | 30 | Everything the mailbox may send in a day. The path caps now sum to exactly this (20 cold + 10 referral + 0 follow-up), so it no longer binds and no path can displace another. |
| `EMAIL_PATH_ORDER` | `referral, cold` | Priority when real queued work competes for the shared budget. Referral leads because it is scarcest. `followup` was removed when the path was switched off; a path absent from this list still gets a correct budget answer (the reservation loop simply never breaks early) and is stopped by its own zero cap. |
| `DAILY_CAP` | `[0,20,20,20,20,20,0]` | Cold path, by weekday: a flat 20 on Mon-Fri, 100 a week. Saturday and Sunday stay zero because a cold email read at the weekend is read badly. Was `[0,17,27,24,20,12,0]`. |
| `REFERRAL_DAILY_CAP` | 10 | Hard maximum of 10 referral asks per day, one per hour inside the 06:00-19:00 window with no doubled slots. Was 15. |
| `REFERRAL_PER_COMPANY` | 6 | People ever asked at one employer. There is no second attempt. |
| `REFERRAL_COMPANY_DAILY_CAP` | **6** | Contacts per employer cluster per day, capped by the six-person lifetime allowance. A cluster stays together while the application is fresh. |
| `REFERRAL_PRIORITY_COMPANY_CAP` | 6 | What a ticked employer gets instead — the whole group in one day. Raises the cap, never removes it. |
| `REFERRAL_RECENT_APPLICATION_DAYS` | 1 | New Referral asks may be created only on the application day or the following calendar day. Out-of-window unsent rows are cancelled automatically. |
| `REFERRAL_PRIORITY_APPLICATION_DAYS` | 1 | Applications made today or yesterday are automatically marked `Priority`. |
| `REFERRAL_PRIORITY_WINDOW_MINUTES` | 120 | A Priority ask uses the fast lane and is scheduled within two hours when that lane has room. |
| `REFERRAL_PRIORITY_GAP_MINUTES_MIN` / `MAX` | 10 / 20 | Deterministic jitter between fast-lane sends. It looks varied but remains stable across replans. |
| `REFERRAL_TOP_COMPANY_PROPERTY_MAX` | 0 | Retained for compatibility only; Target membership, not `App!Property`, decides the company gate. |
| `REFERRAL_QUANT_COMPANIES` | named firms | Quant firms excluded from the Referral campaign, even for a today/yesterday application. Matching uses the shared employer normaliser. |
| `FOLLOWUP_DAILY_CAP` | **0** | The follow-up path is switched off. Zero rather than deleted: the planner already respects this cap, so it is the smallest switch that stops every one of the path's writes. Restoring the feature needs both a number here **and** `followup` back in `EMAIL_PATH_ORDER`. Was 6. |
| `WAVE_SIZE` / `WAVE_GAP_DAYS` | 3 / 5 | Cold contacts per wave, and the gap before the next. |

## Timing

| Constant | Value |
|---|---|
| `SEND_HOUR_FIRST` / `SEND_HOUR_LAST` | 9 / 17 — nine sending hours a day |
| `DRAFT_HOUR_FIRST` / `DRAFT_HOUR_LAST` | 8 / 16 — compatibility bounds for the cold writer's fallback pacing |
| `REFERRAL_HOUR_FIRST` / `REFERRAL_HOUR_LAST` | 6 / 19 |
| `FOLLOWUP_HOUR_FIRST` / `FOLLOWUP_HOUR_LAST` | 8 / 19 |
| `COLD_DRAFT_LEAD_MINUTES` | 20 — a cold message is written twenty minutes before it goes |
| `DRAFT_LEAD_HOURS` | 1 — Referral retains a one-hour review window |
| `ELIGIBLE_AFTER_DAYS` | 2 — after `Date Applied` before anything may go |
| `FOLLOWUP_AFTER_DAYS` / `FOLLOWUP_WINDOW_DAYS` / `FOLLOWUP_LATEST_DAYS` | 5 / 10 / 21 |
| `REFERRAL_WEEKENDS` | `false` — a favour asked on a Saturday reads badly |
| `FOLLOWUP_WEEKENDS` | `true` |

## Statuses

`STATUS_QUEUED · DRAFTED · SENT · REPLIED · BOUNCED · CANCELLED · FAILED`, plus
`MODE_DRAFT`/`MODE_SEND`/`MODE_PAUSE` and a parallel `FOLLOWUP_*` set. `STATUS_SPENDS_CONTACT` names the
statuses that count as having used a person up. `PRIORITY_DONE = 'Done'` is what a spent tick
becomes — it must still count as ticked.

## Functions

| Function | Does |
|---|---|
| `outreachSeason_(role)` | Which intake a role belongs to: summer or off-cycle. |
| `outreachOtherSeason_(s)` | The other one. |
| `outreachEligibleDay_(...)` | The first day an application may be written about. |
| `outreachQualifies_(row)` | Whether an application's `Process` still admits a cold email. Only `Applied` and `Completed OA`. |
| `outreachFollowUpDayAllowed_(day)` | Whether a day may carry follow-ups at all. |
| `outreachModeFor_(...)` | Draft or send, for one row. |
| `outreachProperty_(name, required)` | One script property, throwing if a required one is unset. |
| `outreachReferralPaused_()` | Whether the referral path is paused without affecting cold email or follow-ups. |
| `pauseReferralPath()` / `resumeReferralPath()` | Run by hand to pause or resume referral automation while returning the three active modes. |
| `pauseAllOutreach()` | Set cold, follow-up and referral modes to `Pause`, preventing every outreach path from drafting or sending. |
| `resumeAllOutreach()` | Clear the three global mode overrides and restore all paths to their normal `Send` behavior. |
| `resetReferralQueueForFreshPlan()` | Soft-cancel unsent Queued/Drafted referral rows, delete their Gmail drafts, and preserve Sent/Replied/Bounced history for one-send-only deduplication. |
| `setupOutreachProperties()` | Run by hand: report which properties are still missing. |
| `diagnoseOutreachResume()` | Read the Drive resume configured for attachment and return its name, MIME type, size, update time and SHA-256 checksum, without returning the Drive id. Used to prove that the sender's attachment matches the local PDF. |
| `useOfficialResumeAttachment()` | Validate the stable, GitHub-synchronised official Drive PDF and set `RESUME_FILE_ID` to it. Run once to repair a stale sender pointer; subsequent official-resume pushes update the same Drive file automatically. |
| `outreachTicked_(value)` | Whether a hand-ticked cell counts as ticked — `true`, `"yes"`, `"x"`, `"1"`, `"Done"`. Reading only `=== true` would ignore what people actually type. |
| `outreachMidnight_`, `outreachDaysBetween_`, `outreachAddDays_`, `outreachDayKey_` | Date arithmetic that never trips over clock time. |
| `outreachFingerprint_(email)` | A non-reversible name for an address, so the tracker can say "this person has been written to" without holding the address. |
| `outreachDailyCap_(day)`, `outreachDraftHoursForDay_(day)` | The cold path's shape for one day. |
| `outreachFromAddress_(header)` | The address out of a `From` line. |
| `outreachThreadVerdict_(thread)` | What came back: a reply, a delivery failure (`OUTREACH_BOUNCE_SENDER`), or nothing yet. |
| **`outreachInterleaveByCompany_(rows)`** | **Rows reordered so employers take turns: A,B,C,A,B,C rather than A,A,B,B.** Shared by the cold and referral planners because both had the same bug. Keys on `outreachCompanyTokens_`, not `outreachNameKey_`, or "Stripe" and "Stripe Inc." take two turns each. Orders only; it does not schedule. |
| `outreachSpaceHours_(n, first, last)` | `n` hours spread evenly across a window. |
| `outreachSpreadHours_(...)` | The cold path's variant. |
