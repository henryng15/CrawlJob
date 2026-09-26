# outreach_paypal_university_wave_0928.gs — PayPal university-recruiting wave

Owns the owner-approved three-person PayPal campaign on Monday 2026-09-28, for the Applied
`Software Engineer Intern` application (Workday `R0137285`). It is a direct Target campaign: state
lives in the Script Property `TARGET_RECRUITER_CAMPAIGN_20260928_PAYPAL_UNIVERSITY` and in
`Email_target`; it does not enter the normal `Email` queue. Delivery goes through
`runTargetRecruiterSharedTick_`.

| Function | Does |
|---|---|
| `scheduleTargetRecruiterCampaign0928PayPalUniversity()` | Idempotent. Requires exactly one active application for the role, runs the Gmail rejection preflight, and refuses if Target plus reportable automatic work on 09-28 would exceed 55. It then retires three stale contact rows, appends the three sourced contacts to `Contacts (manual)` (only if absent), and queues exactly those three at 09:10, 09:31 and 09:52 ET. |
| `retireUnsentContactRows_(emails)` | Sets `Verify` to `UNSENDABLE_VERIFY` (`local:Unknown`) on every row in either Contacts tab whose email is listed, so `outreachReadContacts_` drops it. Returns each changed row with its previous `Verify`, which is what a revert needs. |

## Recipients

PayPal's 2026-09-18 recruiter waves reached ten technical recruiters and no one on the university
team. On 2026-09-26 the owner asked for three university or early-career recruiters. They were
sourced through treg:

- Apollo search (US only) and Crustdata profiles for current, US-based PayPal university staff:
  Kellyn Creese (University Recruiter, SF Bay Area), Heather Myers (Sr. Manager, Talent
  Acquisitions - University Programs, remote US) and Iris Lin (Senior Recruiter on the University
  Recruiting team).
- `paypal.com` is accept-all, so BounceBan returns `deliverable` 99 for any address and proves
  nothing. The addresses come from sources that name the person instead: Apollo enrich `verified`
  for `kcreese@` and `irlin@`, and a crawled Tomba record carrying the matching LinkedIn and title
  for `hmyers@`. All three follow PayPal's dominant first-initial + last-name form (`fbaladad`,
  `zwilliams`, `cpestka`, `wgiese`). The `Verify` column records the source rather than a
  mailbox verdict.

## Retired contact rows

The seed tab held three unsent PayPal "university" rows, all `debounce:Risky`. Each is now
`local:Unknown`:

- `kellyn.creese@paypal.com`: a second, unsupported address for Kellyn. Left live, a later wave
  could have emailed the same person twice.
- `chaydon@paypal.com`: Carleen Guerra-Haydon has been at CrowdStrike since January 2026.
- `ssipani@paypal.com`: Sanjana Sipani leads APAC university recruitment, not the US internship.

`tikirby@paypal.com` already received a cold email on 2026-09-24 and was not touched.

## Timing

The Monday gap wave (`TARGET_RECRUITER_CAMPAIGN_20260928_GAP`) starts 09:00 ET at seven-minute
spacing, the early-career wave holds 13:00–13:30 and the recruiter-gap supplement 14:00–14:12. A
09:10 start with 21-minute spacing keeps every PayPal slot three minutes off the gap grid.
