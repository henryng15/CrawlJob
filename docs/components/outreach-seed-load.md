# outreach_seed_load.gs, outreach_sent_column.gs — the contact tabs and the `Sent` tick

## Loading

`replaceContactSeedChunk(rows, startRow, clearExisting)` and `replaceEmployeeSeedChunk(...)`
replace `Contacts (seed)` and `Employees (seed)` wholesale from ColdEmail's merged exports.
Wholesale, because the export is the source of truth for who exists: a row that has left the CSV
has left the list.

Chunked, because a full load is a few thousand rows and `clasp run` carries them as one JSON
argument. Only the first chunk clears. ColdEmail's `src/upload_seed.py` drives it.

They used to live in `outreach_diag.gs`, whose own header calls it a temporary diagnostic to be
deleted once its answer is in hand. A permanent loader had no business there.

## The `Sent` column

`Contacts (seed)` column **J** (`C_SENT`), `Employees (seed)` column **K** (`E_SENT`). A tick means
this person has been written to and must never be written to again, on either path.

**Why it exists.** The system already answered that question, on the two queue tabs: a salted
fingerprint on `Email`, a plain address on `Referral`. Both are records of what was *planned*, and
both were emptied when the pipeline was rebuilt — which would have re-opened all 314 people already
written to. This column is the durable answer, and it sits beside the person rather than on a
queue, so clearing a queue cannot lose it.

**The two mechanisms are kept together on purpose**, and a row is skipped when either says so. The
fingerprint still stops a second send inside one season and still keeps addresses off the tracker;
this survives a rebuild.

**Owner: the outreach script.** The planners read it — `outreachContactAvailable_` for cold,
`outreachReadEmployees_` for referral — and the two senders set it. Nothing else may write it.

**Ticked after the send, not at drafting**, because a draft can still be deleted in its review
window and a person whose draft was thrown away has not been written to. The cost is the one
failure this cannot cover: if the script dies between `GmailApp.send()` and the write, the message
has gone and the tick has not. The queue row is already `Sent` by then, so the fingerprint still
blocks a repeat — the other half of why both mechanisms are kept.

**Nothing here ever unticks anybody.** A load OR-s three sources: the ticks already on the tab, a
`Sent` value on the incoming row, and nothing else. What has been sent cannot be unsent.

## The `From` column

`Contacts (seed)` column **K** (`C_FROM`), `Employees (seed)` column **L** (`E_FROM`). `1` means
the row came from the original ColdEmail pipeline, `2` from the treg run.

**Nothing in this project reads it.** It exists so the tab can answer "where did this row come
from?" without anyone diffing two CSVs. The question that prompted it was a good one — *why does
this company have exactly ten people when two pipelines ran over it?* — and the answer, visible in
one glance with this column, was that one of the two found nobody there:

| | total | From 1 | From 2 |
|---|---|---|---|
| Dell, NetApp, Red Hat | 10 | 0 | 10 |
| Comcast | 10 | 1 | 9 |
| CrowdStrike, Meta, Pinterest, Scale AI | 20 | 10 | 10 |

**It sits after `Sent`, not before it.** `Sent` was already deployed and already held 314 ticks;
inserting a column ahead of it would have moved every one of them one position left.

## Functions

| Function | Does |
|---|---|
| `outreachSentTicked_(value)` | Whether a cell means "already written to". Accepts `TRUE`, `yes`, `y`, `x`, `sent`, `1`, and the boolean. |
| `FROM_SEED` / `FROM_TREG` | `1` and `2`. A row arriving with no `From` is treated as `1`. |
| `outreachExistingSentTicks_(sheet, emailCol, sentCol)` | The ticks a tab already holds, by lower-cased address. |
| `replaceContactSeedChunk(rows, startRow, clearExisting)` | Writes one chunk of `Contacts (seed)`, carrying ticks across. |
| `replaceEmployeeSeedChunk(rows, startRow, clearExisting)` | The same for `Employees (seed)`. |
| `markAlreadySentContacts()` | One-off: ticks everyone the `Email` and `Referral` tabs say was written to. **Must run before those tabs are cleared** — they are the only record. |
| `outreachMarkColdContactsSent_(fingerprints)` | Ticks cold contacts, found by hashing every address against the batch. Both seasons are hashed. |
| `outreachMarkEmployeesSent_(emails)` | Ticks employees, found by address. |

## Gotchas

- **`C_WIDTH`, not `C_BUCKET`.** The contacts read used to stop at the last column it cared about.
  Read one column short and every contact reports as unwritten.
- **Only landed statuses count.** `markAlreadySentContacts` ticks `Sent`, `Replied` and `Bounced`.
  `Queued` and `Drafted` rows were planned and never sent; the rebuild may plan them again.
- **One write per tab, not one per person.** A batch of twenty sends is one `setValues` into the
  column, not twenty round trips.
