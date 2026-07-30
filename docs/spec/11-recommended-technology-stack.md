# 11. Recommended Technology Stack

## 11.1 Backend and UI

```text
Python 3.12
FastAPI
Pydantic v2
SQLAlchemy 2
Alembic
Jinja2
HTMX
Alpine.js
Tailwind CSS
```

Rationale:

- one-language backend;
- low RAM;
- fast development;
- server-rendered pages are sufficient for a private dashboard;
- HTMX supports live status without a separate SPA;
- easier for Claude Code to maintain than a split Next.js/FastAPI architecture.

## 11.2 Database

```text
PostgreSQL 16
```

Use PostgreSQL instead of SQLite because:

- multiple workers;
- durable task locking;
- JSONB;
- partial unique indexes;
- `FOR UPDATE SKIP LOCKED`;
- better recovery and backup tooling.

## 11.3 Durable task queue

Do not add Redis or Celery in MVP.

Use PostgreSQL tables:

- `scheduled_tasks`;
- `task_runs`;
- `task_locks`.

Worker pattern:

```sql
SELECT id
FROM scheduled_tasks
WHERE status = 'PENDING'
  AND run_at <= NOW()
ORDER BY priority DESC, run_at ASC
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

Then atomically mark the task `RUNNING`.

This is sufficient for:

- one VM;
- two workers;
- low volume;
- delayed outreach;
- retry;
- auditability.

## 11.4 Browser

```text
Playwright
Chromium
Xvfb
Openbox or Fluxbox
x11vnc
noVNC
websockify
```

### ARM64 compatibility requirement

OCI Ampere A1 is ARM-based.

Before building the full system, Claude must complete an architecture spike that proves:

1. Chromium launches on the selected Ubuntu ARM64 image.
2. Playwright connects and fills a local fixture form.
3. Xvfb renders Chromium.
4. x11vnc exposes the display.
5. noVNC is reachable through Caddy and Tailscale.
6. file upload works.
7. PDF download works.
8. two slots can run without memory failure.

Do not assume an upstream Docker image is multi-architecture. Prefer a custom Docker image based on a Debian/Ubuntu ARM64 base and install browser dependencies explicitly. If Playwright-managed Chromium is unavailable for the selected combination, use the distribution Chromium binary through Playwright's `executable_path`, after validating compatibility.

## 11.5 PDF resume rendering

> **Superseded by [ADR 0001](../adr/0001-latex-resume-rendering.md).** The
> production path is the user's own LaTeX source compiled with `pdflatex`, not an
> HTML template. WeasyPrint was implemented, then removed: rendering extracted
> facts through a generic template produces a correct document that is not the
> user's resume, which contradicts §7.7's requirement to preserve their template,
> layout, fonts, section order and spacing. Every requirement listed below is
> still met — see the ADR for the point-by-point mapping. Do not reintroduce an
> HTML renderer for application tailoring.

Originally recommended:

```text
Structured YAML/JSON facts
Jinja2 HTML template
WeasyPrint PDF rendering
```

Requirements:

- selectable text;
- embedded standard fonts;
- ATS-readable single-column layout;
- no image-only PDF;
- stable page count;
- deterministic rendering.

Keep the user’s original PDF as the base artifact even if the structured template is reconstructed.

## 11.6 AI provider

Create a provider interface:

```python
class LLMProvider(Protocol):
    async def structured_generate(
        self,
        task: str,
        schema: type[BaseModel],
        messages: list[Message],
        *,
        model: str,
        max_tokens: int,
    ) -> BaseModel: ...
```

Default task routing:

| Task | Default model class |
|---|---|
| JD extraction | deterministic parser first; Haiku fallback |
| Sponsorship classification | Haiku |
| Job scoring | Haiku |
| Resume tailoring plan | Sonnet |
| Form free-text draft | Haiku or Sonnet depending complexity |
| Email hook | Haiku |
| Email body | Haiku |
| Validation | deterministic + separate Haiku check |

Do not run Claude Code as the production automation engine. Claude Code is used to build the software; the runtime uses APIs and deterministic code.

---
