# Manual-triggered outreach email workflow

This document is the operating policy for email work requested through the assistant. It
overrides the runtime scheduler for assistant actions: email planning, drafting and sending
must happen only after an explicit user command in the current conversation.

The runtime may still contain automatic queue logic, triggers or previously scheduled rows. That
logic is included in the daily accounting below, but it is never an authorization for the
assistant to run it.

## Core rule: no autonomous email activity

Do not automatically:

- plan a new cold-email or referral wave;
- enqueue, draft, schedule or send messages;
- run the automatic queue merely because a day has started or a trigger exists;
- activate a paused path, install a trigger, or change a campaign schedule.

An explicit command such as “prepare today’s recruiter emails”, “write the referral emails for
these companies”, or “send the approved drafts” is required. A previous plan, a queued row, or a
live Apps Script trigger does not count as a new command.

“Write/prepare” authorizes planning and drafting only. Actual Gmail sending requires the user to
explicitly say “send” (or equivalent) for that specific plan.

## Greeting personalization

Use the shared greeting renderer for all recruiter, referral and follow-up messages. It removes
decorative prefixes/icons and addresses the recipient by their given name. It renders that given
name with only its first letter capitalized (`lIsA` → `Lisa`) before it reaches any email. For a
Vietnamese-style name it adds lowercase `anh` or `chị` only when a conventional gender inference
is high confidence. Do not guess a title for ambiguous names; use the given name alone except
where the pure-Vietnamese gate below requires the owner’s choice. See
[`components/outreach-templates.md`](components/outreach-templates.md) for the maintained name
lists and examples.

## Pure Vietnamese referral gate

For a **manual referral** whose recipient has a pure Vietnamese-style full name, use
[`henry_vietnamese.md`](henry_vietnamese.md), not the English referral catalog. “Pure” here means
manual review finds a Vietnamese given-name/middle-name plus Vietnamese family-name structure, or
Vietnamese diacritics; an English given name paired only with a Vietnamese surname does not meet
this gate.

Every Vietnamese-template message must use exactly one lowercase title, `anh` or `chị`. The
shared renderer's neutral given-name fallback is not permitted for this gate. If the agent cannot
make a high-confidence title decision, it must return to this chat and ask the owner which title
to use. It must not draft, queue, schedule, or send that recipient through the pipeline until the
owner answers.

Once the owner supplies the title, a manual Target-referral run may store that recipient's
approved given name, title and a `henry_vietnamese` variant in the campaign entry. That is a
copy-selection change only: it does not itself draft or send email, and no other recipient
inherits the decision.

## Read the correct template documentation first

Never use the recruiter wording for a referral ask, or referral wording for a recruiter email.
Before composing, read the relevant existing documentation:

| Email type | Required documentation | Use |
|---|---|---|
| Recruiter / cold email | [`email-templates.md`](email-templates.md), [`components/outreach-templates.md`](components/outreach-templates.md), and [`components/outreach-send.md`](components/outreach-send.md) | Select the approved cold template, recruiter-specific proof point and sender/footer rules. |
| Request for a referral | [`components/outreach-referral-queue.md`](components/outreach-referral-queue.md), [`components/outreach-referral-send.md`](components/outreach-referral-send.md), and [`components/outreach-templates.md`](components/outreach-templates.md); plus [`henry_vietnamese.md`](henry_vietnamese.md) when the pure-Vietnamese gate applies | Select the approved referral template and obey the referral eligibility, recipient and safety rules. |
| Target campaign | [`components/tracker-target-tab.md`](components/tracker-target-tab.md) plus the applicable row above | Treat `Target` as the sourcing/count view; use `Email_target` and `Referral_target` for explicit Target campaign state. |

If the request does not identify the path, stop and resolve whether it is a recruiter/cold email
or a referral ask before writing copy.

## Trigger scope

Every manual run must identify, explicitly or by an unambiguous reference:

1. the email path: recruiter/cold, referral, follow-up, Target recruiter, Target referral, or a
   stated combination;
2. the companies, applications or queue rows in scope;
3. the local sending date, if it is not obvious;
4. whether the result should be a plan, Gmail drafts, or actual sends.

If the user asks only to “write” emails, produce the plan and drafts/copy but do not send. If the
user asks to send, re-check the live application, recipient and queue state immediately before
the send operation.

## Gmail rejection preflight

Before allowing a recruiter, referral or Target campaign entry to leave the mailbox, verify through
the Advanced Gmail API that the company has not sent a matching rejection. A matching rejection
blocks the entry; never send it merely because it was already scheduled or drafted. For direct
Target campaigns the delivery tick performs this check immediately before `sendEmail`, records a
blocked entry as cancelled with the reason, and refreshes the Target mirror. For a manual run,
report every block to the owner in this chat before continuing with any remaining eligible entries.

An Apps Script clock trigger cannot itself write into this chat. If a future background tick finds a
new rejection, it preserves the evidence and blocked state in the campaign; the next requested
status/preflight check must surface it to the owner here.

## Daily email accounting

Use `America/New_York` calendar dates. At the end of every manual run, calculate the number of
messages planned to leave the mailbox on that date. The calculation includes both Target and
automatic work, even when the automatic runtime path is currently paused or not activated.

Count these sources:

- automatic cold recruiter emails from `Email`;
- automatic referral asks from `Referral`;
- automatic follow-ups;
- explicit Target recruiter campaigns represented by `Email_target`;
- explicit Target referral campaigns represented by `Referral_target`;
- any additional messages explicitly included in the current command.

For a given local date, count rows that are already `Sent` on that date plus rows in `Queued` or
`Drafted` state scheduled for that date. Exclude `Cancelled` and `Failed` rows. Deduplicate a
message by its queue/campaign identity so a Target mirror and its underlying campaign cannot be
counted twice. `Target` itself contains availability counts and checkboxes, not the complete
scheduled-message list; use the two Target mirrors for scheduled Target work.

The automatic portion is a planning assumption for this report: include what the automatic
planner would send that day as if it were active, but do not execute it unless the user explicitly
commands that action.

## Daily volume warning

The human-review warning threshold is **more than 55 messages** for one `America/New_York`
calendar day. Exactly 55 does not trigger this warning.

When the total is greater than 55:

1. show a prominent warning before any Gmail draft or send operation;
2. break the total down into Target, automatic cold, automatic referral, follow-up and other
   explicitly requested messages;
3. do not send until the user explicitly acknowledges the over-55 total; and
4. do not silently drop, duplicate or move messages to another date to hide the excess.

A plan-only response may still report the overage, but it must clearly label the result as a
warning and not as permission to send.

## Required final summary

Every response after writing or planning emails must end with a compact daily summary containing:

```text
Plan date: <YYYY-MM-DD America/New_York>
Target: <count>
Automatic: <count>
Follow-up/other: <count>
Total planned to send: <count>
Already sent: <count>
Still queued/drafted: <count>
Status: plan | drafted | sent | blocked pending confirmation
```

If the total exceeds 55, add:

```text
WARNING: <count> planned messages exceeds the 55-message daily threshold.
```

The summary must distinguish “planned to send” from “actually sent”. A draft, queue entry or
Target checkbox is not evidence that Gmail accepted a message.
