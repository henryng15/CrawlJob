# outreach_gap_wave.gs — the 2026-09-24 cold-email gap wave

A one-off, owner-requested recruiter wave for the employers the 2026-09-24 audit found with a
live application (App `Date Applied` 2026-09-14 → 09-24) and no cold email sent or queued.

## Scope, as the owner set it

- **Rippling:** one message to `ctung@rippling.com` for the Backend-focused SWE intern role, on
  2026-09-25 at 09:30 ET.
- **Employers already in the contacts database:** two recruiters each (LabCorp, Gordon Food
  Service, Persona, Expedition Technology). Waymo and Wells Fargo are excluded by the owner.
  Baird and Duolingo are left out because every one of their applications is rejected.
  Pace's only database contact is at `dhpace.com`, a different company from the Pace that was
  applied to (`withpace.com`), so that contact is not used.
- **Employers with no recruiter on file:** three recruiters at the twenty largest employers,
  two elsewhere. State Farm is excluded by the owner, which lets InterSystems become the
  twentieth. Size came from Hunter company enrichment, corrected where it was plainly wrong
  (it reported State Farm as 251–1K).
- **Recruiter order:** campus / university / early-career first, then technology / software /
  technical recruiters, then general talent acquisition, and HR/People only when a small company
  has nothing else.
- **Delivery:** Monday 2026-09-28 through Thursday 2026-10-01, 09:00–13:00 ET. Employers are
  dealt across the four days by recipient count (32 / 30 / 31 / 31), and within one day the
  scheduler interleaves employers, so one employer's recruiters are about an hour apart.

## How the addresses were found

treg people search (quickenrich, leadsforge, and Exa for startups the directories miss) gave
names and titles. The address came from the domain's Hunter pattern, or the Hunter HR listing,
or an email finder as a last resort. An address is accepted only when BounceBan returned
`deliverable` with a score of at least 80. BounceBan was used rather than MillionVerifier because
many of these domains are catch-all or greylisting, and MillionVerifier cannot tell a real
mailbox there. The check also confirms the employer: a name from a people search that matched
the wrong company does not have a mailbox at that company's domain.

Ten employers had no recruiter who could be verified and are not in the wave: Cyvl (App row
titled "AI Intern to the CEO"), Awardco, Avionyx, Bitplaza, Cartesian, Docugami, Fontaine
Modification, RAVE Aerospace, Swarmaero and Pace. Baidu USA, PING and Smarty have one each.

Geneva Trading's App row was deleted mid-session (2026-09-24). The owner asked for it to be
mailed anyway, so its application is pinned with `ownerConfirmed: true`, which skips the live-App
check but not the Gmail rejection preflight. It is its own day,
`TARGET_RECRUITER_CAMPAIGN_20261001_GAP_GENEVA`: two recruiters at 12:40 and 12:52 ET on 10-01,
after the main 10-01 day ends at 12:30.

## Functions

| Function | Does |
|---|---|
| `appendGapWaveContacts20260924(dryRun)` | Append `GAP_WAVE_CONTACTS_20260924_` (119 people) to `Contacts (manual)` with title, focus (`university` / `technical`), the BounceBan verdict and provenance in `From`. Skips any address already on either contacts tab; `dryRun` only reports. |
| `scheduleGapWave20260924(dayKeys)` | For each day in `GAP_WAVE_DAYS_20260924_` (or the listed keys), checks every pinned application in `GAP_WAVE_APPLICATIONS_20260924_` still has at least one live App row at its exact link (App can list one posting twice), unless the owner confirmed it without one (`ownerConfirmed`) and clear of a matching Gmail rejection, and then books the day as one direct recruiter campaign on the shared trigger `runTargetRecruiterSharedTick_`, with `exactContacts` and `includeEmails` so the day sends to exactly the chosen people. Any rejection or dead application aborts before anything is written. |
| `setGapWaveRecipientName20260924(email, name)` | Owner-supplied greeting name for one recipient: sets `name` on that address's pending entries in every gap-wave day, and fills the name on its `Contacts (manual)` row if that row has none. A seed row is only reported, because the next export would overwrite it. Ran 2026-09-24 for `ctung@rippling.com` → `Christopher` (manual row 114). |
| `retimeGapWaveRecipient20260924(email, iso)` | Owner-requested new send time for one recipient's pending entries; the time must be in the future. Ran 2026-09-25 00:2x ET: `ctung@rippling.com` moved from 09:30 to 14:00 so the Rippling referral asks go first. |
| `retimeTargetRecruiterEntries20260925(propertyKey, emails, startIso, spacingMinutes)` | Owner-requested pull-forward for any direct Target recruiter campaign: new times for the listed still-pending addresses, in order, `spacingMinutes` apart. Refuses if any address is not pending, so nothing is half-written; delivery checks are unchanged. Ran 2026-09-25 15:07 ET: 13 of the 09-26 `…_20260926_21_SWE` entries (one per employer, Gemini's Winter 2027 role left in place) moved to 15:12–16:24 that afternoon. |
| `cancelGapWave20260924Companies(companies, reason)` | Owner call-off: cancels every still-pending entry for the named employers (display names), leaves sent entries alone and refreshes `Email_target`. |

`display` is the employer name the email uses. It differs from the App spelling only where the
App spelling would read badly in a letter (`GM financial` → `GM Financial`, `Wex` → `WEX`).

## State

Campaign properties: `TARGET_RECRUITER_CAMPAIGN_20260925_GAP_RIPPLING`, `…_20260928_GAP`,
`…_20260929_GAP`, `…_20260930_GAP`, `…_20261001_GAP`, `…_20261001_GAP_GENEVA`. They appear in `Email_target` and are
counted by `diagnoseTargetMessagesForDay`. Each send still passes the delivery tick's own
already-sent check and Gmail rejection preflight.
