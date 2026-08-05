"""Work authorization and sponsorship questions (spec §7.8, §2.2).

These are the questions where a wrong answer is not a bad answer but a false
statement on a legal document. Everything here is arranged around one
observation: employers ask about work authorization and about sponsorship in
four different shapes, and the difference between two of them is the whole
point of this module.

**Authorization only** — "Are you legally authorized to work in the United
States?" One fact answers it, the user set that fact deliberately, and it is
locked. Answered.

**Sponsorship, this role** — "Do you require sponsorship for this position?"
Answered from its own locked fact. For a student on CPT the truthful answer is
usually *no*: the internship needs no petition filed.

**Sponsorship, now or in the future** — "Will you now **or in the future**
require sponsorship?" A wider question, with its own locked fact, because the
same person truthfully answers no to the one above and yes to this one. Keeping
one fact for both is how a form ends up carrying a false statement — so the
phrasing is detected and the right fact is used, rather than the convenient one.

**Combined** — "Are you legally authorized to work in the United States *without
sponsorship*?" One Yes/No that answers two different questions, and this is the
dangerous one. The naive reading is that it can be assembled from the two facts;
it cannot, because the polarity inverts. A candidate who is authorized *and*
needs future sponsorship answers Yes to the first question, Yes to the second,
and **No** to the combined one. A system that matched the sponsorship half and
filled in "does not require sponsorship = false" would put "I am not authorized
to work" on the form.

So a question carrying both markers is never answered, regardless of what facts
exist. Detection is deliberately greedy: both the visible label and the field's
``name`` are searched, and *any* co-occurrence is treated as combined. The cost
is the user answering one more field. The cost of the other error is a lie.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

__all__ = [
    "AUTHORIZATION_FACT_KEYS",
    "SPONSORSHIP_FACT_KEYS",
    "Category",
    "Decision",
    "categorize",
    "decide",
]


class Category(StrEnum):
    AUTHORIZATION = "AUTHORIZATION"
    #: "Do you require sponsorship *for this role*." A different question from
    #: the one below, and for an intern usually a different answer: a student on
    #: CPT needs no petition filed for the internship itself.
    SPONSORSHIP_NOW = "SPONSORSHIP_NOW"
    #: "...now **or in the future**." Reaches past the internship to the job
    #: after it, which is where an H-1B would be needed.
    SPONSORSHIP_FUTURE = "SPONSORSHIP_FUTURE"
    #: Both in one question. Never answered.
    COMBINED = "COMBINED"
    UNRELATED = "UNRELATED"


#: "Am I allowed to work here at all." Note the absence of any visa vocabulary:
#: a question that mentions a visa is asking something else.
_AUTHORIZATION = re.compile(
    r"\b(?:legally\s+)?(?:authori[sz]ed|eligible|permitted|entitled)\s+to\s+work\b"
    r"|\bwork\s+authori[sz]ation\b"
    r"|\bauthori[sz]ation\s+to\s+work\b"
    r"|\bright\s+to\s+work\b"
    r"|\blegally\s+able\s+to\s+work\b",
    re.I,
)

#: "Will you need us to sponsor you." Includes the visa vocabulary, because an
#: employer asking about a visa is asking about sponsorship whether or not they
#: use the word.
_SPONSORSHIP = re.compile(
    r"\bsponsor(?:ship|ed|ing|s)?\b"
    r"|\bvisa\b"
    # Tolerates "H-1B", "H1B" and the "H 1B" that separator normalisation leaves.
    r"|\bh[\s-]*1[\s-]*b\b"
    r"|\bimmigration\s+status\b"
    r"|\bwork\s+permit\b"
    r"|\bemployment\s+authorization\s+document\b|\bead\b",
    re.I,
)

#: Candidate facts that may answer an authorization question. Read in order; the
#: first present *and locked* one wins. All live under the ``work_authorization``
#: prefix, which :data:`app.services.candidate.ALWAYS_LOCKED_PREFIXES` locks
#: automatically — so "only from locked facts" is enforced by the fact store
#: rather than by remembering to lock them.
AUTHORIZATION_FACT_KEYS: tuple[str, ...] = (
    "work_authorization.is_authorized",
    "work_authorization.authorized_us",
)

#: Language that widens a sponsorship question past the role being applied for.
#: "Now or in the future", "at any time during your employment", "ongoing" — the
#: phrasings differ, the effect does not.
_FUTURE = re.compile(
    r"\bin\s+the\s+future\b"
    r"|\bfuture\b"
    r"|\bor\s+later\b"
    r"|\bat\s+any\s+(?:time|point)\b"
    r"|\bongoing\b"
    r"|\bcontinu(?:e|ed|ing)\b"
    r"|\bever\b",
    re.I,
)

#: Answers "do you need us to file something for *this* role". For a student on
#: CPT the truthful answer is usually no — the internship needs no petition.
SPONSORSHIP_NOW_FACT_KEYS: tuple[str, ...] = ("work_authorization.requires_sponsorship_now",)

#: Answers "...now or in the future". A different fact because it is a different
#: question: the same person can truthfully answer no to one and yes to the
#: other, and collapsing them is how a form ends up carrying a false statement.
SPONSORSHIP_FACT_KEYS: tuple[str, ...] = ("work_authorization.requires_future_sponsorship",)


@dataclass(frozen=True, slots=True)
class Decision:
    """What to do with one work-authorization question."""

    category: Category
    #: ``None`` means leave the field blank for the user.
    value: Any = None
    #: The locked fact the value came from, when there is one.
    fact_key: str | None = None
    #: Shown beside the field on the review screen (§22.4).
    reason: str = ""

    @property
    def answered(self) -> bool:
        return self.value is not None

    @property
    def needs_human(self) -> bool:
        return self.value is None


#: Separators used in field names. Replaced with spaces before matching, because
#: ``_`` is a word character to ``\b`` — so ``sponsorship_required`` would not
#: match ``\bsponsorship\b``, and ATS field names are written almost entirely in
#: snake_case and kebab-case.
_SEPARATORS = re.compile(r"[_\-.]+")


def categorize(*texts: str | None) -> Category:
    """Classify a question from its label, its field name, or both.

    Every text is searched and the markers are pooled, so a label that asks about
    authorization and a field named ``sponsorship_required`` together read as
    combined. That is the safe direction: the two halves being split across the
    label and the name is a strong sign the employer means one question.
    """
    haystack = _SEPARATORS.sub(" ", " ".join(t for t in texts if t))
    if not haystack.strip():
        return Category.UNRELATED

    authorization = bool(_AUTHORIZATION.search(haystack))
    sponsorship = bool(_SPONSORSHIP.search(haystack))

    if authorization and sponsorship:
        return Category.COMBINED
    if authorization:
        return Category.AUTHORIZATION
    if sponsorship:
        # "Now or in the future" is a wider question than "for this role", and
        # for an intern the honest answers differ. Splitting them here is what
        # lets both be answered truthfully instead of both being left blank.
        return Category.SPONSORSHIP_FUTURE if _FUTURE.search(haystack) else Category.SPONSORSHIP_NOW
    return Category.UNRELATED


def decide(
    *texts: str | None,
    facts: dict[str, Any],
    locked_keys: frozenset[str] = frozenset(),
) -> Decision:
    """Answer a work-authorization question, or refuse to.

    Args:
        texts: the question label and, optionally, the field's ``name``.
        facts: candidate facts, keyed by candidate-fact key.
        locked_keys: which of those the user locked. An authorization fact that
            is not locked is not used — §7.8 allows these answers to come from a
            locked fact or a human, and nothing else.
    """
    category = categorize(*texts)

    if category is Category.COMBINED:
        return Decision(
            category,
            reason=(
                "this asks about authorization and sponsorship in one answer; "
                "the two facts cannot be combined without changing what is claimed"
            ),
        )

    if category in (Category.SPONSORSHIP_NOW, Category.SPONSORSHIP_FUTURE):
        keys = (
            SPONSORSHIP_NOW_FACT_KEYS
            if category is Category.SPONSORSHIP_NOW
            else SPONSORSHIP_FACT_KEYS
        )
        for key in keys:
            if key in facts and key in locked_keys:
                return Decision(
                    category,
                    value=facts[key],
                    fact_key=key,
                    reason=f"answered from the locked fact {key}",
                )
        return Decision(
            category,
            reason=(
                f"no locked {
                    'sponsorship-now'
                    if category is Category.SPONSORSHIP_NOW
                    else 'future-sponsorship'
                } fact is set; "
                "add one in Settings or answer this yourself"
            ),
        )

    if category is Category.AUTHORIZATION:
        for key in AUTHORIZATION_FACT_KEYS:
            if key in facts and key in locked_keys:
                return Decision(
                    category,
                    value=facts[key],
                    fact_key=key,
                    reason=f"answered from the locked fact {key}",
                )
        return Decision(
            category,
            reason=(
                "no locked work-authorization fact is set; "
                "add one in Settings or answer this yourself"
            ),
        )

    return Decision(Category.UNRELATED)
