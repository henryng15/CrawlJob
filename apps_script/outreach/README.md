# `outreach/` — the sender

These six files are **not** part of the Apps Script bound to the spreadsheet. They belong to a
standalone project in the Apps Script editor of `hoanng15.work@gmail.com`.

That separation is the reason the project exists. A bound script runs as whoever owns the
spreadsheet, so `GmailApp.sendEmail` there would send from the account that owns the tracker —
which is a different address, and the one that must never appear as the sender.

| File | |
|---|---|
| `outreach_config.gs` | IDs, column numbers, caps, and the two date helpers everything else counts with |
| `outreach_contacts.gs` | reads both contact tabs, decides what one employer is, and counts per company |
| `outreach_compose.gs` | the ten message variations and the HTML builder |
| `outreach_queue.gs` | what earns a queue row, in what order, and how many go out this hour |
| `outreach_send.gs` | drafting, sending, reply and bounce detection, and the hourly trigger |
| `outreach_rejections.gs` | recognising a rejection in the mailbox and closing the application it belongs to |
| `appsscript.json` | the manifest: timezone, and the five scopes spelled out |
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

Everything that *decides* is pure — it takes rows, a message and a date, and returns rows.
Only `outreach_send.gs` and the bottom of `outreach_rejections.gs` touch Gmail. That is what lets the rules be argued with without a Google account:

```
node apps_script/outreach/harness.js     # 163 tests, sends nothing
```

## Deploying — do not paste by hand

Pasting is how the project silently fell a version behind: the rejection matcher
was rebuilt from 52 real messages, the new file was never pasted in, and the old rules
went on closing the wrong applications for a day. Nothing in the editor says which
version it is holding.

[`clasp`](https://github.com/google/clasp) makes the repository the source of truth:

```bash
npm install -g @google/clasp
clasp login                      # sign in as hoanng15.work@gmail.com
cp .clasp.json.example .clasp.json   # then paste the script id into it
clasp push                       # ships every .gs file plus appsscript.json
```

The script id is in the Apps Script editor under Project Settings, or in its URL
between `/projects/` and `/edit`. `clasp login` needs the Apps Script API switched
on once, at [script.google.com/home/usersettings](https://script.google.com/home/usersettings).

`.claspignore` keeps `harness.js` out of the push — it is Node, and the editor would
refuse it. `.clasp.json` holds the real id and is gitignored; the example file is what
is tracked.

After that, deploying is `clasp push` and nothing else. `clasp pull` brings back
anything edited in the browser, so the two can never quietly disagree.

Install steps, and the design each rule comes from: [../../docs/outreach.md](../../docs/outreach.md).
