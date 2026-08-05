"""How a form field is found again.

One field, several ways to point at it, tried in a fixed order: the accessible
label first and a CSS selector last. That order is not a preference — it is what
survives an ATS redesign. A label is what the applicant reads and what the
employer maintains; a generated class name is an implementation detail that
changes when someone reskins the page.

When no strategy resolves, the caller reports the field unfilled rather than
writing an answer into a best-guess element. A form that looks plausible and is
wrong is the hardest kind of error to catch, and this system now submits.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum

from app.ats.fields import FieldSpec

__all__ = [
    "LocatorStrategy",
    "Strategy",
    "build_locators",
]


class Strategy(IntEnum):
    """Locator kinds, most durable first."""

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

    def to_json(self) -> dict[str, str | None]:
        """Serialised onto ``application_fields.locator_strategy`` for the audit
        trail — how a given answer was placed is part of what was sent."""
        return {"strategy": self.strategy.name, "value": self.value, "role": self.role}


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
