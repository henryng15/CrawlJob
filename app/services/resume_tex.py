"""Editing a LaTeX resume without touching its template (spec §7.7).

The base resume is a document the user wrote, laid out and tuned until it fitted
on one page. Regenerating it from a model would produce something that compiles
and is not their resume. So nothing here generates LaTeX: it locates the
``\\resumeItem{...}`` bullets in the existing file and splices new text into
exactly those spans, leaving every byte outside them alone.

That is the whole design. The preamble, the geometry, the font packages, the
custom commands, the section order, the headings, the skills block and the
spacing are untouchable by construction rather than by care — a tailoring pass
cannot reach them, because the only thing it can express is "keep this bullet,
drop that one, or replace this bullet's text".

Brace matching is done properly rather than with a regex. Bullets contain
``\\textbf{...}`` and ``\\href{...}{...}``, and a non-greedy regex stops at the
first ``}`` it sees, which is in the middle of a word.

Every bullet also gets a **stable id** naming where it lives: its section, the
employer or project it sits under, and its position within that entry —
``work-experience.todd.2``. That id is what a tailoring plan addresses, so a
rewrite lands where the model said it should rather than wherever the wording
happened to look closest. The section is part of it because an entry name is not
unique on its own: "Kenyon College" is both a degree and a job in this resume,
and ``education.kenyon-college.1`` is a different sentence from
``work-experience.kenyon-college.1``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

__all__ = [
    "ENTRY_COMMANDS",
    "Bullet",
    "TexResume",
    "find_bullets",
    "parse",
    "render",
    "slug",
]

_ITEM = re.compile(r"\\resumeItem\s*\{")
_SECTION = re.compile(r"\\section\s*\{([^}]*)\}")
_LIST_START = re.compile(r"\\resumeItemListStart")
#: Whole-line LaTeX comments. A commented-out bullet is content the user has
#: already chosen to hide, and must stay hidden and untouched.
_COMMENT_LINE = re.compile(r"^\s*%")

#: Commands whose first argument names the employer, school or project an entry
#: belongs to. This resume uses ``\resumeSubheading{Todd}{dates}{title}{}`` for
#: jobs and ``\resumeProjectHeadingDesc{...ThesisLedger...}{}{desc}`` for
#: projects; both put the name first, which is the only thing relied on here.
ENTRY_COMMANDS: tuple[str, ...] = (
    "resumeSubheading",
    "resumeProjectHeadingDesc",
    "resumeProjectHeading",
    "resumeSubSubheading",
)

_ENTRY = re.compile(r"\\(" + "|".join(ENTRY_COMMANDS) + r")\s*\{")

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True, slots=True)
class Bullet:
    """One ``\\resumeItem`` in the source, and where its argument lives."""

    index: int
    #: The section heading it falls under, e.g. "Work Experience".
    section: str
    #: The bullet's LaTeX body, without the enclosing braces.
    text: str
    #: Character offsets of the body inside the source.
    start: int
    end: int
    #: Which ``\\resumeItemListStart`` block it belongs to. Shortening uses this
    #: to avoid emptying a list, which would leave a job title with no bullets
    #: under it — visibly broken rather than merely shorter.
    list_index: int = 0
    #: The employer, school or project this bullet sits under, as the document
    #: writes it: "Todd", "IpserLabs", "ThesisLedger". Empty when a bullet is not
    #: inside an entry.
    entry: str = ""
    #: Stable address, e.g. ``work-experience.todd.2``. What a tailoring plan
    #: names when it wants this sentence changed.
    bullet_id: str = ""

    @property
    def plain(self) -> str:
        """The body with the commonest markup stripped, for reading and scoring.

        Deliberately lossy and never fed back into the document — this is for
        deciding relevance and for showing a diff, not for rendering.
        """
        out = re.sub(r"\\textbf\s*\{([^{}]*)\}", r"\1", self.text)
        out = re.sub(r"\\uline\s*\{([^{}]*)\}", r"\1", out)
        out = re.sub(r"\\emph\s*\{([^{}]*)\}", r"\1", out)
        out = re.sub(r"\\href\s*\{[^{}]*\}\s*\{([^{}]*)\}", r"\1", out)
        out = re.sub(r"\\[a-zA-Z]+", " ", out)
        out = out.replace("\\", "").replace("{", "").replace("}", "")
        return re.sub(r"\s+", " ", out).strip()


@dataclass(slots=True)
class TexResume:
    """A parsed base resume: the source, plus where its bullets are."""

    source: str
    bullets: list[Bullet] = field(default_factory=list)

    def by_section(self) -> dict[str, list[Bullet]]:
        grouped: dict[str, list[Bullet]] = {}
        for bullet in self.bullets:
            grouped.setdefault(bullet.section, []).append(bullet)
        return grouped

    def by_list(self) -> dict[int, list[Bullet]]:
        grouped: dict[int, list[Bullet]] = {}
        for bullet in self.bullets:
            grouped.setdefault(bullet.list_index, []).append(bullet)
        return grouped

    def by_id(self) -> dict[str, Bullet]:
        """Bullets by stable id. Ids are unique by construction."""
        return {bullet.bullet_id: bullet for bullet in self.bullets}

    def inventory(self) -> list[dict[str, str]]:
        """What the tailoring model is shown: an addressable list of sentences.

        The model never sees LaTeX and never returns any. It sees an id, where
        the sentence sits, and what it currently says — and answers with
        operations against those ids.
        """
        return [
            {
                "bullet_id": bullet.bullet_id,
                "section": bullet.section,
                "entry": bullet.entry,
                "text": bullet.plain,
            }
            for bullet in self.bullets
        ]


def _matching_brace(source: str, open_index: int) -> int:
    """Index of the ``}`` closing the ``{`` at ``open_index``.

    Counts depth and honours ``\\{`` and ``\\}``, which appear in resume text as
    escaped braces and would otherwise unbalance the count.
    """
    depth = 0
    i = open_index
    while i < len(source):
        char = source[i]
        if char == "\\":
            i += 2
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError(f"unbalanced braces starting at offset {open_index}")


def _is_commented(source: str, position: int) -> bool:
    """Whether ``position`` sits on a commented-out line."""
    line_start = source.rfind("\n", 0, position) + 1
    return bool(_COMMENT_LINE.match(source[line_start:position] or ""))


def slug(text: str) -> str:
    """A lowercase, hyphenated identifier fragment. Stable for a given input."""
    return _SLUG_STRIP.sub("-", text.lower()).strip("-")


def _plain(fragment: str) -> str:
    """Strip the commonest markup, for reading rather than rendering."""
    out = re.sub(r"\\textbf\s*\{([^{}]*)\}", r"\1", fragment)
    out = re.sub(r"\\uline\s*\{([^{}]*)\}", r"\1", out)
    out = re.sub(r"\\emph\s*\{([^{}]*)\}", r"\1", out)
    out = re.sub(r"\\textmd\s*\{[^{}]*\}", " ", out)
    out = re.sub(r"\\href\s*\{[^{}]*\}\s*\{([^{}]*)\}", r"\1", out)
    out = re.sub(r"\\[a-zA-Z]+", " ", out)
    out = out.replace("\\", "").replace("{", "").replace("}", "")
    return re.sub(r"\s+", " ", out).strip()


def _entry_name(source: str, open_brace: int) -> str:
    """The employer, school or project named by an entry command's first argument.

    Everything after the first separator is dropped: this resume writes
    ``{Kenyon College\\textmd{ - Gambier, OH}}`` for a school and
    ``{\\href{...}{\\uline{\\textbf{ThesisLedger}}} $|$ \\emph{Django REST, ...}}``
    for a project, and only the name itself identifies the entry.
    """
    try:
        close = _matching_brace(source, open_brace)
    except ValueError:  # pragma: no cover - malformed source
        return ""
    name = _plain(source[open_brace + 1 : close])
    # A project heading lists its stack after a pipe; a school appends a location
    # after a dash. Neither is part of the entry's identity. Both dash characters
    # are listed because the template uses them interchangeably.
    for separator in ("$|$", "|", " - ", " – ", ","):
        name = name.split(separator)[0]
    return name.strip()


def find_bullets(source: str) -> list[Bullet]:
    """Every live ``\\resumeItem`` in the document body, in order.

    Two things are deliberately skipped.

    The preamble, because ``\\newcommand{\\resumeSubItem}[1]{\\resumeItem{#1}...}``
    contains a literal ``\\resumeItem{#1}`` that matches every pattern a bullet
    does. Editing it would rewrite the command's definition rather than a line of
    the resume — which is exactly the class of damage this module exists to make
    impossible.

    Commented-out bullets, because the user has already decided those are not on
    the resume; resurrecting one would be adding content rather than selecting
    it.

    Each bullet is given a stable id from its section, its entry, and its
    position within that entry. Where one section holds two entries with the same
    name the second is suffixed, so an id always addresses exactly one sentence.
    """
    body_at = source.find(r"\begin{document}")
    if body_at < 0:
        # No document environment: treat the whole file as body rather than
        # silently finding nothing, which would read as "this resume has no
        # bullets" and quietly disable tailoring.
        body_at = 0

    sections: list[tuple[int, str]] = [
        (match.start(), match.group(1).strip()) for match in _SECTION.finditer(source)
    ]

    def section_at(position: int) -> str:
        current = ""
        for start, title in sections:
            if start < position:
                current = title
            else:
                break
        return current

    list_starts = [m.start() for m in _LIST_START.finditer(source, body_at)]

    def list_at(position: int) -> int:
        current = 0
        for number, start in enumerate(list_starts, start=1):
            if start < position:
                current = number
            else:
                break
        return current

    # Entries, in document order, skipping the commented-out ones — a commented
    # job must not shift the ids of the jobs after it.
    entries: list[tuple[int, str]] = [
        (match.start(), _entry_name(source, match.end() - 1))
        for match in _ENTRY.finditer(source, body_at)
        if not _is_commented(source, match.start())
    ]

    #: Each entry occurrence gets a slug that is unique within its section, so an
    #: id resolves to one bullet even when a name repeats.
    entry_slug: dict[int, str] = {}
    seen: dict[tuple[str, str], int] = {}
    for start, name in entries:
        base = slug(name) or "entry"
        key = (slug(section_at(start)), base)
        seen[key] = seen.get(key, 0) + 1
        entry_slug[start] = base if seen[key] == 1 else f"{base}-{seen[key]}"

    def entry_at(position: int) -> tuple[str, str]:
        """The entry a bullet sits under: its name and its unique slug."""
        found = ("", "")
        for start, name in entries:
            if start < position:
                found = (name, entry_slug[start])
            else:
                break
        return found

    bullets: list[Bullet] = []
    ordinal: dict[str, int] = {}
    for match in _ITEM.finditer(source, body_at):
        brace = match.end() - 1
        if _is_commented(source, match.start()):
            continue
        close = _matching_brace(source, brace)
        section = section_at(match.start())
        entry_name, entry_key = entry_at(match.start())

        prefix = ".".join(part for part in (slug(section), entry_key) if part) or "bullet"
        ordinal[prefix] = ordinal.get(prefix, 0) + 1

        bullets.append(
            Bullet(
                index=len(bullets),
                section=section,
                text=source[brace + 1 : close],
                start=brace + 1,
                end=close,
                list_index=list_at(match.start()),
                entry=entry_name,
                bullet_id=f"{prefix}.{ordinal[prefix]}",
            )
        )
    return bullets


def parse(source: str) -> TexResume:
    return TexResume(source=source, bullets=find_bullets(source))


def render(
    document: TexResume,
    *,
    dropped: frozenset[int] = frozenset(),
    replacements: dict[int, str] | None = None,
) -> str:
    """Rebuild the source with bullets dropped or rewritten.

    Args:
        dropped: indices of bullets to remove entirely. The whole
            ``\\resumeItem{...}`` call goes, not just its text, so no empty
            bullet is left behind.
        replacements: new body text, keyed by bullet index.

    Everything outside the spliced spans is copied byte for byte, which is what
    makes "the template is preserved" a property of the code rather than a claim
    about it.
    """
    replacements = replacements or {}
    source = document.source
    pieces: list[str] = []
    cursor = 0

    for bullet in document.bullets:
        if bullet.index in dropped:
            # Take the whole call, and the line's leading whitespace with it, so
            # the file does not accumulate blank indented lines.
            call_start = source.rfind("\\resumeItem", 0, bullet.start)
            line_start = source.rfind("\n", 0, call_start) + 1
            drop_from = line_start if not source[line_start:call_start].strip() else call_start
            drop_to = bullet.end + 1
            if source[drop_to : drop_to + 1] == "\n":
                drop_to += 1
            pieces.append(source[cursor:drop_from])
            cursor = drop_to
            continue

        if (new_text := replacements.get(bullet.index)) is not None:
            pieces.append(source[cursor : bullet.start])
            pieces.append(new_text)
            cursor = bullet.end
            continue

    pieces.append(source[cursor:])
    return "".join(pieces)
