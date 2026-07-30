"""Building a tailored resume, and giving up correctly (spec §7.7).

The requirement that shapes this module is not "tailor the resume" — it is "the
PDF that reaches the employer is one page and is true". Those are checkable, and
everything here is arranged so that a failure to meet either produces the user's
own base resume rather than something worse.

The ladder, at most three attempts:

1. **Tailored.** Apply the plan: drop the bullets that do not speak to this job,
   keep the rest as the user wrote them.
2. **Shortened.** Still two pages, so drop further, least relevant first, and
   never the last bullet under a heading — a job title with nothing under it
   looks broken rather than concise.
3. **Tightened.** Still two pages, so make the one bounded spacing change the
   template's own comment says is safe, in the direction it says is safe.

If all three come back at two pages, or fail to compile, the base resume is used
unchanged and the reason is recorded. That is not a failure mode to be minimised
away: a correct one-page resume the user wrote beats a tailored two-page one.

**Nothing here invents content.** Bullets are dropped or replaced with text a
model derived from verified facts and a deterministic validator has already
checked (:mod:`app.services.resume`). This module never writes a sentence.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import shutil
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from app.services.latex import CompileResult, compile_pdf
from app.services.resume_tex import Bullet, TexResume, parse, render

__all__ = [
    "MAX_ATTEMPTS",
    "Attempt",
    "BuildOutcome",
    "build",
    "droppable",
    "rank_by_relevance",
    "tighten_spacing",
]

log = logging.getLogger(__name__)

#: §7.7's ceiling. Each attempt is a full LaTeX build, and a fourth would cost
#: more than the base resume it would eventually fall back to.
MAX_ATTEMPTS = 3

#: Words too common to say anything about relevance. Kept short on purpose: this
#: only decides which true bullet to leave out when the page is full.
_STOPWORDS: frozenset[str] = frozenset(
    {
        "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has",
        "have", "in", "into", "is", "it", "its", "of", "on", "or", "that", "the",
        "to", "with", "will", "you", "your", "our", "we", "us", "they", "their",
        "this", "these", "those", "was", "were", "been", "but", "not", "can",
        "may", "must", "should", "would", "could", "about", "across", "after",
        "all", "also", "any",
    }
)  # fmt: skip

_WORD = re.compile(r"[a-z][a-z0-9+#.]{1,}")


@dataclass(frozen=True, slots=True)
class Attempt:
    """One build, whatever came of it. Recorded whether or not it was used."""

    number: int
    strategy: str
    tex: str
    result: CompileResult
    dropped: tuple[int, ...] = ()
    rewritten: tuple[int, ...] = ()
    spacing_changes: tuple[str, ...] = ()

    @property
    def ok(self) -> bool:
        return self.result.ok and self.result.pages == 1

    @property
    def tex_sha256(self) -> str:
        return hashlib.sha256(self.tex.encode("utf-8")).hexdigest()


@dataclass(slots=True)
class BuildOutcome:
    """What to upload, and everything that led to it."""

    attempts: list[Attempt] = field(default_factory=list)
    #: The attempt whose PDF should be uploaded. ``None`` means the base resume.
    chosen: Attempt | None = None
    fallback_reason: str = ""
    #: Absolute path of the PDF that will actually reach the employer.
    pdf_path: Path | None = None
    tex_path: Path | None = None

    @property
    def used_base(self) -> bool:
        return self.chosen is None

    @property
    def pages(self) -> int:
        return self.chosen.result.pages if self.chosen else 1


# ------------------------------------------------------------- relevance


def _tokens(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if w not in _STOPWORDS and len(w) > 2}


def rank_by_relevance(bullets: list[Bullet], job_text: str) -> list[tuple[Bullet, float]]:
    """Bullets scored by overlap with the job description, best first.

    Deliberately a word count rather than a model call. This decides only *which
    true sentence to leave out* when the page is full — a judgement that is
    cheap, explainable in the change manifest, and does not need to be right to
    be safe, because everything it keeps is equally true.
    """
    wanted = _tokens(job_text)
    scored = [
        (bullet, len(_tokens(bullet.plain) & wanted) / (len(wanted) or 1))
        for bullet in bullets
    ]
    return sorted(scored, key=lambda pair: -pair[1])


def droppable(document: TexResume, already: set[int]) -> list[int]:
    """Bullets that may still be dropped without emptying a list.

    Education is excluded outright: a degree is not "less relevant content", and
    a resume missing its coursework line reads as an omission rather than an
    edit.
    """
    survivors: dict[int, int] = {}
    for bullet in document.bullets:
        if bullet.index not in already:
            survivors[bullet.list_index] = survivors.get(bullet.list_index, 0) + 1

    return [
        bullet.index
        for bullet in document.bullets
        if bullet.index not in already
        and bullet.section.lower() != "education"
        and survivors.get(bullet.list_index, 0) > 1
    ]


# -------------------------------------------------------------- spacing


#: The one spacing change this module will make, and the exact bounds on it.
#: The template says, in its own comment, that leading is already at the ceiling
#: for a one-page fit and that raising it pushes to two pages. So the only safe
#: direction is down, and only in the list padding — never the font size, the
#: margins or the leading, which would change how the document looks rather than
#: how much fits.
#: Anchored to the specific ``\newcommand`` that defines each list, so a length
#: that happens to appear elsewhere in the document is never touched.
_SPACING_RULES: tuple[tuple[re.Pattern[str], str, str], ...] = (
    (
        re.compile(r"(\\newcommand\{\\resumeItemListStart\}.*?)topsep=5pt", re.S),
        r"\1topsep=2pt",
        "bullet list top padding 5pt to 2pt",
    ),
    (
        re.compile(r"(\\newcommand\{\\resumeSubHeadingListStart\}.*?)itemsep=3pt", re.S),
        r"\1itemsep=1pt",
        "entry spacing 3pt to 1pt",
    ),
)


def tighten_spacing(source: str) -> tuple[str, list[str]]:
    """Apply the bounded spacing reductions. Returns the source and what changed.

    Every rule is a named, reversible reduction of a specific length. There is no
    rule that changes a font, a margin, the leading or the page geometry, because
    those change what the resume looks like — and the user asked for their
    template preserved, not merely for one page.
    """
    changed: list[str] = []
    out = source
    for pattern, replacement, description in _SPACING_RULES:
        new, count = pattern.subn(replacement, out, count=1)
        if count:
            out = new
            changed.append(description)
    return out, changed


# ----------------------------------------------------------------- build


def build(
    base_tex: str,
    *,
    job_text: str,
    work_dir: Path,
    dropped: frozenset[int] = frozenset(),
    replacements: dict[int, str] | None = None,
    base_pdf: Path | None = None,
    max_attempts: int = MAX_ATTEMPTS,
) -> BuildOutcome:
    """Produce a one-page tailored PDF, or fall back to the base resume.

    Args:
        base_tex: the canonical LaTeX source. Never modified on disk.
        job_text: the posting, for relevance ranking when shortening.
        work_dir: where per-attempt artifacts are written.
        dropped: bullets the tailoring plan chose to leave out.
        replacements: bullet rewrites from the tailoring plan.
        base_pdf: the canonical PDF, used verbatim if every attempt fails.
    """
    document = parse(base_tex)
    outcome = BuildOutcome()

    if not document.bullets:
        outcome.fallback_reason = "the base resume has no editable bullets"
        _use_base(outcome, base_tex, base_pdf, work_dir)
        return outcome

    order = [b.index for b, _ in rank_by_relevance(document.bullets, job_text)]
    least_relevant = list(reversed(order))

    current_dropped = set(dropped)
    current_replacements = dict(replacements or {})
    spacing_changes: list[str] = []

    for number in range(1, max_attempts + 1):
        if number == 2:
            # Shorten: drop the least relevant droppable bullet.
            candidates = droppable(document, current_dropped)
            for index in least_relevant:
                if index in candidates:
                    current_dropped.add(index)
                    break
        elif number == 3:
            spacing_changes = []

        strategy = {1: "tailored", 2: "shortened", 3: "tightened"}[number]
        tex = render(
            document,
            dropped=frozenset(current_dropped),
            replacements=current_replacements,
        )
        if number == 3:
            tex, spacing_changes = tighten_spacing(tex)

        attempt_dir = work_dir / f"attempt-{number}"
        result = compile_pdf(tex, work_dir=attempt_dir, stem="resume")
        attempt = Attempt(
            number=number,
            strategy=strategy,
            tex=tex,
            result=result,
            dropped=tuple(sorted(current_dropped)),
            rewritten=tuple(sorted(current_replacements)),
            spacing_changes=tuple(spacing_changes),
        )
        outcome.attempts.append(attempt)

        if attempt.ok:
            outcome.chosen = attempt
            outcome.pdf_path = result.pdf_path
            outcome.tex_path = attempt_dir / "resume.tex"
            return outcome

        log.info(
            "resume attempt %d (%s) did not qualify: %s",
            number,
            strategy,
            result.error or f"{result.pages} pages",
        )

    last = outcome.attempts[-1]
    outcome.fallback_reason = (
        f"{len(outcome.attempts)} attempts did not produce a one-page PDF "
        f"({last.result.error or f'{last.result.pages} pages'})"
    )
    _use_base(outcome, base_tex, base_pdf, work_dir)
    return outcome


def _use_base(
    outcome: BuildOutcome, base_tex: str, base_pdf: Path | None, work_dir: Path
) -> None:
    """Copy the canonical resume into the application's directory.

    Copied rather than referenced, so the artifact folder holds the exact bytes
    that were uploaded even if the canonical file is later edited. The canonical
    files themselves are only ever read.
    """
    final = work_dir / "final"
    final.mkdir(parents=True, exist_ok=True)

    tex_path = final / "resume.tex"
    tex_path.write_text(base_tex, encoding="utf-8")
    outcome.tex_path = tex_path

    if base_pdf is not None and base_pdf.is_file():
        pdf_path = final / "resume.pdf"
        shutil.copy2(base_pdf, pdf_path)
        outcome.pdf_path = pdf_path
        return

    # No canonical PDF on disk: build one from the canonical source rather than
    # uploading nothing.
    result = compile_pdf(base_tex, work_dir=final, stem="resume")
    outcome.pdf_path = result.pdf_path
    if not result.ok:
        outcome.fallback_reason += "; the base resume also failed to compile"


def manifest_for(
    attempt: Attempt,
    *,
    document: TexResume,
    facts_used: list[str],
    model: str | None,
    prompt_version: str | None,
    now: datetime,
    pdf_sha256: str | None = None,
    fallback_reason: str = "",
    plan_note: str = "",
    rejections: tuple[str, ...] = (),
    drift: dict[str, float] | None = None,
) -> dict[str, object]:
    """The change manifest stored beside each attempt.

    Records what changed and why, never the prompt: the manifest sits in the
    artifact directory alongside the PDF, and a prompt carries the user's whole
    employment history (§23.5).
    """
    by_index = {b.index: b for b in document.bullets}
    return {
        "attempt": attempt.number,
        "strategy": attempt.strategy,
        "created_at": now.isoformat(),
        "compiled": attempt.result.ok,
        "engine": attempt.result.engine,
        "pages": attempt.result.pages,
        "one_page": attempt.ok,
        "error": attempt.result.error,
        "dropped": [
            {"index": i, "section": by_index[i].section, "text": by_index[i].plain}
            for i in attempt.dropped
            if i in by_index
        ],
        "rewritten": [
            {"index": i, "section": by_index[i].section, "was": by_index[i].plain}
            for i in attempt.rewritten
            if i in by_index
        ],
        "spacing_changes": list(attempt.spacing_changes),
        # Why the plan changed as much or as little as it did.
        "plan_note": plan_note,
        # Operations the plan asked for and did not get, with the reason. These are
        # the bullets that stayed as the user wrote them despite the model asking
        # for something else, which is the thing a reviewer most needs told.
        "rejected_operations": list(rejections),
        # How far each rewrite moved from the wording it replaced, 0 to 1.
        # it explains nothing about placement, which ids decide.
        "rewrite_overlap": dict(drift or {}),
        "facts_used": facts_used,
        "model": model,
        "prompt_version": prompt_version,
        "tex_sha256": attempt.tex_sha256,
        "pdf_sha256": pdf_sha256,
        "fallback_reason": fallback_reason,
    }


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_manifest(path: Path, manifest: dict[str, object]) -> None:
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
