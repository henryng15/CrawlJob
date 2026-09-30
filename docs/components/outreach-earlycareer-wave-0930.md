# outreach_earlycareer_wave_0930.gs — early-career recruiters at Accenture, Fidelity, Rivian

On 2026-09-29 the owner picked the five firms the coverage audit found with no campus contact at
all — Persona, Replit, Fidelity, Accenture, Rivian — and asked for two early-career / campus /
university recruiters each, sent spread from that day to Friday, with Friday's before noon.

The list was finished at 20:25 ET, so "today" became Wednesday 09-30. Friday's two go at 09:00 and
09:06 ET.

## Who, and who could not be reached

| Day | Company | Recipient | Title | Address check |
|---|---|---|---|---|
| 09-30 14:30 | Accenture | Rizzalyn Burke | US Early Careers Talent Delivery Manager | trykitt valid (identity + SMTP) |
| 09-30 14:36 | Accenture | Anastasia Komarnicki | Campus Recruiter | trykitt valid (identity + SMTP) |
| 10-01 14:30 | Fidelity | Bridget Giannini | University Talent Acquisition Partner | BounceBan deliverable 99 |
| 10-01 14:36 | Fidelity | Jessica Rattenni | Director, Early Talent Strategy & Experiences | BounceBan deliverable 99 |
| 10-02 09:00 | Rivian | Ryan Campbell | Sr. Recruiter - Software Early Career | BounceBan deliverable 97 (accept-all domain) |
| 10-02 09:06 | Rivian | Katrina Vacca | Sr. Emerging Talent Recruiter | BounceBan deliverable 97 (accept-all domain) |

Two of the five firms have nobody in this group, and no generic recruiter was substituted — the
09-27 Vercel precedent:

- **Replit.** A LinkedIn lead search over campus, university, early-career, emerging/early-talent
  and recruiting-coordinator titles returns zero. The seven recruiter contacts on file are all
  technical; the only non-technical one is People Ops.
- **Persona.** One recruiter exists, titled plainly "Recruiter", besides the two technical
  recruiters already on file. Worth knowing: the tracker holds two different employers under this
  name — the identity company (`withpersona.com`, whose Summer 2027 application this would have
  used) and Persona AI the robotics company (`persona.ai`, the "Manipulation" application).

Dropped for want of a deliverable address, rather than guessed at:

- **Sabreen Akarah** (Sr. Manager, TA - Emerging Talent, Rivian) — `sabreenakarah@` and `sakarah@`
  both undeliverable.
- **Cilly Neureuther** (Campus Talent Acquisition Specialist, Fidelity) — eleven finders miss her,
  Hunter and leadsforge included, and `cilly.neureuther@fmr.com` is undeliverable on a domain that
  is not accept-all, so that is a real no.
- **Meredith Sheehy** (Recruiting Associate Manager, Early Careers Talent Delivery, Accenture) —
  only a bot-generated `ms@accenture.com` was found, the same reason Julie Do was skipped on 09-28.

## Verifier finding — trykitt is blind on rivian.com

trykitt returns `invalid` / `invalid_identity_provider` for **every** rivian.com address tried,
including `annehaber@rivian.com`, which this account emailed on 2026-09-25 with no bounce. Its
verdict on that domain carries no information. BounceBan was the arbiter, at the 97 bar the 09-27
top-up used for Atlassian and Dropbox. accenture.com (Proofpoint) and fmr.com (Microsoft) are both
checkable and not accept-all, so a name-specific valid there is a real answer.

## Capacity

Target totals before this wave: 54 on 09-30, 46 on 10-01, 2 on 10-02. Adding two a day makes
**56 / 48 / 4**, so 09-30 passes the 55 warning threshold and `scheduleEarlyCareerWave20260930`
refuses it unless called with `acknowledgeOver55 = true`.

## Functions

| Function | Does |
|---|---|
| `earlyCareerWave0930Blocked_()` | Companies without an active Applied App row for the pinned role, or blocked by `diagnoseTargetCompanyRejectionPreflight`. All three were clear on 09-29. |
| `scheduleEarlyCareerWave20260930(acknowledgeOver55)` | Per day: drops blocked companies, checks the ≤55 total, appends the recipients to `Contacts (manual)`, and schedules an exact-size campaign on `runTargetRecruiterSharedTick_` at six-minute spacing. |
| `previewEarlyCareerWave20260930()` | Read-only: blocked companies and each day's recipients with titles. |
| `cancelEarlyCareerWave20260930()` | Cancels every still-pending entry in the three campaigns. |

## State on 2026-09-29

Scheduled. The owner approved crossing the 55/day threshold, `scheduleEarlyCareerWave20260930(true)`
returned totals 56 / 48 / 4 with `blocked: {}`, and each of the three campaigns reads back
`scheduled` with both of its entries `pending` at the times in the table above.
