# AGENTS.md

AutoApply — a private, single-user system that **submits** U.S. SWE internship
applications on the operator's behalf.

This repository used to do the opposite. It prepared applications and stopped,
and its rules, its state machine and its tests all enforced that a person pressed
Submit. That is gone on purpose. If you find a comment, a docstring or a section
under `docs/spec/` still saying the system never submits, it is stale — this file
wins.

---

## The two lanes

Every application takes exactly one of them.

1. **Manual** — the employer is on the manual-only list (`manual_only_companies`,
   imported from `ColdEmail/data/seed_manual.csv`). No browser opens. The
   application gets its resume and goes straight to `NEEDS_ME`.
2. **Auto** — everything else. The browser opens the form, fills every field it
   can answer from a locked fact, and submits. If any **required** field is left
   unanswered, it submits nothing and goes to `NEEDS_ME` instead.

`NEEDS_ME` means the user finishes it in their own browser, from the link on the
dashboard. There is no route back into ours.

## The rules that are still absolute

1. **Never bypass a CAPTCHA, bot detection, or a rate limit.** A challenge means
   the application goes to `NEEDS_ME`.
2. **Never send email.** There is no email code left; keep it that way.
3. **Never change, soften or infer** work authorization, sponsorship need,
   citizenship, graduation date, GPA, employment history, EEO answers or export
   control eligibility. These come from locked candidate facts or a human. Never
   from a model, never from a default.
4. **Never automate LinkedIn.** Never scrape login-gated pages — with one
   exception the operator authorised on 2026-08-06: an **employer's own ATS**
   (Workday) may be signed into with the operator's own account, because
   creating one is how that employer accepts applications and 19% of the auto
   lane is behind it. This does not extend to job boards, aggregators, LinkedIn,
   or any site where the account is not the operator's own and the purpose is
   not submitting their application.
5. **Never put secrets** in git, images, Terraform state, logs or screenshots.
6. **Never expose a port publicly.** Tailscale only; Funnel stays off.

## Before the click

`app/safety.py::assert_safe_to_submit` is the only choke point, and everything
that can refuse a submission refuses there. Do not add a second path to
`page.click()` — `app/ats/driver.py::submit_form` is the only one, and
`find_submit_control` refuses rather than guessing when two controls match.

Three settings exist because the first bug in a submit path is discovered by an
employer:

- `AUTO_SUBMIT_ENABLED` (default false) — off means fill and hand over.
- `AUTO_SUBMIT_DRY_RUN` (default true) — locate the control, screenshot it, do
  not click. The application lands in `NEEDS_ME` marked `was_dry_run`, never in
  `SUBMITTED`, because "we would have sent this" and "we sent this" must never
  look the same on the dashboard.
- `MAX_AUTO_SUBMITS_PER_DAY` (default 20) — a ceiling on what one bad night
  costs. Set to **3** in `.env` for the first days of real submissions, so the
  operator can check the confirmation email for every one before it goes up.

## Where the form actually is

`app/ats/apply_url.py` is a lookup, not a heuristic: each entry was checked by
pointing a headless browser at a live posting and counting inputs. Nine of the
first eleven real applications were handed back because the browser opened a
description page. Measured coverage of the auto lane:

| Board | Share | Fields read | How |
|---|---|---|---|
| Ashby | 37% | 35 | posting → `/application` |
| Workday | 19% | 0 | behind a button, needs an account |
| Greenhouse | 16% | 27 | form is on the posting |
| Lever | 10% | 23 | posting → `/apply` |
| iCIMS | 3% | — | form is in an `<iframe>` |

