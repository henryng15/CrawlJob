# InternshipOps

Private, single-user system that **prepares** U.S. SWE internship applications and
recruiter outreach — and stops before every irreversible action.

The system discovers roles, deduplicates them, checks sponsorship language against
your locked profile facts, tailors a resume, fills the employer's application form
in a cloud browser, and then **stops before Submit**. You review and submit. Two
business days later it prepares a recruiter email as a **Gmail draft**. You send it.

It automates repetition — never judgment, legal truth, or irreversible actions.

## Status

Early build. See [docs/spec/30-implementation-milestones.md](docs/spec/30-implementation-milestones.md)
for the milestone plan and what is done.

## Documentation

| | |
|---|---|
| [AGENTS.md](AGENTS.md) | Rules for anyone (human or agent) writing code here. Read first. |
| [docs/spec/](docs/spec/README.md) | Full specification, one file per section. |
| [docs/spec/README.md](docs/spec/README.md#known-defects-in-this-spec) | Known defects in the spec — fix before implementing the affected section. |

## Development

Requires Python 3.12+, [uv](https://docs.astral.sh/uv/), and Docker.

```bash
uv sync --group dev              # install dependencies
uv run pytest -q                 # unit tests (no services needed)
uv run ruff format . && uv run ruff check .
uv run mypy app
```

Tests marked `db`, `browser`, or `network` need live services and are excluded by
default in the fast loop:

```bash
uv run pytest -q -m "not db and not browser and not network"
```

## Safety

Four settings are permanently disabled and the application refuses to start if the
environment tries to enable them:

```
AUTO_SUBMIT_ENABLED  AUTO_SEND_EMAIL_ENABLED  CAPTCHA_BYPASS_ENABLED  LINKEDIN_AUTOMATION_ENABLED
```

The Gmail client exposes no send method at all. See [app/safety.py](app/safety.py).

## License and provenance

Private project. Third-party code provenance is recorded in `THIRD_PARTY.md`.
