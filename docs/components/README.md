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
| `App` | tracker script (rows, columns, `onEdit` repaint) — but its **row order and its yellow** belong to the outreach script's `syncAppOfficialWorklist`, and a rejection found in the mailbox writes `Process` + `Update` | outreach script (both paths), job_sync (`_already_applied`) |
| `Email` | outreach cold path | outreach budget, referral budget |
| `Referral` | outreach referral path **only** — the tracker script may sink called-off rows and nothing else | outreach budget |
| `Email_target` | outreach script's explicit Target-campaign mirror | people; never read by normal workers |
| `Referral_target` | outreach script's explicit Target-campaign mirror | people; never read by normal workers |
| `Season` | `refreshSeasonTab` | people |
| `Cycle Health` | `runOutreachCycle` | people — is the cycle finishing? |
| `Contacts (seed/manual)`, `Employees (seed)` | ColdEmail export through `replaceContactSeedChunk` / `replaceEmployeeSeedChunk`; the **`Sent` column belongs to the outreach script**, which ticks it after Gmail accepts a message; `From` records which sourcing pass found the row and nothing reads it | outreach compose + planners |
| `Company` | `company_tab.gs` **only** | people — who to ask for a referral next |
| `Target` | `target_tab.gs` **only** | people — where to source the next referral contacts |

The contacts and employees tabs live in a **separate spreadsheet** owned by the sending
account, never in the tracker. See [outreach-contacts.md](outreach-contacts.md).

**One owner per column.** Two projects writing one column is the failure this system is most
prone to: they cannot see each other, and neither looks wrong on its own. The Referral tab spent
months with two schedulers for exactly that reason — see the gotcha in
[outreach-referral-queue.md](outreach-referral-queue.md). The `App` tab had the same problem in a
quieter form until 2026-08-30: two projects painting one worklist on two different rules, the
looser one winning every hour — see the gotcha in
[outreach-app-worklist.md](outreach-app-worklist.md).

## Index

**job_sync**
- [job-sync-pipeline.md](job-sync-pipeline.md) — `main.py`, `config.py`, `roles.py`, `places.py`, `liveness.py`
- [job-sync-sources.md](job-sync-sources.md) — `sources.py`, `boards.py`
- [job-sync-feeds.md](job-sync-feeds.md) — `feeds.py`, `data/public_feeds.toml`
- [job-sync-sheet.md](job-sync-sheet.md) — `sheet.py`
- [job-sync-highlight.md](job-sync-highlight.md) — `highlight.py`

**Tracker script** (`apps_script/`)
- [tracker-sync.md](tracker-sync.md) — `sync_applied_to_app.gs`
- [tracker-company-tab.md](tracker-company-tab.md) — `company_tab.gs`
- [tracker-target-tab.md](tracker-target-tab.md) — `target_tab.gs`
- [tracker-external-api.md](tracker-external-api.md) — `external_application_api.gs`, `setup_process_dropdown.gs`

**Chrome extension**
- [chrome-extension-quick-add.md](chrome-extension-quick-add.md) — `quick_add_application/popup.js`

