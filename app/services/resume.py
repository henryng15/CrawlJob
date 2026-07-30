"""Resume tailoring with provenance validation (spec §7.7).

Tailoring is where a job-application tool is most tempting to let lie. Asking a
model to "emphasise relevant experience" invites it to round 12% up to 20%, to
promote a contributor to a lead, or to add a technology the user has never used —
each of which the user then has to defend in an interview.

So every generated bullet cites the facts it rests on, and a deterministic
validator checks the citation actually supports the text:

* every number in the bullet must appear in a cited fact;
* every technology named must appear in a cited fact;
* every organisation named must appear in a cited fact;
* a bullet that cites nothing is rejected.

§7.7's allowed changes are all reorderings and rewordings of things already true.
Its forbidden ones — new employers, new projects, new metrics, inflated ownership,
fabricated scale — are exactly what the checks above catch.

**A plan addresses bullets by id, never by resemblance.** The model is shown the
resume's own bullets with their stable ids (``work-experience.todd.2``) and
answers with one operation per id: keep it, rewrite it, or drop it. So the
question "where does this sentence go" has a single answer given by the model,
and there is no step that guesses. Matching by wording — which is what this
replaced — could put an IpserLabs achievement under Todd whenever the two
happened to share vocabulary, and produce a resume that was true line by line
and wrong about who did what where.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum

from pydantic import BaseModel, Field

from app.services.llm.base import LLMProvider, Message, Task

__all__ = [
    "PROMPT_VERSION",
    "SYSTEM_PROMPT",
    "Action",
    "Bullet",
    "BulletOp",
    "Claims",
    "ResumeFact",
    "TailoringPlan",
    "Transformation",
    "ValidationResult",
    "Violation",
    "ViolationKind",
    "claims_in",
    "tailor",
    "validate_bullet",
    "validate_plan",
]

#: v2 changed the contract: the model now receives the resume's bullet ids and
#: answers with operations against them, instead of returning free-standing
#: bullets that something else had to find a home for.
PROMPT_VERSION = "resume/v2"


class Transformation(StrEnum):
    """What was done to a source fact (§7.7 allowed changes)."""

    VERBATIM = "verbatim"
    REORDER = "reorder"
    SHORTEN = "shorten"
    REWRITE = "rewrite"
    MERGE = "merge"


class Action(StrEnum):
    """What a plan asks for one existing bullet.

    There is deliberately no "add". Every sentence on the resume is one the user
    wrote and verified; a plan selects and rewords, it does not extend.
    """

    KEEP = "keep"
    REWRITE = "rewrite"
    DROP = "drop"


class ViolationKind(StrEnum):
    NO_CITATION = "NO_CITATION"
    UNKNOWN_FACT = "UNKNOWN_FACT"
    INVENTED_METRIC = "INVENTED_METRIC"
    INVENTED_TECHNOLOGY = "INVENTED_TECHNOLOGY"
    INVENTED_ORGANISATION = "INVENTED_ORGANISATION"
    INFLATED_OWNERSHIP = "INFLATED_OWNERSHIP"


@dataclass(frozen=True, slots=True)
class ResumeFact:
    """One immutable, user-verified statement about the candidate."""

    id: str
    text: str
    #: Organisation this belongs to, if any.
    organisation: str | None = None
    technologies: frozenset[str] = frozenset()
    kind: str = "experience"

    @property
    def numbers(self) -> frozenset[str]:
        return frozenset(_NUMBERS.findall(self.text))


class Bullet(BaseModel):
    """A tailored resume line and the facts it claims to rest on."""

    text: str = Field(min_length=4)
    fact_ids: list[str] = Field(default_factory=list)
    transformation: Transformation = Transformation.REWRITE

    @property
    def numbers(self) -> frozenset[str]:
        return frozenset(_NUMBERS.findall(self.text))


class BulletOp(BaseModel):
    """One operation against one existing resume bullet.

    ``bullet_id`` is the only thing that decides *where* a rewrite lands. The
    echoed ``section`` and ``entry`` are cross-checks: a model that names Todd's
    bullet id while describing IpserLabs work will usually give itself away in one
    of the three, and any disagreement rejects the operation rather than
    resolving it.
    """

    bullet_id: str = Field(min_length=1)
    action: Action = Action.KEEP
    #: The new wording. Required for ``rewrite``, ignored otherwise.
    text: str = ""
    #: The facts the new wording rests on. Checked for provenance, and checked to
    #: belong to the same employer or project as the bullet being rewritten.
    fact_ids: list[str] = Field(default_factory=list)
    #: What the model believes this id refers to. Optional; verified if given.
    section: str = ""
    entry: str = ""
    transformation: Transformation = Transformation.REWRITE


class TailoringPlan(BaseModel):
    """The model's proposed resume for one job, as operations on existing bullets."""

    summary: str = ""
    summary_fact_ids: list[str] = Field(default_factory=list)
    operations: list[BulletOp] = Field(default_factory=list)
    #: Which sections to include and in what order. Reordering is always allowed.
    section_order: list[str] = Field(default_factory=list)

    @property
    def rewrites(self) -> list[BulletOp]:
        return [op for op in self.operations if op.action is Action.REWRITE]

    @property
    def bullets(self) -> list[Bullet]:
        """The new wording this plan proposes, for provenance validation.

        Only rewrites carry text, so only rewrites can make a claim. A keep
        repeats a sentence the user already verified and a drop makes no claim at
        all, which is why neither needs checking.
        """
        return [
            Bullet(text=op.text, fact_ids=op.fact_ids, transformation=op.transformation)
            for op in self.rewrites
            if len(op.text) >= 4
        ]


