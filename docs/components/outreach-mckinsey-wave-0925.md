# outreach_mckinsey_wave_0925.gs — McKinsey referral wave

Owns the owner-approved, five-person September 25 McKinsey QuantumBlack referral campaign. It is a direct Target campaign: state lives in Script Properties and `Referral_target`; it does not enter the normal `Referral` queue.

| Function | Does |
|---|---|
| `scheduleTargetReferralCampaign20260925McKinsey(acknowledgeOver55)` | Validates the exact current Applied QuantumBlack role, repeats Gmail rejection preflight, rejects Gmail/Referral duplicates, schedules the five BounceBan-deliverable US software contacts at five-minute intervals, and refreshes `Referral_target`. Requires the owner’s explicit over-55 acknowledgement. |
| `runTargetReferralCampaignTick20260925McKinsey_()` | The one-minute handler. Delegates to the shared Target referral sender, which repeats rejection preflight before Gmail, preserves one-send-only history, and updates Target counts after acceptance. |
| `sendTargetReferralCampaign20260925McKinseyNow()` | Public owner-invoked runner for the next due entry; it uses the same guarded handler and cannot bypass duplicate or rejection checks. |
| `addTargetReferralCampaign20260925McKinseyReplacement()` | Pending-only replacement for an entry skipped because Gmail shows prior outbound history. It adds the owner-approved, BounceBan-deliverable Vibhav Bhangale only when absent and without Gmail history, keeps five-minute spacing, and refreshes `Referral_target`. |
| `diagnoseTargetReferralCampaign20260925McKinsey()` | Read-only status of the five entries, including name, role title, schedule, state and any recorded delivery/rejection error, without returning email addresses. |
