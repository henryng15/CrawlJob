"""Applying a tailoring plan to the base resume, by id (spec §7.7).

A plan names the bullet it wants changed. This module resolves that id, checks
the operation is allowed, and splices. **Nothing here decides where content
goes** — the id does, and an id that does not resolve to exactly one bullet is
refused rather than interpreted.

That is the whole point of the design. The previous version matched the model's
wording against the resume's wording and rewrote whichever bullet scored highest.
It worked until two entries described similar work, and then it silently attached
one employer's achievement to another — output that is true sentence by sentence,
compiles, fits on one page, and misrepresents the candidate's history. No amount
of threshold tuning fixes that, because the resemblance is real.

Four ways an operation is refused. Each leaves the bullet exactly as the user
wrote it, which is always a safe outcome:

**Unknown id.** No such bullet. The model may be working from a stale inventory,
or inventing.

**Duplicate id.** Two operations for one bullet. Which one was meant is not
knowable, so neither is applied.

**Cross-section.** The operation echoes a section or entry that disagrees with
the bullet the id resolves to. Two things must be wrong for this to fire, which
is exactly why it is worth checking.

**Provenance mismatch.** The rewrite cites a fact belonging to a different
employer or project than the bullet it would replace. This is the check that
catches the failure the id scheme exists to prevent, in the one case ids cannot:
a model that picks the wrong id *and* describes the work of whoever the facts
actually belong to.

**Unscoped claim.** The rewrite asserts something the bullet it replaces did not
— a figure, a technology, a name — and no cited fact *belonging to this entry*
supports it. An unattributed fact cannot say which entry it belongs to, so it
cannot be the authority for adding a claim to one; a fact recorded without an
organisation is exactly the fact whose organisation nobody checked. It may still
support rewording, because rewording asserts nothing new.

This is checked **per claim**, and the coarser version had a hole worth naming:
*piggybacking*. When the rule asked only "did any cited fact name this employer",
a plan could cite one properly scoped fact next to an unscoped one and carry in a
metric that nothing attributed to this employer supported. A scoped fact
establishes what that fact says and no more, so each new claim is matched against
the facts scoped here, one at a time. The same applies across employers: citing a
Todd fact and an IpserLabs fact on a Todd bullet does not let the IpserLabs figure
through.

It is still narrower than refusing unscoped facts outright, which would make every
resume imported before organisations were recorded untailorable.

Everything spliced in is escaped first. Plan text is prose — a stray ``%`` would
comment out the rest of the line and silently delete the end of a bullet, and
``&`` or ``_`` would fail the compile outright.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum

from app.services.resume import (
    Action,
    BulletOp,
    Claims,
    ResumeFact,
    TailoringPlan,
    claims_in,
)
from app.services.resume_build import droppable
from app.services.resume_tex import Bullet, TexResume, slug

__all__ = [
    "Edits",
    "Rejection",
    "RejectionKind",
    "latex_escape",
    "plan_edits",
    "similarity",
]


class RejectionKind(StrEnum):
    UNKNOWN_ID = "UNKNOWN_ID"
    DUPLICATE_ID = "DUPLICATE_ID"
    CROSS_SECTION = "CROSS_SECTION"
    PROVENANCE_MISMATCH = "PROVENANCE_MISMATCH"
    #: Cites only facts that name no employer or project, and adds a claim.
    UNSCOPED_CLAIM = "UNSCOPED_CLAIM"
    EMPTY_REWRITE = "EMPTY_REWRITE"
    NOT_DROPPABLE = "NOT_DROPPABLE"


@dataclass(frozen=True, slots=True)
class Rejection:
    """One operation that was refused, and why. Recorded in the manifest."""

    kind: RejectionKind
    bullet_id: str
    detail: str

    def __str__(self) -> str:
        return f"{self.kind.value} {self.bullet_id}: {self.detail}"


#: LaTeX's ten special characters. Order matters: the backslash is replaced
#: first, or the replacements' own backslashes would be escaped again.
_ESCAPES: tuple[tuple[str, str], ...] = (
    ("\\", r"\textbackslash{}"),
    ("{", r"\{"),
    ("}", r"\}"),
    ("$", r"\$"),
    ("&", r"\&"),
    ("#", r"\#"),
    ("_", r"\_"),
    ("%", r"\%"),
    ("^", r"\^{}"),
    ("~", r"\~{}"),
)

_WHITESPACE = re.compile(r"\s+")


def latex_escape(text: str) -> str:
    """Make prose safe to splice into a LaTeX document.

    The dangerous one is ``%``. It does not fail the compile — it comments out
    the rest of the line, so "reduced latency 40%" would produce a bullet that
    ends mid-sentence and a PDF that looks deliberate.
    """
    out = _WHITESPACE.sub(" ", text).strip()
    for char, replacement in _ESCAPES:
        out = out.replace(char, replacement)
    return out


# ------------------------------------------------------------- diagnostics

#: Words too common to say anything about whether two sentences are related.
_STOPWORDS: frozenset[str] = frozenset(
    {
        "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has",
        "have", "in", "into", "is", "it", "its", "of", "on", "or", "that", "the",
        "to", "with", "using", "used", "use", "via", "across", "over", "per",
        "this", "these", "those", "was", "were", "been", "but", "not", "also",
    }
)  # fmt: skip

_WORD = re.compile(r"[a-z][a-z0-9+#.]*")


def _tokens(text: str) -> frozenset[str]:
    return frozenset(
        word for word in _WORD.findall(text.lower()) if word not in _STOPWORDS and len(word) > 2
    )


def similarity(left: str, right: str) -> float:
    """Jaccard overlap of the content words in two sentences.

    **Diagnostic only.** It is recorded beside each rewrite in the change
    manifest, so a reviewer can see at a glance which lines moved a long way from
    what they replaced. It has no say in *which* bullet a rewrite is applied to —
    that was its job once, and doing that job is what let similar wording from two
    different employers be interchanged.
    """
    a, b = _tokens(left), _tokens(right)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


# ----------------------------------------------------------------- applying


@dataclass(frozen=True, slots=True)
class Edits:
    """What the plan asks to be done to the base resume."""

    #: Base bullet indices to remove entirely.
    dropped: frozenset[int] = frozenset()
    #: New body text, already LaTeX-escaped, keyed by base bullet index.
    replacements: dict[int, str] = field(default_factory=dict)
    #: Bullet id → base bullet index, for every operation that was applied.
    applied: dict[str, int] = field(default_factory=dict)
    #: Operations that were refused. Every one leaves its bullet as written.
    rejections: tuple[Rejection, ...] = ()
    #: Bullet id → overlap with the wording it replaced. Diagnostic.
    drift: dict[str, float] = field(default_factory=dict)
    #: Shown in the manifest when something is worth explaining.
    note: str = ""

    @property
    def rejected_ids(self) -> tuple[str, ...]:
        return tuple(r.bullet_id for r in self.rejections)


def _normalized(name: str) -> str:
    return slug(name)


def _organisations_of(
    fact_ids: list[str], facts: dict[str, ResumeFact]
) -> dict[str, str]:
    """The employers or projects the cited facts belong to, slug → written name.

    Compared as slugs so "IpserLabs" and "Ipser Labs" are one employer; reported
    with the name the user actually wrote, because the rejection is something a
    person reads.

    Facts with no organisation are excluded rather than treated as a mismatch: an
    unattributed fact contradicts nothing, and rejecting on its account would
    make rewriting impossible for any resume imported before organisations were
    being recorded.
    """
    found: dict[str, str] = {}
    for fid in fact_ids:
        fact = facts.get(fid)
        if fact is None or not fact.organisation:
            continue
        key = _normalized(fact.organisation)
        if key:
            found[key] = fact.organisation
    return found


def _scoped_to(
    fact_ids: list[str], facts: dict[str, ResumeFact], entry: str
) -> list[ResumeFact]:
    """The cited facts that belong to this bullet's employer or project."""
    return [
        facts[fid]
        for fid in fact_ids
        if fid in facts
        and facts[fid].organisation
        and _normalized(facts[fid].organisation or "") == entry
    ]


