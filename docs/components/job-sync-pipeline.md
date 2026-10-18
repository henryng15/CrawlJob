# job_sync — pipeline and filters

`main.py`, `config.py`, `roles.py`, `places.py`, `liveness.py`

The entry point and the three filters that decide whether a posting belongs in the sheet.

## Connections

- **In:** `sources.py`, `boards.py`, and optional `feeds.py` supply postings; environment variables supply credentials.
- **Out:** `sheet.append_new_jobs` writes the `Jobs` tab; `highlight.highlight` paints `App`.
- **Runs:** `.github/workflows/sync.yml`, **dispatched from outside GitHub** — four cron-job.org
  jobs created by `scripts/setup_cron_job_org.sh` fire it every 45 minutes from 09:00 to 21:00 ET,
  seventeen times a day. `sync.yml` has no `schedule:` of its own on purpose: GitHub delivered its
  cron firings a median 25 minutes late (p90 74, worst 106) over 21–27 August 2026, which a
  45-minute cadence cannot absorb. A dispatch starts at once.
- **Sweeps links on every run**, as it always did. For one day — 18 to 19 October 2026 —
  it did not: `sync.yml` passed `--skip-link-check` on fifteen of the seventeen runs
  while a serial sweep of one oversized host was taking the run to 10m26s. That gate was
  removed once `liveness.py` was fixed to split a large host across queues; see
  *What the sweep costs* below.

## `main.py`

| Function | Does |
|---|---|
| `in_working_window(now)` | True when the local ET hour is in 08:00–22:59. A *window*, not a slot list — a late cron would otherwise be dropped for missing its exact hour. |
| `main()` | Parse flags, fetch trackers, ATS boards, and optional feeds; dedupe, filter, write. |

**Flags:** `--skip-link-check` (no liveness probe), `--no-boards` (Markdown trackers only),
`--rebuild` (discard existing rows), `--audit-app` (report `App` problems and sync nothing).

`--skip-link-check` is a supported path rather than a corner, and worth knowing about
even though the workflow does not pass it: `sheet.append_new_jobs` reconnects to Sheets
**inside** the `verify_links` branch precisely because skipping the sweep leaves no idle
gap to reconnect across. It is the flag to reach for when a sync is wanted in a hurry.

`--scheduled` (exit outside the window) is still in the CLI but **the workflow no longer passes
it** — the window moved to the cron-job.org schedule, so `in_working_window` is now dead code on
the scheduled path and only bites someone who passes the flag by hand.

**Constants:** `WORKING_HOURS = 8..22` — an hour wider than the schedule at each end, which is
what carries it through the DST change. `EARLIEST_POSTED = 2026-01-01` — one posting year;
the trackers carry a decade of history and the first sync would otherwise pour all of it in.

## `config.py`

| Function | Does |
|---|---|
| `Settings` | Frozen dataclass: `sheet_id`, `sheet_tab`, `app_tab`, `alumni_tab`, `service_account_json`. |
| `load_settings()` | Read env vars, raise if `GOOGLE_SHEET_ID` or `GOOGLE_SERVICE_ACCOUNT_JSON` is missing. |

Tab names use `os.getenv(...) or "Jobs"`, not a getenv default: an Actions secret that was
never set arrives as an empty string, which would name a tab that cannot exist.

Optional feed credentials are opt-in: `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` enable Adzuna,
and `USAJOBS_API_KEY` enables USAJOBS. Company-scoped SmartRecruiters, Personio, and
Recruitee identifiers live in `data/public_feeds.toml`.

## `roles.py`

| Function | Does |
|---|---|
| `_is_internship(text)` | Whether the title says intern/internship rather than new-grad. |
| `is_target_role(title)` | The one gate on job title. |

## `places.py`

| Function | Does |
|---|---|
| `_contains(text, phrase)` | Whole-phrase containment, bounded both sides so "indianapolis" does not match "india". |
| `is_united_states(text)` | **Keeps unless the text says somewhere else.** Absence of a location is not a reason to drop a posting. |

## `liveness.py`

| Function | Does |
|---|---|
| `workday_api(url)` | The CXS endpoint behind a Workday page — the page itself renders in JS and always looks alive. |
| `_fetch(url)` | One HTTP request. |
| `check(url)` | `True` if the posting is there, `False` if the host says it is gone, `None` if unknown. |
| `_sweep(urls)` | One queue, start to finish, paced `PER_HOST_DELAY_SECONDS` apart. |
| `_queues(by_host)` | The work handed to the pool: one queue per host, but a host over `PER_HOST_DEPTH` dealt round-robin into up to `PER_HOST_WORKERS`. Deepest first, because the pool is only `WORKERS` wide. |
| `dead_links(urls)` | Only links a host **positively** reported gone. `None` never removes a row. |

The three-state return is the whole design: a network failure must not delete a live posting.

**What the sweep costs.** `dead_links` hands the pool one queue per host, paced
`PER_HOST_DELAY_SECONDS = 0.4` apart within a queue, so **a run is as long as its deepest
queue** — not as long as the average, and not as long as the total.

That is why one host could set the price of the whole thing. Measured on 2026-10-17 against
the live `Jobs` tab: 1,044 swept links across 204 hosts, of which **507 were `jobright.ai`**
while the next host down, `job-boards.greenhouse.io`, held 56. One queue of 507 at 1.04s a
link is 8.8 minutes; the runner-up is 0.6. That single bucket is the whole reason the run
went from a 192s median in mid-September to 736s a month later — the crawl adds roughly
nineteen Jobright links a day, each one +1.04s on *every* run — and seventeen such runs a day
spent the month's 3,000 Actions minutes on the 17th with two weeks of October left.

`_queues` is the fix. A host over `PER_HOST_DEPTH = 100` links is dealt round-robin into up
to `PER_HOST_WORKERS = 6` queues, deepest queue handed out first; a host under the threshold
is one queue, exactly as before. Jobright's 507 became six queues of 85 and the sweep went
from 527s to **94s measured**, with all 507 returning alive — no dead, no unknown, no sign of
the generic shell. A 60-link sample at 2, 4 and 8 workers was clean too.

| | serial | six paced queues |
|---|---|---|
| jobright.ai, 507 links | 527s | **94s** |
| false deaths | 0 | **0** |

The splitting is safe because of the pass that was already there: an apparent death is
re-asked alone on a quiet connection before any row is deleted, so a shell served under load
costs a second request rather than a live posting.

**The dials, and what it would take to move them.** 6 and 100 are measured on one day against
one host. The shell was originally seen at *16 unpaced* workers, so there is real headroom
between that and six paced — but it is untested, and raising these wants a fresh measurement
rather than this one. Growth is also bounded differently now: Jobright has to pass 600 links
before its queues deepen at all, where before every single link added time.
