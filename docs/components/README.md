# Component reference

One document per source file: what it owns, what it connects to, and what each function does.
The `docs/*.md` files one level up explain *why* the system is shaped this way; these explain
*what is where*. Read the component doc before changing a file, and update it after.

## Three subsystems

| | Runs | Language | Owns |
|---|---|---|---|
| **job_sync** | GitHub Actions, every 45 min, 09:00–21:00 ET | Python | Finding postings, writing the `Jobs` tab |
| **tracker script** | Bound to the spreadsheet, `onEdit` + hourly | Apps Script | Moving a ticked job into `App`, tab layout, housekeeping |
| **outreach script** | Standalone, hourly `runOutreachCycle` | Apps Script | Every email: cold, follow-up, referral |

They meet only in the spreadsheet. No subsystem calls another directly.

## Data flow

```
ATS boards + Markdown trackers
        │  job_sync/sources.py, boards.py
        ▼
   filter: roles.py, places.py, liveness.py
        │
        ▼
   Jobs tab ──tick "Applied"──►  App tab          (tracker script, onEdit)
                                   │
                                   │ every application is a row here
                                   ▼
                        ┌──────────┴───────────┐
                        │   outreach script    │
                        │  runOutreachCycle    │
                        └──────────┬───────────┘
                     ┌─────────────┼─────────────┐
                     ▼             ▼             ▼
                Referral tab   Email tab    (replies scanned
                (ask an        (cold email   back onto both)
                 engineer)      a recruiter)
                     │             │
                     └──── Gmail ──┘
```

## Spreadsheet tabs

| Tab | Written by | Read by |
|---|---|---|
| `Jobs` | job_sync | tracker script (tick → App) |
| `App` | tracker script | outreach script (both paths), job_sync (`_already_applied`) |
| `Email` | outreach cold path | outreach budget, referral budget |
| `Referral` | outreach referral path | outreach budget |
| `Season` | `refreshSeasonTab` | people |
| `Cycle Health` | `runOutreachCycle` | people — is the cycle finishing? |
| `Contacts (seed/manual)`, `Employees (seed)` | ColdEmail export, by hand | outreach compose + planners |

The contacts and employees tabs live in a **separate spreadsheet** owned by the sending
account, never in the tracker. See [outreach-contacts.md](outreach-contacts.md).

## Index

**job_sync**
- [job-sync-pipeline.md](job-sync-pipeline.md) — `main.py`, `config.py`, `roles.py`, `places.py`, `liveness.py`
- [job-sync-sources.md](job-sync-sources.md) — `sources.py`, `boards.py`
- [job-sync-sheet.md](job-sync-sheet.md) — `sheet.py`
- [job-sync-highlight.md](job-sync-highlight.md) — `highlight.py`

**Tracker script** (`apps_script/`)
- [tracker-sync.md](tracker-sync.md) — `sync_applied_to_app.gs`
- [tracker-external-api.md](tracker-external-api.md) — `external_application_api.gs`, `setup_process_dropdown.gs`

**Outreach script** (`apps_script/outreach/`)
- [outreach-config.md](outreach-config.md) — constants, seasons, the shared interleaver
- [outreach-contacts.md](outreach-contacts.md) — who counts as the same employer
- [outreach-budget.md](outreach-budget.md) — how three paths share one mailbox
- [outreach-compose.md](outreach-compose.md) — cold email wording
- [outreach-queue.md](outreach-queue.md) — the `Email` tab: planning and ordering
- [outreach-send.md](outreach-send.md) — drafting, sending, the cycle, health
- [outreach-followup.md](outreach-followup.md) — the nudge on an existing thread
- [outreach-rejections.md](outreach-rejections.md) — reading rejections out of the mailbox
- [outreach-referral-templates.md](outreach-referral-templates.md) — referral wording
- [outreach-referral-queue.md](outreach-referral-queue.md) — the `Referral` tab: planning and ordering
- [outreach-referral-send.md](outreach-referral-send.md) — referral drafting, sending, reconciling
- [outreach-diagnostics.md](outreach-diagnostics.md) — read-only probes against the live script

## The rule

**Changing a component, a rule or a constant means updating its document in the same change.**
A document that describes code which no longer exists is worse than no document, because it
still reads as current. If a change adds a function, add its row; if it changes what a function
decides, change that row's description; if it adds a rule, say what the rule is and why.
