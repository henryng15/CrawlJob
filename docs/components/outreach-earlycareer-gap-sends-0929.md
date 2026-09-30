# outreach_earlycareer_gap_sends_0929.gs — the campus recruiters already on file, never written to

On 2026-09-29 the coverage audit ([outreach-diagnostics.md](outreach-diagnostics.md),
`diagnoseEarlyCareerCoverageForCompanies`) found eight companies holding a campus or early-career
recruiter in Contacts that no Gmail message had ever gone to. The owner asked for the whole group
this week — minus Cloudflare and Shopify — starting that night, three or four a day, finishing
Thursday, and waived the 55-a-day limit for all of it.

Nobody here needed finding or verifying: each address was already researched into the seed. That is
why this group could go out the same night while the
[Accenture/Fidelity/Rivian wave](outreach-earlycareer-wave-0930.md) needed a day of lookups first.

## Recipients

| Time (ET) | Company | Recipient | Title |
|---|---|---|---|
| 09-29 22:10 | McKinsey | Katie Abbott | campus recruiter |
| 09-29 22:16 | Qualcomm | Steph Savitz | Lead, Campus Recruiting & Intern Programs |
| 09-29 22:22 | McKinsey | Nour Nafie | campus recruiter |
| 09-30 15:30 | Dell Technologies | Lexie Hluchanek | campus recruiter |
| 09-30 15:36 | Visa | Lisa Kappil | university recruiter |
| 09-30 15:42 | Dell Technologies | Manveena Singh | Global Operations Campus Recruiting Program Manager |
| 10-01 15:30 | Walmart | Kenneth Burke | campus recruiter |
| 10-01 15:36 | Cisco | Matt Lorman | early talent |

**Left out on purpose:** Cloudflare (Daisy Saenz, Trang Bi) and Shopify (Jennifer Clerici), at the
owner's instruction.

The 09-29 sends are late in the evening for a cold email. That is the owner's explicit choice; the
list was only finished at 21:40 ET and they asked for it to start that night.

## Applications

Each company's role is its newest active Applied row, and all six passed
`diagnoseTargetCompanyRejectionPreflight` on 09-29. Qualcomm reuses the same application the
[10-01 follow-up file](outreach-university-followups-1001.md) pins. The job link is only ever used
for rejection matching — the templates do not put it in the message — so Cisco's long careers-site
URL is trimmed to its identifying query parameters.

## Day totals

Waived by the owner: **66** on 09-29, **59** on 09-30 and **50** on 10-01, counting the
Accenture wave's own entries on 09-30. `scheduleEarlyCareerGap20260929` therefore reports the totals
instead of refusing them — the only scheduler here that does not take an `acknowledgeOver55`
argument, because there is nothing left for it to gate.

## Functions

| Function | Does |
|---|---|
| `earlyCareerGap0929Blocked_()` | Companies without an active Applied App row for the pinned role, or blocked by the rejection preflight. All six were clear. |
| `scheduleEarlyCareerGap20260929()` | Schedules the three days on `runTargetRecruiterSharedTick_` at six-minute spacing. Appends nothing: every recipient is already a Contacts row. |
| `previewEarlyCareerGap20260929()` | Read-only: blocked companies, each day's recipients and the day total each would reach. |
| `cancelEarlyCareerGap20260929()` | Cancels every still-pending entry in the three campaigns. |

## State on 2026-09-29

Scheduled. `blocked: {}`, totals 66 / 59 / 50, and all three campaigns read back `scheduled` with
every entry `pending` at the times above.
