# outreach_offtarget_waves.gs — the manual off-Target recruiter waves

Explicit recruiter campaigns for employers that are **not** on the `Target` shortlist. They
exist because the Target campaign machinery is the only path that can send at an arbitrary hour,
and the owner asked for windows outside the normal sending window.

## Connections

- **Reads:** `Contacts (seed)` through `outreachReadContacts_`, the `Email` queue through
  `targetRecruiterSpentFingerprints_`, and Gmail for the per-entry rejection preflight.
- **Writes:** the campaign Script Property, one every-minute trigger per wave, and the
  `Email_target` mirror through `refreshTargetQueueTabs_`, which dynamically includes every
  persisted `OFFTARGET_RECRUITER_CAMPAIGN_*` property.
- **Runs:** manually, through `clasp run`. Never from a scheduler.

## The two waves

| Function | Property | Window (ET) | Spacing | Employers |
|---|---|---|---|---|
| `scheduleOffTargetRecruiterCampaign0913Night()` | `OFFTARGET_RECRUITER_CAMPAIGN_20260913_NIGHT` | 2026-09-13 23:00 to 23:50 | 2 min | 26 |
| `scheduleOffTargetRecruiterCampaign0914Early()` | `OFFTARGET_RECRUITER_CAMPAIGN_20260914_EARLY` | 2026-09-14 03:00 to 04:12 | 12 min | 7 |
| `scheduleOffTargetRecruiterWeekend0919And0920()` | `OFFTARGET_RECRUITER_CAMPAIGN_20260919_WEEKEND_SATURDAY` / `...0920_WEEKEND_SUNDAY` | 2026-09-19 09:00 to 16:48 / 2026-09-20 09:00 onward | 12 min | 40 Saturday, then every remaining eligible company Sunday |
| `resplitOffTargetRecruiterWeekend0919And0920ToReported71()` | same two properties | same dates/times | 12 min | Before delivery only, removes the two companies that appeared after the reported 71-company audit and restores the requested 40/31 split without replacing recruiter selections. |
| `moveRecentOffTargetWeekendApplicationsTo0926And0927()` | all four `...0919`, `...0920`, `...0926_RECENT_SATURDAY`, `...0927_RECENT_SUNDAY` properties | 2026-09-19/20 and 2026-09-26/27, from 09:00 | 12 min | Retimes only the existing companies with an App Software Engineer/Engineering Intern application in the latest five calendar weeks to the following weekend; the return includes a live application snapshot. |
| `migrateOffTargetWeekendRecruiterCampaignsToEmail()` | four pending weekend campaign properties → `Email` ids `OFFTARGET-EMAIL-WEEKEND-*` | preserves 2026-09-19/20/26/27 timestamps | 12 min | Moves all 71 selected recipients to operational Email rows, then removes the direct campaign state and mirror rows. |
| `scheduleOffTargetWeekendStartupRecruiters()` | `Contacts (manual)` and `Email` ids `OFFTARGET-EMAIL-WEEKEND-STARTUP-*` | 2026-09-20 09:12–09:36 ET | 12 min | Appends three Hunter-verified technical recruiters for owner-screened growth/value startups and queues one per company only after live App, Target, duplicate-mail and daily-limit checks. |
| `scheduleOffTargetWeekendStartupCareersContacts()` | `Contacts (manual)` and `Email` ids `OFFTARGET-EMAIL-WEEKEND-CAREERS-*` | 2026-09-19/20 13:24–13:36 ET | 12 min | Appends four MillionVerifier-confirmed recruiter/career-owner contacts and queues two after each existing weekend wave, after live App, Target, duplicate-mail and all-queue/campaign daily-limit checks. |
| `scheduleOffTargetWeekendStartupTregContacts()` | `Contacts (manual)` and `Email` id `OFFTARGET-EMAIL-WEEKEND-TREG-20260919-1` | 2026-09-19 13:48 ET | n/a | Appends the one additional Treg directory/email-finder contact with a synchronous MillionVerifier `ok` verdict, then queues it only after live App, Target, duplicate-mail, commitment and all-queue/campaign daily-limit checks. |
| `scheduleOffTargetJuiceboxRecruiterExpansion20260920()` | `Contacts (manual)` and `Email` ids `OFFTARGET-EMAIL-WEEKEND-JUICEBOX-20260920-1..2` | 2026-09-20 13:48–14:00 ET | 12 min | Adds only the two additional verified recruiting/careers contacts at Juicebox to its already-booked founding-recruiter cold email. |
| `queueOwnerApprovedOffTargetRecruiters0916()` | ordinary `Email` ids `MANUAL-EMAIL-20260916-*` | no fixed send time | n/a | Bounded one-recruiter queue entry for Baird, Dow Jones, and Textron GSE; validates the exact live Applied SWE role/link, Target exclusion, Gmail rejection state, prior send, and recruiter commitment. It creates no draft, trigger, or delivery time while Automatic outreach is paused. |
| `expandOwnerApprovedOffTargetRecruiters0916ToFive()` | `Contacts (manual)` plus ordinary `Email` ids `MANUAL-EMAIL-20260916-*-TOPUP-*` | no fixed send time | n/a | Appends only its nine MillionVerifier-`ok` contacts and expands Baird, Dow Jones, and Textron GSE to exactly five active ordinary Email rows each. It cannot find a sixth recruiter, create a draft, set a timestamp, or install a sender trigger. |
| `rebalanceOffTargetWeekendEmail0919And0920()` | queued `OFFTARGET-EMAIL-WEEKEND-*` rows | 2026-09-19/20 from 09:00 ET | 12 min | Pending-only 40/4 → 22/22 repair that preserves the first 22 Saturday recipients and moves 18 after Sunday’s existing rows. |
| `migrateOffTargetRecruiterCampaignsToEmail()` | both properties | one-time | n/a | 32 valid rows |
| `restoreOffTargetEmailQueueTiming()` | `Email` ids `OFFTARGET-EMAIL-*` | 2026-09-13 23:00 to 23:50; 2026-09-14 03:00 to 04:12 | 2 / 12 min | 25 / 7 |
| `diagnoseOffTargetMigrationToEmail()` | `Email` ids `OFFTARGET-EMAIL-*` | read-only | n/a | count only |

