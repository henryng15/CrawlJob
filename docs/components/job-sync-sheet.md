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
| `_already_applied(app_rows)` | What the application tracker says has been sent, read two ways (strict and loose). |
| `_ticked`, `_noted` | Checkbox and note state on one row. |
| `_mark_applied` | Tick the checkbox on a job already in the tracker, so what is left unticked is what is left to do. |
| `_census` | Applied, Expired, and what remains — the postings still worth an application. |
| `_last_stage(update_cell)` | The stage named by the bottom line of the `Update` column, or `""`. |

## Writing

| Function | Does |
|---|---|
| `_sorted_rows`, `_divided` | Order, then one blank row between what is still to do and what is dealt with. |
| `_stamp`, `_unstamped` | The caption in H1 saying when this run wrote; blanked for the comparison that decides whether anything changed. |
| `_trimmed(rows)` | Trailing blank cells removed — how the API hands rows back. |
| `_column(index)`, `_update`, `_write` | The A1 arithmetic and the single write call. |
| `append_new_jobs(...)` | The entry point `main.py` calls. |
| `audit_app(...)` | Read every `App` row and say what is wrong with it. `--audit-app` only; writes nothing. |
| `SyncResult` | What one run changed, so the log can say which rows left and why. |
