# outreach_referral.gs — the referral ask's words

The referral message is not a cold email with a different noun. It asks a stranger to spend
their own credibility, so it has its own tiers, subjects and templates.

## Connections

- **In:** the person (title, seniority), the company, the posting.
- **Out:** [outreach-referral-send.md](outreach-referral-send.md) `draftReferralAsks` writes it.
- Pure. Opens nothing, sends nothing.

## Tiers and templates

A person's **tier** comes from their title and seniority; the tier plus an index picks the
subject and body. Ten templates, so six people at one employer never read the same message.

| Function | Does |
|---|---|
| `outreachReferralTier_(title, seniority)` | The tier for one person. |
| `outreachReferralIndex_(company, attempt)` | Which of the ten templates this attempt gets. Keyed on the company so the sequence is stable per employer. |
| `outreachReferralSubjectIndex_(...)` | Which subject a person gets. |
| `outreachReferralSubject_(...)` | That subject. |
| `outreachReferralIntro_(...)` | Who is writing, in one line, **with the graduation year left out**. |
| `outreachReferralBullets_(...)` | The body's bullet block. |
| `outreachReferralPosting_(link)` | The posting, on a line of its own at the foot of the message. |
| `outreachReferralCompose_(...)` | **The entry point.** One referral email, in both halves. |
| `previewReferralTemplates()` | Run by hand: log one example of every tier and every template. Sends nothing. |

## Gotchas

- The posting link sits on its own line at the foot deliberately: a link inside a sentence asking
  for a favour reads as a demand to click.
- Anything that would turn a two-minute favour into a calendar item is left out — the safe answer
  to a calendar item is silence.
- `previewReferralTemplates` is the only safe way to change wording. There is **no second
  attempt** at a person, so a template bug is not a retry, it is a chance spent.
