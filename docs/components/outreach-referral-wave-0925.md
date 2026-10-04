# outreach_referral_wave_0925.gs — the 2026-09-25 referral wave

Owner request on 2026-09-25: at least five referral asks at each employer that has a recent live
application and no referral ask yet. The employers are Rippling (from 09:00 ET), Together AI,
Fidelity Investments, Persona, Accenture and Target, five people each, 30 in all. Amazon, Figma,
Robinhood and Intuit are excluded because the owner already has referrals there, obtained outside
this pipeline.

## Who

Recipients come from `Employees (seed)`, mid-level software engineers first. Together AI and
Target each had three eligible people, so two more at each were found through treg people search
and accepted only on a BounceBan `deliverable`: Blaine Kasten and Helena Tanub (`first@together.ai`;
Together AI's `{f}{last}` pattern was undeliverable for them, and Aditi was dropped as too common a
first name), and Anisa Filfil and Erik Iverson at Target. The seed people marked Risky at Together
AI, Target and Persona were rechecked with BounceBan, and all were `deliverable`. None of the
recipients meets the pure-Vietnamese gate, so every message uses the English referral catalog.

Because four recipients are not in the seed, the wave is a fixed list
(`REFERRAL_WAVE_0925_`) rather than a `scheduleTargetReferralCampaign_` selection.

## When

The wave is one direct referral campaign, `TARGET_REFERRAL_CAMPAIGN_20260925_REFERRAL_WAVE`, with
its own minute trigger, `runReferralWaveTick20260925_`. It sends from 09:00 ET, eight minutes
apart, clustered by employer (Rippling 09:00–09:32 … Target 12:20–12:52). The same morning, the
Rippling recruiter email to Christopher was moved to 14:00 at the owner's request
(`retimeGapWaveRecipient20260924`, see [outreach-gap-wave.md](outreach-gap-wave.md)).

## TD Bank follow-on

The owner then asked for about ten early-career / new-grad software engineers at TD Bank, where
there are no `Employees (seed)` rows. treg quickenrich returned only Canadian TD staff, so the ten
came from Exa: people whose current TD role is in the United States, who joined in 2023 or later,
and whose title is not intern, senior or lead. Each address follows td.com's `first.last` pattern
and returned BounceBan `deliverable` 99. Preet Shah and Travis Cook also verified but were held
back, because names that common can reach a different person at a bank this size. The asks go
out on their own campaign, `TARGET_REFERRAL_CAMPAIGN_20260925_TD_BANK`, and their own trigger,
`runReferralWaveTickTdBank20260925_`. The start time and spacing are passed when it is scheduled.

## Functions

| Function | Does |
|---|---|
| `referralWave0925Entries_(employees, used, specs, startIso, spacingMinutes)` | Builds the entries from the fixed list. A seed person carries the seed row's title, seniority, angle and bucket; a researched person borrows the employer's angle and bucket. With `used`, anyone already on the Referral tab or already written to in Gmail is skipped and reported, not replaced. |
| `scheduleReferralWave20260925(acknowledgeOver55)` | Refuses unless `acknowledgeOver55` is `true` (the day's planned total is over 55) and the 09:00 start is still ahead. Runs the Gmail rejection preflight for every employer before writing anything, then stores the campaign and installs its trigger. |
| `runReferralWaveTick20260925_()` | Minute-trigger delivery through the shared `runTargetReferralCampaignTickFor_`, which repeats the already-sent check and the rejection preflight before each send. |
| `scheduleTdBankReferralWave20260925(startIso, spacingMinutes, acknowledgeOver55)` | The TD Bank follow-on: same over-55 gate, rejection preflight, skip rules and entry builder as the main wave, from `startIso`, `spacingMinutes` apart. |
| `runReferralWaveTickTdBank20260925_()` / `previewTdBankReferralWave20260925(startIso, spacingMinutes)` | Its delivery tick and its read-only preview. |
| `retimePendingReferralWaves20260925(targetIsos)` | Replaces the times of, and only of, still-`pending` asks in the main and TD Bank 09/25 waves. It preserves sent history, requires one strictly-increasing future timestamp per pending entry, holds the script lock, and refuses without writing if the pending count changed. |
| `previewReferralWave20260925()` | Read-only: every subject and time, plus the first body per employer. Sends nothing. |
