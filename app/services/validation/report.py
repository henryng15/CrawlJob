"""What a validation run found, in a shape that can be printed or stored.

Findings carry a severity because the useful question is not "did anything look
odd" but "is this adapter safe to rely on". A feed that omits a timestamp on one
posting in two hundred is worth knowing about; a feed whose URLs do not
canonicalise is not usable at all.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Any

__all__ = [
    "AdapterReport",
    "Finding",
    "Severity",
    "StageOneReport",
    "StageTwoReport",
    "write_report",
]


class Severity(StrEnum):
    #: The adapter cannot be trusted for this. Blocks real-world use.
    BLOCKER = "BLOCKER"
    #: Works, but something is missing or degraded that a person should see.
    WARNING = "WARNING"
    #: Worth recording; no action implied.
    NOTE = "NOTE"


@dataclass(frozen=True, slots=True)
class Finding:
    severity: Severity
    check: str
    detail: str
    #: The posting or field it concerns, when it concerns one.
    subject: str = ""

    def line(self) -> str:
        where = f" [{self.subject}]" if self.subject else ""
        return f"{self.severity.value:<8} {self.check}{where}: {self.detail}"


@dataclass
class AdapterReport:
    """One ATS, one board."""

    ats: str
    board: str
    source_name: str = ""
    url: str = ""
    fetched: int = 0
    fetch_error: str = ""
    findings: list[Finding] = field(default_factory=list)
    #: Counts of the things checked, for the summary line.
    stats: dict[str, Any] = field(default_factory=dict)
    #: Postings that passed the pre-spend screen, by title. Stage 2 picks from
    #: these, so seeing them is part of the read-only result.
    eligible: list[dict[str, str]] = field(default_factory=list)

    def add(self, severity: Severity, check: str, detail: str, subject: str = "") -> None:
        self.findings.append(Finding(severity, check, detail, subject))

    @property
    def blockers(self) -> list[Finding]:
        return [f for f in self.findings if f.severity is Severity.BLOCKER]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if f.severity is Severity.WARNING]

    @property
    def ok(self) -> bool:
        return not self.fetch_error and not self.blockers

    def as_dict(self) -> dict[str, Any]:
        return {
            "ats": self.ats,
            "board": self.board,
            "source_name": self.source_name,
            "url": self.url,
            "fetched": self.fetched,
            "fetch_error": self.fetch_error,
            "ok": self.ok,
            "stats": self.stats,
            "eligible": self.eligible,
            "findings": [
                {
                    "severity": f.severity.value,
                    "check": f.check,
                    "detail": f.detail,
                    "subject": f.subject,
                }
                for f in self.findings
            ],
        }


@dataclass
class StageOneReport:
    started_at: datetime
    adapters: list[AdapterReport] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return all(a.ok for a in self.adapters)

    def by_ats(self) -> dict[str, list[AdapterReport]]:
        grouped: dict[str, list[AdapterReport]] = {}
        for adapter in self.adapters:
            grouped.setdefault(adapter.ats, []).append(adapter)
        return grouped

    def as_dict(self) -> dict[str, Any]:
        return {
            "stage": 1,
            "started_at": self.started_at.isoformat(),
            "ok": self.ok,
            "adapters": [a.as_dict() for a in self.adapters],
        }


@dataclass
class StageTwoReport:
    """One real application form, opened and mapped. Never submitted."""

    ats: str
    company: str = ""
    title: str = ""
    url: str = ""
    reached_form: bool = False
    fields_found: int = 0
    filled: list[str] = field(default_factory=list)
    left_for_human: list[dict[str, str]] = field(default_factory=list)
    unrecognised: list[str] = field(default_factory=list)
    resume_attached: bool = False
    resume_confirmation: str = ""
    screenshot: str = ""
    mapping_path: str = ""
    #: Always false. Recorded so the artifact says so in writing.
    submitted: bool = False
    findings: list[Finding] = field(default_factory=list)
    error: str = ""

    def add(self, severity: Severity, check: str, detail: str, subject: str = "") -> None:
        self.findings.append(Finding(severity, check, detail, subject))

    @property
    def blockers(self) -> list[Finding]:
        return [f for f in self.findings if f.severity is Severity.BLOCKER]

    @property
    def ok(self) -> bool:
        return self.reached_form and not self.error and not self.blockers

    def as_dict(self) -> dict[str, Any]:
        return {
            "stage": 2,
            "ats": self.ats,
            "company": self.company,
            "title": self.title,
            "url": self.url,
            "reached_form": self.reached_form,
            "fields_found": self.fields_found,
            "filled": self.filled,
            "left_for_human": self.left_for_human,
            "unrecognised": self.unrecognised,
            "resume_attached": self.resume_attached,
            "resume_confirmation": self.resume_confirmation,
            "screenshot": self.screenshot,
            "mapping_path": self.mapping_path,
            "submitted": self.submitted,
            "error": self.error,
            "ok": self.ok,
            "findings": [
                {
                    "severity": f.severity.value,
                    "check": f.check,
                    "detail": f.detail,
                    "subject": f.subject,
                }
                for f in self.findings
            ],
        }


def write_report(path: Path, payload: dict[str, Any]) -> Path:
    """Store a report beside the run's other artifacts."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    return path