Each has a matching every-minute tick wrapper, `runOffTargetRecruiterCampaignTick0913Night_` and
`runOffTargetRecruiterCampaignTick0914Early_`, which delegate to
`runTargetRecruiterCampaignTickFor_`.

`offTargetWeekendRecruiterSpecs_()` is the bounded selector behind the weekend campaign. It
reruns `auditRecentOffTargetSummer2027RecruiterGaps()` at schedule time, chooses one recruiter per
company, uses the newest qualifying App role/link, then tests the selected app against one fresh
Advanced Gmail rejection candidate set. The Saturday and Sunday ticks repeat the rejection check
immediately before each send. There are only 71 distinct companies in the audit, so Sunday is
intentionally not padded with duplicate companies after Saturday takes the first 40.

The schedule-time audit later surfaced Baird and Dow Jones, which were not in the 71-company
report the owner explicitly selected. `resplitOffTargetRecruiterWeekend0919And0920ToReported71()`
is the one-time pending-only repair: it removes only those two live-only companies, moves the
first two Sunday entries into Saturday, and retains all other recruiter selections.

`moveRecentOffTargetWeekendApplicationsTo0926And0927()` is also pending-only. It treats the
latest five calendar weeks inclusively (August 12–September 15 for this invocation), reads live
non-rejected `App` rows for each of the protected 71 companies, and requires the role to contain
both `Intern` and either `SWE` or `Software Engineer`/`Software Engineering`; `Embedded` and
co-op roles remain excluded. A qualifying entry uses its newest matching App role and job link,
while preserving the already-selected recruiter and template. Companies with one or more such
recent applications are split across Saturday and Sunday morning on September 26–27; all other
entries are reflowed over September 19–20. It reports both the live application count and the
count in the recent window, and installs/deletes the two later minute triggers as needed. It does
not create drafts or send email; the direct delivery tick still performs its Gmail rejection
preflight immediately before each eventual send.

`migrateOffTargetWeekendRecruiterCampaignsToEmail()` is the corresponding pending-only exit
path when the owner wants off-Target work represented in the operational `Email` tab rather than
the `Email_target` direct-campaign mirror. It preserves recipient fingerprint, selected template,
SWE-intern role/link and every explicit timestamp; verifies the live App, Target exclusion,
selected recruiter, queue commitment and sent-mail state before appending anything. An entry that
has become ineligible (including a matching App rejection) is retained as `Cancelled` in `Email`
with its reason instead of silently disappearing; no Gmail action occurs during migration. It then
removes only the four weekend direct states and their triggers, refreshes the now-Target-only
mirror, and ensures the dedicated `runOffTargetEmailQueueTick_` trigger owns delivery. The normal
automated Email path deliberately ignores these rows, so a paused or later-resumed planner cannot
reflow or duplicate the weekend sends.

