"""Turn the user's resume into a facts registry (spec §7.7, §18.6).

Tailoring can only rearrange things that are already true, so it needs the truth
in a form it can cite: a set of atomic, identified facts. This module gets from
"a PDF the user has" to that set.

The one rule that shapes everything here: **an imported fact is not a verified
fact.** Extraction is done by a model reading a PDF, and a model reading a PDF
gets things wrong — a date, a percentage, which employer a project belonged to.
Every fact lands unverified, tailoring refuses to run until the user has confirmed
them, and the Settings screen is where that happens. Skipping that step would mean
a resume whose provenance chain is checked rigorously against facts nobody read.
"""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import ResumeVersion
from app.services.candidate import Actor, FactValue, list_facts, set_fact
from app.services.llm.base import LLMProvider, Message, Task
from app.services.resume import ResumeFact

__all__ = [
    "FACT_PREFIX",
    "ExtractedFacts",
    "extract_text",
    "import_resume",
    "load_facts",
    "store_facts",
    "unverified",
]

log = logging.getLogger(__name__)

#: Candidate-fact key prefix for resume facts. Not in ALWAYS_LOCKED_PREFIXES: a
#: resume bullet is the user's own account of their work, editable by them, and
#: unlike a graduation date it is not a statement a form will hold them to.
FACT_PREFIX = "resume.fact."

PROMPT_VERSION = "resume-import/v1"

SUPPORTED = (".pdf", ".docx", ".md", ".txt")


class ExtractedFact(BaseModel):
    """One statement pulled out of the resume."""

    id: str = Field(min_length=2, max_length=64)
    text: str = Field(min_length=8)
    organisation: str | None = None
    technologies: list[str] = Field(default_factory=list)
    kind: str = "experience"


class ExtractedFacts(BaseModel):
    facts: list[ExtractedFact] = Field(default_factory=list)


_SYSTEM = """\
You convert a resume into atomic facts that a later step will cite.

Rules:
- Copy what the resume says. Never add, round, or infer a number.
- One achievement per fact. Split a bullet that makes two claims.
- id: short, stable, dotted, e.g. "exp.acme.1" or "proj.ledger".
- organisation: the employer, school or project the fact belongs to, verbatim.
- technologies: only tools the resume itself names for that fact.
- kind: experience | project | education | skill.
- If the text is unreadable or empty, return no facts. Do not invent a resume.
"""


# ------------------------------------------------------------- extraction


def extract_text(path: Path) -> str:
    """Read a resume into plain text.

    PDF and DOCX readers are imported lazily: a user whose resume is Markdown
    should not have to install either.
    """
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED:
        raise ValueError(f"{path.name}: expected one of {', '.join(SUPPORTED)}")

    if suffix in {".md", ".txt"}:
        return path.read_text(encoding="utf-8")

    if suffix == ".docx":
        from docx import Document

        return "\n".join(p.text for p in Document(str(path)).paragraphs)

    from pypdf import PdfReader

    pages = [page.extract_text() or "" for page in PdfReader(str(path)).pages]
    text = "\n".join(pages)
    if not text.strip():
        # A scanned resume is an image. Saying so beats extracting zero facts and
        # letting the user wonder why their resume "did not work".
        raise ValueError(
            f"{path.name} has no extractable text. If it is a scan, export a "
            "text PDF from the original document, or supply Markdown."
        )
    return text


def propose_facts(text: str, *, provider: LLMProvider) -> ExtractedFacts:
    """Ask the model to structure the resume. Nothing here is trusted yet."""
    response = provider.structured_generate(
        task=Task.RESUME_PLAN,
        schema=ExtractedFacts,
        messages=[Message(role="system", content=_SYSTEM), Message(role="user", content=text)],
        max_tokens=4096,
    )
    return response.value


def parse_facts_file(path: Path) -> ExtractedFacts:
    """Read a facts file the user wrote by hand.

    Offered because it skips extraction entirely: a user who writes this file has
    verified it by construction, which is strictly better than checking a model's
    reading of a PDF.
    """
    raw = json.loads(path.read_text(encoding="utf-8"))
    return ExtractedFacts.model_validate(
        raw if isinstance(raw, dict) and "facts" in raw else {"facts": raw}
    )


