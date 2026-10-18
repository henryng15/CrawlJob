# Operations

## Reading the log of one sync run

```
Simplify / Pitt CSC — Summer 2027: 80 matching roles
...
294 of 365 deduped roles posted on or after 2026-07-01
Appended 0 new jobs; 294 already in the sheet.
Dropped 8 rows whose posting the board reports as gone.
Dropped 0 rows from employers this tracker no longer follows.
Merged 78 rows repeating a company and role already listed.
Ticked by company and role: Virtu Financial — Software Engineer Intern - Software Engineer
Ticked Applied on 3 rows matching a tracked link and 9 matching a tracked company and role.
52 rows ticked Applied and 0 ticked Expired; 440 postings still to apply to.
```

| Line | Worth a look when |
|---|---|
| `N of M deduped roles` | `M` drops sharply → a tracker changed format, check for `WARNING` |
| `Appended` | 0 is normal; new jobs do not appear every forty-five minutes |
| `Dropped … reports as gone` | a sudden jump → a board may be returning 404 across the board |
| `Merged` | a sudden jump after a change to the matching rules → check nothing was merged that should not have been |
| `Ticked by company and role: …` | **read every one** — this is the loosest layer |
| `still to apply to` | the number worth reading daily |

Every run does the work. `Outside the 08:00–22:59 ET working window; nothing to do.` should
never appear at all: the workflow no longer passes `--scheduled`, and the window now lives in
the cron-job.org schedule rather than in the Python. Seeing that line means somebody passed the
flag by hand.

## Auditing the App tab

```bash
internship-sync --audit-app
```

On Actions: **Run workflow** → turn on the `audit_app` input. It syncs nothing.

It reads every row of the `App` tab and reports four kinds of problem:

```
App: 82 rows
  row 14   MISSING    Role
  row 18   SAME JOB   as row 6 (Chicago Trading Company (CTC) — Software Engineering …)
  row 65   DEAD LINK  the board reports it as gone
  row 70   SAME JOB   as row 69 (Notion — Software Engineer Intern (Summer 2027))
18 findings across 82 rows.
```

- `MISSING` — a required field is empty. `Role` is the one most worth fixing: without it the
  row can never be matched by name, see [matching.md](matching.md).
- `SAME LINK` / `SAME JOB` — two rows are the same application.
- `NOT A LINK` — the Application Link cell is not a URL.
- `STAGE?` — the `Process` value is outside the pipeline.
- `UNLOGGED` — `Process` and the last line of the `Update` column name two different stages.
  Apps Script writes that line the moment `Process` changes, so a mismatch means the change
  reached the sheet by a route the simple trigger cannot see: a write through the API, or an
  edit made while the script was broken. Fix it by typing the missing line into the `Update`
  cell yourself.
- `DEAD LINK` — the board reports the posting as taken down.

The audit **only reports; it changes nothing** in the App tab. It also does not fail the
workflow when it finds something, because most findings are things you have decided not to
fix.

It is separate from the sync run because it has to ask every board, which takes about a
minute.

## Rebuild

```bash
internship-sync --rebuild
```

On Actions: **Run workflow** → turn on the `rebuild` input.

Discards every existing row and writes the sheet from the sources alone. Use it when the
old rows were written by a parser that was wrong and cannot be corrected in place.

> **Rebuild also wipes column F onward.** Every `Applied` tick, every `Expired` tick and
> every note is lost. The `App` tab is untouched, so the next sync can tick the jobs you
> have already applied to back on — but `Expired` and the notes have to be redone by hand.

## Other flags

| Flag | |
|---|---|
| `--skip-link-check` | ask no board at all; runs fast, and drops no row for a dead link. **The workflow passes this on fifteen of the seventeen daily runs** — only the 10:30 and 16:30 ET slots sweep. Use the `link_check` input to force a sweep on a run in between |
| `--since 2026-09-01` | change the posting-date cutoff |
| `--sources path.toml` | use a different list of trackers |
| `--no-boards` | read only the Markdown trackers and skip the ATS boards for this run |
| `--scheduled` | exit immediately outside the 08:00–22:59 ET window. **The workflow no longer passes it** — the window moved to the cron-job.org schedule, so this only bites someone who passes it by hand |

## What to look at when it breaks

| Symptom | Usual cause |
|---|---|
| `Missing required environment variable(s)` | a secret was never created, or its name is misspelled |
| `No tab named 'Jobs'` | the tab was renamed → set `GOOGLE_SHEET_TAB` |
| `WARNING: no tab named 'App'` | the sync still runs, it just cannot tick anything |
| `Expected [...] in Jobs!A1:D1` | headers A–D were edited; put the four column names back |
| `403` / `does not have permission` | the spreadsheet was never shared with the service account, see [setup.md](setup.md) |
| An Applied cell shows the word `TRUE` instead of a tick | column F is being written with `RAW` |
| The tool ticks 0 rows every time | column H has a note on every row, or columns F–G are in the wrong place |
| `Multiple top-level packages discovered` | a new directory at the repo root → declare it in `[tool.setuptools] packages` |