@dataclass(frozen=True, slots=True)
class Violation:
    kind: ViolationKind
    detail: str
    bullet_text: str = ""


@dataclass(slots=True)
class ValidationResult:
    violations: list[Violation] = field(default_factory=list)
    validated: list[Bullet] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.violations

    def summary(self) -> str:
        if self.passed:
            return f"{len(self.validated)} bullets, all supported"
        kinds = ", ".join(sorted({v.kind.value for v in self.violations}))
        return f"{len(self.violations)} violation(s): {kinds}"


#: Numbers that make a claim: percentages, counts, multipliers, magnitudes. Bare
#: years are excluded — "since 2024" is a date, not a metric.
_NUMBERS = re.compile(r"\b(?!(?:19|20)\d{2}\b)\d+(?:[.,]\d+)?%?[kKmMbB]?\b")

#: Words that claim sole responsibility. §7.7 forbids inflating ownership, so
#: these are only permitted when the cited fact uses them too.
_OWNERSHIP = re.compile(
    r"\b(led|leading|owned|owner|architect(?:ed)?|founded|created|"
    r"single-handedly|solely|spearheaded|drove|managed)\b",
    re.I,
)

#: Capitalised tokens that may name an organisation or product.
_PROPER_NOUN = re.compile(r"\b[A-Z][A-Za-z0-9]{2,}(?:\.[a-z]{2,})?\b")

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def _proper_nouns(text: str) -> set[str]:
    """Capitalised tokens that are not the first word of a sentence.

    A word at the start of a sentence is capitalised by grammar, not because it
    names anything — and resume bullets almost always start with a verb. Treating
    "Builds Python services" as naming a company called "Builds" was the failure
    that motivated this; a stopword list of English verbs is a game that cannot be
    won.

    The cost is that an invented name at the very start of a bullet is missed. The
    metric and technology checks still apply there, and bullets that open with a
    company name are rare enough to accept.
    """
    found: set[str] = set()
    for sentence in _SENTENCE_SPLIT.split(text):
        for match in _PROPER_NOUN.finditer(sentence.strip()):
            if match.start() > 0:
                found.add(match.group(0))
    return found


def _tokens(text: str) -> frozenset[str]:
    return frozenset(word.lower() for word in re.findall(r"[A-Za-z][A-Za-z0-9+#.]*", text))