def _supported_by(sources: list[ResumeFact]) -> Claims:
    """Everything a set of facts asserts: figures, technologies, names.

    A fact's ``technologies`` list counts alongside its prose, because that is
    where the import step puts a tool the sentence names only in passing. Its
    ``organisation`` counts too — a bullet naming the employer it already sits
    under is not making a new claim about anyone.
    """
    numbers: set[str] = set()
    technologies: set[str] = set()
    organisations: set[str] = set()
    for fact in sources:
        stated = claims_in(fact.text)
        numbers |= set(stated.numbers)
        technologies |= set(stated.technologies) | {t.lower() for t in fact.technologies}
        organisations |= set(stated.organisations)
        if fact.organisation:
            organisations |= {word.lower() for word in fact.organisation.split()}
            organisations.add(fact.organisation.lower())
    return Claims(
        numbers=frozenset(numbers),
        technologies=frozenset(technologies),
        organisations=frozenset(organisations),
    )


def plan_edits(
    document: TexResume,
    plan: TailoringPlan,
    *,
    facts: dict[str, ResumeFact] | None = None,
    allowed_bullets: set[str] | None = None,
) -> Edits:
    """Resolve a plan's operations against the resume's own bullets.

    Args:
        document: the parsed canonical resume.
        plan: the model's proposal, addressed by bullet id.
        facts: candidate facts, for the provenance check. Without them a rewrite's
            attribution cannot be verified, so rewrites are refused.
        allowed_bullets: rewrite texts that passed provenance validation. A
            rewrite whose text is not among them is not applied — §7.7 blocks an
            unsupported claim rather than using it carefully.
    """
    facts = facts or {}
    by_id = document.by_id()
    rejections: list[Rejection] = []

    #: Duplicates are found before anything is applied, so the first of two
    #: operations cannot win by arriving first.
    counts: dict[str, int] = {}
    for op in plan.operations:
        counts[op.bullet_id] = counts.get(op.bullet_id, 0) + 1

    replacements: dict[int, str] = {}
    drift: dict[str, float] = {}
    applied: dict[str, int] = {}
    wanted_drops: list[str] = []

    for op in plan.operations:
        bullet = by_id.get(op.bullet_id)

        if bullet is None:
            rejections.append(
                Rejection(
                    RejectionKind.UNKNOWN_ID,
                    op.bullet_id,
                    "no bullet in the base resume has this id",
                )
            )
            continue

        if counts[op.bullet_id] > 1:
            rejections.append(
                Rejection(
                    RejectionKind.DUPLICATE_ID,
                    op.bullet_id,
                    f"{counts[op.bullet_id]} operations name this bullet; "
                    "which was meant is not knowable",
                )
            )
            continue

        mismatch = _echo_mismatch(op, bullet.section, bullet.entry)
        if mismatch:
            rejections.append(Rejection(RejectionKind.CROSS_SECTION, op.bullet_id, mismatch))
            continue

        if op.action is Action.KEEP:
            applied[op.bullet_id] = bullet.index
            continue

        if op.action is Action.DROP:
            wanted_drops.append(op.bullet_id)
            continue

        # A rewrite. Everything below is about whether this text may stand in this
        # position.
        text = op.text.strip()
        if len(text) < 4:
            rejections.append(
                Rejection(
                    RejectionKind.EMPTY_REWRITE,
                    op.bullet_id,
                    "a rewrite with no text is a deletion in disguise; use drop",
                )
            )
            continue

        if allowed_bullets is not None and text not in allowed_bullets:
            rejections.append(
                Rejection(
                    RejectionKind.PROVENANCE_MISMATCH,
                    op.bullet_id,
                    "the new wording did not pass provenance validation",
                )
            )
            continue

        organisations = _organisations_of(op.fact_ids, facts)
        entry = _normalized(bullet.entry)
        if entry and organisations and entry not in organisations:
            rejections.append(
                Rejection(
                    RejectionKind.PROVENANCE_MISMATCH,
                    op.bullet_id,
                    f"cites work at {', '.join(sorted(organisations.values()))} but "
                    f"this bullet is under {bullet.entry}",
                )
            )
            continue

        # Every *new* claim — a figure, a technology, a name the canonical bullet
        # did not carry — has to be supported by a fact scoped to this entry.
        #
        # Checked claim by claim rather than operation by operation, because the
        # coarser version had a hole with a name: piggybacking. Cite one properly
        # scoped fact alongside an unscoped one and the whole rewrite was waved
        # through, so the unscoped fact could smuggle in a metric that nothing
        # attributed to this employer supports. The scoped fact establishes only
        # what the scoped fact says.
        #
        # Rewording stays free: a claim already in the bullet is one the user
        # wrote under this heading themselves.
        if entry:
            added = claims_in(text).beyond(claims_in(bullet.plain))
            unsupported = added.beyond(_supported_by(_scoped_to(op.fact_ids, facts, entry)))
            if not unsupported.empty:
                rejections.append(
                    Rejection(
                        RejectionKind.UNSCOPED_CLAIM,
                        op.bullet_id,
                        f"adds {unsupported.summary()} to a bullet under "
                        f"{bullet.entry}, which no cited fact about {bullet.entry} "
                        "supports",
                    )
                )
                continue

        escaped = latex_escape(text)
        drift[op.bullet_id] = round(similarity(bullet.plain, text), 3)
        applied[op.bullet_id] = bullet.index
        # An identical bullet is left as the user wrote it, markup and all.
        # Escaping and re-splicing it would strip the \textbf it carries for no
        # gain, which is a formatting change nobody asked for.
        if escaped != bullet.plain:
            replacements[bullet.index] = escaped

    dropped = _resolve_drops(document, by_id, wanted_drops, rejections, applied)

    return Edits(
        dropped=frozenset(dropped),
        replacements=replacements,
        applied=applied,
        rejections=tuple(rejections),
        drift=drift,
        note=_note(plan, document, rejections),
    )


