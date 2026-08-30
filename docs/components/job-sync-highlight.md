# job_sync/highlight.py — who can be asked about an application

Paints the `App` tab and ticks two checkboxes: **Alumni** and **Recruiter**. The question it
answers is "for this application already sent, is there anybody to write to?"

## Connections

- **In:** `main.py`, after the sheet write. Reads `data/recruiter_companies.txt` (rebuilt by
  `scripts/recruiter_companies.py` from the ColdEmail export) and the H-1B disclosure data.
- **Writes:** `App` — two checkbox columns plus row colour.
- **Consumed by:** a person deciding what to chase; the outreach script does **not** read these.

## Contact data

| Function | Does |
|---|---|
| `recruiter_companies()` | Employers with a recruiter contact, as token sets ready to compare. |
| `h1b_sponsors()` | DOL-certified SWE H-1B sponsors present in **both** FY2024 and FY2025. |
| `_h1b_tokens(name)` | Normalize a company name, expanding only high-confidence brand aliases. |
| `is_h1b_sponsor(name)` | Whether a `Jobs` company sponsored certified SWE H-1B LCAs in both years. |

Two years rather than one: a single year admits companies that filed once and stopped.

## Painting

| Function | Does |
|---|---|
| `_values(...)` | `None` where the tab is not there — different from a tab with no rows. |
| `_painted(...)` | The tab's id, and which rows already carry the target colour. |
| `_runs(rows)` | Consecutive rows folded into half-open ranges, so scattered matches cost few requests. |
| `_requests(...)` | **Only the difference.** A row already the right colour is left alone. |
| `_paint(...)` | Issue the batch. |

## Checkboxes

| Function | Does |
|---|---|
| `_checkbox_columns(header)` | Where Alumni and Recruiter sit, and the proof they can be written together. |
| `_boxes(...)` | Two checkbox columns, `count` rows deep, every cell reading TRUE or FALSE. |
| `_boxed(...)` | Whether every cell the ticks go into really is a checkbox. |
| `_checkbox(...)` | The checkbox data-validation rule over exactly the written range. |
| `_state(...)` | What this run says about one checkbox, or what the sheet already says. |
| `_mark_contacts(...)` | State both columns, and report whether anything had to be written. |
| `_Ticks` | What one pass at the two columns did. |
| `highlight(...)` | The entry point: two checkboxes in `App`, and the colour that goes with them. |
| `HighlightResult` | What changed. |

## Gotcha

Writing a value into a cell that is not a checkbox produces a plain `TRUE` string that looks
right and behaves differently. `_boxed` exists to refuse that, rather than discover it later.