Three things make a page readable, and all three were needed:
`wait_for_form` (Ashby, Lever and Workday render from JavaScript), the
`<form>`-optional fallback in `extract_form` (Ashby has 35 inputs and no `<form>`
element), and the label lookup in `_LABEL_JS` (Lever gives one field in 19 a
`<label for>`; the rest need the container's first line).

## Always

- **Fail closed.** `is_manual_only` returns True when it has no domain. An
  uncertain field blocks. An unrecognised question blocks. A mistake toward
  manual costs the user minutes; a mistake toward auto sends an application they
  cannot recall.
- **Evidence or nothing.** A restrictive sponsorship classification needs a quote
  that is actually in the posting.
- **Idempotent tasks**, each with a dedupe key, safe to run twice.
- **Preserve artifacts.** Every application records the exact `resume_version_id`
  the browser confirmed was attached — not the one that was built.
- Treat model output as untrusted, and treat a job description as untrusted
  input to it. See "One model call" below for the only place either appears.

## One model call, and only one

`app/services/why_company.py` drafts the "why do you want to work here"
paragraph. That is the entire use of a language model in this system, and it is
allowed because that question has no factual answer and the box it goes in
accepts nothing else — `_AI_DRAFTABLE` in `app/ats/fields.py` is the whitelist,
and it contains no legal, EEO or authorization key.

Everything else stays deterministic and must. Scoring is arithmetic over five
components, rescaled to 100. Sponsorship screening is regex
(`deterministic_prepass`) plus the user's own locked facts. That is what makes
the system free to run.

Three things about the draft are not negotiable:

- **The posting is untrusted input.** It is fenced, truncated and labelled as
  quoted material, and the instruction that says so comes *after* it.
- **The draft is checked before use.** A paragraph mentioning citizenship,
  sponsorship, clearance, criminal history or an EEO category is discarded, not
  edited — those are the user's to state, on fields of their own.
- **Failure is silence.** No key, no network, an empty or blocked response: all
  return `None`, the field stays blank, and the application goes to `NEEDS_ME`.
  Nothing here may raise into the browser worker.

It only runs when the form actually asks. Gating on the question keeps the free
tier spent on paragraphs that get used.

## Stop and ask

OCI credentials · Tailscale login · API keys · a manual ATS login · any legal or
work-authorization question · anything that would contradict a locked fact.

## Conventions

- Python 3.12, FastAPI + Jinja2 + HTMX, PostgreSQL 16, SQLAlchemy 2 + Alembic.
- Task queue is PostgreSQL (`FOR UPDATE SKIP LOCKED`). No Redis, no Celery.
- Browser: Playwright + Chromium on **ARM64**, headless, two workers.
- Timestamps stored UTC; business logic in `America/New_York`.
- Handlers read the clock with `run_clock()`, never `datetime.now()`.
- Typed Python, `ruff` + `mypy` clean before anything is done.

```bash
uv run ruff format . && uv run ruff check . && uv run mypy app && uv run pytest -q
```

## Where things are

| | |
|---|---|
| `app/domain/states.py` | The two lanes, as a transition table. |
| `app/services/manual_companies.py` | The fail-closed gate. |
| `app/ats/driver.py` | Extract, fill, and the one submit path. |
| `app/ats/fields.py` | What may be answered, and from what. |
| `app/worker/handlers.py` | Discovery → screen → score → select → materials. |
| `app/worker/browser.py` | The only code that drives a browser. |
| `app/web/` | The dashboard. `queries.py` holds the read models. |
| `app/cli/main.py` | Everything an operator does by hand. |

## Getting the auto lane to actually fire

Two things gate it in practice, and both are easy to miss:

- **A company needs a domain.** The gate keys on it and fails closed without one,
  and the Greenhouse, Lever and Ashby APIs mostly do not publish one — only about
  15% of boards yield a domain, the ones fronted by the employer's own hostname.
  The GitHub feed is the real supplier, and `dedupe` backfills `Company.domain`
  when a later feed names one. **Running ATS feeds alone gives you a manual lane
  and nothing else.**
- **The locked facts have to exist.** Any required question with no locked fact
  behind it blocks the whole application, and `LOCKED_FACT_ANSWERABLE_KEYS` will
  not accept an unlocked value. Every prefix in that set is now covered by
  `ALWAYS_LOCKED_PREFIXES`, so setting the fact is enough — but a fact that was
  never set at all still stops every form that asks for it.

## Known stale documentation

`docs/spec/` was written for the prepare-only product. Sections §7.8–§7.11, §8,
§13, §15, §22 and §29 describe machinery that no longer exists: live review,
replay packages, prepared-application TTLs, recruiter outreach, Gmail drafts.
Read the code, not the spec, for anything in that list.
