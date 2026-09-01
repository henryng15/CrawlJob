# outreach_referral.gs — the referral ask's words

The referral message is not a cold email with a different noun. It asks a stranger to spend
their own credibility, so it has its own tiers, subjects and templates. Humble here means clear,
professional and conditional: it asks for a resume review first, then a referral only if the
reader independently sees a fit. It does not use self-deprecating language.

Every string is listed verbatim in
[../email-templates.md](../email-templates.md#part-3--the-referral-ask) — the four tiers of ten, the
thirty six subjects, the ten applied lines and the bullet order per bucket.

## Connections

- **In:** the person (title, seniority), the company, the posting.
- **Out:** [outreach-referral-send.md](outreach-referral-send.md) `draftReferralAsks` writes it.
- Pure. Opens nothing, sends nothing.

## Tiers and templates

A person's **tier** comes from their title and seniority. Ten variations per tier keep six people
at one employer from receiving an identical body, while a least-used-first selector balances new
asks within that tier. A company-seeded order breaks ties, preserving a stable sequence for people
at one employer. Every variation has the same serious structure: introduction, no-prior-connection
context, applied role, two relevant projects, resume-review/referral request, attached resume and
direct posting link, then an easy opt-out.

| Function | Does |
|---|---|
| `outreachReferralTier_(title, seniority)` | The tier for one person. |
| `outreachReferralIndex_(company, attempt)` | Which of the ten templates this attempt gets. Keyed on the company so the sequence is stable per employer. |
| `outreachReferralTemplateLoad_(...)`, `outreachBalancedReferralTemplateFor_(...)` | Count non-cancelled referral rows per tier and choose the least-used template for a newly booked row; the company-seeded index breaks a tie. |
| `outreachReferralContactOpening_(...)` | One of ten professional paraphrases of the no-prior-connection sentence. |
| `outreachReferralAttemptForTemplate_(...)` | Recover the stable attempt belonging to a persisted template, so the subject and resume-bullet pair can be recreated at draft time. |
| `outreachReferralSubjectIndex_(...)` | Which subject a person gets. |
| `outreachReferralSubject_(...)` | That subject. |
| `outreachReferralIntro_(...)` | Who is writing, their software-engineering background, what they have **already applied to**, and one line on why the role fits. Graduation year left out. |
| `REFERRAL_APPLIED_LINES` | Ten concise role-fit lines, indexed with the template so six people at one employer do not read the same sentence. |
| `outreachReferralBullets_(...)` | The body's bullet block. |
| `outreachReferralPosting_(link)` | The posting, on a line of its own at the foot of the message. |
| `outreachReferralCompose_(...)` | **The entry point.** One referral email, in both halves. |
| `previewReferralTemplates()` | Run by hand: log one example of every tier and every template. Sends nothing. |

## Gotchas

- The posting link sits on its own line at the foot deliberately: a link inside a sentence asking
  for a favour reads as a demand to click.
- **The applied fact is stated, not implied.** The intro said "applying for the role" for as long as
  this path read the `Jobs` tab and had no application behind it. Every row now comes from one that
  was made, so the present tense became the same falsehood pointing the other way — and a reader
  left to guess assumes the expensive version, that their name is wanted for somebody who has not
  applied. Said in the past tense, with a `REFERRAL_APPLIED_LINES` line after it saying why the note
  exists anyway.
- Anything that would turn a two-minute favour into a calendar item is left out — the safe answer
  to a calendar item is silence.
- `previewReferralTemplates` is the only safe way to change wording. There is **no second
  attempt** at a person, so a template bug is not a retry, it is a chance spent.
- A queued referral row keeps the body-template number already displayed on its tab. The balance
  rule fills only new rows, never rewriting a draft or changing a message awaiting review.
