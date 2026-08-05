# Running it on this laptop

The production target is OCI with Docker (see `docs/RUNBOOK.md` and
`deploy/deploy.sh`). This file is the other case: running the whole thing
locally on the WSL box, which is how it was last verified end to end.

Docker Desktop's WSL integration is off, so `docker compose up` does not work
here. Postgres 17 is installed natively instead, and is run as your own user —
no `sudo`, no container.

---

## Start

```bash
PGBIN=/usr/lib/postgresql/17/bin
BASE=$HOME/.local/share/internship-ops-pg

# once, ever
$PGBIN/initdb -D $BASE/dev  -U internship_ops --auth=trust -E UTF8
$PGBIN/initdb -D $BASE/test -U internship_ops --auth=trust -E UTF8

# every boot
$PGBIN/pg_ctl -D $BASE/dev  -l $BASE/log/dev.log \
  -o "-p 5442 -k /tmp -c listen_addresses=127.0.0.1" start
$PGBIN/pg_ctl -D $BASE/test -l $BASE/log/test.log \
  -o "-p 5443 -k /tmp -c listen_addresses=127.0.0.1" start
```

Ports match `docker-compose.yml`: **5442** is development, **5443** is the test
database the suite truncates. Both listen on loopback only, which is the same
rule the production compose file follows — no database port is ever reachable
off-host.

First time only:

```bash
psql -h 127.0.0.1 -p 5442 -U internship_ops -d postgres -c "CREATE DATABASE internship_ops"
psql -h 127.0.0.1 -p 5443 -U internship_ops -d postgres -c "CREATE DATABASE internship_ops_test"
uv run internship-ops migrate
```

Stop with `pg_ctl -D <dir> stop`.

---

## The three processes

Each wants its own terminal.

```bash
uv run internship-ops serve                 # http://localhost:8000
uv run internship-ops worker                # everything except the browser
uv run python -m app.worker.browser_slot    # PREPARE_APPLICATION only
```

The worker and the browser slot are deliberately separate processes. Exactly one
process owns each task type: a worker that claimed `PREPARE_APPLICATION` without
Chromium would bury it.

`worker` polls when the queue is empty and does not exit on its own. `--once`
runs a single task; `--max-tasks N` stops after N have *run*, so if fewer than N
are queued it keeps polling — that is a daemon idling, not a hang.

---

## Sign in

`ADMIN_PASSWORD_HASH` in `.env` is an Argon2 hash, never a password. Change it
with:

```bash
uv run internship-ops hash-password
```

Without it nobody can sign in, and signing in is not optional: selecting a job
is a human step with no CLI equivalent, by design.

---

## What runs without an API key

`LLM_PROVIDER=null` is the default and makes no network calls to a model. The
pipeline still runs end to end:

| Stage | Without a key |
|---|---|
| Discovery, dedupe, pre-spend screen | Unaffected — no model involved |
| Sponsorship | Keyword pre-pass only, `SPONSORSHIP_NOT_MENTIONED` at low confidence |
| Scoring | The 50 model-judged points are zeroed; jobs still score and rank |
| Resume | Not a model step at all — your PDF is copied and uploaded |
| Recruiter hook | Plain email, no hook |

So it is usable offline, and every degradation is recorded rather than silent.
Set `ANTHROPIC_API_KEY` and `LLM_PROVIDER=anthropic` to get the other half of
the fit score and a real recruiter hook. `LLM_MONTHLY_BUDGET_USD` caps the spend.

---

## Checking the browser stage without touching an employer

There is a fake ATS in the repo for exactly this:

```bash
uv run python -m uvicorn browser.fake_ats.app:app --port 8099
```

Point an application's `application_url` at
`http://127.0.0.1:8099/greenhouse/jobs/swe-intern` and run the browser slot. It
fills what it can, uploads the resume, screenshots, and stops. Add
`?fault=captcha|selectors|expired|validation` to the URL to rehearse a failure.

The slot launches Chromium headed and needs a display. WSLg provides one
(`DISPLAY=:0`); over plain SSH, use `Xvfb`.

---

## Running the tests

The suite needs the test database on 5443; without it the database tests skip
rather than fail.

```bash
uv run pytest
```
