# outreach_contacts.gs — the contact list, and who counts as the same employer

Contacts live in a **separate spreadsheet owned by the sending account**, never in the tracker.

## Two tabs, and the split is the point

| Tab | Written by |
|---|---|
| `Contacts (seed)` | Overwritten wholesale by the ColdEmail export |
| `Contacts (manual)` | Only ever typed by hand, never touched by automation |

One tab would mean a single re-export silently destroying months of hand-gathered contacts.
Two tabs make that impossible rather than merely unlikely.

## Connections

- **Reads:** `CONTACTS_SHEET_ID` — both contact tabs, and `Employees (seed)` for the referral path.
- **Read by:** [outreach-queue.md](outreach-queue.md) (who to cold-email),
  [outreach-compose.md](outreach-compose.md) (angle, bucket),
  [outreach-referral-queue.md](outreach-referral-queue.md) (employees).
- **`COMPANY_NOISE` mirrors `job_sync/sources.py`.** The two lists must agree or the tracker and
  the queue disagree about what one employer is.

## Functions

| Function | Does |
|---|---|
| `outreachNameKey_(value)` | Lowercase, non-alphanumerics to spaces, trimmed. **Keeps legal form** — `"Stripe Inc."` → `"stripe inc"`. |
| `outreachCompanyTokens_(company)` | The words that actually name an employer, `COMPANY_NOISE` dropped, sorted and deduped. `"Stripe Inc."` → `["stripe"]`. |
| `outreachSameEmployer_(left, right)` | Either token set contained in the other. Catches "Google Cloud" vs "Google"; whole-word containment stops "Dice" matching "Dicerna". |
| `outreachFocusFromRole_(title)` | The focus a recruiter's own title implies, used only when `Focus` is empty. Only `university` is worth deriving — it is the value `outreachVariantOrder_` reads. |
| `outreachCell_(row, column)` | One cell as trimmed text. |
| `outreachReadContacts_(sheet)` | Every contact worth writing to, from both tabs, newest-typed last. |
| `outreachContactsFor_(contacts, company)` | The contacts at one employer. |
| `outreachBucketFor_(contacts, company)` | The industry this employer sits in, borrowed from whichever contact carries one. |
| `outreachAngleFor_(contacts, company)` | The company's opening line, borrowed the same way. |
| `outreachRecruiterCount_(contacts, company)` | How many recruiters are on file. |

Also defines the campus-title regex `CAMPUS_TITLE`: whole words, so `intern` must not match
`internal` — a different job and a different address.

## Gotcha — two keys, two purposes

`outreachNameKey_` and `outreachCompanyTokens_` disagree by design, and using the wrong one is a
real bug class. Caps and load counting key on `outreachNameKey_`; the interleaver keys on
`outreachCompanyTokens_`. Anything that decides "is this the same employer" wants the tokens.
