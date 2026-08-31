# outreach_config.gs — constants, seasons, shared helpers

Loaded first. Every other outreach file reads its column numbers, caps and status words from
here. Nothing in this file touches a sheet or Gmail.

## Connections

- **Read by:** every other `outreach_*.gs`.
- **Column constants must match the live tabs.** `Q_*` describes `Email` (23 columns), `R_*`
  describes `Referral` (20), `APP_*` describes `App`, `C_*`/`E_*` the contacts spreadsheet.
  Layout migrations live in [tracker-sync.md](tracker-sync.md); this file only names positions.

## Script properties

| Property | Holds |
|---|---|
| `TRACKER_SHEET_ID` | The tracker spreadsheet. Despite the comment saying "Track App", it points at **Job and Update - SWE Intern**. |
| `CONTACTS_SHEET_ID` | The contacts spreadsheet, owned by the sending account. |
| `RESUME_FILE_ID` | The resume PDF in Drive. It must point to `OFFICIAL_RESUME_FILE_ID`, the stable Drive file that the Resume repository's GitHub workflow overwrites on every `main` push changing `official/henryng_swe.pdf`. |
| `FINGERPRINT_SALT` | Salts the contact fingerprint. Changing it re-opens every past contact. |
| `OUTREACH_MODE`, `FOLLOWUP_MODE`, `REFERRAL_MODE` | `Draft` holds messages in Drafts; blank sends them. |

## The caps that decide volume

| Constant | Value | Means |
|---|---|---|
| `DAILY_EMAIL_BUDGET` | 47 | Everything the mailbox may send in a day, across all three paths. |
| `EMAIL_PATH_ORDER` | `referral, cold, followup` | Who reserves first. Referral leads because it is scarcest; follow-up is last because it loses least by slipping a day. |
| `DAILY_CAP` | `[0,17,27,24,20,12,0]` | Cold path, by weekday. Sunday and Saturday are zero. |
| `COMPANY_WEEKLY_CAP` | 5 | Cold emails per company per rolling 7 days. |
| `REFERRAL_DAILY_CAP` | 20 | Referral asks a day. The 06:00–19:00 window has fourteen hours, so six hours may carry two asks; total mailbox volume remains capped at 47 and lower-priority paths yield as necessary. |
| `REFERRAL_PER_COMPANY` | 6 | People ever asked at one employer. There is no second attempt. |
| `REFERRAL_COMPANY_DAILY_CAP` | **1** | People per employer per day. This is what spreads the queue across employers. |
| `REFERRAL_PRIORITY_COMPANY_CAP` | 6 | What a ticked employer gets instead — the whole group in one day. Raises the cap, never removes it. |
| `REFERRAL_RECENT_APPLICATION_DAYS` | 7 | New Referral asks may be created for an application made in the last seven calendar days. |
| `REFERRAL_PRIORITY_APPLICATION_DAYS` | 1 | Applications made today or yesterday are automatically marked `Priority`. |
| `REFERRAL_PRIORITY_WINDOW_MINUTES` | 120 | A Priority ask uses the fast lane and is scheduled within two hours when that lane has room. |
| `REFERRAL_PRIORITY_GAP_MINUTES_MIN` / `MAX` | 10 / 20 | Deterministic jitter between fast-lane sends. It looks varied but remains stable across replans. |
| `REFERRAL_TOP_COMPANY_PROPERTY_MAX` | 70 | A non-quant employer with `App!Property` at or below this existing priority rank remains eligible after seven days. |
| `REFERRAL_QUANT_COMPANIES` | named firms | Quant firms excluded from the Referral campaign, even for a today/yesterday application. Matching uses the shared employer normaliser. |
| `FOLLOWUP_DAILY_CAP` | 6 | Follow-ups a day. |
| `WAVE_SIZE` / `WAVE_GAP_DAYS` | 3 / 14 | Cold contacts per wave, and the gap before the next. |

## Timing

| Constant | Value |
|---|---|
| `SEND_HOUR_FIRST` / `SEND_HOUR_LAST` | 9 / 17 — nine sending hours a day |
| `DRAFT_HOUR_FIRST` / `DRAFT_HOUR_LAST` | 8 / 16 — the same window shifted back by `DRAFT_LEAD_HOURS`, derived not typed |
| `REFERRAL_HOUR_FIRST` / `REFERRAL_HOUR_LAST` | 6 / 19 |
| `FOLLOWUP_HOUR_FIRST` / `FOLLOWUP_HOUR_LAST` | 8 / 19 |
| `DRAFT_LEAD_HOURS` | 1 — a message is written one hour before it goes, so the hour it could have been read always exists |
| `ELIGIBLE_AFTER_DAYS` | 2 — after `Date Applied` before anything may go |
| `FOLLOWUP_AFTER_DAYS` / `FOLLOWUP_WINDOW_DAYS` / `FOLLOWUP_LATEST_DAYS` | 5 / 10 / 21 |
| `REFERRAL_WEEKENDS` | `false` — a favour asked on a Saturday reads badly |
| `FOLLOWUP_WEEKENDS` | `true` |

## Statuses

`STATUS_QUEUED · DRAFTED · SENT · REPLIED · BOUNCED · CANCELLED · FAILED`, plus
`MODE_DRAFT`/`MODE_SEND` and a parallel `FOLLOWUP_*` set. `STATUS_SPENDS_CONTACT` names the
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
