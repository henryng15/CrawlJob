# outreach_target_priority_waves.gs — approved Target priority campaigns

## Purpose

Owns the explicit Target campaigns requested on 2026-09-13: five Lyft referral
asks on September 15, five Anduril recruiter cold emails on September 15, five
Notion recruiter cold emails on September 16, four additional Atlassian recruiter
cold emails on September 16, ten Figma referral asks on September 18, ten
Coinbase recruiter cold emails on September 22, ten Figma recruiter cold emails
on September 25, seven Palantir recruiter cold
emails on September 17, two Lockheed Martin referral asks on September 15, and
the Lockheed Martin recruiter wave one week later on September 22. It also owns
the six requested Summer recruiter waves from September 16 through September 23.
It additionally owns ten DoorDash referral asks on September 16, five Red Hat recruiter cold emails and five DoorDash recruiter cold emails on September 23, plus two Hunter-verified Shield AI recruiter cold emails on September 18.
It also owns ten Intuit recruiter emails on the morning of September 22: two
already sendable contacts plus eight Hunter-validated technical recruiters.
It also owns the seven-recipient JPMorgan Chase SWE recruiter wave after the
owner confirmed the applied role's OA is complete.
It also owns ten Robinhood technical/early-career recruiter emails on September
24, using the preferred applied Backend Summer 2027 role rather than Web.
It also owns five Wells Fargo recruiter emails on September 21 for the applied
non-California Software Engineering internship.
It also owns five Wells Fargo referral asks on September 17 for that same
non-California Software Engineering internship.
Vercel's September 18 recruiter wave now has seven main-wave contacts plus five
additional technical/university-recruiting contacts, all using the same active
Summer 2027 application.
Walmart's earliest safe referral wave is on September 15, with its recruiter
wave exactly one week later. It also owns the ten-contact PayPal technical
recruiter campaign on September 18. It uses the common direct-Target campaign
schedulers and therefore writes campaign state only to
Script Properties and the `Referral_target` / `Email_target` mirrors. The
normal `Referral` and `Email` workers never read those mirrors.

## Contact provenance and scope

`TARGET_PRIORITY_HUNTER_RECRUITERS_` contains ten addresses returned as valid by
the user's authorized Hunter Email Finder on 2026-09-13 plus four Atlassian
technical/senior recruiters and four Figma technical recruiters returned by
Hunter Domain Search on 2026-09-14, including two Shield AI recruiting contacts.
The source list is restricted to technical, technology, university, or
early-career recruiting work and intentionally contains no design or
embedded-recruiting contact. The four domain-search records retain Hunter's
`accept_all` verdict rather than being relabeled as valid. They are included
only in the explicitly requested Atlassian supplement. The append helper adds
missing rows to the protected `Contacts (manual)` tab; it never modifies an
existing seed/manual contact and never touches the generated `Contacts (seed)`
export. This is the user-approved, bounded exception to the tab's normal
hand-entry practice.

## Functions