def validate_bullet(bullet: Bullet, facts: dict[str, ResumeFact]) -> list[Violation]:
    """Check one bullet against the facts it cites.

    Every check answers a specific way §7.7 says a resume must not change.
    """
    violations: list[Violation] = []

    if not bullet.fact_ids:
        return [
            Violation(
                ViolationKind.NO_CITATION,
                "the bullet cites no candidate facts",
                bullet.text,
            )
        ]

    unknown = [fid for fid in bullet.fact_ids if fid not in facts]
    if unknown:
        violations.append(
            Violation(
                ViolationKind.UNKNOWN_FACT,
                f"cites facts that do not exist: {', '.join(unknown)}",
                bullet.text,
            )
        )

    cited = [facts[fid] for fid in bullet.fact_ids if fid in facts]
    if not cited:
        return violations

    supported_numbers = {number for fact in cited for number in fact.numbers}
    invented_numbers = bullet.numbers - supported_numbers
    if invented_numbers:
        violations.append(
            Violation(
                ViolationKind.INVENTED_METRIC,
                f"states figures no cited fact contains: {', '.join(sorted(invented_numbers))}",
                bullet.text,
            )
        )

    supported_words = {word for fact in cited for word in _tokens(fact.text)}
    supported_tech = {tech.lower() for fact in cited for tech in fact.technologies}
    named_tech = {
        word
        for word in _tokens(bullet.text)
        if word in _KNOWN_TECHNOLOGIES
        and word not in supported_tech
        and word not in supported_words
    }
    if named_tech:
        violations.append(
            Violation(
                ViolationKind.INVENTED_TECHNOLOGY,
                f"names technologies no cited fact mentions: {', '.join(sorted(named_tech))}",
                bullet.text,
            )
        )

    supported_orgs = {
        (fact.organisation or "").lower() for fact in cited if fact.organisation
    } | supported_words
    named_orgs = {
        noun
        for noun in _proper_nouns(bullet.text)
        if noun.lower() not in supported_orgs and noun.lower() not in _KNOWN_TECHNOLOGIES
    }
    if named_orgs:
        violations.append(
            Violation(
                ViolationKind.INVENTED_ORGANISATION,
                f"names organisations no cited fact mentions: {', '.join(sorted(named_orgs))}",
                bullet.text,
            )
        )

    claims_ownership = _OWNERSHIP.search(bullet.text)
    if claims_ownership and not any(_OWNERSHIP.search(fact.text) for fact in cited):
        violations.append(
            Violation(
                ViolationKind.INFLATED_OWNERSHIP,
                f"claims ownership the cited facts do not: {claims_ownership.group(0)!r}",
                bullet.text,
            )
        )

    return violations


#: Technology names worth policing. Not exhaustive — it does not need to be, since
#: an unrecognised capitalised token is caught by the organisation check instead.
_KNOWN_TECHNOLOGIES = frozenset(
    {
        "python", "java", "javascript", "typescript", "go", "golang", "rust", "c", "c++",
        "c#", "ruby", "php", "swift", "kotlin", "scala", "r", "sql", "bash",
        "react", "vue", "angular", "svelte", "next.js", "django", "flask", "fastapi",
        "rails", "spring", "express", "node", "node.js", "graphql", "grpc", "rest",
        "postgres", "postgresql", "mysql", "sqlite", "mongodb", "redis", "elasticsearch",
        "kafka", "rabbitmq", "duckdb", "snowflake", "bigquery", "dbt", "spark", "hadoop",
        "docker", "kubernetes", "terraform", "ansible", "aws", "gcp", "azure", "oci",
        "lambda", "s3", "ec2", "rds", "pytorch", "tensorflow", "pandas", "numpy",
        "scikit-learn", "sklearn", "git", "github", "gitlab", "jenkins", "playwright",
        "selenium", "pytest", "junit", "jest",
    }
)  # fmt: skip


@dataclass(frozen=True, slots=True)
class Claims:
    """The checkable assertions in a piece of text.

    The same three categories the provenance validator polices, pulled out so
    other code can ask "does this sentence claim anything the one it replaces did
    not" without reimplementing the definitions and drifting from them.
    """

    numbers: frozenset[str]
    technologies: frozenset[str]
    organisations: frozenset[str]

    def beyond(self, other: Claims) -> Claims:
        """What this text asserts that ``other`` does not."""
        return Claims(
            numbers=self.numbers - other.numbers,
            technologies=self.technologies - other.technologies,
            organisations=self.organisations - other.organisations,
        )

    @property
    def empty(self) -> bool:
        return not (self.numbers or self.technologies or self.organisations)

    def summary(self) -> str:
        parts = [
            f"figures {', '.join(sorted(self.numbers))}" if self.numbers else "",
            f"technologies {', '.join(sorted(self.technologies))}"
            if self.technologies
            else "",
            f"names {', '.join(sorted(self.organisations))}" if self.organisations else "",
        ]
        return "; ".join(part for part in parts if part)


