# outreach_contacts.gs — the contact list, and who counts as the same employer

Contacts live in a **separate spreadsheet owned by the sending account**, never in the tracker.

## Two tabs, and the split is the point

| Tab | Written by |
|---|---|
| `Contacts (seed)` | Overwritten wholesale by the ColdEmail export |
| `Contacts (manual)` | Hand-curated and protected from bulk export. An explicit user-approved campaign may append a bounded, documented set of contacts; it never rewrites existing rows. |

One tab would mean a single re-export silently destroying months of hand-gathered contacts.
Two tabs make that impossible rather than merely unlikely.

## Connections

- **Reads:** `CONTACTS_SHEET_ID` — both contact tabs, and `Employees (seed)` for the referral path.
- **Read by:** [outreach-queue.md](outreach-queue.md) (who to cold-email),
  [outreach-templates.md](outreach-templates.md),
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
| `outreachRecruiterCount_(contacts, company)` | How many recruiters are on file. The Target availability snapshot further removes `Sent`-ticked and cold-queue-committed contacts. |
| `importOwnerRecruiterSheet20260923(dryRun, hold)` | One-off, owner-requested import of the recruiters with an email on the owner's shared list (`OWNER_RECRUITER_SHEET_20260923_`, 70 addresses). Skips any address already on either contacts tab and any address in `hold`, adopts the existing seed spelling of a company, and appends the rest to `Contacts (manual)` with provenance in `From`; `dryRun` only reports. A blank company on the source sheet was inferred from the email domain; names are only those the sheet gives. Ran 2026-09-23: 8 already in seed, 3 held (same person on file under another address), 59 appended at manual rows 111–169. |
| `ownerRecruiterSheet20260923Appended_()` | The 59 addresses that import actually appended: the list minus `OWNER_RECRUITER_SHEET_20260923_HELD_` (3) and `_ALREADY_ON_FILE_` (8). |
| `diagnoseOwnerRecruiterSheet20260923Applications()` | Read-only. Per employer among the appended recruiters: its App rows, whether each qualifies (Applied / Completed OA) and the Gmail rejection preflight for the qualifying ones. |
| `scheduleOwnerSheetRecruiterWave20260923()` | Owner-requested cold wave to the appended recruiters at employers with a live application, Rippling excluded. `OWNER_SHEET_WAVE_APPLICATIONS_20260923_` pins one application per employer (15 employers); `OWNER_SHEET_WAVE_DAYS_20260923_` splits the 24 recipients into two direct Target recruiter campaigns on the shared trigger (`…_20260923_OWNER_SHEET` 11:40–12:46 ET, `…_20260924_OWNER_SHEET` 09:00–10:06 ET, 6-minute spacing, `exactContacts` per day). Before writing state it re-checks each application's exact link still qualifies and runs the Gmail rejection preflight; afterwards it sets greeting names from `OWNER_SHEET_WAVE_GREETINGS_20260923_` (first.last addresses and LinkedIn slugs) on entries the sheet left unnamed — the contact rows are not changed. Daily capacity was waived by the owner. |
| `cancelOwnerSheetRecruiterWaveCompanies(companies, reason)` | Owner call-off for that wave: marks every still-pending entry for the named employers `cancelled` with the reason, leaves sent entries alone, completes a campaign with nothing left pending, and refreshes `Email_target`. Ran 2026-09-23 11:27 ET for Adobe and Google (owner already in process there): 3 entries cancelled, none had been sent. |

Also defines the campus-title regex `CAMPUS_TITLE`: whole words, so `intern` must not match
`internal` — a different job and a different address.

Campus, university, early career and **emerging talent** are one group, by the owner's reading on
2026-09-29, so the regex carries every spelling live contact data has shown: `campus`,
`university`, `college`, `school`, `student`, `intern`, `graduate`, `grad`, plus
`early|emerging|future` before `career(s)` or `talent`, plus `new grad`. Two of those were added
that day after the reply audit found them missing: `emerging talent` — which is Dropbox's entire
early-career team, and the title on Cisco's and Dell's coordinators — and the plural
`early careers`, as in Atlassian's *Senior Manager, Early Careers Talent Acquisition*, which the
old `early[\s-]?(career|talent)\b` could not match. `Talent Acquisition` alone still does not
count; it is any recruiter's job title.

The same regex is now the ordering test in `diagnoseTargetRecruiterContactDetails`
([outreach-diagnostics.md](outreach-diagnostics.md)), which used its own narrower list. That test
decides who a wave writes to first, so a campus recruiter it did not recognise was sorted behind
the technical ones. Wording is not affected: the ten cold templates do not vary by recipient, so
`Focus` is derived and stored but no longer reaches the words.

## Gotcha — two keys, two purposes

`outreachNameKey_` and `outreachCompanyTokens_` disagree by design, and using the wrong one is a
real bug class. Caps and load counting key on `outreachNameKey_`; the interleaver keys on
`outreachCompanyTokens_`. Anything that decides "is this the same employer" wants the tokens.
