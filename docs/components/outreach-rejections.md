# outreach_rejections.gs — reading rejections out of the mailbox

Finds rejection emails, works out which application each is about, records it on both tabs, and
calls off everything still in flight for that application.

## Connections

- **Reads:** Gmail (labelled search), `App`, `Email`.
- **Writes:** `App` (`Process`, `Update`), `Email` (rows cancelled).
- **Runs:** cycle steps `rejections` and `stale`, both before `enqueue` — so a contact freed here
  is available to the wave planned in the same firing.

## Recognising a rejection

| Function | Does |
|---|---|
| `outreachNormalise_(text)` | Lowercase, apostrophes removed, whitespace collapsed. |
| `outreachSentences_(text)` | Split into sentences. |
| `outreachSentenceRefuses_(sentence)` | Whether one sentence is a refusal. |
| `outreachIsRejection_(text)` | Whether the message as a whole is one. |

Sentence-level rather than whole-body: "we will not be moving forward" inside a paragraph that
also says "we were impressed" is still a rejection.

## Pinning it to an application

| Function | Does |
|---|---|
| `outreachTextTokens_(text)` | The distinct words in a body, broken up the way a company name is. |
| `outreachSenderTokens_(from)` | The words in a `From` line that could name an employer. |
| `outreachRoleScore_(a, b)` | How well two role strings agree. |
| `outreachRejectionTarget_(...)` | **Which open application this is about, or nothing and why not.** Returning the reason is the point: an unpinnable rejection must be visible, not silently dropped. |

## Recording it

| Function | Does |
|---|---|
| `outreachRejectedOn_(message)` | The day the rejection was *sent*, which is the day it happened. |
| `outreachLastStage_(updateCell)` | The stage named by the last line of `Update` that names one. |
| `outreachStamp_(...)` | The `"<Stage>: <date>"` line appended to `Update`. |
| `outreachRecordRejection_(...)` | Write it to both tabs. |
| `outreachCancelQueueRows_(...)` | Call off everything still in flight for that application. |
| `outreachStaleQueueRows_(...)` | Queue rows still in flight for an application that has stopped qualifying for any reason. |
| `cancelStaleOutreachRows()` | Bring the queue back in line with `App`. Cycle step `stale`. |
| `outreachLabel_()`, `outreachRejectionQuery_()` | The Gmail label and search. |
| `scanRejectionEmails()` | Read the mailbox and act on what can be pinned down. Cycle step `rejections`. |

## Gotcha

Everything the search returns leaves with exactly one Gmail label, so nothing is judged twice.
A message that could not be pinned to an application is still labelled — it is out of the search
but recorded as unresolved, which is why `outreachRejectionTarget_` returns a reason.
