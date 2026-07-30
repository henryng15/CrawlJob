"""Resume tailoring, from a model's plan to the PDF that gets uploaded (§7.7, §26.2).

The synchronous path in :func:`app.services.resume.tailor` stays for the single
application an operator re-runs by hand; the batch path tailors thirty overnight
at half price, which is what makes the monthly cap workable.

The two must produce identical artifacts, so everything after the model —
validation, the LaTeX build, the files, the ``ResumeVersion`` rows — is written
once in :func:`apply_plan` and called by both. A batch that wrote a subtly
different resume from the synchronous path would be a very hard bug to see.

:func:`apply_plan` is the **only** way an application gets a resume. It goes
through the LaTeX builder against the user's own ``.tex``; there is no other
renderer, so there is no path by which a document that is not their template can
reach an employer.

**No prompt or plan is ever logged.** They contain the user's employment history.
Failures are recorded as the ``custom_id`` and a reason.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import Application, Job, ResumeVersion
from app.services.llm.base import Message
from app.services.llm.batch import BatchRequest
from app.services.resume import (
    PROMPT_VERSION,
    ResumeFact,
    TailoringPlan,
    ValidationResult,
    bullet_inventory,
    validate_plan,
)
from app.services.resume_build import BuildOutcome

__all__ = [
    "BaseResume",
    "TailoringOutput",
    "apply_plan",
    "base_resume_source",
    "batch_request_for",
    "shared_system_blocks",
]

log = logging.getLogger(__name__)

#: Roughly four characters per token. Only used for the pre-flight cost
#: estimate, which is deliberately pessimistic — see ``estimate_cost``.
_CHARS_PER_TOKEN = 4


@dataclass(frozen=True, slots=True)
class TailoringOutput:
    """What finalising a plan produced."""

    version: ResumeVersion | None
    validation: ValidationResult
    #: Set when the plan was refused. §7.7: an unsupported claim blocks rather
    #: than degrading into a weaker bullet.
    blocked_reason: str | None = None
    #: The LaTeX build behind it, when one ran. ``None`` when an existing resume
    #: was reused or the plan never reached the compiler.
    outcome: BuildOutcome | None = None

    @property
    def ok(self) -> bool:
        return self.version is not None

    def detail(self) -> str:
        """One line for the task log. Never contains resume text."""
        if self.blocked_reason:
            return self.blocked_reason
        if self.outcome is None:
            return "resume already prepared"
        if self.outcome.used_base:
            return f"base resume used: {self.outcome.fallback_reason}"
        chosen = self.outcome.chosen
        assert chosen is not None  # used_base is False
        return (
            f"one page on attempt {chosen.number} ({chosen.strategy}), "
            f"{len(self.outcome.attempts)} build(s)"
        )


def shared_system_blocks(system_prompt: str) -> list[dict[str, Any]]:
    """The system prompt as cacheable content blocks.

    Every request in a tailoring batch shares this text, so marking it
    ``ephemeral`` lets the provider bill the repeats at the cache rate. It is
    **best-effort and nothing depends on it** (§26.2): a miss costs the full rate
    and the batch still succeeds. The cost check before submitting assumes no
    cache at all, so a bad hit rate cannot push the month past its cap.
    """
    return [
        {
            "type": "text",
            "text": system_prompt,
            "cache_control": {"type": "ephemeral"},
        }
    ]


def _prompt_body(
    job: Job, facts: dict[str, ResumeFact], bullets: list[dict[str, str]]
) -> str:
    """The user half of the tailoring prompt.

    Written once and shared, because the batch path and the synchronous path have
    to ask the same question. The bullet inventory comes first: it is what the
    model's answer must be addressed to, and a model that never sees the ids can
    only return operations that get refused.
    """
    corpus = "\n".join(f"[{fact.id}] {fact.text}" for fact in facts.values())
    return (
        f"RESUME BULLETS\n{bullet_inventory(bullets)}\n\n"
        f"CANDIDATE FACTS\n{corpus}\n\n"
        f"JOB TITLE\n{job.title}\n\nJOB DESCRIPTION\n{job.description_text or ''}"
    )


def batch_request_for(
    application: Application,
    job: Job,
    facts: dict[str, ResumeFact],
    *,
    bullets: list[dict[str, str]] | None = None,
    max_tokens: int = 4096,
) -> BatchRequest:
    """One request in a tailoring batch.

    ``custom_id`` is the application id, and that is the only link between a
    result and the application it belongs to. It must be the application's own
    id rather than a positional label, because the results come back in whatever
    order they finished.
    """
    content = _prompt_body(job, facts, bullets or [])
    return BatchRequest(
        custom_id=str(application.id),
        messages=[{"role": "user", "content": content}],
        max_tokens=max_tokens,
        estimated_input_tokens=len(content) // _CHARS_PER_TOKEN,
    )


def user_messages(
    job: Job, facts: dict[str, ResumeFact], bullets: list[dict[str, str]] | None = None
) -> list[Message]:
    """The same prompt as a message list, for the synchronous path."""
    return [Message(role="user", content=_prompt_body(job, facts, bullets or []))]


@dataclass(frozen=True, slots=True)
class BaseResume:
    """The canonical resume as read at one moment, and its fingerprint."""

    tex: str
    pdf: Path | None
    #: SHA-256 of the ``.tex`` bytes. What a plan is pinned to.
    sha256: str

    def inventory(self) -> list[dict[str, str]]:
        from app.services.resume_tex import parse

        return parse(self.tex).inventory()


def base_resume_source(settings: Settings) -> BaseResume | None:
    """The canonical ``.tex`` and PDF, read only. ``None`` if not configured.

    Read fresh on every call rather than cached, so editing the canonical resume
    changes what the next application is tailored from without a restart — and
    hashed on the way through, so a plan made against an older reading can be
    told apart from one made against this. Neither file is ever opened for
    writing anywhere in this system.
    """
    tex = settings.base_resume_tex
    if tex is None or not tex.is_file():
        return None
    raw = tex.read_bytes()
    pdf = settings.base_resume_pdf
    return BaseResume(
        tex=raw.decode("utf-8"),
        pdf=pdf if pdf and pdf.is_file() else None,
        sha256=hashlib.sha256(raw).hexdigest(),
    )


def apply_plan(
    session: Session,
    settings: Settings,
    *,
    application: Application,
    job: Job,
    plan: TailoringPlan,
    facts: dict[str, ResumeFact],
    now: datetime,
    model: str | None = None,
    pinned_sha256: str | None = None,
) -> TailoringOutput:
    """Validate a plan, build the PDF from the user's LaTeX, and record it all.

    The whole production path in one function, on purpose: the plan is checked
    for provenance, mapped onto the base resume's own bullets, built through the
    three-attempt ladder, and every attempt is written to disk and to the
    database. What comes back is the row whose PDF will be uploaded.

    Args:
        pinned_sha256: the base resume the plan's bullet ids were generated
            against. Required for anything that was not planned in this same call:
            a plan is only meaningful relative to one version of the resume, and
            applying it to a different one splices text into whatever now occupies
            those positions. Falls back to the application's own pin.

    Idempotent: an application that already has a selected resume is left exactly
    as it is. A batch result applied twice — because retrieval was retried, or the
    worker died after the API call — must not produce a second PDF, a second row,
    or a rewritten history of attempts.
    """
    from app.services.resume_artifacts import record_build, resume_dir, selected_version
    from app.services.resume_build import build
    from app.services.resume_edits import plan_edits
    from app.services.resume_tex import parse

    existing = selected_version(session, application.id)
    if existing is not None:
        return TailoringOutput(version=existing, validation=ValidationResult())

    result = validate_plan(plan, facts)

    directory = settings.artifacts_dir / str(application.id)
    directory.mkdir(parents=True, exist_ok=True)
    validation_path = directory / "resume-validation.json"
    # Written whether or not validation passed: the review screen shows the
    # violations, and a user cannot judge "it was rejected" without seeing why.
    validation_path.write_text(
        json.dumps(
            {
                "validation": {"passed": result.passed, "summary": result.summary()},
                "bullets": [b.model_dump(mode="json") for b in plan.bullets],
                "violations": [
                    {"kind": v.kind.value, "detail": v.detail} for v in result.violations
                ],
                "tailored_text": "\n".join(b.text for b in plan.bullets),
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    if not result.passed:
        return TailoringOutput(
            version=None,
            validation=result,
            blocked_reason=(
                f"tailoring produced unsupported claims and was blocked: {result.summary()}"
            ),
        )

    source = base_resume_source(settings)
    if source is None:
        return TailoringOutput(
            version=None,
            validation=result,
            blocked_reason=(
                "the base resume is not available "
                f"(BASE_RESUME_TEX={settings.base_resume_tex}); nothing was tailored"
            ),
        )

    # The pin. A plan's bullet ids address one version of one file, so a plan and
    # a resume that disagree is not something to reconcile — the plan is thrown
    # away and the application is tailored again against what the resume now says.
    pin = pinned_sha256 or application.base_tex_sha256
    if pin and pin != source.sha256:
        return TailoringOutput(
            version=None,
            validation=result,
            blocked_reason=(
                "the base resume changed after this plan was made "
                f"(planned against {pin[:12]}, now {source.sha256[:12]}); "
                "re-run tailoring for this application"
            ),
        )
    application.base_tex_sha256 = source.sha256

    base_tex, base_pdf = source.tex, source.pdf
    document = parse(base_tex)
    # Operations are resolved by bullet id, so where a rewrite lands is the
    # model's stated choice rather than a guess. ``allowed_bullets`` is the second
    # gate: only wording that passed provenance validation may be spliced, and a
    # rejected bullet is not a weaker bullet to be used carefully — it is a claim
    # nothing supports.
    edits = plan_edits(
        document,
        plan,
        facts=facts,
        allowed_bullets={b.text.strip() for b in result.validated},
    )
    if edits.rejections:
        # Worth a log line: a plan whose operations keep being refused means the
        # model and the resume have drifted apart, and no bullet ids or resume
        # text appear here.
        log.info(
            "application %s: %d tailoring operation(s) refused (%s)",
            application.id,
            len(edits.rejections),
            ", ".join(sorted({r.kind.value for r in edits.rejections})),
        )

    outcome = build(
        base_tex,
        job_text=f"{job.title}\n{job.description_text or ''}",
        work_dir=resume_dir(settings, application.id),
        dropped=edits.dropped,
        replacements=edits.replacements,
        base_pdf=base_pdf,
        max_attempts=settings.resume_max_attempts,
    )

    version = record_build(
        session,
        settings,
        application=application,
        document=document,
        outcome=outcome,
        facts_used=sorted({fid for b in result.validated for fid in b.fact_ids}),
        model=model,
        prompt_version=PROMPT_VERSION,
        now=now,
        validation_path=validation_path,
        edits=edits,
    )
    if version is None:  # pragma: no cover - build always yields one or the other
        return TailoringOutput(
            version=None,
            validation=result,
            outcome=outcome,
            blocked_reason="the resume build produced nothing to upload",
        )

    application.updated_at = now
    return TailoringOutput(version=version, validation=result, outcome=outcome)
