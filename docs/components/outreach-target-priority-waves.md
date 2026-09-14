# outreach_target_priority_waves.gs — approved Target priority campaigns

## Purpose

Owns the explicit Target campaigns requested on 2026-09-13: five Lyft referral
asks on September 15, five Anduril recruiter cold emails on September 15, five
Notion recruiter cold emails on September 16, seven Palantir recruiter cold
emails on September 17, two Lockheed Martin referral asks on September 15, and
the Lockheed Martin recruiter wave one week later on September 22. It also owns
the six requested Summer recruiter waves from September 16 through September 23.
Walmart's earliest safe referral wave is on September 15, with its recruiter
wave exactly one week later.
It uses the common
direct-Target campaign schedulers and therefore writes campaign state only to
Script Properties and the `Referral_target` / `Email_target` mirrors. The
normal `Referral` and `Email` workers never read those mirrors.

## Contact provenance and scope

`TARGET_PRIORITY_HUNTER_RECRUITERS_` contains the ten addresses returned as
valid by the user's authorized Hunter Email Finder on 2026-09-13. The source
list is restricted to technical, technology, university, or early-career
recruiting work and intentionally contains no design or embedded-recruiting
contact. `appendTargetPriorityHunterRecruiters_` appends missing rows to the
protected `Contacts (manual)` tab; it never modifies an existing seed/manual
contact and never touches the generated `Contacts (seed)` export. This is the
user-approved, bounded exception to the tab's normal hand-entry practice.

## Functions

| Function | Responsibility |
| --- | --- |
| `appendTargetPriorityHunterRecruiters_()` | Idempotently adds only the ten approved, Hunter-valid contacts to `Contacts (manual)`, recording the source in `From`. |
| `scheduleTargetReferralCampaign0915Lyft()` | Queues five Lyft referral asks for 13:00–13:36 ET on 2026-09-15. It reserves addresses from Lyft's earlier campaign and excludes the early candidate names that would require a separate Vietnamese-copy decision, so all five selected referrals can use the normal approved referral copy. |
| `scheduleTargetRecruiterCampaign0915Anduril()` | Ensures the approved contacts are present, then queues five Anduril technical/early-career recruiter emails for 14:00–14:24 ET on 2026-09-15 using the active `2027 Software Engineer Intern` application. |
| `scheduleTargetRecruiterCampaign0916Notion()` | Ensures the approved contacts are present, then queues five Notion technical/university recruiter emails for 10:00–10:24 ET on 2026-09-16 using the active `Software Engineer Intern (Summer 2027)` application. |
| `scheduleTargetRecruiterCampaign0917Palantir()` | Queues the seven currently unsent Palantir technical/campus recruiter emails for 11:00–11:36 ET on 2026-09-17, using its active Production Infrastructure SWE Intern application. |
| `scheduleTargetReferralCampaign0915LockheedMartin()` | Queues two Lockheed Martin referral asks for 15:00 and 15:09 ET on 2026-09-15, using the current Winter 2027 Software Developer Co-op role. It excludes the three pure-Vietnamese-name candidates so the selected two need no greeting-title decision. |
| `scheduleTargetRecruiterCampaign0922LockheedMartin()` | Queues every currently sendable Lockheed Martin recruiter (up to five) for 09:00–09:24 ET on 2026-09-22, exactly one week after the referral wave. |
| `scheduleTargetRecruiterCampaign0916Datadog()` | Queues up to seven Datadog recruiters for 11:00–11:36 ET on 2026-09-16, after the Intel/Atlassian and Notion waves, using the active Summer Software Engineering Intern posting. |
| `scheduleTargetRecruiterCampaign0917ScaleAi()` | Queues up to seven Scale AI recruiters for 12:00–12:36 ET on 2026-09-17, after the Dell, Plaid and Palantir waves, using the Summer 2027 SWE Intern posting. |
| `scheduleTargetRecruiterCampaign0918Vercel()` | Queues up to seven Vercel recruiters for 09:00–09:36 ET on 2026-09-18, using the Summer 2027 SWE Intern posting. |
| `scheduleTargetRecruiterCampaign0921Dropbox()` | Queues up to seven Dropbox recruiters for 09:00–09:36 ET on 2026-09-21, using the Summer 2027 SWE Intern posting. |
| `scheduleTargetRecruiterCampaign0922Lyft()` | Queues up to seven Lyft recruiters for 10:00–10:36 ET on 2026-09-22, after the Lockheed Martin recruiter wave, using Lyft's Backend Summer 2027 SWE Intern posting. |
| `scheduleTargetRecruiterCampaign0923Mastercard()` | Queues up to seven Mastercard recruiters for 09:00–09:36 ET on 2026-09-23, using the Summer 2027 Software Engineer Intern posting. |
| `scheduleTargetReferralCampaign0915Walmart()` | Queues ten Walmart referral asks for 16:00–17:21 ET on 2026-09-15 using the active Summer 2027 Software Engineer II Intern application. It excludes An Tran and Huynh Le because an `anh`/`chị` title is not high confidence, and uses reviewed Vietnamese copy for Duc Nguyen, Luan Nguyen and Nhi Nguyen. |
| `scheduleTargetRecruiterCampaign0922Walmart()` | Queues up to seven Walmart recruiter emails for 11:00–11:36 ET on 2026-09-22, exactly one week after the referral wave, using the shared Target recruiter delivery trigger. |
| `runTargetReferralCampaignTick0915Lyft_()` | Every-minute delivery handler for the Lyft campaign; delegates to the shared referral sender, including its Advanced Gmail rejection preflight immediately before each send. |
| `runTargetRecruiterCampaignTick0915Anduril_()` | Every-minute delivery handler for the Anduril campaign; delegates to the shared recruiter sender, including its Advanced Gmail rejection preflight immediately before each send. |
| `runTargetRecruiterCampaignTick0916Notion_()` | Every-minute delivery handler for the Notion campaign; delegates to the shared recruiter sender, including its Advanced Gmail rejection preflight immediately before each send. |
| `runTargetRecruiterCampaignTick0917Palantir_()` | Every-minute delivery handler for the Palantir campaign, including its Advanced Gmail rejection preflight immediately before each send. |
| `runTargetReferralCampaignTick0915LockheedMartin_()` | Every-minute delivery handler for the Lockheed Martin referral campaign, including its Advanced Gmail rejection preflight immediately before each send. |
| `runTargetRecruiterCampaignTick0922LockheedMartin_()` | Every-minute delivery handler for the Lockheed Martin recruiter campaign, including its Advanced Gmail rejection preflight immediately before each send. |
| `runTargetRecruiterSharedTick_()` | Shared every-minute delivery router used by the six requested Summer recruiter campaigns after trigger consolidation. It keeps each campaign's recorded time and delegates the earliest due entry to the common sender, including its Advanced Gmail rejection preflight immediately before each send. The dated tick functions remain callable maintenance fallbacks. |
| `runTargetReferralCampaignTick0915Walmart_()` | Every-minute delivery handler for the Walmart referral campaign, including its Advanced Gmail rejection preflight immediately before each send. |
| `runTargetRecruiterCampaignTick0922Walmart_()` | Callable maintenance fallback for the Walmart recruiter campaign; the shared recruiter router normally delivers it. |

## Validation

On 2026-09-13, `diagnoseCompanyAvailability` confirmed all three active Target
applications and no existing usable recruiter records for Anduril/Notion;
`diagnoseTargetCompanyRejectionPreflight` returned `clear` for Lyft, Anduril,
and Notion. Hunter's Email Finder returned `valid` for each selected address.
