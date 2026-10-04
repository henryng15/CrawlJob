# outreach_figma_earlycareer_followup_0930.gs — Figma early-career follow-up, 09-30

On 2026-09-29 the owner asked for one more reply, on the morning of 09-30, to the early-career
recruiter already emailed in the 09-21 Figma wave.

## Who

Of the ten Figma recipients on 09-21, only **Shelley H. (`shelley@figma.com`, Early Career
Recruiter)** is early-career. The other nine are technical recruiters, technical sourcers or
recruiting directors (Anisha Ladhar, Darya Behroozi, Erin Fox, Gwendolyn Jenkins, Jacinta Harding,
Jane Tu, Jenny Cai, Kathryn Hart, Shu Chen), so they are out of scope. Hannah O'Toole and Jaelyn
Brown get their *first* email on 09-30 from
[`outreach_earlycareer_topup_0929.gs`](outreach-earlycareer-topup-0929.md); their follow-up, if the
owner wants one, is a later file.

## Timing

10:40 ET, between the 09-30 gap wave (09:00–10:24, 13 companies at 7 minutes) and the 11:00
early-career top-up. The day stood at 54 Target messages, so this brings it to 55 and needs no
over-55 acknowledgement.

## Guards

Same as [`outreach_followup.gs`](outreach-followup.md) and the 10-01 university follow-ups: one
plain-text, two-sentence reply on the original thread, no attachment. Any human reply from Figma,
any Figma mail that is not a shared or no-reply mailbox, or a matching Gmail rejection cancels it; a
bounced or missing original skips it.

Two live facts were checked before scheduling:

- The 2026-09-13 *"Update from Figma"* decline names Software Engineer Intern (**Winter 2027**), a
  different application from the active **Summer 2027** one confirmed on 09-14.
  `diagnoseTargetCompanyRejectionPreflight('Figma', …)` returns `clear`.
- Figma's own bounce-back subject is `Vacation / Out of Office Re: …`. The automatic-reply pattern
  in `outreach_university_followups_1001.gs` is anchored at the start of the subject, so it would
  read that as a human answer and silently cancel. The pattern here matches anywhere in the
  subject, and the diagnostic confirms `answeredNow: no` with two such bounce-backs (from
  `schen@` and `aladhar@`) in the mailbox. **Open for the owner:** the 10-01 file still carries the
  anchored pattern; it is only exposed if Atlassian or Qualcomm sends a similarly worded
  auto-reply.

## Functions

| Function | Does |
|---|---|
| `scheduleFigmaEarlyCareerFollowUp20260930()` | Stores the single entry under `UNIVERSITY_FOLLOWUPS_20260930_FIGMA_EARLYCAREER` and installs one one-off trigger. Returns `alreadyScheduled` rather than double-booking. |
| `runFigmaEarlyCareerFollowUp20260930_()` | Trigger handler: re-checks the guards, sends through `outreachSendFollowUp_`, records `sent`/`skipped`/`cancelled`, then deletes its trigger. |
| `diagnoseFigmaEarlyCareerFollowUp20260930()` | Read-only: state, trigger count, the answer check, the original thread found and the exact body. |
| `cancelFigmaEarlyCareerFollowUp20260930()` | Cancels the pending entry and removes the trigger. Safe to re-run. |

## Readback, 2026-09-29

`{scheduled: 'Figma Shelley H. 2026-09-30 10:40 EDT'}`, then `state.status: scheduled`,
`triggers: 1`, `answeredNow: 'no'`, original `SWE student who cut research to 1 minute`
(2026-09-21 13:42 ET). The harness stayed at 574 ok / 28 FAILED and the pull-diff showed only this
new file.