def claims_in(text: str) -> Claims:
    """Every figure, technology and proper name a sentence asserts."""
    words = _tokens(text)
    return Claims(
        numbers=frozenset(_NUMBERS.findall(text)),
        technologies=frozenset(word for word in words if word in _KNOWN_TECHNOLOGIES),
        organisations=frozenset(
            noun.lower()
            for noun in _proper_nouns(text)
            if noun.lower() not in _KNOWN_TECHNOLOGIES
        ),
    )


def validate_plan(plan: TailoringPlan, facts: dict[str, ResumeFact]) -> ValidationResult:
    """Validate every bullet and the summary.

    A plan with any violation is not partially usable: §7.7 says an unsupported
    claim blocks the resume, because the user cannot be asked to spot which line
    was invented.
    """
    result = ValidationResult()

    for bullet in plan.bullets:
        violations = validate_bullet(bullet, facts)
        if violations:
            result.violations.extend(violations)
        else:
            result.validated.append(bullet)

    if plan.summary.strip():
        summary_bullet = Bullet(
            text=plan.summary,
            fact_ids=plan.summary_fact_ids,
            transformation=Transformation.REWRITE,
        )
        result.violations.extend(validate_bullet(summary_bullet, facts))

    return result


SYSTEM_PROMPT = """\
You tailor a candidate's existing resume for one job by editing its bullets in
place.

You are given RESUME BULLETS: every editable line of the resume, each with a
bullet_id, the section it is in, and the employer or project it belongs to. You
are also given CANDIDATE FACTS with their own ids.

Return one operation per bullet you want to change, each naming an existing
bullet_id:

  keep    — leave the line exactly as written.
  rewrite — replace its wording. Supply text, and fact_ids for what it rests on.
  drop    — remove the line, because it says nothing about this job.

Rules:
- bullet_id must be one you were given. Never invent one, and never use the same
  id twice.
- A rewrite must describe the same work as the bullet it replaces, at the same
  employer or project. Echo the section and entry you believe the id refers to.
- Every fact you cite must belong to that same employer or project. Do not
  describe one employer's work under another's heading.
- Do not add an employer, project, metric, technology or date the facts do not
  contain. Do not change a job title. Do not say the candidate led something the
  facts describe them as contributing to.
- If you cannot express something with a fact that supports it, leave the bullet
  as it is.

A bullet you say nothing about is kept unchanged.
"""


def bullet_inventory(bullets: list[dict[str, str]]) -> str:
    """The addressable bullet list, as the prompt shows it."""
    return "\n".join(
        f"[{item['bullet_id']}] ({item['section']} / {item['entry']}) {item['text']}"
        for item in bullets
    )


def tailor(
    *,
    facts: dict[str, ResumeFact],
    job_title: str,
    job_description: str,
    provider: LLMProvider,
    bullets: list[dict[str, str]] | None = None,
    max_attempts: int = 2,
) -> tuple[TailoringPlan, ValidationResult]:
    """Produce a validated tailoring plan.

    Args:
        bullets: the resume's own bullets, from
            :meth:`app.services.resume_tex.TexResume.inventory`. Without them the
            model has no ids to address, so it can only return operations that
            will be rejected — the caller is expected to pass them.

    A plan that fails validation is retried once with the violations fed back,
    since models correct a specific, named problem reliably. If it fails again the
    caller receives the failure rather than a quietly weakened resume — §7.7
    requires an unsupported claim to block, not degrade.
    """
    corpus = "\n".join(f"[{fact.id}] {fact.text}" for fact in facts.values())
    messages = [
        Message(role="system", content=SYSTEM_PROMPT),
        Message(
            role="user",
            content=(
                f"RESUME BULLETS\n{bullet_inventory(bullets or [])}\n\n"
                f"CANDIDATE FACTS\n{corpus}\n\n"
                f"JOB TITLE\n{job_title}\n\nJOB DESCRIPTION\n{job_description}"
            ),
        ),
    ]

    plan = TailoringPlan()
    result = ValidationResult()

    for attempt in range(1, max_attempts + 1):
        response = provider.structured_generate(
            task=Task.RESUME_PLAN, schema=TailoringPlan, messages=messages
        )
        plan = response.value
        result = validate_plan(plan, facts)
        if result.passed or attempt == max_attempts:
            break

        messages.append(
            Message(
                role="user",
                content=(
                    "The previous plan was rejected. Fix these and return the whole "
                    "plan again:\n"
                    + "\n".join(f"- {v.kind.value}: {v.detail}" for v in result.violations)
                ),
            )
        )

    return plan, result
