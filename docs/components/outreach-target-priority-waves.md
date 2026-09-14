# outreach_target_priority_waves.gs — approved Target priority campaigns

## Purpose

Owns the three explicit Target campaigns requested on 2026-09-13: five Lyft
referral asks on September 15, five Anduril recruiter cold emails on September
15, and five Notion recruiter cold emails on September 16. It uses the common
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
| `runTargetReferralCampaignTick0915Lyft_()` | Every-minute delivery handler for the Lyft campaign; delegates to the shared referral sender, including its Advanced Gmail rejection preflight immediately before each send. |
| `runTargetRecruiterCampaignTick0915Anduril_()` | Every-minute delivery handler for the Anduril campaign; delegates to the shared recruiter sender, including its Advanced Gmail rejection preflight immediately before each send. |
| `runTargetRecruiterCampaignTick0916Notion_()` | Every-minute delivery handler for the Notion campaign; delegates to the shared recruiter sender, including its Advanced Gmail rejection preflight immediately before each send. |

## Validation

On 2026-09-13, `diagnoseCompanyAvailability` confirmed all three active Target
applications and no existing usable recruiter records for Anduril/Notion;
`diagnoseTargetCompanyRejectionPreflight` returned `clear` for Lyft, Anduril,
and Notion. Hunter's Email Finder returned `valid` for each selected address.
