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
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum

from pydantic import BaseModel, Field

from app.services.llm.base import LLMProvider, Message, Task

__all__ = [
    "Bullet",
    "ResumeFact",
    "TailoringPlan",
    "Transformation",
    "Violation",
    "ViolationKind",
    "tailor",
    "validate_bullet",
    "validate_plan",
]

PROMPT_VERSION = "resume/v1"


class Transformation(StrEnum):
    """What was done to a source fact (§7.7 allowed changes)."""

    VERBATIM = "verbatim"
    REORDER = "reorder"
    SHORTEN = "shorten"
    REWRITE = "rewrite"
    MERGE = "merge"


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


class TailoringPlan(BaseModel):
    """The model's proposed resume for one job."""

    summary: str = ""
    summary_fact_ids: list[str] = Field(default_factory=list)
    bullets: list[Bullet] = Field(default_factory=list)
    #: Which sections to include and in what order. Reordering is always allowed.
    section_order: list[str] = Field(default_factory=list)


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


_SYSTEM = """\
You select and reword a candidate's existing resume material for one job.

You may: reorder bullets, choose which experiences to include, shorten wording,
and emphasise the technologies the job asks for when the candidate has used them.

You may not: add an employer, project, metric, technology or date the facts do not
contain; change a job title; or describe the candidate as leading something the
facts describe them as contributing to.

Every bullet must list the fact ids it came from. If you cannot express something
without a fact to support it, leave it out.
"""


def tailor(
    *,
    facts: dict[str, ResumeFact],
    job_title: str,
    job_description: str,
    provider: LLMProvider,
    max_attempts: int = 2,
) -> tuple[TailoringPlan, ValidationResult]:
    """Produce a validated tailoring plan.

    A plan that fails validation is retried once with the violations fed back,
    since models correct a specific, named problem reliably. If it fails again the
    caller receives the failure rather than a quietly weakened resume — §7.7
    requires an unsupported claim to block, not degrade.
    """
    corpus = "\n".join(f"[{fact.id}] {fact.text}" for fact in facts.values())
    messages = [
        Message(role="system", content=_SYSTEM),
        Message(
            role="user",
            content=(
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