`scheduleOffTargetWeekendStartupRecruiters()` is the manual supplement for a live 5-week App
screen: candidates must be off-Target, non-quant SWE interns with neither a recruiter contact nor
an existing email commitment. The owner-selected startup evidence supports Hadrian, Neuralink and
Pacific Fusion; Hunter Domain Search returned one `valid` technical recruiter at each. The function
adds only those three people to `Contacts (manual)`, confirms the application and no previous
outbound thread/queue commitment, and appends explicit Sunday Email rows. It refuses to exceed 55
planned messages for the date, does not draft or send while scheduling, and relies on the dedicated
minute sender's final Gmail rejection preflight.

`scheduleOffTargetWeekendStartupCareersContacts()` is the follow-on path for a startup with no
recruiter in the database: it searches Talent/People/Careers owners, accepts only a complete name
with a synchronous MillionVerifier `ok` email, and excludes incomplete-name, catch-all and invalid
outcomes. The current bounded set is Brandon Miller (Allen Control Systems), Tasha Vance (Nominal),
Farron McDonald (Juicebox), and Brittany Miller (General Matter). It counts normal `Email` rows and
direct Target campaign entries before admitting two sends to each weekend date; it neither drafts
nor sends while scheduling.

`scheduleOffTargetWeekendStartupTregContacts()` is an idempotent, separately auditable
follow-on for the remaining owner-selected startups. It stores a contact only after the Treg
directory, email finder and synchronous MillionVerifier return a complete name and `ok` outcome;
catch-all, invalid, incomplete and no-result candidates are never written. Its date follows the
same five-day recency split as the weekend wave, and its explicit `Email` row remains owned by the
dedicated rejection-preflighting minute sender. It does not draft or send during scheduling.

`scheduleOffTargetJuiceboxRecruiterExpansion20260920()` is the bounded follow-up after the owner
asked to send more to Juicebox. It retains the existing Founding Recruiter entry and adds only
Michelle Benoit (Senior Technical Recruiter) and Lauren Hoe (Talent Partner), both returned
SMTP-valid by TryKitt and `ok` by MillionVerifier. It does not substitute software engineers or
founders to make an arbitrary contact count. It rechecks the active SWE Intern App row, Target
exclusion, current Gmail rejection evidence, every selected mailbox, all queue commitments and
the 55-message daily limit before appending two explicit direct-delivery Email rows.

`queueOwnerApprovedOffTargetRecruiters0916()` is intentionally not an explicit off-Target
weekend wave. It books three ordinary `Email` rows requested after the coverage audit, one per
employer, with no `Scheduled At` value and an id outside the `OFFTARGET-EMAIL-*` namespace.
Therefore `runOffTargetEmailQueueTick_` cannot pick it up; it remains queued until the owner
explicitly chooses a delivery date/path. It rechecks exact App role/link, Target exclusion, sent
mail, committed fingerprints and Advanced Gmail rejection evidence before its append.

`expandOwnerApprovedOffTargetRecruiters0916ToFive()` is the subsequent owner-requested minimum-
five expansion. Its roster is the twelve specific people returned by the free people search, paid
email finder and MillionVerifier `ok` gate; the append helper deduplicates against both contacts
tabs. It rechecks each exact live App role/link, Target exclusion, sent-mail history, Gmail
rejection evidence and contact fingerprint, then fills only the difference between the current
active normal-queue count and five. The normal rows stay unscheduled and outside the
`OFFTARGET-EMAIL-*` namespace, so the dedicated direct sender ignores them while Automatic is
paused.

`rebalanceOffTargetWeekendEmail0919And0920()` is a strict pending-only 40/4 → 22/22 timing
repair. It proceeds only while all 40 Sep 19 and all four Sep 20 explicit off-Target Email rows
remain `Queued`, keeps the first 22 Saturday recipients in place, and moves 18 after Sunday’s
existing entries. It preserves recipient, template and delivery path, rewrites only scheduled
timestamps, and never drafts or sends mail.

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
