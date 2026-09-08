# outreach_send.gs — drafting, sending, the cycle

Owns Gmail for the cold path, `runOutreachCycle`, the hourly planning entry point for the whole
outreach script, and `runOutreachSendTick`, the one-minute delivery entry point.

## Connections

- **In:** rows booked by [outreach-queue.md](outreach-queue.md); words from
  [outreach-templates.md](outreach-templates.md).
- **Out:** Gmail drafts and sends; status written back to `Email`.
- **Drives:** every other outreach file, through `runOutreachCycle`.

## `runOutreachCycle` — the hourly planning trigger

Steps, in order. Order is load-bearing; the comments in the file say why for each.

```
schema migration          ← OUTSIDE step(); fatal by design
health stamp: started
layout → scan → rejections → stale
referralScan → referralReplanned → referralPlanned → referralSent → referralDrafted
queued → sent → written
followUpPlanned → followUpSent
projected → season → sorted → referralSorted → appWorklist
health stamp: finished
throw if any step failed
```

Two rules shape it:

- **Each step is isolated.** `step(name, work)` catches per step, so a Gmail search that throws
  in step 1 does not take step 12 with it. The blast radius is the change; the order is not.
- **Send before write, never the reverse.** Drafting first would let a message be written and
  sent inside one firing, and the hour in which it could have been read would never exist.

| Function | Does |
|---|---|
| `runOutreachCycle()` | The above. Returns `summary`; throws at the end if any step failed, so the run shows red in Executions. |
| `runOutreachSendTick()` | Every minute, sends already-due referral, cold and follow-up drafts, then creates any cold draft inside its 20-minute lead window and any Referral draft inside its one-hour lead window. Send still comes first, so a draft cannot be created and sent in one tick. It does not plan or scan. The path send locks prevent it racing the hourly cycle into a duplicate Gmail send. |
| `outreachHealthStart_(tracker, runId)` | Stamps `Cycle Health` **before** the fatal schema step, newest row first, trimmed to 240 rows. |
| `outreachHealthFinish_(sheet, runId, summary, failures)` | Closes that row with `ok`/`failed`, the failed step names, and the summary. |
| `installOutreachTriggers()` | Hourly `runOutreachCycle`, one-minute `runOutreachSendTick`, plus the `onEdit` trigger. Clears existing ones first. |
| `removeOutreachTriggers()` | The kill switch. |
| `onOutreachQueueEdit(e)` | Reproject the moment somebody ticks `Priority`, so a tick visibly does something. |

**A row that says it started and never says it finished is the only record a part-way death
leaves behind.** That is why there are two stamps rather than one — see
[outreach-diagnostics.md](outreach-diagnostics.md).

## Drafting and sending

| Function | Does |
|---|---|
| `prepareOutreachDrafts()` | Write cold emails into Drafts twenty minutes before their projected send slot, addressed and complete. It passes the Referral rows into the shared budget so the Referral allocation is reserved before cold drafting uses the remainder. |
| `outreachDraftsToSend_(rows, now)` | The drafts whose hour has come. |
| `sendPreparedDrafts()` | Send what was written at least twenty minutes ago. **Re-reads `App` for every draft**, so a rejection recorded by any route still stops it. |
| `outreachSendHourAfter_(now)` | The twenty-minute fallback send time for a newly queued cold row without a projected slot. |
| `outreachStillQualifies_(row)` | Re-read the application this row was built from. |
| `outreachDiscardDraft_(id)` | Throw away a draft that must not go. |
| `outreachWriteRow_(sheet, index, updates)` | Write named columns of one row. **One API call per row.** |
| `outreachContactByFingerprint_(...)` | Find the contact behind a fingerprint, so the queue never holds an address. |
| `outreachPrioritiesToRetire_(rows)` | Ticked rows whose email has gone; the tick becomes `Done`. |

## Replies

| Function | Does |
|---|---|
| `outreachRowsToScan_(rows)` | Which rows still have a question outstanding. |
| `scanOutreachReplies()` | Mark what has come back, via `outreachThreadVerdict_`. |
| `repairMisreadReplies()` | Run by hand: undo replies that were never replies. |
| `previewOutreachEmail()` | Run by hand: draft the next few emails **to yourself**. |

## Gotcha

`sendPreparedDrafts` deliberately survives a failed `scan`. A failed scan costs an hour of
freshness, not the safety check — the re-read of `App` is the check that actually matters.

The cycle runs Referral before cold before follow-up. The shared 47-message budget protects
actual queued higher-priority work; unused capacity is available to Reply instead of being
reserved by an empty path.