**Outreach script** (`apps_script/outreach/`)
- [outreach-config.md](outreach-config.md) — constants, seasons, the shared interleaver
- [outreach-contacts.md](outreach-contacts.md) — who counts as the same employer
- [outreach-budget.md](outreach-budget.md) — how three paths share one mailbox
- [outreach-queue.md](outreach-queue.md) — the `Email` tab: planning and ordering
- [outreach-send.md](outreach-send.md) — drafting, sending, the cycle, health
- [outreach-followup.md](outreach-followup.md) — the nudge on an existing thread
- [outreach-rejections.md](outreach-rejections.md) — reading rejections out of the mailbox
- [outreach-referral-queue.md](outreach-referral-queue.md) — the `Referral` tab: planning and ordering
- [outreach-referral-send.md](outreach-referral-send.md) — referral drafting, sending, reconciling
- [outreach-app-worklist.md](outreach-app-worklist.md) — the `App` worklist: which rows are waiting on a link, and where they sit
- [outreach-diagnostics.md](outreach-diagnostics.md) — read-only probes against the live script
- [outreach-offtarget-waves.md](outreach-offtarget-waves.md) — explicit off-Target manual recruiter campaigns
- [outreach-gap-wave.md](outreach-gap-wave.md) — the 2026-09-24 cold-email gap wave: researched recruiters for recent applications with no cold email
- [outreach-rippling-linda-0925.md](outreach-rippling-linda-0925.md) — owner-requested Rippling Full Stack recruiter send to Linda
- [outreach-referral-wave-0925.md](outreach-referral-wave-0925.md) — the 2026-09-25 referral wave: five asks at each of six recent employers
- [outreach-referral-wave-0927-scale.md](outreach-referral-wave-0927-scale.md) — the 2026-09-27 Scale AI referral wave: 25 early-career and Vietnamese-name asks, 16:00–18:24 ET
- [outreach-referral-wave-0928-shopify.md](outreach-referral-wave-0928-shopify.md) — the 2026-09-28 Shopify referral wave: 15 Vietnamese and early-career SWE asks, 16:32–17:56 ET
- [outreach-referral-wave-0929-cloudflare.md](outreach-referral-wave-0929-cloudflare.md) — the 2026-09-29 Cloudflare referral wave: 12 Vietnamese and early-career SWE asks from 09:00 ET
- [outreach-paypal-university-followup-1001.md](outreach-paypal-university-followup-1001.md) — one conditional follow-up to PayPal's three university recruiters, 10-01 09:30–09:54 ET, cancelled if PayPal answers
- [outreach-university-followups-1001.md](outreach-university-followups-1001.md) — conditional follow-ups to Atlassian and Qualcomm university recruiters, 10-01 and 10-05
- [outreach-scale-vercel-followups-0929.md](outreach-scale-vercel-followups-0929.md) — owner-requested Vercel immediate and Scale AI 09-30 threaded campus-recruiter follow-ups
- [outreach-startup-recruiter-wave-0927.md](outreach-startup-recruiter-wave-0927.md) — the 2026-09-27 evening wave: one recruiter each at ten high-growth startups applied to since 09-01
- [outreach-ramp-extension-0928.md](outreach-ramp-extension-0928.md) — the owner's Ramp CodeSignal extension request, resent to two Ramp talent contacts on 09-28 at 09:00 ET
- [outreach-earlycareer-topup-0929.md](outreach-earlycareer-topup-0929.md) — university/early-career recruiter top-up to three per company for Mastercard, Oracle, Atlassian, Figma and Dropbox, 09-29 to 10-01
- [outreach-figma-earlycareer-followup-0930.md](outreach-figma-earlycareer-followup-0930.md) — one conditional follow-up to Figma early-career recruiter Shelley H., 09-30 10:40 ET
- [outreach-datadog-campus-0928.md](outreach-datadog-campus-0928.md) — three Datadog campus recruiters for the SWE Intern application, 09-28 at 11:00 ET
- [outreach-lyft-early-talent-0928.md](outreach-lyft-early-talent-0928.md) — Lyft early-talent recruiters Micaela Maciel (09-28) and Vivian Chen (09-30), 11:30 ET
- [outreach-early-talent-fill-0928.md](outreach-early-talent-fill-0928.md) — Lyft +2 (Ina Charles, Kayli Keller) and Intel +2 (Jihad Broussard, Shannon Hough) early-talent emails, 09-28 to 09-30 at 11:45 ET
- [outreach-ziprecruiter-ta-0930.md](outreach-ziprecruiter-ta-0930.md) — three ZipRecruiter TA leads (no campus recruiters exist) for the SWE Intern application, 09-30 at 12:30 ET
- [outreach-notion-university-0928.md](outreach-notion-university-0928.md) — resend to Notion university recruiter Shivani Patel (09-16 attempt failed) 09-28 12:00 ET, plus recruiters Maria Gorecki and Molly Epstein 10-01 13:00 ET
- [outreach-together-recruiters-1002.md](outreach-together-recruiters-1002.md) — two Together AI senior technical recruiters (its only university recruiter was emailed 09-26), 10-02 at 10:00 ET
- [outreach-mckinsey-wave-0925.md](outreach-mckinsey-wave-0925.md) — the owner-approved five-person McKinsey QuantumBlack referral campaign
- [outreach-gm-wave-0929.md](outreach-gm-wave-0929.md) — the owner-approved six-recruiter General Motors wave on Tuesday 2026-09-29
- [outreach-spectrum-wave-0930.md](outreach-spectrum-wave-0930.md) — the owner-approved three-person Spectrum university-recruiting wave on Wednesday 2026-09-30
- [outreach-paypal-university-wave-0928.md](outreach-paypal-university-wave-0928.md) — the owner-approved three-person PayPal university-recruiting wave on Monday 2026-09-28
- [outreach-earlycareer-wave-0927.md](outreach-earlycareer-wave-0927.md) — the owner-requested three-per-company university/early-career recruiter wave from 2026-09-27 through 2026-10-01
- [outreach-unicorn-wave-0927.md](outreach-unicorn-wave-0927.md) — the 2026-09-27 private-unicorn startup recruiter supplement
- [outreach-recruiter-gaps-0927.md](outreach-recruiter-gaps-0927.md) — the 2026-09-27 University/Early-Career recruiter gap supplement
- [outreach-target-priority-waves.md](outreach-target-priority-waves.md) — approved Lyft, Anduril and Notion Target campaigns
- [outreach-templates.md](outreach-templates.md) — all the wording: the ten cold and ten referral templates, generated from ColdEmail's Markdown. Replaces the former outreach-compose.md and outreach-referral-templates.md, whose generated copy no longer exists
- [outreach-seed-load.md](outreach-seed-load.md) — replacing the two contact tabs, and the `Sent` column

## The rule

**Changing a component, a rule or a constant means updating its document in the same change.**
A document that describes code which no longer exists is worse than no document, because it
still reads as current. If a change adds a function, add its row; if it changes what a function
decides, change that row's description; if it adds a rule, say what the rule is and why.
