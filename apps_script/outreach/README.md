# `outreach/` — the sender

These seven files are **not** part of the Apps Script bound to the spreadsheet. They belong to a
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
node apps_script/outreach/harness.js     # 378 tests, sends nothing
```

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
