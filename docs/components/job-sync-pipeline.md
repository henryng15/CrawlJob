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
- **Sweeps links twice a day, not seventeen times.** `sync.yml` passes
  `--skip-link-check` on every run except the two whose ET hour is `10` or `16`, so the
  liveness probe happens at the 10:30 and 16:30 slots and nowhere else. Those two hours
  are the gate because the 45-minute cadence puts exactly one firing in each of them —
  09, 12, 15 and 18 hold two apiece — and a mid-hour slot leaves 29 minutes of slack for
  a late dispatch. The `link_check` input forces a sweep on any run in between.

## `main.py`

| Function | Does |
|---|---|
| `in_working_window(now)` | True when the local ET hour is in 08:00–22:59. A *window*, not a slot list — a late cron would otherwise be dropped for missing its exact hour. |
| `main()` | Parse flags, fetch trackers, ATS boards, and optional feeds; dedupe, filter, write. |

**Flags:** `--skip-link-check` (no liveness probe), `--no-boards` (Markdown trackers only),
`--rebuild` (discard existing rows), `--audit-app` (report `App` problems and sync nothing).

`--skip-link-check` is the one the workflow now passes on fifteen of the seventeen daily
runs, for the cost reason in `liveness.py` below. It is a supported path rather than a
corner: `sheet.append_new_jobs` reconnects to Sheets **inside** the `verify_links` branch
precisely because skipping the sweep leaves no idle gap to reconnect across.

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
| `_sweep(urls)` | Check many at once. |
| `dead_links(urls)` | Only links a host **positively** reported gone. `None` never removes a row. |

The three-state return is the whole design: a network failure must not delete a live posting.

**What the sweep costs, and why it is gated.** `dead_links` groups links by host and probes
the hosts in parallel (`WORKERS = 12`) but each host's links strictly one at a time, with
`PER_HOST_DELAY_SECONDS = 0.4` between them — the pacing that stopped Jobright serving its
generic shell for 41 of 83 live postings. So a run is as long as its **largest single host
bucket**, not as long as the average.

Measured on 2026-10-17 against the live `Jobs` tab: 1,044 swept links across 204 hosts, of
which **507 were `jobright.ai`** and the next host down, `job-boards.greenhouse.io`, held 56.
At a median 0.46s per `check` plus the 0.4s pacing, that one bucket is 7.3 minutes against
0.6 for the runner-up. It is the whole reason the run went from a 192s median in mid-September
to 736s a month later: the crawl adds roughly nineteen Jobright links a day, each one +0.86s
on *every* run. Seventeen such runs a day spent the month's 3,000 Actions minutes on the 17th,
with two weeks of October left.

Gating the sweep to two runs a day is a schedule fix, not a fix to this module — the bucket
keeps growing, and a swept run reaches `sync.yml`'s 15-minute ceiling around mid-November 2026.
The fix at that point is inside `dead_links`: probe a large bucket with some concurrency rather
than one link at a time, and lean on the second confirmation pass, which already re-asks every
apparent death on its own and would catch a shell served under load.
