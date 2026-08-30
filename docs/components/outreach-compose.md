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
| `outreachVariantOrder_(contact)` | The variations this contact could receive, best first. Reads `Focus` — `university` moves the campus subject up. |
| `outreachVariantFor_(...)` | The one variant this attempt uses. |
| `outreachCompose_(...)` | **The entry point.** Builds one email in both halves, HTML and plain. |
| `outreachIntroBullets_(...)` | The bullet block. |
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
