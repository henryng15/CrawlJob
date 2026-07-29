# InternshipOps

Private, single-user system that **prepares** U.S. SWE internship applications and
recruiter outreach — and stops before every irreversible action.

The system discovers roles, deduplicates them, checks sponsorship language against
your locked profile facts, tailors a resume, fills the employer's application form
in a cloud browser, and then **stops before Submit**. You review and submit. Two
business days later it prepares a recruiter email as a **Gmail draft**. You send it.

It automates repetition — never judgment, legal truth, or irreversible actions.

## What runs today

| Stage | Where |
|---|---|
| Discovery from Greenhouse, Lever, Ashby and GitHub feeds | [app/services/discovery/](app/services/discovery/) |
| Deduplication by requisition, URL, then fingerprint | [app/services/dedupe.py](app/services/dedupe.py) |
| Eligibility filter, then sponsorship classification with quoted evidence | [app/services/sponsorship.py](app/services/sponsorship.py) |
| Fit scoring, 8 components out of 100 | [app/services/scoring.py](app/services/scoring.py) |
| Resume import and provenance-validated tailoring | [app/services/resume.py](app/services/resume.py) |
| Form filling in a live browser, never Submit | [app/worker/browser_slot.py](app/worker/browser_slot.py) |
| Outreach scheduling, recruiter matching, Gmail drafts | [app/worker/handlers.py](app/worker/handlers.py) |
| Review screens for every decision | [app/web/](app/web/) |

Recurring work — discovery, Gmail reconciliation, submission reconciliation,
backups and cleanup — runs on the schedule in §16.2. Every worker may tick; the
idempotency key carries the time bucket, so concurrent ticks collapse rather than
double-firing.

Not yet exercised against a real ATS: the browser slot fills and replays forms
correctly on the local fake ATS, but Greenhouse and Lever in production have
iframes, multi-page flows and SSO that no fixture reproduces.

## Getting started

Requires Python 3.12+, [uv](https://docs.astral.sh/uv/), and Docker.

```bash
cp .env.example .env && chmod 600 .env
python -c "import secrets; print(secrets.token_urlsafe(48))"   # for the two keys
docker compose up -d                     # Postgres on 5442, test Postgres on 5443
uv sync --all-extras --group dev
uv run internship-ops migrate
uv run internship-ops hash-password      # paste the result into ADMIN_PASSWORD_HASH
uv run internship-ops serve --reload     # http://localhost:8000
```

Then, in another terminal:

```bash
uv run internship-ops worker
```

### Putting your own data in

```bash
# Your resume. PDF, DOCX, Markdown or plain text.
uv run internship-ops import-resume ~/Documents/resume.pdf
uv run internship-ops verify-facts        # confirm what was extracted

# Your name, which every email is signed with.
uv run internship-ops set-fact candidate.preferred_name '"Hoan"'

# Recruiters. Preview first; --commit writes.
uv run internship-ops import-recruiters recruiters.csv
uv run internship-ops import-recruiters recruiters.csv --commit

# Find some roles.
uv run internship-ops discover greenhouse stripe figma --now
```

Facts extracted from a resume land **unverified**, and tailoring refuses to cite
them until you confirm each one. A model reading a PDF gets dates and percentages
wrong; a provenance chain anchored to facts nobody read is worse than none.

Writing the facts file yourself skips extraction and stores them verified:

```bash
uv run internship-ops import-resume resume.pdf --facts facts.json
```

### Model access

`LLM_PROVIDER=null` is the default and makes no API calls: the whole pipeline runs
without a key, using the deterministic paths and skipping the model-judged parts.
Set `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` for full behaviour. The
monthly cap in `LLM_MONTHLY_BUDGET_USD` is enforced before each request, not after.

### Gmail

Run [scripts/gmail_authorize.py](scripts/gmail_authorize.py) on your own machine.
It opens *your* browser, you approve in your own Google session, and the refresh
token comes back to localhost encrypted. No password passes through anything but
Google's own login page.

The requested scopes are `gmail.compose` and `gmail.readonly`. `gmail.send` is
never requested, so the credential this produces **cannot send email** — and the
`GmailService` interface has no `send` method for it to call.

One thing is easy to miss: in the Google Cloud console, set **Publishing status →
In production**. Left in "Testing", Google expires refresh tokens after seven days
and outreach breaks every week with an error that reads like a bug in this code.

## Deployment

```bash
cd infra/terraform && terraform init && terraform apply   # builds the machine
# then, on the instance:
docker compose -f docker-compose.prod.yml up -d --build
sudo tailscale serve --bg 8080
```

Only Caddy publishes a port, and only on host loopback. Postgres, the web app and
every browser port exist on the internal Docker network alone. The worker does
**not** mount the Docker socket — see the note at the top of
[docker-compose.prod.yml](docker-compose.prod.yml).

On Oracle Cloud, A1 (ARM) capacity is usually unavailable to Always Free tenancies.
Upgrading the tenancy to Pay-As-You-Go improves the odds substantially and leaves
free-tier resources still costing $0 — the spec's §17 does not mention this.

## Documentation

| | |
|---|---|
| [AGENTS.md](AGENTS.md) | Rules for anyone (human or agent) writing code here. Read first. |
| [docs/spec/](docs/spec/README.md) | Full specification, one file per section. |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | What to do when something is wrong. Read before debugging. |
| [infra/terraform/README.md](infra/terraform/README.md) | Building the OCI machine, step by step. |
| [docs/spec/README.md](docs/spec/README.md#known-defects-in-this-spec) | Known defects in the spec — fix before implementing the affected section. |

## Development

```bash
uv run pytest -q -m "not db and not browser"   # fast loop, no services
uv run pytest -q                               # everything, needs Docker
uv run ruff check . && uv run mypy app
```

## Safety

Four settings are permanently disabled and the application refuses to start if the
environment tries to enable them:

```
AUTO_SUBMIT_ENABLED  AUTO_SEND_EMAIL_ENABLED  CAPTCHA_BYPASS_ENABLED  LINKEDIN_AUTOMATION_ENABLED
```

These are not the whole guarantee, only the visible part of it. The application
state machine has no edge from any filling state to `SUBMITTED`; the Gmail
interface has no `send` method; and `app/services/resume.py` blocks a resume whose
bullets are not supported by cited facts. See [app/safety.py](app/safety.py) and
[tests/unit/test_states.py](tests/unit/test_states.py), which proves the
unreachability by graph search rather than by inspection.

## License and provenance

Private project. Third-party code provenance is recorded in `THIRD_PARTY.md`.
