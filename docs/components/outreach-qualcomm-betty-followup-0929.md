# outreach_qualcomm_betty_followup_0929.gs — Betty Vallar, Qualcomm, 09-29 23:00 ET

Tonight's 22:16 ET cold email to Steph Savitz (Qualcomm Campus Recruiting Lead) drew an
out-of-office reply routing *"Summer intern program and all intern-related questions"* to **Betty
Vallar** by name. The owner asked for Betty to be found and written to the same night.

## Why this is a reply, not a new cold email

Betty was already cold-emailed on **2026-09-24 at 15:29 ET**, subject *"SWE student: AI, cloud, and
backend systems"*. She has not answered and nothing bounced. A fresh cold message would be a
duplicate, and the shared sender's duplicate guard would refuse it. So this goes out as one
plain-text reply on that thread, at 23:00 ET.

What makes it worth sending is new information rather than a nudge: a person inside Qualcomm's
campus team named her as the owner of intern questions.

Her address, `bvallar@qualcomm.com`, is the one the 09-24 message reached; BounceBan scores it
deliverable 99 on an accept-all domain. LinkedIn confirms Betty Ann Vallar, Talent Acquisition
Specialist, Senior, San Diego, at Qualcomm since 2019.

## A detail worth keeping

Steph's away message gives her leave as **2026-07-03 through 2026-09-25** — a window that closed
four days before it fired. Either she has not switched it off or the leave ran long. The 10-01
Qualcomm follow-up to Andrew Cordisco in
[outreach-university-followups-1001.md](outreach-university-followups-1001.md) is unaffected.

## Guards

As in the other one-off follow-ups: a human reply on Betty's thread, a matching Gmail rejection, or
a bounced/missing original stops it. One difference from
[the Figma file](outreach-earlycareer-followup-0930.md): the "answered" test is scoped to **Betty's
own thread** rather than to all Qualcomm mail, because a company-wide test could read Steph's
out-of-office as a human answer — and that out-of-office is the very reason this send exists. The
automatic-reply pattern also carries `on leave`.

## Functions

| Function | Does |
|---|---|
| `scheduleQualcommBettyFollowUp20260929()` | Stores the entry under `UNIVERSITY_FOLLOWUPS_20260929_QUALCOMM_BETTY` and installs one one-off trigger. |
| `runQualcommBettyFollowUp20260929_()` | Trigger handler: re-checks the guards, replies through `outreachSendFollowUp_`, records the outcome, deletes its trigger. |
| `diagnoseQualcommBettyFollowUp20260929()` | Read-only: state, trigger count, answer check, the original thread and the exact body. |
| `cancelQualcommBettyFollowUp20260929()` | Cancels the pending reply and removes the trigger. |

## State on 2026-09-29

Scheduled: `Betty Vallar 2026-09-29 23:00 EDT`, `triggers: 1`, `answeredNow: no`, original found
(09-24 11:29 ET as Gmail's API reports it).
