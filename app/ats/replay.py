"""Replay packages and semantic locators (spec §7.11).

Playwright's storage state preserves cookies, local storage and IndexedDB. It does
not preserve text the user typed into an ordinary input, which is exactly what a
half-filled application consists of. So a live session that expires cannot simply
be restored — the answers have to be re-entered, against a page that may have
changed in the meantime.

That is what a replay package is: the answers, plus enough information to find
each field again. Locators are recorded in order of durability, because a CSS
selector is the first thing an ATS redesign breaks:

1. accessible label
2. ARIA role and name
3. HTML ``name`` attribute
4. associated ``<label for=...>``
5. nearby question text
6. ATS-specific stable attributes
7. CSS selector, last

If the page has changed materially, replay stops and asks for a human rather than
typing an answer into whatever field happens to be in the same position (§7.11).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import IntEnum
from typing import Any

from app.ats.fields import Answer, FieldSpec, SourceType

__all__ = [
    "LocatorStrategy",
    "ReplayField",
    "ReplayPackage",
    "Strategy",
    "build_package",
    "page_fingerprint",
]


class Strategy(IntEnum):
    """Locator kinds, most durable first (§7.11)."""

    ACCESSIBLE_LABEL = 1
    ARIA_ROLE_NAME = 2
    NAME_ATTRIBUTE = 3
    LABEL_FOR = 4
    NEARBY_TEXT = 5
    ATS_ATTRIBUTE = 6
    CSS_SELECTOR = 7


@dataclass(frozen=True, slots=True)
class LocatorStrategy:
    strategy: Strategy
    value: str
    role: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {"strategy": self.strategy.name, "value": self.value, "role": self.role}


@dataclass(frozen=True, slots=True)
class ReplayField:
    semantic_key: str | None
    label: str
    field_type: str
    value: Any
    source_type: SourceType
    required: bool
    locators: tuple[LocatorStrategy, ...]
    page_index: int = 0

    @property
    def is_manual(self) -> bool:
        return self.source_type in {SourceType.MANUAL_REQUIRED, SourceType.UNRESOLVED}


@dataclass(slots=True)
class ReplayPackage:
    application_id: str
    application_url: str
    ats_type: str
    page_fingerprint: str
    created_at: datetime
    fields: list[ReplayField] = field(default_factory=list)
    manual_fields: list[ReplayField] = field(default_factory=list)
    storage_state_path: str | None = None
    resume_artifact_path: str | None = None

    def to_json(self) -> dict[str, Any]:
        def encode(item: ReplayField) -> dict[str, Any]:
            data = asdict(item)
            data["source_type"] = item.source_type.value
            data["locators"] = [loc.to_json() for loc in item.locators]
            return data

        return {
            "application_id": self.application_id,
            "application_url": self.application_url,
            "ats_type": self.ats_type,
            "page_fingerprint": self.page_fingerprint,
            "created_at": self.created_at.isoformat(),
            "storage_state_path": self.storage_state_path,
            "resume_artifact_path": self.resume_artifact_path,
            "fields": [encode(f) for f in self.fields],
            "manual_fields": [encode(f) for f in self.manual_fields],
        }


def build_locators(spec: FieldSpec) -> tuple[LocatorStrategy, ...]:
    """Derive every locator available for a field, most durable first."""
    locators: list[LocatorStrategy] = []

    if spec.question_text:
        locators.append(LocatorStrategy(Strategy.ACCESSIBLE_LABEL, spec.question_text))
        role = _role_for(spec.field_type.value)
        if role:
            locators.append(LocatorStrategy(Strategy.ARIA_ROLE_NAME, spec.question_text, role))
    if spec.name:
        locators.append(LocatorStrategy(Strategy.NAME_ATTRIBUTE, spec.name))

    for key, value in spec.locator.items():
        match key:
            case "label_for":
                locators.append(LocatorStrategy(Strategy.LABEL_FOR, str(value)))
            case "nearby_text":
                locators.append(LocatorStrategy(Strategy.NEARBY_TEXT, str(value)))
            case "ats_attribute":
                locators.append(LocatorStrategy(Strategy.ATS_ATTRIBUTE, str(value)))
            case "css":
                locators.append(LocatorStrategy(Strategy.CSS_SELECTOR, str(value)))

    return tuple(sorted(locators, key=lambda loc: loc.strategy))


def _role_for(field_type: str) -> str | None:
    return {
        "text": "textbox",
        "email": "textbox",
        "phone": "textbox",
        "url": "textbox",
        "textarea": "textbox",
        "number": "spinbutton",
        "select": "combobox",
        "multiselect": "listbox",
        "radio": "radio",
        "checkbox": "checkbox",
        "file": "button",
    }.get(field_type)


def page_fingerprint(specs: list[FieldSpec]) -> str:
    """A hash of the form's shape.

    Covers the question set and their types, not their values or order of
    appearance on screen. A changed fingerprint means the form itself changed,
    which is the condition under which replay must stop (§7.11).
    """
    shape = sorted(
        f"{spec.question_text.strip().lower()}|{spec.field_type.value}|{spec.required}"
        for spec in specs
    )
    return hashlib.sha256(json.dumps(shape).encode()).hexdigest()


def build_package(
    *,
    application_id: str,
    application_url: str,
    ats_type: str,
    specs: list[FieldSpec],
    answers: list[Answer],
    created_at: datetime,
    storage_state_path: str | None = None,
    resume_artifact_path: str | None = None,
) -> ReplayPackage:
    """Assemble a replay package from a filled form.

    Manual and unresolved fields are recorded separately: replay must not type
    anything into them, and the review screen lists them as the work remaining.
    """
    if len(specs) != len(answers):
        raise ValueError(f"specs and answers must be parallel; got {len(specs)} and {len(answers)}")

    package = ReplayPackage(
        application_id=application_id,
        application_url=application_url,
        ats_type=ats_type,
        page_fingerprint=page_fingerprint(specs),
        created_at=created_at,
        storage_state_path=storage_state_path,
        resume_artifact_path=resume_artifact_path,
    )

    for spec, answer in zip(specs, answers, strict=True):
        item = ReplayField(
            semantic_key=answer.semantic_key,
            label=spec.question_text,
            field_type=spec.field_type.value,
            value=answer.value,
            source_type=answer.source_type,
            required=spec.required,
            locators=build_locators(spec),
            page_index=spec.page_index,
        )
        (package.manual_fields if item.is_manual else package.fields).append(item)

    return package


@dataclass(frozen=True, slots=True)
class ReplayCheck:
    """Whether a stored package may still be replayed against a page."""

    can_replay: bool
    reason: str
    changed_fields: tuple[str, ...] = ()


def check_replayable(package: ReplayPackage, current: list[FieldSpec]) -> ReplayCheck:
    """Compare a package against the form as it is now (§7.11).

    A material change stops replay. Typing a stored answer into a form whose
    questions have moved is how the wrong text ends up in the wrong box, and the
    user would be reviewing a page that looks plausible and is wrong.
    """
    now = page_fingerprint(current)
    if now == package.page_fingerprint:
        return ReplayCheck(True, "form is unchanged")

    stored_labels = {f.label.strip().lower() for f in package.fields + package.manual_fields}
    current_labels = {spec.question_text.strip().lower() for spec in current}

    missing = stored_labels - current_labels
    added = current_labels - stored_labels

    if not missing and added:
        return ReplayCheck(
            True,
            f"form gained {len(added)} question(s); stored answers still map",
            tuple(sorted(added)),
        )

    return ReplayCheck(
        False,
        f"form changed materially: {len(missing)} question(s) are gone",
        tuple(sorted(missing)),
    )
