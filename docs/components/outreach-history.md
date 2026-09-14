# outreach_history.gs — external cold-email history

## Purpose

Owns the append-only `Outreach History` spreadsheet tab. It records a cold email
that was sent outside the normal `Email` queue or direct Target campaign, including
messages using a different approved or owner-written template. The tab is evidence
and reporting only: no planner, draft worker, or send worker reads it, so a history
row cannot become another send.

The visible ledger contains the Gmail-accepted send time, company, path, role/link
when known, source, Gmail message ID, a salted recipient fingerprint, and `Sent`
status. It intentionally does not show recruiter email addresses. Existing past
Gmail threads are not auto-imported because Gmail alone cannot reliably distinguish
a cold email from unrelated correspondence.

## Functions

| Function | Responsibility |
| --- | --- |
| `initializeOutreachHistory()` | Creates or repairs the sender-owned `Outreach History` tab with its fixed header and timestamp formatting. It stops on an unexpected existing header rather than overwriting a human-maintained sheet. |
| `outreachReadExternalColdHistory_(tracker)` | Internal read of valid `Cold email`/`Sent` ledger rows. It never exposes a recipient address. Target coverage and history diagnostics use it as additional sent evidence. |
| `recordExternalColdEmail(company, recipientEmail, role, jobLink, source)` | Manual-only recorder for an already-sent off-template/external cold email. It verifies a Gmail send to the supplied recipient, appends one idempotent evidence row keyed by Gmail message ID, ticks the matching Contacts `Sent` value when present, and syncs the Target recruiter status/counts. It never drafts, queues, or sends email. |

## Operating rule

After any cold email is sent outside a queue/campaign—by the owner or by an
explicit manual assistant send—record it through `recordExternalColdEmail` in the
same work session. Supply the company and recipient so Gmail can confirm the
message; include the role/link when available. A draft, planned email, or unsent
manual note is never recorded. This rule lets the Target audit treat all actual
cold-email approaches consistently without misclassifying unrelated Gmail threads.
