# outreach_compose.gs — the cold email's words

Turns one queue row plus its contact into the message that goes. Pure: hand it data, get back
subject and body. It opens nothing and sends nothing.

## Connections

- **In:** a queue row, the contact, the application, and the angle/bucket from
  [outreach-contacts.md](outreach-contacts.md).
- **Out:** [outreach-send.md](outreach-send.md) `prepareOutreachDrafts` writes the result to Gmail.
- The referral path has its own composer — see [outreach-referral-templates.md](outreach-referral-templates.md).

## Functions

| Function | Does |
|---|---|
| `outreachVariantOrder_(...)`, `outreachVariantFor_(...)` | The compatible base variations, in relevance order. `Focus = university` moves the campus subject up. |
| `outreachVariantTemplateLoad_(...)`, `outreachBalancedVariantFor_(...)` | Count non-cancelled queue rows and give a new row the least-used base variation; relevance breaks a tie. Existing rows keep the template already written on the tab. |
| `outreachCopyFormFor_(...)`, `outreachVariantParts_(...)`, `outreachVariantKey_(...)` | Choose and persist one of three light copy forms within the selected base as `base:form`; old base-only values remain form 1. |
| `outreachCompose_(...)` | **The entry point.** Builds one email in both halves, HTML and plain, with three short labelled sections. |
| `outreachIntroText_(...)` | Writes the natural introduction: who Henry is, the application, and the genuine hope of moving to the next stage. |
| `outreachNaturalHook_(...)` | Turns a profile hook into a sentence that explains why this recruiter received the note, trimming headline spillover. |
| `outreachSubject_(...)` | Fills a short subject hook, including `{role}` where a variation uses it. |
| `outreachShortRole_(title)` | A role shortened for the subject line. A title no rule recognises is left exactly as written — never mangled. |
| `outreachFirstName_(name)` | The greeting name. |
| `outreachNoDashes_(text)` | An em dash becomes a full stop and a new sentence. |
| `outreachEscape_(text)` | HTML-escape. |
| `outreachBoldHtml_(text)`, `outreachBoldPlain_(text)` | The same emphasis in each half. |

## Gotchas

- **Two halves must say the same thing.** `outreachBoldHtml_` and `outreachBoldPlain_` exist so
  the HTML and plain-text bodies stay in step; changing one without the other means some readers
  see a different message.
- `outreachNoDashes_` runs on the way in, so a long dash typed into a contact's `Angle` does not
  reach the reader as an em dash.
- `SHORT_ROLES` drives `outreachShortRole_`; adding a rule there changes subject lines for every
  future send, and none already drafted.
- There are ten factual base variations and three copy forms per base. The three headings stay
  short and fixed (`A quick introduction`, `Why I’m reaching out`, `A quick question`); subjects
  and closings vary, while the resume fact, recipient-specific hook, company angle and ask remain
  grounded in their source data.
- Cold subjects are deliberately under 60 characters and use curiosity or a small pattern break
  (`I applied. What happens next?`, `I may have the wrong person`) instead of dangling resume
  statistics. No subject promises urgency or hides that this is an application email.
- The body uses short paragraphs rather than bullet lists. The intro carries one bold resume proof
  point; the role, company and ask are also bold where they help the eye land. HTML and plain text
  still render the same words.
- The opening identifies Henry and Kenyon plainly. It must not include graduation-year or GPA
  metadata such as `class of 2028` or `4.0 GPA`.
