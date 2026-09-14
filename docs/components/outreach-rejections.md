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
| `outreachHostTokens_(url)` | The employer-naming labels of a URL's host, ATS plumbing dropped. |
| `outreachReqIds_(text)` | The requisition numbers a piece of text names. Five digits or more, leading zeros stripped. |
| `outreachRolePhrase_(subject, body)` | The role the message is about, cut out of the frame the ATS wrote it in. |
| `outreachRoleFold_(role)` | A role title as a set of words, endings settled and filler dropped. |
| `outreachRoleAgreement_(a, b)` | How far two role titles agree, counted in **both** directions. |
| `outreachRejectable_(process)` | Whether a refusal can still close this application. Everything but `Rejected`. |
| `outreachRoleScore_(a, b)` | How much of a role title a text names. One-way; kept for callers that want recall. |
| `outreachRejectionTarget_(...)` | **Which application this is about, what state it is in, and why.** Returning the reason is the point: an unpinnable rejection must be visible, not silently dropped. |
| `outreachGmailApiRejectionQuery_()` | The broad, bounded Gmail query used by preflight; it uses the same rejection phrase catalog as the scanner but does not depend on the scanner's labels. |
| `outreachGmailApiBodyText_(payload)`, `outreachGmailApiHeader_(payload, wanted)` | Decode the plain body and selected headers from an Advanced Gmail API message response. |
| `outreachGmailApiRejectionCandidates_()` | Reads the scanner's bounded 40 newest current candidates through `Gmail.Users.Messages.list/get`, so a one-minute Target tick can finish. A list/get API error reaches the caller so a send cannot proceed on an unverified mailbox; an individual malformed body stays available to diagnostics but does not by itself block delivery. |
| `outreachGmailApiRejectedTarget_(entry, candidates)` | Applies the rejection recognizer and company/role matcher to one Target entry. It blocks only a message with decoded refusal language; an unreadable body is insufficient evidence to block an application acknowledgement. |

### The three layers, strongest first

1. **The requisition number.** `outreachReqIds_` over the subject and body against the same
   over the row's `Application Link` and `Official`. The only layer that separates two rows
   whose role titles are identical word for word — which is exactly what IBM's `App` rows are.
2. **The employer**, from the sender line, the subject, **and the host of the link the row
   itself holds**. The link is the one place the employer is written down that neither an ATS
   sender nor a typo can distort: `avav.wd1.myworkdayjobs.com` is AeroVironment however the
   `From` line reads, and it reaches a row whose company cell says `Saleforce`.
3. **The role**, but only where the employer has several applications. `outreachRolePhrase_`
   names the role first, then `outreachRoleAgreement_` compares the two titles **as titles**.

> **Why the role score had to become two-sided.** The old score asked only how much of the
> sheet's title the email names, so every word of `Software Engineering Intern` appears inside
> `Embedded Software Engineer Intern` and the embedded row scored a perfect 1.0 against a mail
> about the generic req. Measured both ways it falls to 0.86, and a containment guard rejects
> it outright: **the email may say more than the sheet does, never less.** Without that guard a
> generic refusal closes a specialisation at the same employer — a live application lost, with
> nothing downstream to question it.

> **`outreachRejectable_` is not `outreachQualifies_`.** They answer different questions.
> `outreachQualifies_` is the sending gate: may a cold email still go out, and its list is
> `Applied` and `Completed OA`. An application at `OA` or `Interview` admits no cold email and
> is very much still live. Reusing the sending gate here meant every refusal arriving after an
> interview found no row and went to the review pile.

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

## The five verdicts

Everything the search returns leaves with exactly one Gmail label, so nothing is judged twice.

| Label | Means | Writes? | Re-judged on a rules bump? |
|---|---|---|---|
| `Tracker/Rejected` | pinned, and `App` was written | yes | **no** — the row is closed, so a second pass would find nothing and move a correct closure into the review pile |
| `Tracker/Already recorded` | pinned, and `App` already said `Rejected` | no | yes |
| `Tracker/No application` | no row in `App` names this employer | no | yes |
| `Tracker/Check by hand` | genuinely ambiguous — several applications there, none named exactly | no | yes |
| `Tracker/Not a rejection` | the language is not a refusal | no | yes |

> **Why "already recorded" and "no application" are not questions for a person.** Both used to
> be filed as `Check by hand`, and neither has an action attached, so neither ever left the
> pile. Of the 35 threads sitting there when this was written, 10 were refusals for an
> application `App` already recorded as `Rejected` and 12 named an employer with no row at all —
> mail for something applied to outside this tracker. Two thirds of a review surface that is
> supposed to be short enough to read on a Sunday.

**Measured on those same 35 threads**, the layers above turn `0 written / 0 recorded /
35 by hand` into `4 written / 10 recorded / 21 by hand`, with no wrong write. Three tightenings
were needed to get the wrong writes to zero: the two-sided role score, the containment guard,
and scoring the already-`Rejected` rows alongside the live ones so a closed row that matches
better wins over a live row that matches worse.

**Bump `REJECTION_RULES_VERSION` whenever any of this changes** — it is what reopens the four
re-judgeable piles so improved rules see the mail the old rules got wrong. It is at **4**.
