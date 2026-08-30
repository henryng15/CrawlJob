# `outreach/` — the sender

These files are **not** part of the Apps Script bound to the spreadsheet. They belong to a
standalone project owned by `hoanng15.work@gmail.com`.

That separation is the reason the project exists. A bound script runs as whoever owns the
spreadsheet, so `GmailApp.sendEmail` there would send from the account that owns the tracker —
a different address, and the one that must never appear as the sender.

Per-function detail for every file below is in
[../../docs/components/](../../docs/components/README.md).

| File | |
|---|---|
| `outreach_config.gs` | ids, column numbers, caps, statuses, date helpers, and the shared company interleaver |
| `outreach_contacts.gs` | both contact tabs, and what counts as one employer |
| `outreach_compose.gs` | the cold email's ten variations, in HTML and plain text |
| `outreach_queue.gs` | what earns a queue row, in what order, how many go this hour, the `Season` report |
| `outreach_send.gs` | drafting, sending, replies, bounces, `runOutreachCycle`, the `Cycle Health` tab |
| `outreach_rejections.gs` | recognising a rejection and closing the application it belongs to |
| `outreach_followup.gs` | the twenty short replies, which rows earn one, and posting it onto the thread |
| `outreach_referral.gs` | forty referral messages in four seniority tiers, the tier resolver, the composer |
| `outreach_referral_queue.gs` | which link may be used, which posting per company, who is asked and on what day |
| `outreach_referral_send.gs` | the referral path's sheet and Gmail work |
| `outreach_budget.gs` | one daily ceiling across all three paths, and who gives way |
| `outreach_diag.gs` | **temporary** read-only probes against the live script |
| `appsscript.json` | timezone, the five scopes, one advanced service, `executionApi` |

## The manifest

Scopes are **declared rather than inferred**. Apps Script works out what to ask for by scanning
the code at the moment you press Allow, so a project authorised before `outreach_send.gs` existed
never asked for Drive — and failed with `Access denied: DriveApp` the first time it went to attach
the resume.

| Scope | For |
|---|---|
| `spreadsheets` | the tracker and the contacts book |
| `drive.readonly` | reading the resume to attach it — nothing is written to Drive |
| `mail.google.com` | drafting, sending, reading a thread, labelling rejections |
| `script.scriptapp` | installing the hourly trigger |
| `userinfo.email` | knowing whose account this is, so a preview can be addressed to you |

One **advanced service**, `Gmail` v1, for a single call. `GmailMessage.reply` and
`GmailThread.reply` both answer the *sender*, which on a thread this account started is this
account — so a follow-up sent through `GmailApp` would go to the wrong person, and neither method
takes a `to`. `Gmail.Users.Messages.send` with the thread id and the original `Message-ID` in
`In-Reply-To` is what makes the nudge a real reply rather than a new conversation wearing `Re:`.

`"executionApi": { "access": "MYSELF" }` is what lets `clasp run` execute a function at all.
Without it every call returns a `NOT_FOUND` storage error naming neither the manifest nor the API.
See [../../docs/components/outreach-diagnostics.md](../../docs/components/outreach-diagnostics.md).

## Three paths, one mailbox

`runOutreachCycle` runs hourly and drives all three. `EMAIL_PATH_ORDER` is
`referral → cold → followup`: referral leads because it is scarcest (six people per employer, no
second attempt ever), follow-up trails because it is the only path that loses nothing by slipping
a day.

The referral steps **are** part of the cycle — `referralScan`, `referralReplanned`,
`referralPlanned`, `referralSent`, `referralDrafted`. Nothing here needs running by hand.

The referral path reads the **`App`** tab: every row is an application somebody deliberately made.
It used to read `Jobs`, which offered hundreds of postings nobody had chosen.

## Run by hand

| | |
|---|---|
| `checkReferralService` | whether the path could work. Reads and sends nothing; reports every missing piece at once |
| `previewReferralTemplates` | logs all forty messages. What is worth checking is that the ask really does shrink down the tiers |
| `previewOutreachEmail` | drafts the next few cold emails **to yourself** |
| `auditReferralTab` | what the `Referral` tab says day by day, and whether it obeys its own caps |
| `setupOutreachProperties` | which script properties are still unset |
| `repairReferralBlankRows` | clear blank rows a past bug wrote `Cancelled` into |

## Testing

Everything that *decides* is pure — rows and a date in, rows out. Only `outreach_send.gs`, the
bottom of `outreach_rejections.gs` and `outreach_referral_send.gs` touch Gmail. That is what lets
the rules be argued with without a Google account:

```bash
node apps_script/outreach/harness.js     # 570 assertions, sends nothing
```

A passing harness says the rules are right. It says **nothing** about whether they ran against the
sheet — that is what the `Cycle Health` tab and `outreach_diag.gs` are for.

## Deploying

```bash
cd apps_script/outreach
cp .clasp.json.example .clasp.json   # then paste the script id
clasp status                         # what would be pushed
clasp push
```

Before pushing, check for editor-side edits that never reached git: copy `.clasp.json` into a
scratch directory, `clasp pull` **there**, and diff the pulled `.js` against the repo's `.gs`.
Pulling into the repo itself overwrites local work — that direction is the one to avoid, not the
pull itself.

`.claspignore` keeps `harness.js` out of the push; it is Node, and the editor would refuse it.
`.clasp.json` holds the real id and is gitignored.

To execute a function on the live project, see
[../../docs/components/outreach-diagnostics.md](../../docs/components/outreach-diagnostics.md) —
`clasp run` needs a GCP project, a user-provided OAuth client, and `executionApi` in the manifest.

The design each rule comes from: [../../docs/outreach.md](../../docs/outreach.md).
