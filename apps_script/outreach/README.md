# `outreach/` — the sender

These eleven files are **not** part of the Apps Script bound to the spreadsheet. They belong to a
standalone project in the Apps Script editor of `hoanng15.work@gmail.com`.

That separation is the reason the project exists. A bound script runs as whoever owns the
spreadsheet, so `GmailApp.sendEmail` there would send from the account that owns the tracker —
which is a different address, and the one that must never appear as the sender.

| File | |
|---|---|
| `outreach_config.gs` | IDs, column numbers, caps, and the two date helpers everything else counts with |
| `outreach_contacts.gs` | reads both contact tabs, decides what one employer is, and counts per company |
| `outreach_compose.gs` | the ten message variations and the HTML builder |
| `outreach_queue.gs` | what earns a queue row, in what order, how many go out this hour, and the `Season` report |
| `outreach_send.gs` | drafting, sending, reply and bounce detection, and the hourly trigger |
| `outreach_rejections.gs` | recognising a rejection in the mailbox and closing the application it belongs to |
| `outreach_followup.gs` | the twenty short replies, which rows earn one, what day it lands on, and posting it onto the thread |
| `outreach_referral.gs` | the forty referral messages in four seniority tiers, the tier resolver, and the composer |
| `outreach_referral_queue.gs` | which link a referral may be submitted against, which posting per company, who is asked and on what day |
| `outreach_referral_send.gs` | the three referral entry points: booking rows, drafting them an hour early, sending them |
| `outreach_budget.gs` | one daily ceiling across all three paths, and who gives way when it binds |
| `appsscript.json` | the manifest: timezone, the five scopes spelled out, and the one advanced service |
| `.claspignore` / `.clasp.json.example` | so the project is deployed with `clasp push` rather than pasted |

The scopes are declared rather than inferred. Apps Script works out what to ask for by scanning
the code at the moment you press Allow, so a project authorised before `outreach_send.gs` was
pasted in never asked for Drive — and then failed with `Access denied: DriveApp` the first time
it went to attach the resume. Spelling them out makes the grant match the code whatever order
the files arrived in.

| Scope | For |
|---|---|
| `spreadsheets` | the tracker and the contacts book |
| `drive.readonly` | reading the resume to attach it — nothing is written to Drive |
| `mail.google.com` | drafting, sending, reading a thread to see if it was answered, and labelling rejections |
| `script.scriptapp` | installing the hourly trigger |
| `userinfo.email` | knowing whose account this is, so a preview can be addressed to you |

One **advanced service** is declared alongside them: `Gmail`, v1. It exists for a single call.
`GmailMessage.reply` and `GmailThread.reply` both answer the *sender* of the message, and on a
thread this account started that sender is this account — so a follow-up sent through `GmailApp`
would have gone to Henry. Neither method takes a `to`. `Gmail.Users.Messages.send` with the
thread's id and the original `Message-ID` in `In-Reply-To` is what makes the nudge a real reply
rather than a new conversation wearing `Re:`. It asks for no scope `https://mail.google.com/` does
not already cover, but the first run after it arrives will ask to be re-authorised.

Everything that *decides* is pure — it takes rows, a message and a date, and returns rows.
Only `outreach_send.gs` and the bottom of `outreach_rejections.gs` touch Gmail. That is what lets the rules be argued with without a Google account:

```
node apps_script/outreach/harness.js     # every rule, on a laptop, sending nothing
```

## The three referral files

They are the second path: asking an engineer at a company for a referral, rather than asking a
recruiter to look at an application. The split between them is the one `outreach_queue.gs` and
`outreach_send.gs` already make — every rule that chooses a person can be argued with on a laptop,
and only `outreach_referral_send.gs` can put anything in a mailbox.

**`runOutreachCycle` does not call them.** Its ten steps are unchanged, so pushing these files
changes nothing that runs on the hourly trigger; the three entry points below are run by hand until
that changes.

| | |
|---|---|
| `checkReferralService` | says whether the path could work. Reads and sends nothing, and reports every missing piece at once |
| `previewReferralTemplates` | logs all forty messages. Forty is past what anybody holds in their head, and what is worth checking is that the ask really does shrink down the tiers |
| `planReferralAsks` | appends the booked rows to the `Referral` tab. Touches no mailbox |
| `draftReferralAsks` | writes each message an hour before its slot, into Drafts |
| `sendReferralAsks` | sends what is still there when the hour comes. **This one sends.** |

Two things this path needs that the recruiter path does not: an `Employees (seed)` tab on the
contacts spreadsheet, exported by `src/export_referrals.py` in ColdEmail; and the `Jobs` tab of the
tracker, which this project reads here for the first time — the cold path starts from an
application, and this one starts from a posting that may never have been applied to. Both are
already covered by the `spreadsheets` scope, and no new scope or advanced service is needed.

The rules behind every one of these are in
[../../docs/outreach.md](../../docs/outreach.md#the-referral--asking-an-engineer-instead-of-a-recruiter).

## Deploying — do not paste by hand

Pasting is how the project silently fell a version behind: the rejection matcher
was rebuilt from 52 real messages, the new file was never pasted in, and the old rules
went on closing the wrong applications for a day. Nothing in the editor says which
version it is holding.

[`clasp`](https://github.com/google/clasp) makes the repository the source of truth:

```bash
npm install -g @google/clasp
clasp login                                   # sign in as hoanng15.work@gmail.com
cd apps_script/outreach                       # from the repo root — clasp reads
cp .clasp.json.example .clasp.json            #   .clasp.json in the folder you are in
$EDITOR .clasp.json                           # paste the script id
clasp status                                  # what would be pushed, what is ignored
clasp push                                    # ships every .gs plus appsscript.json
```

**Do not run `clasp pull` to "check first".** It overwrites the local files with
whatever is in the editor, which is the older copy — the exact direction that caused
the problem this setup exists to prevent. The repository is the source of truth; push
from it. `clasp status` answers the same question without touching anything.

The script id is in the Apps Script editor under Project Settings, or in its URL
between `/projects/` and `/edit`. `clasp login` needs the Apps Script API switched
on once, at [script.google.com/home/usersettings](https://script.google.com/home/usersettings).

`.claspignore` keeps `harness.js` out of the push — it is Node, and the editor would
refuse it. `.clasp.json` holds the real id and is gitignored; the example file is what
is tracked.

After that, deploying is `clasp push` and nothing else. `clasp pull` brings back
anything edited in the browser, so the two can never quietly disagree.

Install steps, and the design each rule comes from: [../../docs/outreach.md](../../docs/outreach.md).
