# outreach_spectrum_wave_0930.gs — Spectrum university-recruiting wave

Owns the owner-approved three-person Spectrum campaign on Wednesday 2026-09-30, for the Applied
`2027 Summer Intern: Software Developer` application. It is a direct Target campaign: state lives
in the Script Property `TARGET_RECRUITER_CAMPAIGN_20260930_SPECTRUM` and in `Email_target`; it
does not enter the normal `Email` queue. Delivery goes through `runTargetRecruiterSharedTick_`.

| Function | Does |
|---|---|
| `scheduleTargetRecruiterCampaign0930Spectrum()` | Idempotent. Requires exactly one active application for the role, runs the Gmail rejection preflight, and refuses if Target plus reportable automatic work on 09-30 would exceed 55. It then appends the three sourced contacts to `Contacts (manual)` (only if absent) and queues exactly those three at 09:10, 09:31 and 09:52 ET. |

## Recipients

Spectrum had no seed or manual recruiter contacts. The owner asked for three people who work only
on early-career or university recruiting, and on 2026-09-25 these were sourced through treg:

- Apollo and Crustdata search for current Spectrum University Relations / University Programs
  staff: Alyssa Clendening (University Relations Program Lead), Peyton Hammer (Sr University
  Relations Program Specialist) and Megan Ludwig (Manager of University Programs).
- Kitt (`treg.people.email.find`) for the `first.last@spectrum.com` addresses.
- BounceBan deepverify: `deliverable`, score 99, for all three. An invented control mailbox came
  back `undeliverable`, so the domain is not catch-all.

Alex Cunningham (Senior University Relations Recruiter) was deliberately left out. That address
got a follow-up in November 2025 about a Summer 2026 Data Scientist role, so the scheduler's
Gmail-history guard would skip it anyway.

The tracker stores only a jobright.ai link for this application. The campaign uses it as the
application's identity key; it does not appear in the email.

## Timing

The Wednesday gap wave (`TARGET_RECRUITER_CAMPAIGN_20260930_GAP`) starts 09:00 ET at
seven-minute spacing. A 09:10 start with 21-minute spacing keeps every Spectrum slot three minutes
off that grid.
