"""One-shot, out-of-band validation of the ATS adapters (spec §5.6, §28).

Everything in here runs **beside** the pipeline, never through it. No task is
queued, no ``Application`` row is created, no daily quota is touched, and
``PIPELINE_ENABLED`` is neither read nor changed. That is not politeness — it is
what makes this safe to run against real employers' job boards on a paused
instance, and it is enforced structurally: nothing in this package imports the
queue or the application state machine.

Two stages, deliberately separate:

**Stage 1** fetches the live feeds and checks what came back — canonical URLs,
timestamps, titles, locations, descriptions, and whether deduplication is stable
across two fetches. It reads and nothing else, so it can be run freely.

**Stage 2** opens exactly one real application form per ATS in a browser, maps
its fields, fills the safe ones, attaches the resume, and stops. It touches an
employer's system, so it asks for confirmation first and refuses to run without
it.
"""

from __future__ import annotations

from app.services.validation.report import (
    AdapterReport,
    Finding,
    Severity,
    StageOneReport,
)
from app.services.validation.stage_one import validate_feeds

__all__ = [
    "AdapterReport",
    "Finding",
    "Severity",
    "StageOneReport",
    "validate_feeds",
]
