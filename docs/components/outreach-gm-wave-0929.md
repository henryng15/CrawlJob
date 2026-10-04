# outreach_gm_wave_0929.gs — General Motors recruiter wave

Owns the owner-approved six-recruiter General Motors campaign on Tuesday 2026-09-29. It is a
direct Target campaign: state lives in the Script Property
`TARGET_RECRUITER_CAMPAIGN_20260929_GENERAL_MOTORS` and in `Email_target`; it does not enter
the normal `Email` queue. Delivery goes through the shared `runTargetRecruiterSharedTick_`
router, which discovers the campaign by its key prefix.

| Function | Does |
|---|---|
| `scheduleTargetRecruiterCampaign0929GeneralMotors()` | Idempotent. Requires exactly one active `2027 Summer Intern - Digital Product: Software Engineering` application, runs the Gmail rejection preflight, and refuses if Target plus reportable automatic work on 09-29 would exceed 55. It then queues exactly the six listed recipients at 09:04–10:24 ET, sixteen minutes apart. The shared scheduler also skips anyone already sent, spent, or with outbound Gmail history, and `exactContacts` makes the whole call fail rather than send a shorter wave. |

## Recipients and timing

The recipients are Sophia Jewell (early talent), Donald Rose (lead technical recruiter), Drew
Torkelson, Isabella Wang, Sheraz Hussain and Rick Martin (technical recruiting/sourcing).
Leadership, executive, Canada-based and generic TA contacts were left out. The two seed rows
carry debounce `Safe to Send`. The four `Contacts (manual)` rows had a blank `Verify`, so they
were checked with BounceBan deepverify on 2026-09-25: all four came back `deliverable`, score 99.

The Tuesday gap wave (`TARGET_RECRUITER_CAMPAIGN_20260929_GAP`) holds 09:00–12:52 ET at
eight-minute spacing. The GM slots sit four minutes off that grid, so the two campaigns never
fall due in the same minute.
