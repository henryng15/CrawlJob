# Rippling Linda one-recipient campaign

`outreach_rippling_linda_0925.gs` owns the owner-requested additional cold email to
`linda.le@rippling.com` for the active Rippling Full Stack Software Engineer Intern – Summer
2027 application. It is a direct Target campaign and does not alter the normal Email queue.

| Function | Behaviour |
| --- | --- |
| `sendTargetRecruiterNowRipplingLinda0925()` | Idempotent owner-triggered entry point. Adds Linda to `Contacts (manual)` when absent, rechecks the exact active application, Gmail history and Advanced Gmail rejection preflight, then sends through the shared Target recruiter sender with the official resume/footer and refreshes Target mirrors. It installs a one-minute retry trigger only while the message is pending. |
| `runTargetRecruiterCampaignTickNowRipplingLinda0925_()` | Internal retry handler for the one-recipient campaign; it delegates to the shared Target delivery path and removes its trigger after the entry is accepted, blocked or otherwise settled. |

The campaign property is `TARGET_RECRUITER_CAMPAIGN_20260925_RIPPLING_LINDA`.