| Function | Responsibility |
| --- | --- |
| `appendTargetPriorityHunterRecruiters_()` | Idempotently adds only the twenty-eight approved Hunter-sourced contacts to `Contacts (manual)`, recording the source in `From`. |
| `scheduleTargetReferralCampaign0915Lyft()` | Queues five Lyft referral asks for 13:00–13:36 ET on 2026-09-15. It reserves addresses from Lyft's earlier campaign and excludes the early candidate names that would require a separate Vietnamese-copy decision, so all five selected referrals can use the normal approved referral copy. |
| `scheduleTargetRecruiterCampaign0915Anduril()` | Ensures the approved contacts are present, then queues five Anduril technical/early-career recruiter emails for 14:00–14:24 ET on 2026-09-15 using the active `2027 Software Engineer Intern` application. |
| `scheduleTargetRecruiterCampaign0916Notion()` | Ensures the approved contacts are present, then queues five Notion technical/university recruiter emails for 10:00–10:24 ET on 2026-09-16 using the active `Software Engineer Intern (Summer 2027)` application. |
| `scheduleTargetRecruiterCampaign0916AtlassianHunter4()` | Ensures the four Hunter Domain Search Atlassian contacts are present, then queues exactly those four additional recruiter emails for 09:30–09:48 ET on 2026-09-16. It excludes every recipient already reserved by the earlier Intel/Atlassian campaign and reuses the shared Target delivery trigger. |
| `scheduleTargetReferralCampaign0918Figma()` | Queues ten Figma referral asks for 13:00–14:21 ET on 2026-09-18 using the active Summer 2027 posting. It excludes Andrew Ly and Cynthia Vu because their pure-Vietnamese-style names require owner title review under the manual referral gate. |
| `rescheduleTargetReferralCampaign0916Figma()` | Moves the Figma referral campaign to 15:00–16:21 ET on 2026-09-16 only if all ten entries remain pending. It preserves each recipient and template, refuses to move a campaign with any sent, failed, bounced or otherwise non-pending entry, and refreshes `Referral_target`. |
| `scheduleTargetReferralCampaign0916DoorDash()` | Queues ten DoorDash referral asks for 13:00–14:21 ET on 2026-09-16 using the active Software Engineer Intern Summer 2027 US application. It excludes the six pure-Vietnamese-style candidate names because their Vietnamese referral greetings require individual owner-approved titles; ten other eligible people remain. |
| `rescheduleTargetReferralCampaign0916DoorDash()` | Replaces the DoorDash referral campaign only while every entry is pending, preserving its date and times but applying the reviewed no-Vietnamese-name selection. It refuses to replace a campaign with any sent, failed, bounced or otherwise non-pending entry. |
| `scheduleTargetRecruiterCampaign0922Coinbase()` | Queues ten Coinbase recruiter emails for 12:00–12:54 ET on 2026-09-22, before Thursday of that week, using the active `Software Engineer Intern` application and the shared Target recruiter trigger. |
| `rescheduleTargetRecruiterCampaigns0921CoinbaseLockheedMartin()` | Pending-only rebalance of the ten Coinbase and five Lockheed Martin recruiter emails to Monday 2026-09-21: Lockheed 09:00–09:24 and Coinbase 10:00–10:54 ET. It validates both complete future campaigns before either is written, preserves recipients/templates/campaign keys, and leaves the ten Intuit and ten Intel Tuesday emails untouched. It deliberately avoids the global sender lock, because repeated minute delivery ticks otherwise starve a future-only schedule edit. |
| `appendTargetWellsFargoRecruiters_()` | Appends four Treg-sourced, Tomba-verified Wells Fargo recruiting contacts to `Contacts (manual)` only when their email is not already present; existing contacts are never altered. |
| `scheduleTargetRecruiterCampaign0921WellsFargo()` | Queues five Wells Fargo recruiter emails for 11:00–11:24 ET on Monday 2026-09-21, using only the applied non-California `2027 Technology Summer Internship – Early Careers (Software Engineering)` role. Its normal-queue fingerprint gate omits the already-queued existing contact, preventing a duplicate. As a bounded future-only campaign it does not take the global sender lock, because the current shared minute tick can hold that lock until timeout; it still requires all five recipients be unspent and without outbound Gmail history. |
| `scheduleTargetReferralCampaign0917WellsFargo()` | Queues five Wells Fargo referral asks for 14:00–14:36 ET on Thursday 2026-09-17, using the same non-California SWE internship. It selects only five reviewed non-Vietnamese-style candidates, requires no prior Referral/Gmail history, and avoids the contested global sender lock because this future-only campaign has isolated state. |
| `scheduleTargetRecruiterCampaign0925Figma()` | Ensures the approved Hunter-sourced Figma recruiter is present, then queues ten currently sendable Figma recruiter emails for 13:00–13:54 ET on 2026-09-25, exactly one week after the referral wave, using the same Summer 2027 posting. |
| `scheduleTargetRecruiterCampaign0925FigmaSupplement()` | Queues the remaining tenth Figma recruiter in a one-slot supplement at 13:54 ET on 2026-09-25, excluding the ten recipients reserved by the main Figma recruiter wave and reusing the shared Target recruiter trigger. |
| `scheduleTargetRecruiterCampaign0925FigmaSupplement2()` | Queues the remaining tenth Figma recruiter in a second one-slot supplement at 14:00 ET on 2026-09-25 when the first supplement's candidate is already spent, still excluding the main wave and reusing the shared Target recruiter trigger. |
| `scheduleTargetRecruiterCampaign0917Palantir()` | Queues the seven currently unsent Palantir technical/campus recruiter emails for 11:00–11:36 ET on 2026-09-17, using its active Production Infrastructure SWE Intern application. |
| `scheduleTargetReferralCampaign0915LockheedMartin()` | Queues two Lockheed Martin referral asks for 15:00 and 15:09 ET on 2026-09-15, using the current Winter 2027 Software Developer Co-op role. It excludes the three pure-Vietnamese-name candidates so the selected two need no greeting-title decision. |
| `scheduleTargetRecruiterCampaign0922LockheedMartin()` | Queues every currently sendable Lockheed Martin recruiter (up to five) for 09:00–09:24 ET on 2026-09-22, exactly one week after the referral wave. |
| `scheduleTargetRecruiterCampaign0916Datadog()` | Queues up to seven Datadog recruiters for 11:00–11:36 ET on 2026-09-16, after the Intel/Atlassian and Notion waves, using the active Summer Software Engineering Intern posting. |
| `scheduleTargetRecruiterCampaign0917ScaleAi()` | Queues up to seven Scale AI recruiters for 12:00–12:36 ET on 2026-09-17, after the Dell, Plaid and Palantir waves, using the Summer 2027 SWE Intern posting. |
| `scheduleTargetRecruiterCampaign0918Vercel()` | Queues up to seven Vercel recruiters for 09:00–09:36 ET on 2026-09-18, using the Summer 2027 SWE Intern posting. |
| `scheduleTargetRecruiterCampaign0918VercelSupplement()` | Queues five additional preselected Vercel technical/university recruiters for 11:24–11:48 ET on 2026-09-18. It excludes the main-wave recipients and uses the same Summer 2027 SWE Intern posting. |
| `scheduleTargetRecruiterCampaign0921Dropbox()` | Queues up to seven Dropbox recruiters for 12:00–12:36 ET on 2026-09-16, using the Summer 2027 SWE Intern posting. |
| `scheduleTargetRecruiterCampaign0922Lyft()` | Queues up to seven Lyft recruiters for 13:00–13:36 ET on 2026-09-17, using Lyft's Backend Summer 2027 SWE Intern posting. |
| `scheduleTargetRecruiterCampaign0923Mastercard()` | Queues up to seven Mastercard recruiters for 10:00–10:36 ET on 2026-09-18, using the Summer 2027 Software Engineer Intern posting. |
| `scheduleTargetRecruiterCampaign0918PayPal()` | Queues the first seven selected PayPal technical recruiters for 10:42–11:18 ET on 2026-09-18, using the active Software Engineer Intern application and an exact email inclusion list. |
| `scheduleTargetRecruiterCampaign0918PayPalSupplement()` | Queues the three remaining selected PayPal technical recruiters for 12:12–12:24 ET on 2026-09-18, excluding the first-wave recipients and using the same Software Engineer Intern application. |
| `scheduleTargetRecruiterCampaign0922Intuit()` | Queues the two remaining sendable Intuit recruiters for 09:00 and 09:06 ET on 2026-09-22. It excludes the earlier HP/Intuit/Oracle campaign's Intuit recipients and uses the applied Summer 2027 Full Stack SWE Intern role. |
| `scheduleTargetRecruiterCampaign0922IntuitHunterSupplement()` | Adds eight Hunter-validated current Intuit technical recruiters, then queues them for 09:12–09:54 ET on 2026-09-22. It excludes the first two recipients and uses the same applied Summer 2027 Full Stack SWE Intern role. |
| `scheduleTargetRecruiterCampaign0924Robinhood()` | Queues ten selected Robinhood technical/early-career recruiters for 09:00–09:54 ET on 2026-09-24. It uses the preferred, applied Backend Summer 2027 role rather than the concurrently applied Web role. |
| `rescheduleSummerRecruiterWavesInto0914To0918()` | Moves the fully pending Dropbox, Lyft and Mastercard campaigns into the September 14–18 week, while retaining the original campaign keys and selected recipients. |
| `scheduleTargetReferralCampaign0915Walmart()` | Queues ten Walmart referral asks for 16:00–17:21 ET on 2026-09-15 using the active Summer 2027 Software Engineer II Intern application. It excludes An Tran and Huynh Le because an `anh`/`chị` title is not high confidence, and uses reviewed Vietnamese copy for Duc Nguyen, Luan Nguyen and Nhi Nguyen. |
| `appendTargetIntelSeptemberSupplements_()` | Appends exactly two Hunter-valid Intel engineering leaders to `Employees (seed)` and nine current Hunter/MillionVerifier-backed Intel recruiting contacts to `Contacts (manual)`; existing rows win and are never rewritten. |
| `scheduleTargetReferralCampaign0916Intel()` | Queues seven Intel referral asks at 16:30–17:24 ET on 2026-09-16, initially excluding Hoang Nguyen until the owner supplies the required Vietnamese greeting title. |
| `replaceIntelReferralCampaign0916WithApprovedHoang()` | Pending-only correction after the owner approved `anh Hoang`: replaces only Piotr Bocian with Hoang Nguyen at the same 17:24 ET slot, preserves the seven-person count and applies Vietnamese referral variant 1. |
| `scheduleTargetRecruiterCampaign0922Intel()` | Queues ten Intel recruiter emails at 13:00–13:54 ET on 2026-09-22, then idempotently cancels only the Intel entry from the shared Sep 16 Intel/Atlassian campaign to prevent a duplicate. |
| `scheduleTargetRecruiterCampaign0922Walmart()` | Queues up to seven Walmart recruiter emails for 11:00–11:36 ET on 2026-09-22, exactly one week after the referral wave, using the shared Target recruiter delivery trigger. |
| `scheduleTargetRecruiterCampaign0923RedHat()` | Queues five Red Hat recruiter emails for 12:00–12:24 ET on 2026-09-23, using the current Software Engineer Co-op posting and the shared Target recruiter delivery trigger. |
| `scheduleTargetRecruiterCampaign0923DoorDash()` | Queues the five preselected technical DoorDash recruiter emails for 13:00–13:24 ET on Wednesday 2026-09-23, using the active Software Engineer Intern (Summer 2027) US application and the shared Target recruiter trigger. |
| `rescheduleTargetRecruiterCampaign0923DoorDash()` | Replaces the DoorDash campaign only while every existing entry is pending, preserving its date and time but restricting selection to the five preselected technical recruiters. It refuses to replace any campaign with a sent, failed, bounced or otherwise non-pending entry. |
| `appendApprovedManualRecruiters_(roster, defaultSource)` | Shared narrow-exception appender for an owner-approved, externally verified roster. It writes only addresses neither contacts tab already knows, never rewrites an existing row, and throws rather than write a blank address. |
| `retargetTargetRecruiterCampaign0924RobinhoodToWeb()` | Points the booked 2026-09-24 Robinhood wave at the Web application instead of Backend. Pending entries only — it refuses once any entry has left `pending` — and it changes only `role` and `jobLink`, leaving recipients, times, spacing and template numbers untouched, then refreshes the mirrors. |
| `scheduleTargetRecruiterCampaign0917SweLike()` | Adds the eight `valid`-verified off-Target recruiters at Nuro, Ibotta, Skillz and Kodiak, then queues them for 15:00–15:42 ET on 2026-09-17 on the shared Target recruiter trigger. Bounded by an exact `includeEmails` list, a per-company `maxContacts` derived from that roster, and each employer's one checked live application. |
| `scheduleTargetRecruiterCampaign0917SweLikeAcceptAll()` | Queues the four catch-all Klaviyo and Toast recruiters for 16:00–16:18 ET on 2026-09-17. A separate wrapper on purpose: these addresses are `accept_all`, so calling it *is* the act of accepting the bounce risk, and it can never happen as a side effect of scheduling the verified eight. |
| `diagnoseTargetRecruiterCampaign0917SweLike()` | Read-only state for both waves, each reported separately with pending/sent/failed counts by company. |
| `cancelTargetRecruiterCampaign0917SweLike(acceptAllInstead)` | Cancels either wave, pending entries only. It refuses outright once any entry has left pending, clears only that campaign's own property, refreshes the mirrors, and deletes no trigger — the shared recruiter tick belongs to every direct campaign. |
| `scheduleTargetRecruiterCampaign0919C3ai()` | Appends six Treg-confirmed C3.ai Talent Acquisition contacts and schedules exactly seven C3.ai recruiter emails for Saturday 2026-09-19, 14:00–14:36 ET. The fixed roster also contains the five known prior local contacts so the one still eligible one can be selected; its `exactContacts: 7` guard refuses to persist an undersized wave. It uses the shared Target recruiter tick and does not change Automatic Pause modes. |
| `replaceTargetReferralCampaign0916FigmaWithC3ai()` | Owner-authorized, pending-only replacement: removes exactly ten Figma intern-referral entries and their dedicated referral trigger, then retimes the existing seven-entry C3.ai recruiter campaign to 15:00–15:36 ET on 2026-09-16. It validates both full campaign states before any write, refreshes both Target mirrors, preserves contact/history data, and does not alter Automatic Pause modes. As both campaigns must still be future-only, it deliberately avoids the global sender lock so an unrelated hung shared tick cannot block the safe schedule edit. |
| `cancelAllTargetWellsFargoOutreach()` | Owner-authorized cancellation for the two Wells Fargo roles already in process. It fails closed unless the direct referral and recruiter campaigns each have exactly five pending entries and the normal `Email` tab has exactly one queued Wells Fargo row. It cancels that normal row, removes both direct campaign properties, deletes the dedicated referral trigger, refreshes Target mirrors, and preserves any sent/drafted/non-pending history by refusing to alter it. The normal queue is parsed with zero-based array indices so its stored row number is the actual sheet row. |
| `repairWellsFargoNormalQueueCancellation()` | One-time bounded repair for the initial row-offset mistake in Wells Fargo cancellation. It requires the exact queued Wells Fargo row and the exact owner-cancellation marker two physical rows below, restores only that unrelated queued row, then cancels Wells Fargo at its actual row. It refuses if either shape differs. |
| `scheduleTargetRecruiterCampaign0918ShieldAI()` | Adds exactly the two Hunter-verified Shield AI recruiting contacts, then queues them for 12:00 and 12:06 ET on 2026-09-18, using the active Summer 2027 Software Engineer Intern application and the shared Target recruiter trigger. |
| `scheduleTargetRecruiterCampaign0917JPMorganChaseSWE()` | Adds only Bryan Hutchinson and Kyra Sharma (both recorded accurately as `catch_all` at JPMorgan Chase's mail domain) to the five untouched existing recruiter contacts, then queues exactly seven emails for the completed-OA `Software Engineer Summer Intern` application on Sep 17, 16:30–17:06 ET. It refuses an undersized wave and uses the shared Target recruiter trigger. |
| `runTargetReferralCampaignTick0915Lyft_()` | Every-minute delivery handler for the Lyft campaign; delegates to the shared referral sender, including its Advanced Gmail rejection preflight immediately before each send. |
| `runTargetReferralCampaignTick0918Figma_()` | Every-minute delivery handler for the Figma referral campaign; delegates to the shared referral sender, including its Advanced Gmail rejection preflight immediately before each send. |
| `runTargetReferralCampaignTick0916DoorDash_()` | Every-minute delivery handler for the DoorDash referral campaign; delegates to the shared referral sender, including its Advanced Gmail rejection preflight immediately before each send. |
| `runTargetRecruiterCampaignTick0915Anduril_()` | Every-minute delivery handler for the Anduril campaign; delegates to the shared recruiter sender, including its Advanced Gmail rejection preflight immediately before each send. |
| `runTargetRecruiterCampaignTick0916Notion_()` | Every-minute delivery handler for the Notion campaign; delegates to the shared recruiter sender, including its Advanced Gmail rejection preflight immediately before each send. |
| `runTargetRecruiterCampaignTick0917Palantir_()` | Every-minute delivery handler for the Palantir campaign, including its Advanced Gmail rejection preflight immediately before each send. |
| `runTargetReferralCampaignTick0915LockheedMartin_()` | Every-minute delivery handler for the Lockheed Martin referral campaign, including its Advanced Gmail rejection preflight immediately before each send. |
| `runTargetRecruiterCampaignTick0922LockheedMartin_()` | Every-minute delivery handler for the Lockheed Martin recruiter campaign, including its Advanced Gmail rejection preflight immediately before each send. |
| `runTargetRecruiterSharedTick_()` | Shared every-minute delivery router used by the six requested Summer recruiter campaigns after trigger consolidation. It keeps each campaign's recorded time and delegates the earliest due entry to the common sender, including its Advanced Gmail rejection preflight immediately before each send. The dated tick functions remain callable maintenance fallbacks. |
| `runTargetReferralCampaignTick0915Walmart_()` | Every-minute delivery handler for the Walmart referral campaign, including its Advanced Gmail rejection preflight immediately before each send. |
| `runTargetReferralCampaignTick0916Intel_()` | Every-minute delivery handler for the Intel referral campaign, including its Advanced Gmail rejection preflight immediately before each send. |
| `runTargetReferralCampaignTick0917WellsFargo_()` | Every-minute delivery handler for the Wells Fargo referral campaign, including its Advanced Gmail rejection preflight immediately before each send. |
| `runTargetRecruiterCampaignTick0922Walmart_()` | Callable maintenance fallback for the Walmart recruiter campaign; the shared recruiter router normally delivers it. |

## Validation

On 2026-09-13, `diagnoseCompanyAvailability` confirmed all three active Target
applications and no existing usable recruiter records for Anduril/Notion;
`diagnoseTargetCompanyRejectionPreflight` returned `clear` for Lyft, Anduril,
and Notion. Hunter's Email Finder returned `valid` for each selected address.

On 2026-09-14, PayPal had 16 sendable recruiter contacts and no prior recruiter
campaign. The exact Software Engineer Intern rejection preflight returned
`clear`; `scheduleTargetRecruiterCampaign0918PayPal()` queued seven entries for
10:42–11:18 EDT. `initializeTargetQueueTabs()` then rebuilt `Email_target`, where
the seven PayPal slots were verified.

On 2026-09-15, the owner requested seven Intel referral asks before a ten-person
recruiter wave the following week. The seed had six Intel employees, and Hoang Nguyen
was initially held because a pure-Vietnamese referral needs an owner-approved `anh`/`chị`
title. After the owner confirmed `anh Hoang`, the pending-only correction replaces the
Piotr Bocian supplemental slot with Hoang at the identical time using reviewed Vietnamese
copy. Two Hunter-valid Intel software-engineering directors were added as bounded
supplements; Piotr remains in the seed but is not in this campaign. Nine additional
recruiting contacts come from the Hunter directory; four also returned a synchronous
MillionVerifier `ok` outcome. The Sep 22 recruiter scheduler includes the existing pending
Intel technical recruiter, then cancels that prior Sep 16 entry only after the new ten-entry
campaign has been created. Both delivery handlers repeat Gmail rejection preflight; setup
writes no Gmail draft or message.

Later that day, the owner requested that roughly fifteen of the September 22 recruiter
slots move to September 21. The all-pending rebalancer validates both complete campaigns
before writing either one, then moves all ten Coinbase contacts and all five Lockheed Martin
contacts. Intuit remains on its requested Tuesday morning, and Intel remains one week after
its referral wave. The shared/direct delivery triggers continue to do the Gmail rejection
preflight immediately before each message; retiming itself creates no draft or message.

Also on 2026-09-15, the owner requested five Wells Fargo recruiter emails for the
applied non-California SWE internship. Hunter had no search or verification quota
remaining, so a free Treg people search and a bounded Tomba work-email lookup were
used instead. Alexa Wennet (technology campus recruiting), Nicole Harrison (digital/
payments recruiting), Daniela Castro (senior recruiting) and Trent Akers (recruiting
management) returned valid work-email results. The existing normal Email queue already
commits one of the two prior Wells Fargo contacts, so the Target scheduler's fingerprint
gate excludes it and selects the remaining existing contact plus these four supplements.
The preflight for the exact non-California application was clear; setup creates no
Gmail draft or message.

The owner then requested five Wells Fargo referral asks in the current week if a
day had room. September 16 had only one explicit Target slot remaining, so the
five reviewed standard-English candidates were queued consecutively on September
17 at 14:00–14:36 ET. The exact same non-California application passed rejection
preflight. The direct referral state reports five pending entries; scheduling
created neither a draft nor a Gmail message.

On 2026-09-15 the owner asked for new recruiter coverage at the employers that
resemble DoorDash in size and shape, run as a direct Target campaign while
`outreach`, `referral` and `followUp` all stay Paused. `diagnoseOutreachAccess`
confirmed those three switches before and after the change, and confirmed that
neither `runOutreachCycle` nor `runOutreachSendTick` is installed. The wave uses
the shared Target recruiter tick and the `Email_target` mirror; no normal queue
row was written and no Pause mode was read or set.

A free Treg people search supplied the candidates and Treg's email verifier ruled
on every address before any of it reached a sheet. That gate did real work: all
four Waymo addresses and one Skillz address came back `invalid` — the same
pattern-guessing that bounced five of the ten Waymo referral asks on 2026-09-09 —
the single Hudl candidate could not have a recruiting title confirmed, and the
NewsBreak search returned another company's staff entirely. Those are excluded
rather than guessed at, so Waymo, Hudl and NewsBreak carry no wave at all.

Twelve contacts survived, and they are deliberately **two** campaigns rather than
one. Eight came back a clean `valid` — Nuro four, Ibotta two, Skillz one, Kodiak
one — and are queued for 15:00-15:42 ET. The remaining four are Klaviyo's three
and Toast's one, whose domains are catch-all: the verifier could say only
`accept_all`, which is recorded as `accept_all` in the Verify column and is never
reported as `valid`. They sit behind their own wrapper so that accepting the
bounce risk has to be a separate, deliberate call.

Only technical, campus and software-engineering titles were kept; Toast's six
sales, GTM, executive and contract recruiters were passed over, which is why that
employer contributes one contact and not five.
`diagnoseTargetCompanyRejectionPreflight` returned `clear` for each of the six
live applications. September 17 already carried the Lyft recruiter block at
13:00-13:36 and the Wells Fargo referral block at 14:00-14:36, so the waves start
at 15:00 and 16:00 and stay inside the sending window.

The policy accounting for that day is **not** the mirror count alone.
`diagnoseAutomaticOutreachForDay` simulates the paused planners and returns
`cold.newlyPlanned: 20` for each weekday, because twenty is what the automatic
path would schedule if it ran. Counting it, September 17 reaches 59 with the
verified eight and 63 with all twelve, against the 55-message threshold — so the
day needs an explicit acknowledgement before delivery, even though the automatic
runtime is Paused and will send none of those twenty.

Later on 2026-09-15 the owner reported that Robinhood's Backend application had
moved into process and asked for the booked wave to be written about the
full-stack role instead. Robinhood has exactly two live applications on the App
tab — `Software Engineering Intern, Web (Summer 2027)` and
`Software Engineering Intern, Backend (Summer 2027)` — and neither is named
"full stack", so the choice was put to the owner rather than guessed; they chose
Web. Worth noting separately: the Backend row still reads `Process = Applied`
with `Applied: Sep 14, 2026` in Update, so the tracker does not yet record the
progression the owner described.

All ten entries were still `pending`, so `retargetTargetRecruiterCampaign0924RobinhoodToWeb`
rewrites `role` and `jobLink` in place and leaves the recipients, the 09:00-09:54
slots, the spacing and the template numbers exactly as approved. Re-running the
scheduler would have been the wrong tool: it re-picks contacts and re-stamps
hours. The retarget refuses outright once any entry has left `pending`, because a
sent message cited the Backend requisition and that is what its recipient read.
`diagnoseTargetCompanyRejectionPreflight` returned `clear` for the Web role
before the change.
