# job_sync — where postings come from

`sources.py`, `boards.py`, `feeds.py`

Three supplies: Markdown trackers other people publish, the ATS the employer actually runs,
and optional public career/job feeds. `sources.py` also owns the identity rules the whole
Python side shares.

## Connections

- **Out:** `main.py` merges all supplies; `sheet.py` reuses `normalize_link`, `company_identity`,
  `role_identity`, `name_key`, `company_tokens`, `same_employer`.
- **Mirrors:** `COMPANY_NOISE` here and in `outreach_contacts.gs` must agree, or the tracker
  and the outreach queue will disagree about what one employer is.

## `sources.py` — identity rules

| Function | Does |
|---|---|
| `normalize_link(url)` | **The one definition of "the same posting."** Strips `?utm_source=Simplify&ref=Simplify` and friends so a row already in the sheet and an incoming row compare equal. |
| `name_key(text)` | Company or role with case and punctuation set aside. |
| `role_key(title)` | A role with word endings settled, in the order written. |
| `role_identity(title)` | A conservative identity that tolerates SWE/SDE acronyms and title reordering while keeping season/year and descriptive words. |
| `role_tokens(title)` | A role as an unordered bag of words, intake removed. |
| `company_tokens(name)` | An employer as the words that name it, legal form dropped. |
| `company_identity(name)` | Exact token-set company key for deduplication; unlike contact matching, it does not use containment. |
| `same_employer(a, b)` | Either token set contained in the other. "Google Cloud" matches "Google"; "Dice" does not match "Dicerna" because containment is over whole words. |
| `is_aggregator_link(url)` | A link that only redirects to the posting rather than being it (Jobright, Startup Jobs, or Adzuna). |
| `is_blocked_company(name)` | Matched on a substring of the condensed name, so "ByteDance" catches its spellings. |

## `sources.py` — reading trackers

| Function | Does |
|---|---|
| `Source`, `Job` | The dataclasses; `Source.format` selects Markdown or RSS. |
| `load_sources(path)` | Read `sources.toml`. |
| `fetch_source(source)` | Download one tracker. |
| `clean_text(cell)` | Strip Markdown decoration out of a table cell. |
| `resolve_company(cell, above)` | A cell holding only `↳` means "the company above". |
| `extract_url(cell)`, `posted_date(cell)`, `_parse_month_date`, `_header_index` | Column parsing. |
| `parse_jobs(text, today)` | One tracker's Markdown/HTML table into `Job`s. |
| `parse_rss_jobs(text, today)` | Parse job RSS, currently Startup Jobs' engineering feed, using the canonical GUID when present. |
| `parse_source(text, source, today)` | Dispatch a configured source to its parser. |
| `dedupe_jobs(jobs)` | Keep the first occurrence of an application URL across all sources. |

## `feeds.py` — optional public feeds

| Function | Does |
|---|---|
| `_smartrecruiters`, `_personio`, `_recruitee` | Read company-scoped public career feeds listed in `data/public_feeds.toml`. |
| `_adzuna`, `_usajobs` | Read optional credentialed aggregator/federal APIs from environment variables. |
| `harvest_feeds` | Fetch optional feeds, isolate failures, count skipped unconfigured feeds, and URL-dedupe their output. |

The registry is intentionally empty until a company board has been verified. Startup Jobs is
configured directly in `sources.toml` because its RSS feed is global and needs no credential.
`ADZUNA_APP_ID` + `ADZUNA_APP_KEY` enable Adzuna; `USAJOBS_API_KEY` enables USAJOBS. Missing
optional credentials never fail a run.

## `boards.py` — reading the ATS directly

| Function | Does |
|---|---|
| `BoardResult` | Roles found, plus the links deliberately not followed. |
| `_greenhouse`, `_lever`, `_ashby` | One parser per ATS. Each returns a common shape. |
| `_display(slug)` | A company name out of a board slug, for the two ATSes that do not send one. |
| `_from_iso`, `_from_epoch` | Date parsing. Lever counts milliseconds. |
| `_where(row)` | Every place a row names, joined into one line for the country reading. |
| `_in_country(row)` | Lever carries an ISO-3166 code — the one unambiguous location field available. |
| `read_board(ats, slug)` | One board's JSON, or `None` for anything that did not come back as JSON. |
| `split_board`, `parse_board`, `_one` | Turn a board response into roles. |
| `harvest(boards)` | Ask every board at once; keep only matching roles. |
| `load_boards()` | The boards worth asking daily, as `(ats, slug)` pairs, from `data/ats_boards.json`. |
| `extra_boards()` | Boards written down by hand, `"<ats>:<slug>"` one per line. |

Board discovery is a separate offline tool: `scripts/discover_boards.py` probes candidate
slugs (from tracker links) and records which ones answer and advertise internships.