## Checks before pushing

```bash
uv run pytest -q          # 194 tests
uv run ruff check .
uv run ruff format --check job_sync tests
```

The Apps Script half cannot run under pytest. The way to check it is to stub
`SpreadsheetApp` and then run `onEdit` and `backfillTicksFromApp` against a fake sheet with
`node` — see [`apps_script/README.md`](../apps_script/README.md).

## The second workflow: rebuilding the ATS board shortlist

[`.github/workflows/boards.yml`](../.github/workflows/boards.yml) runs at **06:00 UTC on
Sunday**, or on demand through **Run workflow**. It asks all 19,913 boards in one pass,
keeps the ones currently advertising an internship, and commits
`job_sync/data/ats_boards.json` back into the repo — committing only when the file has
actually changed.

It is separate from the sync workflow because it is a different kind of job: ~20,000 requests
and about half an hour, against 1,019 requests and a few seconds on each sync run. Folding it
into the sync would make all seventeen runs a day pay that price to learn something that only
changes weekly.

06:00 UTC is 01:00–02:00 ET, well clear of the sync's 08:00–22:59 ET window, so the two
never compete for the same API.

`timeout-minutes: 90` is not a decorative number: a slug that neither resolves nor gets
refused will hold a worker until the timeout expires, and there are thousands of that kind.
90 minutes is comfortably above the real ~35, and far below the 6-hour default, which is
long enough to burn a day of quota.

### Reading its log

The rebuild of 23 August 2026:

```
  probed                       19913
  answered with a job           9858   board still alive
  advertising any internship    1019   <- written to daily
  with a matching SWE intern     185
  matching roles right now       303
```

The third number is the one to watch. A sharp drop means something is wrong with the
upstream slug lists, not that the hiring market suddenly closed.

### When to run it by hand

- You have just cloned the repo and `job_sync/data/ats_boards.json` is not there yet.
- You have just changed `roles.py` — when the filter changes, the shortlist has to be
  rebuilt.
- The start of recruiting season (August–September), when a wave of companies opens intern
  programmes at once and you do not want to wait for Sunday.

```bash
uv run python scripts/discover_boards.py
```

## GitHub Actions budget

Actions bills per **minute, rounded up**, for each job — so a 131-second run and a 178-second
run cost the same three minutes at the end.

Measured from real runs: **median 130s across the 60 runs to 27 August 2026**, billed 3.

| | per day | min/run | min/month |
|---|---|---|---|
| sync, every run does the work | 17 | 2.2, billed 3 | ~1,530 |
| `boards.yml` rebuilding the shortlist | weekly | ~40 | ~172 |
| manual **Run workflow** dispatches | varies | 3 | ~60 |
| | | **total** | **~1,760** |

Against the 3,000 minutes `sync.yml` names, that leaves roughly **1,240 spare**. Check the real
figure under **Settings → Billing and plans → Usage this month** — the numbers here are derived,
not read off the invoice.

The day ends at 21:00 rather than 18:00 because of what the shorter day cost. Databricks published
a Software Engineering Intern role at 19:40 ET, an hour and a half after the last run, and it went
unseen until 09:00 the next morning. The evening runs are what that bought.

**The clock is not GitHub's.** `sync.yml` has no `schedule:`. GitHub delivered its cron firings a
median 25 minutes late over 21–27 August 2026 — p90 74, worst 106 — which a 45-minute cadence
cannot absorb, since the delay is over half the interval and runs bunch up behind each other. It
dropped almost nothing (52 of 54); it was simply always late. Four cron-job.org jobs, created by
`scripts/setup_cron_job_org.sh`, now fire the workflow through the dispatch API, and a dispatch
starts at once — one measured on 27 August was accepted at 15:50:11Z and running by 15:50:12Z.

Two settings in `sync.yml` keep that budget from being wrong by a lot:

- `timeout-minutes: 15`. A run takes about two minutes. The default ceiling is six hours, so a
  single hung run would eat 12% of the month before Actions gave up on it.
- `concurrency: sheet-write` with `cancel-in-progress: false`. Two runs must never write the sheet
  at once, and a manual run fired during a scheduled one would do exactly that. Queueing rather
  than cancelling, because a cancelled run could stop halfway through a rewrite. Queued time is
  not billed.

What actually limits the run count is not the quota but politeness to the three APIs: 1,019
requests × 17 runs = 17,323 requests a day, which is 0.22 requests a second against Greenhouse,
the busiest of the three, and 0.40 across all of them.

> The `/actions/runs/{id}/timing` API reports `billable.UBUNTU.total_ms = 0` even for a
> 237-second run, so **do not trust it**. The numbers above are derived from
> `run_duration_ms` plus the rounding rule. The official figure is under **Settings →
> Billing and plans → Usage this month**.
