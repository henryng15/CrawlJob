from __future__ import annotations

import re

# These are deliberately visible and editable. A role must also explicitly be
# an internship/co-op; that prevents this tracker from adding ordinary full-time jobs.
# "Summer analyst" is what banks and trading firms call an internship, and they
# never use the word intern. Verition posted "2027 Technology Internship (US)" and
# Point72 posts "Technology Summer Analyst" — same thing, same applicant, and one
# of them was invisible here.
INTERNSHIP_RE = re.compile(
    r"\b(intern(?:ship)?|co[ -]?op|placement|student|summer analyst|summer associate)\b",
    re.IGNORECASE,
)
ROLE_PATTERNS = (
    r"\b(?:software|swe|sde)\b",
    r"\bsoftware (?:engineering|engineer|development|developer|dev)\b",
    r"\b(?:front[ -]?end|back[ -]?end|full[ -]?stack|web|mobile|ios|android) (?:engineer|engineering|developer|development)\b",
    r"\b(?:platform|infrastructure|production infrastructure|developer experience|devex) (?:engineer|engineering)\b",
    r"\b(?:cloud(?: operations)?|build|release|mlops) (?:engineer|engineering|developer|development)\b",
    r"\b(?:devops|site reliability|sre)\b",
    r"\b(?:embedded|firmware|systems|application) (?:software )?(?:engineer|engineering|developer|development)\b",
    r"\b(?:forward deployed (?:software )?engineer|fde)\b",
    r"\b(?:machine learning|ml|data) (?:platform )?(?:engineer|engineering)\b",
    r"\b(?:quant|quantitative) developer\b",
    # From here down the family name alone is enough, with no second word to anchor
    # on. That is a deliberate loosening: an employer who calls the job "Cloud
    # Intern" or "AI Summer Analyst" means exactly what this tracker is looking
    # for, and demanding they also write "engineer" only filters out the ones with
    # a terse job title.
    #
    # It is affordable because the internship half of the test still has to agree.
    # "Cloud Solutions Architect" and "Head of AI" carry no intake word and stay
    # out; only "<family> ... Intern" and "<family> ... Summer Analyst" get in.
    #
    # Technology is here because finance names the whole function that way rather
    # than naming a discipline — "2027 Technology Internship", "Technology Summer
    # Analyst". The cost across all of these is the occasional "Marketing
    # Technology Intern" or an infrastructure role that turns out to be civil
    # engineering: one row to glance past, against whole categories otherwise unseen.
    r"\btechnolog(?:y|ies|ist)\b",
    r"\bcloud\b",
    r"\binfra(?:structure)?\b",
    r"\bdev ?ops\b",
    r"\b(?:ai|a\.i\.|artificial intelligence|generative ai|gen ?ai|llms?)\b",
    r"\b(?:machine|deep) learning\b",
    r"\bml ?ops\b",
    r"\bml\b",
    r"\bsoftware\b",
    r"\b(?:programming|programmer|coding)\b",
)
ROLE_RE = re.compile("|".join(f"(?:{pattern})" for pattern in ROLE_PATTERNS), re.IGNORECASE)


# The same idea as "summer analyst" but with the intake wedged into the middle:
# "Summer 2027 Technology Analyst". Two separate words rather than a phrase, which
# is why it cannot live in INTERNSHIP_RE. Safe only because ROLE_RE still has to
# agree — "Investment Banking Summer 2027 Analyst" carries no technical word and
# stays out.
SUMMER_RE = re.compile(r"\bsummer\b", re.IGNORECASE)
ANALYST_RE = re.compile(r"\banalyst\b", re.IGNORECASE)


def _is_internship(role: str) -> bool:
    if INTERNSHIP_RE.search(role):
        return True
    return bool(SUMMER_RE.search(role) and ANALYST_RE.search(role))


def is_target_role(role: str) -> bool:
    return bool(_is_internship(role) and ROLE_RE.search(role))
