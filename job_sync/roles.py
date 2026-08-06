from __future__ import annotations

import re

# These are deliberately visible and editable. A role must also explicitly be
# an internship/co-op; that prevents this tracker from adding ordinary full-time jobs.
INTERNSHIP_RE = re.compile(r"\b(intern(?:ship)?|co[ -]?op|placement|student)\b", re.IGNORECASE)
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
)
ROLE_RE = re.compile("|".join(f"(?:{pattern})" for pattern in ROLE_PATTERNS), re.IGNORECASE)


def is_target_role(role: str) -> bool:
    return bool(INTERNSHIP_RE.search(role) and ROLE_RE.search(role))