def _echo_mismatch(op: BulletOp, section: str, entry: str) -> str:
    """Whether the operation's own account of the id disagrees with the document.

    Only checked when the model supplied it. An omitted echo is not evidence of
    anything; a wrong one is.
    """
    if op.section and _normalized(op.section) != _normalized(section):
        return f"names section {op.section!r}, but this bullet is in {section!r}"
    if op.entry and _normalized(op.entry) != _normalized(entry):
        return f"names entry {op.entry!r}, but this bullet is under {entry!r}"
    return ""


def _resolve_drops(
    document: TexResume,
    by_id: dict[str, Bullet],
    wanted: list[str],
    rejections: list[Rejection],
    applied: dict[str, int],
) -> set[int]:
    """Drop what the plan asked to drop, so far as the document allows.

    Applied one at a time and re-checked: ``droppable`` answers "given what is
    already gone, what may go next", and taking the whole set at once would empty
    a list that each individual check called safe.
    """
    dropped: set[int] = set()
    for bullet_id in wanted:
        index = by_id[bullet_id].index
        if index in droppable(document, dropped):
            dropped.add(index)
            applied[bullet_id] = index
            continue
        rejections.append(
            Rejection(
                RejectionKind.NOT_DROPPABLE,
                bullet_id,
                "dropping it would empty its entry or remove education",
            )
        )
    return dropped


def _note(plan: TailoringPlan, document: TexResume, rejections: list[Rejection]) -> str:
    if not plan.operations:
        return (
            f"the plan named no bullets; all {len(document.bullets)} were kept as written"
        )
    if rejections:
        return (
            f"{len(rejections)} of {len(plan.operations)} operations were refused; "
            "those bullets were kept as written"
        )
    return ""
