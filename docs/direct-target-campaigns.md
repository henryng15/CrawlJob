# Direct Target campaigns while Automatic is paused

## Purpose

This runbook is for an assistant scheduling a **bounded, explicitly requested**
Target recruiter or referral campaign without reactivating the normal automatic
outreach system. It is intentionally separate from the normal `Email`,
`Referral`, and `Contacts (manual)` queue paths.

## The two paths are separate

| Path | State and visible queue | What delivers it | Relation to Pause modes |
| --- | --- | --- | --- |
| Automatic outreach | Operational `Email` / `Referral` queues | Automatic planner and generic queue workers | Disabled when `outreach`, `referral`, or `followUp` is `Pause` |
| Direct Target campaign | Campaign-specific Script Property mirrored to `Email_target` / `Referral_target` | Dedicated Target campaign tick or the shared Target recruiter tick | Does not read or change those Pause modes |

`Email_target` and `Referral_target` are visibility mirrors for direct Target
campaign state. They are not input queues: normal planners and normal send
workers must never read them. Conversely, do not put a direct Target campaign
only into `Email`, `Referral`, or `Contacts (manual)` and expect it to deliver
while Automatic is paused.

## Safe operating procedure

1. Require an explicit current-chat request that identifies the type
   (recruiter/cold or referral), company scope, date/time, and whether the
   owner asked only to prepare/draft or actually to deliver. A request such as
   “send ten recruiters on Wednesday” is an explicit deferred-delivery
   instruction: schedule the bounded direct campaign and let its Target-only
   delivery tick send at the requested time, without asking again on
   Wednesday. “Prepare”, “draft”, “queue”, or “schedule only” authorizes no
   future Gmail send; use a hold/draft-only state instead.
2. Check the live application, selected contact(s), normal-queue and Gmail
   duplicate history. Select only contacts whose identity and work email are
   verified. Never guess an email address.
3. For every candidate delivery, run the Advanced Gmail rejection preflight.
   The delivery tick must run it again immediately before `sendEmail` so a
   later rejection blocks the message.
4. Create or use a **public, bounded scheduler/wrapper** for only that
   campaign. It may write a campaign-specific Script Property and install or
   reuse the Target-only clock trigger/shared router. A private helper ending
   in `_` cannot be invoked with `clasp run`; expose a small public wrapper
   with fixed scope and guards instead.
5. Refresh the Target mirror after scheduling or any state transition. The
   campaign must appear in `Email_target` or `Referral_target`; if it does not,
   repair the mirror rather than assuming it was scheduled.
6. Do not call `installOutreachTriggers()`, `runOutreachCycle`,
   `runOutreachSendTick`, or any automatic planner. Do not change Script
   Properties `outreach`, `referral`, or `followUp` from `Pause`.
7. Before a send, report daily accounting in America/New_York time. Include
   direct Target work plus the hypothetical automatic forecast for policy
   visibility, but keep the latter paused. Warn and obtain acknowledgement if
   the total is more than 55.
8. After a successful Gmail acceptance, mark only that campaign entry `Sent`,
   refresh the mirrors and Target seed counts/status. A plan, draft, failed
   preflight, cancellation, or failed Gmail call must not mark Target as sent.
9. After code changes, update the matching component documentation and daily
   log, then verify deployment with a fresh scratch-directory `clasp pull` and
   a search for the deployed public wrapper. Do not rely only on `clasp push`.

## Cancellation or retiming

Only mutate entries that are still pending. A cancellation/retiming wrapper
must refuse to touch `Sent`, `Bounced`, `Failed`, or otherwise delivered
entries; preserve accepted-send history. Remove only the matching campaign
property and its dedicated trigger (if any), then refresh the appropriate
Target mirror. Never alter Automatic modes as a shortcut.

## What is deliberately not safe

- Turning off Pause modes or installing Automatic triggers to make a single
  campaign run. That can plan/send work for unrelated applications.
- Writing contacts to `Contacts (manual)` by itself and treating that as a
  scheduled send. Contacts are data, not delivery instructions.
- Calling a private scheduler with `clasp run`, bypassing duplicate checks, or
  using unverified/guessed recipient addresses.
- Counting `Email_target` or `Referral_target` as ordinary queues, which risks
  duplicate delivery if a normal worker is later changed.

See [manual-outreach-trigger.md](manual-outreach-trigger.md) for owner
authorization, templates, rejection safety, and the required final daily
summary. See [components/outreach-target-priority-waves.md](components/outreach-target-priority-waves.md)
and [components/outreach-diagnostics.md](components/outreach-diagnostics.md)
for the live implementation.
