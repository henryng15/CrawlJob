# outreach_templates.gs, outreach_compose.gs, outreach_referral.gs — the words

Ten cold templates and ten referral templates, and the machinery that fills and renders them.

**`outreach_templates.gs` is generated. Do not edit it.** The wording lives in ColdEmail's
`docs/henry_cold_email_templates_10.md` and `docs/henry_referral.md`; `scripts/build_templates.py`
parses both and writes the `.gs`. `--check` fails if the two have drifted.

## What this replaced

| Was | Now |
|---|---|
| 30 cold bodies: 10 factual bases × 3 copy forms, chosen by the contact's `Focus` and the company's `Bucket` | 10 fixed templates, chosen only by which is least used |
| 40 referral bodies: 10 forms × 10 tier-specific asks, softening as the reader got more senior | 10 fixed templates; the tier decides nothing |
| 36 referral subjects drawn from a list and paired to the attempt | each template carries its own subject |
| A per-recruiter `Hook` and a per-company `Angle` written into the body | neither reaches a reader |
| `RESUME_BULLETS`, paired to the attempt | four fixed bullets inside each template |
| `outreachShortRole_` + `SHORT_ROLES`, rewriting a job-board title into three words | the posting title is printed as written |

The cost is stated plainly because it is real: **nothing is personalised to the reader beyond
their first name and their employer, and nothing can be.** The templates have nowhere to put it.

Two consequences worth knowing:

- **An empty `Angle` no longer holds a row back.** `outreach_queue.gs` used to send only when the
  company had an angle and draft otherwise, because an angle was something the message needed.
  Nothing needs it now, so that distinction went with the copy that motivated it.
- **The referral message prints no posting link.** The templates say "I'd be happy to send over
  the job ID afterward", and a link under that sentence contradicts it. The Referral tab still
  refuses to send a row without one.

## The shape

Every template, in both sets: a subject, one opening paragraph, three headed sections — the first
four bullets, the other two a short paragraph each — one or more closing paragraphs, and a
sign-off. `**bold**` survives into both halves through `outreachBoldHtml_` / `outreachBoldPlain_`.

Only three placeholders exist: `[Name]`, `[Company]`, `[Role Name]`. The generator refuses any
other, because a placeholder nothing fills reaches a recruiter as square brackets. Each falls back
to a word rather than an empty string — `there`, `your team`, `DEFAULT_SHORT_ROLE`.

## Functions

| Function | Does |
|---|---|
| `outreachColdTemplateLoad_(queueRows)` | Counts non-cancelled rows per template, 1–10. |
| `outreachLeastUsedTemplate_(load, count)` | The least-used number, ties to the lowest. |
| `outreachColdTemplateFor_(load)` | Which of the ten a new cold row gets. |
| `outreachFillTemplate_(text, values)` | Substitutes the three placeholders. |
| `outreachRenderTemplate_(template, values)` | One template plus one recipient as `{subject, html, plain}`. Shared by both paths. |
| `outreachCompose_(options)` | One cold email, from `template`, `company`, `role`, `recruiterName`. |
| `outreachReferralTemplateLoad_(referralRows)` | The same count for the Referral tab. |
| `outreachReferralIndex_(company, attempt)` | A stable per-employer place in the ten, so six people at one company walk the list in a fixed order. |
| `outreachReferralAttemptForTemplate_(company, template)` | The attempt behind a template a row already advertises. |
| `outreachBalancedReferralTemplateFor_(tier, company, attempt, load)` | Least-used, tie broken by the company-seeded order. `tier` is ignored and kept only for the caller. |
| `outreachReferralCompose_(options)` | One referral ask. Accepts `angle`, `bucket`, `seniority`, `dateApplied` and uses none of them. |
| `outreachReferralTier_(title, seniority)` | Still computed, because the Referral tab has a Tier column. Decides no wording. |
| `previewReferralTemplates()` | Logs one example of each of the ten. Sends nothing. |

## Gotchas

- **Both halves must say the same thing.** `outreachRenderTemplate_` builds HTML and plain in one
  pass for that reason; changing one branch without the other is the failure this shape prevents.
- **Subjects run long.** Seven of the ten cold subjects and nine of the ten referral subjects pass
  the 60 characters a phone shows. That is a property of the copy, not of this code, and the tests
  assert the exact counts so it cannot change unnoticed.
- **The closing is a list, not a string.** Referral templates end with two paragraphs — the resume
  line and the thank-you. An early version of the generator kept only the last, which silently
  dropped the sentence saying an attachment exists from all ten.
