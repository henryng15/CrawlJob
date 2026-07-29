# AGENTS.md

InternshipOps — a private, single-user system that **prepares** U.S. SWE internship
applications and recruiter outreach. It never completes them.

Full spec: [docs/spec/README.md](docs/spec/README.md). Read the relevant section
before implementing it; don't work from this file alone.

---

## The two hard rules

Everything else is negotiable. These are not.

1. **Never click Submit on an application.** Fill the form, screenshot it, stop.
2. **Never send an email.** Create a Gmail draft. The Gmail service must not
   expose a `send` method at all — not disabled, absent.

---

## Never

- Bypass CAPTCHA, bot detection, rate limits, or account security checks.
- Change, soften, or infer: work authorization, sponsorship needs, immigration
  status, citizenship, graduation date, GPA, employment history, EEO answers,
  export-control eligibility. These come from locked candidate facts or from a
  human. Never from a model.
- Automate LinkedIn, or scrape private/login-gated pages.
- Put secrets in git, Docker images, Terraform state or outputs, logs,
  screenshots, or test fixtures.
- Expose any port publicly. Access is Tailscale-only; Funnel stays off.
- Use employer-side ATS submission APIs.

## Always

- **Fail closed.** Uncertain field, changed page, ambiguous JD → manual review
  queue. Never guess.
- **Evidence or nothing.** A restrictive sponsorship classification needs a JD
  quote. A resume bullet needs fact IDs. A cold-email hook needs a source URL.
  No evidence → downgrade the claim, don't invent one.
- **Idempotent tasks.** Every background task gets a dedupe key and must be safe
  to run twice.
- **Dedupe before spending.** Deduplication runs before any LLM call, resume
  generation, or browser work.
- **Preserve artifacts.** Every tailored resume version is immutable, and each
  application records the exact `resume_version_id` uploaded.
- Treat model output as untrusted until it passes deterministic validation.
- Add fixture tests before adding an ATS adapter.

---

## Stop and ask

Report and wait — do not improvise around these:

OCI credentials · Tailscale login · Gmail OAuth · API keys · manual ATS login ·
any legal or work-authorization question · anything that would contradict a
locked candidate fact.

---

## Conventions

- Python 3.12, FastAPI + Jinja2 + HTMX, PostgreSQL 16, SQLAlchemy 2 + Alembic.
- Task queue is PostgreSQL (`FOR UPDATE SKIP LOCKED`). No Redis, no Celery.
- Browser: Playwright + Chromium on **ARM64**, two fixed slots. Never assume an
  upstream image is multi-arch.
- Timestamps stored UTC; business logic in `America/New_York`.
- Typed Python, `ruff` + `mypy` clean before you call anything done.
- Claude Code builds this repo. It is not the runtime — production uses the API
  and deterministic code.

```bash
uv run ruff format . && uv run ruff check . && uv run mypy app && uv run pytest -q
```

---

## Where things are

| | |
|---|---|
| `app/domain/` | State machines, normalization, task vocabulary. No I/O. |
| `app/services/` | One module per pipeline stage. Pure functions where possible. |
| `app/worker/handlers.py` | The pipeline: each stage enqueues the next. |
| `app/worker/browser_slot.py` | The only code that drives a browser. |
| `app/web/` | Review screens. `queries.py` holds the read models. |
| `app/cli/main.py` | Everything an operator does by hand. |

Handlers read the clock with `run_clock()`, never `datetime.now()`. Send windows,
cooldowns and due dates all turn on time, and a stage that reads the wall clock
cannot be tested at any moment but the present one.

## Build order

Milestone 0 (ARM64 browser spike) is blocking — nothing proceeds until Chromium
runs on OCI A1 and noVNC is reachable privately.

Then: M2 core → M3 profile → M4 discovery → M5 sponsorship → M7 Greenhouse →
M9 outreach. Defer M1, M6, M8, M10, M11.

One milestone at a time. Do not start the next until acceptance criteria pass.
See [docs/spec/30-milestones/](docs/spec/30-milestones/).

Still unregistered, and reported as such at worker startup:
`REPLAY_APPLICATION`, `RECONCILE_SUBMISSION`, `ENRICH_JOB`, `DEDUPE_JOB`,
`BACKUP_DATABASE`, `BACKUP_ARTIFACTS`. An unregistered task type is buried on
arrival rather than retried, so adding a handler is what makes a stage real.

---

## Known spec defects

The spec has 7 known errors — see the table at the bottom of
[docs/spec/README.md](docs/spec/README.md). Two will bite you:
Gmail OAuth "Testing" mode expires refresh tokens after 7 days, and
`claude-sonnet-4-6` in the sample `.env` is not a real model ID.
