# Scale AI and Vercel recruiter follow-ups (2026-09-29)

`apps_script/outreach/outreach_scale_vercel_followups_0929.gs` owns exactly two
owner-requested follow-ups: one immediate threaded reply to Vercel university
recruiter Robin Lee, and one threaded reply to Scale AI university recruiter
Sarah Ruhe at 16:00 ET on 2026-09-30. It does not alter the globally paused
generic follow-up planner.

The Scale timing is a deliberate owner override of the usual five-day wait.
Before either send, the runner checks its original sent message, suppresses the
company if a human reply or assessment mail exists, runs the shared exact Gmail
rejection matcher against a fresh company-scoped candidate set, and skips a
bounced/missing original. It sends a plain-text reply in the original Gmail
thread, with no attachment.

| Function | Responsibility |
| --- | --- |
| `scheduleScaleVercelFollowUps20260929` | Persists the two entries and installs one recovery trigger per requested time. |
| `runScaleVercelFollowUps20260929` / `runScaleVercelFollowUps20260929_` | Public execution-API wrapper and guarded runner; handles the earliest due entry only after all live safety checks, then records sent/skipped/cancelled state. |
| `diagnoseScaleVercelFollowUps20260929` | Read-only state, trigger, original-thread message list, reply-guard, and body inspection. |
| `cancelScaleVercelFollowUps20260929` | Cancels any still-pending entry and removes its triggers. |
