"""Cold-email hook generation (spec §7.13).

A hook is the sentence that shows the email was written for this company rather
than mail-merged. It is also the easiest thing in the system to fabricate, and a
fabricated one is worse than none: a recruiter who is told you admired a product
launch that never happened learns something about you.

So the rule is source-or-silence. Every hook carries a URL and the exact excerpt
it came from, the excerpt is verified against the fetched page, and a hook that
fails verification is dropped in favour of a short, plain email that claims
nothing (§7.13).

Phase 1 hooks are about the company or the job, never about the recruiter
personally. Login-gated and private profiles are not read (§7.13, AGENTS.md).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

from pydantic import BaseModel, Field

from app.services.llm.base import LLMProvider, Message, Task

__all__ = [
    "Hook",
    "HookType",
    "SourceDocument",
    "compose_email",
    "generate_hook",
    "verify_hook",
]

PROMPT_VERSION = "hook/v1"


class HookType(StrEnum):
    JOB_SPECIFIC = "JOB_SPECIFIC"
    COMPANY_SPECIFIC = "COMPANY_SPECIFIC"
    #: No verifiable hook was found; the email says nothing personal.
    NONE = "NONE"


@dataclass(frozen=True, slots=True)
class SourceDocument:
    """A page a hook may be drawn from.

    Only sources §7.13 permits: the job description, the company's engineering
    blog, its careers page, an official announcement, or its own website.
    """

    url: str
    text: str
    kind: str = "job_description"


class Hook(BaseModel):
    """A hook and the evidence for it."""

    hook_type: HookType = HookType.NONE
    hook: str = ""
    source_url: str = ""
    source_excerpt: str = ""
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    unsupported_claims: list[str] = Field(default_factory=list)

    @property
    def is_usable(self) -> bool:
        return bool(self.hook and self.source_url and self.source_excerpt)


def _normalize(text: str) -> str:
    text = text.replace("’", "'").replace("“", '"').replace("”", '"').replace("—", "-")
    return re.sub(r"\s+", " ", text).strip().lower()


def verify_hook(hook: Hook, sources: list[SourceDocument]) -> Hook:
    """Drop a hook whose excerpt is not in one of its sources (§7.13).

    Mirrors the sponsorship evidence check for the same reason: a fluent quote
    from a model is not evidence that the quote exists.
    """
    if not hook.is_usable:
        return Hook(
            hook_type=HookType.NONE,
            unsupported_claims=(
                [*hook.unsupported_claims, "hook is missing a source url or excerpt"]
                if hook.hook
                else hook.unsupported_claims
            ),
        )

    by_url = {doc.url: doc for doc in sources}
    document = by_url.get(hook.source_url)
    if document is None:
        return Hook(
            hook_type=HookType.NONE,
            unsupported_claims=[f"cited a source that was not fetched: {hook.source_url}"],
        )

    if _normalize(hook.source_excerpt) not in _normalize(document.text):
        return Hook(
            hook_type=HookType.NONE,
            unsupported_claims=[
                f"the excerpt does not appear in {hook.source_url}: {hook.source_excerpt[:80]!r}"
            ],
        )

    return hook


_SYSTEM = """\
You write one sentence for a cold email to a recruiter, showing the applicant read
something specific about this company or role.

Rules:
- Draw only from the supplied sources.
- Quote the exact sentence you drew from in source_excerpt, and give its url.
- If nothing in the sources supports a specific, non-generic sentence, return
  hook_type NONE with an empty hook. That is a valid answer.
- Never mention the recruiter personally.
- Never state anything the sources do not say.
"""


def generate_hook(
    sources: list[SourceDocument],
    *,
    provider: LLMProvider,
    company: str,
    role: str,
) -> Hook:
    """Produce a verified hook, or a ``NONE`` hook.

    Callers should treat ``NONE`` as ordinary. §7.13 explicitly prefers a short,
    direct email over an invented personal detail.
    """
    if not sources or not any(doc.text.strip() for doc in sources):
        return Hook(hook_type=HookType.NONE, unsupported_claims=["no sources were available"])

    corpus = "\n\n".join(f"SOURCE {doc.url} ({doc.kind})\n{doc.text}" for doc in sources)
    response = provider.structured_generate(
        task=Task.EMAIL_HOOK,
        schema=Hook,
        messages=[
            Message(role="system", content=_SYSTEM),
            Message(role="user", content=f"COMPANY: {company}\nROLE: {role}\n\n{corpus}"),
        ],
    )
    return verify_hook(response.value, sources)


def compose_email(
    *,
    recruiter_first_name: str,
    company: str,
    role: str,
    applicant_name: str,
    hook: Hook,
    applied_on: str,
) -> tuple[str, str]:
    """Build the subject and body (§8.3).

    One clear ask, short body, role and company named, no tracking, and no claim
    that an application was submitted unless the caller already confirmed it —
    which the outreach policy guarantees before this is reached.
    """
    subject = f"{role} application - {applicant_name}"

    opening = f"Hi {recruiter_first_name}," if recruiter_first_name else "Hello,"
    hook_line = f"\n\n{hook.hook.strip()}" if hook.is_usable else ""

    body = (
        f"{opening}\n\n"
        f"I applied for the {role} role at {company} on {applied_on} and wanted to "
        f"introduce myself directly."
        f"{hook_line}\n\n"
        f"Would you be open to a short conversation about the role?\n\n"
        f"Thanks,\n{applicant_name}"
    )
    return subject, body