# --------------------------------------------------------------- registry


def store_facts(session: Session, extracted: ExtractedFacts, *, actor: Actor) -> int:
    """Write facts into the candidate registry. Returns how many were written.

    Stored unverified unless the user is the actor: :func:`load_facts` refuses
    unverified facts, which is what stops a model's misreading from reaching a
    real application.
    """
    for fact in extracted.facts:
        set_fact(
            session,
            f"{FACT_PREFIX}{fact.id}",
            {
                "text": fact.text,
                "organisation": fact.organisation,
                "technologies": sorted({t.lower() for t in fact.technologies}),
                "kind": fact.kind,
            },
            actor=actor,
            verified=actor is Actor.USER,
        )
    return len(extracted.facts)


def _to_fact(stored: FactValue) -> ResumeFact | None:
    value = stored.value
    if not isinstance(value, dict) or not value.get("text"):
        return None
    return ResumeFact(
        id=stored.key.removeprefix(FACT_PREFIX),
        text=str(value["text"]),
        organisation=value.get("organisation"),
        technologies=frozenset(str(t).lower() for t in value.get("technologies", [])),
        kind=str(value.get("kind", "experience")),
    )


def load_facts(session: Session, *, require_verified: bool = True) -> dict[str, ResumeFact]:
    """The facts tailoring may cite.

    Unverified facts are excluded by default. A tailored resume is a document the
    user signs their name to; every line in it must trace to something they read
    and confirmed.
    """
    found: dict[str, ResumeFact] = {}
    for stored in list_facts(session, prefix=FACT_PREFIX):
        if require_verified and not stored.is_verified:
            continue
        fact = _to_fact(stored)
        if fact is not None:
            found[fact.id] = fact
    return found


def unverified(session: Session) -> list[str]:
    """Fact ids still awaiting the user's confirmation."""
    return [
        stored.key.removeprefix(FACT_PREFIX)
        for stored in list_facts(session, prefix=FACT_PREFIX)
        if not stored.is_verified
    ]


# ----------------------------------------------------------------- import


@dataclass(frozen=True, slots=True)
class ImportResult:
    resume: ResumeVersion
    facts_found: int
    needs_verification: list[str]

    def summary(self) -> str:
        if self.needs_verification:
            return (
                f"{self.facts_found} fact(s) extracted. Confirm them in Settings "
                f"before tailoring runs — {len(self.needs_verification)} unverified."
            )
        return f"{self.facts_found} verified fact(s) stored."


def import_resume(
    session: Session,
    path: Path,
    *,
    settings: Settings,
    provider: LLMProvider | None = None,
    facts_file: Path | None = None,
) -> ImportResult:
    """Store the base resume and derive its facts.

    Args:
        path: the resume itself. Kept verbatim as the BASE artifact, because a
            tailored resume is only auditable against the document it came from.
        facts_file: a hand-written facts file. When given, the model is not used
            and the facts are stored verified.
    """
    text = extract_text(path)

    artifacts = settings.artifacts_dir / "resume"
    artifacts.mkdir(parents=True, exist_ok=True)
    stored_path = artifacts / f"base{path.suffix.lower()}"
    shutil.copy2(path, stored_path)
    (artifacts / "base.txt").write_text(text, encoding="utf-8")

    resume = ResumeVersion(
        kind="BASE",
        status="APPROVED",  # the user's own document; nothing was generated
        source_path=str(stored_path),
        pdf_path=str(stored_path),
        sha256=hashlib.sha256(stored_path.read_bytes()).hexdigest(),
        prompt_version=PROMPT_VERSION,
    )
    session.add(resume)
    session.flush()

    if facts_file is not None:
        extracted = parse_facts_file(facts_file)
        actor = Actor.USER
    elif provider is not None:
        extracted = propose_facts(text, provider=provider)
        actor = Actor.IMPORT
    else:
        extracted = ExtractedFacts()
        actor = Actor.IMPORT

    count = store_facts(session, extracted, actor=actor)
    return ImportResult(
        resume=resume, facts_found=count, needs_verification=unverified(session)
    )


