"""The manual-only company list.

A list of employers whose applications are never submitted automatically — the
system may prepare one, but a person finishes it. The list is imported from a CSV
the user maintains and is consulted before any automated submission.

The key is the **domain**, and the reason is worth stating once: company names do
not identify companies. Two names can be one employer ("Raytheon" / "RTX"), one
name can be two employers, and abbreviations collide with real words.

Everything in :func:`is_manual_only` therefore fails *closed*. The system now
clicks Submit on its own, so a wrong "no" is not a wasted preparation any more —
it is an application sent to an employer the user had reserved for themselves,
and there is no undo for that. A wrong "yes" costs the user a few minutes in
their own browser. The two errors are not comparable, so the function only ever
answers "no" when it has a domain and that domain is demonstrably absent.
"""

from __future__ import annotations

import csv
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ManualOnlyCompany
from app.domain.normalization import normalize_company

__all__ = [
    "ImportReport",
    "import_csv",
    "is_manual_only",
    "normalize_domain",
    "plan_import",
    "preview_import",
]

#: A normalized company name shorter than this is never matched by name. "X"
#: folds to the one-character key ``x``, which would match any row whose name
#: folded the same way — a company literally called X exists, and so do dozens of
#: single-letter product names.
_MIN_NAME_KEY_LENGTH = 2


def normalize_domain(value: str) -> str:
    """Fold a domain to its match key.

    ``"https://www.Stripe.com/ "`` and ``"stripe.com"`` both become
    ``"stripe.com"``. Scheme, ``www.``, port, path, query and surrounding
    whitespace are all dropped; what remains is lowercased.

    Returns the empty string when nothing usable is left, which callers must
    treat as "no domain" rather than as a key.
    """
    host = value.strip().lower()
    if "//" in host:
        host = host.split("//", 1)[1]
    for separator in ("/", "?", "#"):
        host = host.split(separator, 1)[0]
    host = host.split(":", 1)[0]
    host = host.removeprefix("www.")
    return host.strip(" .")


@dataclass(slots=True)
class ImportReport:
    """What an import did, or would do."""

    added: int = 0
    #: Already on the list. Re-importing the same file skips every row.
    skipped: int = 0
    #: The same domain twice within one file.
    duplicates: int = 0
    #: Rows with no usable domain or no name. Reported, never guessed at.
    invalid: int = 0

    @property
    def total(self) -> int:
        return self.added + self.skipped + self.duplicates + self.invalid

    def summary(self) -> str:
        return (
            f"{self.total} rows: {self.added} added, "
            f"{self.skipped} already listed, "
            f"{self.duplicates} duplicated within the file, "
            f"{self.invalid} unusable"
        )


def _read(path: Path) -> Iterator[dict[str, str]]:
    """Yield rows keyed by lowercased header."""
    reader = csv.DictReader(path.read_text(encoding="utf-8-sig").splitlines())
    for raw in reader:
        yield {(key or "").strip().lower(): (value or "").strip() for key, value in raw.items()}


def plan_import(
    session: Session, path: Path, *, source: str
) -> tuple[ImportReport, list[ManualOnlyCompany]]:
    """Work out what importing ``path`` would change. Writes nothing."""
    known = set(session.scalars(select(ManualOnlyCompany.domain)).all())
    seen: set[str] = set()
    pending: list[ManualOnlyCompany] = []
    report = ImportReport()

    for row in _read(path):
        domain = normalize_domain(row.get("domain", ""))
        name = row.get("company_name", "")
        if not domain or not name:
            report.invalid += 1
            continue
        if domain in seen:
            report.duplicates += 1
            continue
        seen.add(domain)
        if domain in known:
            report.skipped += 1
            continue
        pending.append(ManualOnlyCompany(domain=domain, company_name=name, source=source))
        report.added += 1

    return report, pending


def preview_import(session: Session, path: Path, *, source: str) -> ImportReport:
    """Parse and compare without writing, so the user sees the change first."""
    return plan_import(session, path, source=source)[0]


def import_csv(session: Session, path: Path, *, source: str) -> ImportReport:
    """Import ``path``, adding rows that are not already listed.

    Idempotent: a domain already on the list is skipped, not rewritten, so
    re-running the same file changes nothing at all. An existing row's
    ``company_name`` and ``source`` are left alone — the list is a set of
    domains, and the rest is decoration.
    """
    report, pending = plan_import(session, path, source=source)
    session.add_all(pending)
    session.flush()
    return report


def _match_keys(host: str) -> list[str]:
    """``host`` and every parent domain of it, most specific first.

    A feed hands us ``careers.stripe.com`` while the user's list says
    ``stripe.com``. Comparing only the exact string would call that a miss, and a
    miss is now an auto-submission. Parents can only ever add a "yes", so a
    meaningless tail like ``com.br`` in the sequence costs nothing: it is not on
    anyone's list, and if it somehow were, that is the user's own list saying so.
    """
    labels = host.split(".")
    return [".".join(labels[index:]) for index in range(len(labels) - 1)]


def _domain_is_listed(session: Session, host: str) -> bool:
    return (
        session.scalars(
            select(ManualOnlyCompany.id)
            .where(ManualOnlyCompany.domain.in_(_match_keys(host)))
            .limit(1)
        ).first()
        is not None
    )


def _name_is_listed(session: Session, company_name: str | None) -> bool:
    """Does a listed company fold to the same name key as ``company_name``?

    Names shorter than two characters after folding are never matched: ``"X"``
    folds to ``"x"``, and a one-character key would pull any similarly folded
    name onto the list.
    """
    if not company_name:
        return False
    key = normalize_company(company_name)
    if len(key) < _MIN_NAME_KEY_LENGTH:
        return False
    listed = session.scalars(select(ManualOnlyCompany.company_name)).all()
    return any(normalize_company(name) == key for name in listed)


def is_manual_only(session: Session, *, domain: str | None, company_name: str | None) -> bool:
    """Must an application to this employer be finished by hand? **Fails closed.**

    Exactly one thing produces ``False``: a usable domain that is absent from the
    list, under a name that is also absent. Everything else is ``True``.

    In particular **no domain means ``True``**. Do not "fix" that by falling
    through to the name — this function is the last thing between a discovered
    posting and a browser that clicks Submit, and ``False`` is the irreversible
    answer. A company routed to manual by mistake costs the user a few minutes;
    a company routed to auto by mistake sends an application they had reserved
    for themselves, in their words, and it cannot be recalled.

    The name check is an **additional way to reach ``True``** and never a way to
    reach ``False``. It compares
    :func:`~app.domain.normalization.normalize_company` keys, which miss every
    one of these real pairs:

    * ``"DE Shaw"`` vs ``"D. E. Shaw & Co."``
    * ``"Raytheon"`` vs ``"RTX"``
    * ``"Coca-Cola"`` vs ``"The Coca-Cola Company"``
    * ``"BCG"`` vs ``"Boston Consulting Group"``

    So a name that does not match proves nothing at all, and is treated as
    proving nothing. Only the domain can clear an employer for auto-submission,
    which is the whole reason discovery works to obtain one.
    """
    host = normalize_domain(domain or "")
    if not host:
        return True
    return _domain_is_listed(session, host) or _name_is_listed(session, company_name)
