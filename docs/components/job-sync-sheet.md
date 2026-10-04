# job_sync/sheet.py — writing the Jobs tab

The only module that talks to the Sheets API. Everything above it is pure.

## Connections

- **In:** `main.py` hands it deduped, filtered `Job`s and the existing sheet.
- **Reads:** the `App` tab, to know what has already been applied to.
- **Writes:** the `Jobs` tab, whole, sorted. Never appends — see `_write`.

## Why it rewrites rather than appends

The sheet has to end up sorted, and a sort after an append is two operations that can be
interrupted between. `_write` rewrites the range in one call.

## Reading the layout

| Function | Does |
|---|---|
| `_service()` | The authenticated Sheets client. |
| `_quote_tab(name)` | A1 notation needs the name quoted if it holds a space or a digit. |
| `_whole_tab(name)` | The A1 range that is a tab with no column letters. |
| `_tab_names(service, id)`, `_tab_id(...)` | Tab discovery. |
| `AppLayoutError` | Raised when a column the run needs is not named in `App`'s header row. |
| `_header_key(cell)` | One header cell reduced to what identifies the column. |
| `app_columns(header)` | Where each named column sits, read off `App`'s own header row — never hard-coded. |
| `_layout(header)` | Which of four historical shapes the `Jobs` tab is in. |
| `_insert_source_column`, `_claim_source_column` | Walk an older `Jobs` tab forward to the current layout. |

## Deciding what stays

| Function | Does |
|---|---|
| `_identity(row)` | One posting, **strict**, for deciding what leaves the sheet. |
| `_loose_identity(row)` | One posting, **loose**, for asking whether it has already been applied to. |
| `_key`, `_sort_key` | Everything still to do first, newest posting first within that. |
| `_preference(a, b)` | Which of two rows describing one job to keep. |
| `_drop_duplicate_rows` | Rows written before the key knew what it knows now. |
| `_drop_duplicate_identities` | One row per company and role, chosen by `_preference`. |
| `_drop_empty_rows` | A row with nothing in the four owned columns is not a job. |
| `_drop_blocked_rows` | An employer the tracker has stopped following leaves the sheet. |
| `_drop_foreign_rows` | Rows the boards place outside the United States. |
| `_drop_dead_rows` | Existing rows are checked too, not only new ones. |
| `_is_annotated(row)` | Someone has written past the five owned columns — a tick, a note. **Annotated rows are protected.** |

## Applied state

| Function | Does |
|---|---|
| `_already_applied(values_api, settings)` | What the application tracker says has been sent, read two ways (strict and loose). Reads the `App` tab on the reconnected client — see *The connection is rebuilt after the liveness sweep*. |
| `_ticked`, `_noted` | Checkbox and note state on one row. |
| `_mark_applied` | Tick the checkbox on a job already in the tracker, so what is left unticked is what is left to do. |
| `_census` | Applied, Expired, and what remains — the postings still worth an application. |
| `_last_stage(update_cell)` | The stage named by the bottom line of the `Update` column, or `""`. |

## The connection is rebuilt after the liveness sweep

`append_new_jobs` reconnects — `_service()` again, and a new `values_api` — immediately after
`_drop_dead_rows`, and only when `verify_links` is on.

The sweep is the one step in the function that takes minutes: a request per unsettled row,
around 1,350 of them, serialised within each host. **Seven to ten minutes is the normal cost,
not a regression** — the median sync run sat between 7.0 and 10.2 minutes every day from
2026-09-23 to 10-01, and again on 10-04. The ~2.3-minute runs on 10-02 and 10-03 were the
exception, and they track how fast the hosts answer, not row count (1,344 rows on 10-03
against 1,359 on 10-04).

Across that gap the connection opened for the read at the top of the function goes idle long
enough for Google's frontend to close it. httplib2 does not notice and does not reconnect: it
sends on the dead socket and raises `ssl.SSLEOFError`. Nothing retries it. httplib2 0.32.0's
`_conn_request` catches the error as a `socket.error` but only retries `ENETUNREACH` and
`EADDRNOTAVAIL`, and `googleapiclient`'s `num_retries` defaults to `0`, so `_retry_request`
makes one attempt and re-raises.

**This failed seven sync runs between 2026-10-01 and 10-04** — three on 10-01, four on 10-04 —
every one of them an identical `SSLEOFError` on the App-tab read, after the crawl had already
finished. The sources and all 1,186 boards had answered; nine minutes of work was discarded at
the last step. The two 09-29 failures are unrelated: HTTP 403 during the workspace migration.

**The exposure is not new, and the sweep getting slower is not what caused it** — runs of eight
to ten minutes ran green through all of late September. Whether Google closes the idle
connection on a given run is not deterministic, so this sat latent for weeks and then took four
of thirteen runs in a day. **Only long runs die, though:** every failing run was 9.1 to 10.7
minutes, and 10-02 and 10-03 — the two-minute days — did not fail once. That is also why
`--skip-link-check` has never seen it.

Reconnecting *after* the sweep rather than reading `App` *before* it is deliberate. The write and
`_ensure_jobs_checkboxes` also sit after the gap, so moving only the App read earlier would hand
the stale socket to `_write` instead — the same failure in a worse place. One token fetch covers
every call below.

Retry counts were not raised instead. A retry would reissue the request on the same httplib2
connection, whose `sock` is still set after a failed send, so it is not reliably a reconnect.

## Writing

| Function | Does |
|---|---|
| `_sorted_rows`, `_divided` | Order, then one blank row between what is still to do and what is dealt with. |
| `_stamp`, `_unstamped` | The caption in H1 saying when this run wrote; blanked for the comparison that decides whether anything changed. |
| `_trimmed(rows)` | Trailing blank cells removed — how the API hands rows back. |
| `_column(index)`, `_update`, `_write` | The A1 arithmetic and the value writes. |
| `_jobs_checkbox_rule`, `_ensure_jobs_checkboxes` | Apply `BOOLEAN` validation to `Applied` and `Expired` through exactly the Jobs rows just written, so boolean state always renders as checkboxes rather than bare `TRUE`/`FALSE`. |
| `append_new_jobs(...)` | The entry point `main.py` calls. |
| `audit_app(...)` | Read every `App` row and say what is wrong with it. `--audit-app` only; writes nothing. |
| `SyncResult` | What one run changed, so the log can say which rows left and why. |
