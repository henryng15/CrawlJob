# outreach_offtarget_waves.gs — the manual off-Target recruiter waves

Two explicit recruiter campaigns for employers that are **not** on the `Target` shortlist. They
exist because the Target campaign machinery is the only path that can send at an arbitrary hour,
and the owner asked for two windows outside the normal sending window.

## Connections

- **Reads:** `Contacts (seed)` through `outreachReadContacts_`, the `Email` queue through
  `targetRecruiterSpentFingerprints_`, and Gmail for the per-entry rejection preflight.
- **Writes:** the campaign Script Property, one every-minute trigger per wave, and the
  `Email_target` mirror through `refreshTargetQueueTabs_`, whose recruiter-key list includes
  both off-Target campaign properties.
- **Runs:** manually, through `clasp run`. Never from a scheduler.

## The two waves

| Function | Property | Window (ET) | Spacing | Employers |
|---|---|---|---|---|
| `scheduleOffTargetRecruiterCampaign0913Night()` | `OFFTARGET_RECRUITER_CAMPAIGN_20260913_NIGHT` | 2026-09-13 23:00 to 23:50 | 2 min | 26 |
| `scheduleOffTargetRecruiterCampaign0914Early()` | `OFFTARGET_RECRUITER_CAMPAIGN_20260914_EARLY` | 2026-09-14 03:00 to 04:12 | 12 min | 7 |
| `migrateOffTargetRecruiterCampaignsToEmail()` | both properties | one-time | n/a | 32 valid rows |
| `restoreOffTargetEmailQueueTiming()` | `Email` ids `OFFTARGET-EMAIL-*` | 2026-09-13 23:00 to 23:50; 2026-09-14 03:00 to 04:12 | 2 / 12 min | 25 / 7 |
| `diagnoseOffTargetMigrationToEmail()` | `Email` ids `OFFTARGET-EMAIL-*` | read-only | n/a | count only |

Each has a matching every-minute tick wrapper, `runOffTargetRecruiterCampaignTick0913Night_` and
`runOffTargetRecruiterCampaignTick0914Early_`, which delegate to
`runTargetRecruiterCampaignTickFor_`.

`migrateOffTargetRecruiterCampaignsToEmail()` is the one-time exit path for these
direct waves. It keeps the selected recipients, verifies their App state, contact availability,
sent-mail history and Advanced Gmail rejection state, appends ordinary `Queued` rows to `Email`,
then deletes both direct triggers and campaign properties. It balances the regular cold templates.
`restoreOffTargetEmailQueueTiming()` restores the requested 23:00 and 03:00 timestamps and installs
`runOffTargetEmailQueueTick_`, which delivers only those `Email` rows at their explicit times.
A matching Gmail rejection is blocked and reported while every other fully valid entry proceeds; a
sent, changed, Target-listed, missing or already-committed entry aborts the migration before it
changes either direct campaign.

`diagnoseOffTargetMigrationToEmail()` is a read-only count by normal-queue status and scheduled
calendar day. It returns no recruiter names or addresses.

`restoreMicronOffTargetEmailRow()` is the one-time repair for Micron's false block: its unreadable
Workday acknowledgement body was not a verified rejection. It selects the same first available
recruiter rule as the original wave and restores the original 23:36 ET slot.

## How the employers were chosen

Every employer satisfies all of: an application already in `App`, not on the `Target` shortlist,
not a quant or proprietary trading firm, no rejection for it anywhere in the mailbox, and at least
one **open** Software Engineer Intern, Software Developer, or Software Engineering Co-op
requisition. Roles containing `Design` or `Embedded` are excluded. Applications are at least two
days old, per `ELIGIBLE_AFTER_DAYS`.

## Why excludeEmails is long

`scheduleTargetRecruiterCampaign_` sorts a company's contacts by name and takes the first
`maxContacts`. With `maxContacts: 1` that is the alphabetically first recruiter, which is not the
best-verified one. Every other contact at each employer is therefore listed in `excludeEmails`, so
the selector is left with exactly the intended person: the one whose `Verify` column reads
`debounce:Safe to Send` ahead of `anymail_verify`, `local:high` and `debounce:Risky`, with a
technical, university or campus title preferred over a sales or clinical one.

Four original candidates were removed by the final role filter: Brunswick (Software Controls),
CesiumAstro and CACI International (Embedded), By Light (Software Design), and GE HealthCare
(a general engineering-development program). Verkada was also removed for an Embedded role.
whatnot was eligible but has no recruiter left after the early wave dynamically excludes the five
contacts already reserved by its Target campaign, so the two campaigns cannot select the same
person. The early wave therefore schedules seven employers.

## Hours, caps and what these waves bypass

A direct campaign does not enter the `Email` queue, so it is bound by neither
`SEND_HOUR_FIRST..SEND_HOUR_LAST` nor the weekday `DAILY_CAP` (which is **0** on a Sunday) nor
`DAILY_EMAIL_BUDGET`. That is what makes a 23:00 and an 03:00 wave possible, and it is also why
these two functions must never be wired to a scheduler: nothing else would stop them.

The per-entry Gmail rejection preflight still runs immediately before each `sendEmail`, and a
blocked entry is recorded as cancelled with its reason rather than sent.

After `migrateOffTargetRecruiterCampaignsToEmail()` succeeds, neither direct wave remains in
`Email_target`; the operational `Email` rows are the sole send instructions. The off-Target minute
handler, rather than the ordinary weekday queue, sends them at 23:00 and 03:00.
