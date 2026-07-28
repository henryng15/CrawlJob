"""Recruiter import and matching (spec §7.12).

Two jobs, both of which fail badly if done carelessly.

**Import** reads a spreadsheet the user assembled by hand. It validates, previews
and only then commits, because the failure mode — a malformed address that later
produces a bounce, or a duplicate that produces two emails to one person — is
invisible until it has already happened. Nothing is sent during import (§7.12).

**Matching** picks which recruiter to contact about an application. It refuses to
guess: a fuzzy company match below the confidence threshold returns nothing and
asks the user, because emailing the wrong company's recruiter about a job they
have never heard of is worse than not emailing at all.
"""

from __future__ import annotations

import csv
import re
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from io import StringIO
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Company, Recruiter
from app.domain.normalization import normalize_company

__all__ = [
    "ImportReport",
    "ImportRow",
    "MatchResult",
    "RecruiterRow",
    "commit_import",
    "match_recruiter",
    "normalize_email",
    "parse_csv",
    "parse_rows",
    "preview_import",
]

#: Deliberately permissive. This validates shape, not deliverability — a stricter
#: pattern would reject valid addresses and the user cannot tell why.
_EMAIL = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[A-Za-z]{2,}$")

#: Titles that indicate the right person for a campus internship, best first
#: (§7.12).
_TITLE_PREFERENCE: tuple[str, ...] = (
    "university",
    "campus",
    "early career",
    "early talent",
    "student",
    "intern",
    "technical recruiter",
    "technical sourcer",
    "software",
    "engineering recruiter",
)

#: Below this, a fuzzy company match is not acted on.
FUZZY_THRESHOLD = 0.88


def normalize_email(value: str) -> str:
    """Lowercase and trim. Addresses are case-insensitive in the part that matters."""
    return value.strip().lower()


@dataclass(frozen=True, slots=True)
class RecruiterRow:
    """One validated row, ready to be written."""

    full_name: str
    raw_company: str
    email: str
    title: str | None = None
    linkedin_url: str | None = None
    location: str | None = None
    source: str | None = None
    company_domain: str | None = None

    @property
    def email_domain(self) -> str:
        """The employer's domain, preferring the column over the address.

        A recruiter using a personal or agency address still belongs to the
        company the spreadsheet names, and matching by domain has to agree.
        """
        return self.company_domain or self.email.rsplit("@", 1)[-1]

    @property
    def normalized_company(self) -> str:
        return normalize_company(self.raw_company)


@dataclass(frozen=True, slots=True)
class ImportRow:
    """A row plus what the importer concluded about it."""

    line: int
    raw: dict[str, str]
    parsed: RecruiterRow | None
    error: str | None = None
    is_duplicate_in_file: bool = False
    exists_in_database: bool = False

    @property
    def ok(self) -> bool:
        return self.parsed is not None and self.error is None


@dataclass(slots=True)
class ImportReport:
    """What a preview or commit found. Shown before anything is written (§7.12)."""

    rows: list[ImportRow] = field(default_factory=list)
    committed: int = 0
    updated: int = 0

    @property
    def valid(self) -> list[ImportRow]:
        return [r for r in self.rows if r.ok and not r.is_duplicate_in_file]

    @property
    def invalid(self) -> list[ImportRow]:
        return [r for r in self.rows if not r.ok]

    @property
    def duplicates_in_file(self) -> list[ImportRow]:
        return [r for r in self.rows if r.is_duplicate_in_file]

    @property
    def already_known(self) -> list[ImportRow]:
        return [r for r in self.valid if r.exists_in_database]

    def summary(self) -> str:
        return (
            f"{len(self.rows)} rows: {len(self.valid)} valid, "
            f"{len(self.invalid)} invalid, "
            f"{len(self.duplicates_in_file)} duplicated within the file, "
            f"{len(self.already_known)} already in the database"
        )


_HEADER_ALIASES: dict[str, str] = {
    # The user's own export uses these; see ColdEmail/finals/*.csv.
    "company_name": "raw_company",
    "recruiter_name": "full_name",
    "recruiter_title": "title",
    "domain": "company_domain",
    "name": "full_name",
    "full name": "full_name",
    "full_name": "full_name",
    "recruiter": "full_name",
    "recruiter name": "full_name",
    "company": "raw_company",
    "employer": "raw_company",
    "organization": "raw_company",
    "email": "email",
    "email address": "email",
    "e-mail": "email",
    "title": "title",
    "job title": "title",
    "role": "title",
    "linkedin": "linkedin_url",
    "linkedin_url": "linkedin_url",
    "linkedin url": "linkedin_url",
    "location": "location",
    "source": "source",
    "source_provider": "source",
    "notes": "notes",
    # Deliverability verdicts from an email-verification provider. A row the
    # provider already called undeliverable must not be imported: sending to it
    # damages the sending domain's reputation for every later email.
    "debounce_result": "deliverability",
    "certainty": "deliverability",
    "confidence": "deliverability",
    "verify_method": "deliverability",
}

#: Verdicts that mean "do not send here". Matched case-insensitively as a
#: substring, because providers word these differently.
_UNDELIVERABLE = ("invalid", "bounce", "undeliverable", "do not send", "unknown", "risky")


def _canonical_headers(fieldnames: Sequence[str] | None) -> dict[str, str]:
    return {name: _HEADER_ALIASES.get(name.strip().lower(), "") for name in (fieldnames or [])}


def parse_csv(text: str) -> Iterator[tuple[int, dict[str, str]]]:
    """Yield ``(line_number, canonical_row)`` from CSV text."""
    reader = csv.DictReader(StringIO(text))
    mapping = _canonical_headers(reader.fieldnames)
    for offset, raw in enumerate(reader, start=2):
        row: dict[str, str] = {}
        for source_key, value in raw.items():
            key = mapping.get(source_key or "", "")
            if key and value:
                row[key] = value.strip()
        yield offset, row


def parse_xlsx(path: Path) -> Iterator[tuple[int, dict[str, str]]]:
    """Yield ``(line_number, canonical_row)`` from an XLSX file.

    Imported lazily so the spreadsheet dependency is optional — a user who only
    ever exports CSV should not need it installed.
    """
    from openpyxl import load_workbook

    workbook = load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.active
    if sheet is None:
        return
    rows = sheet.iter_rows(values_only=True)
    headers = [str(c or "") for c in next(rows, ())]
    mapping = _canonical_headers(headers)

    for offset, values in enumerate(rows, start=2):
        row: dict[str, str] = {}
        for header, value in zip(headers, values, strict=False):
            key = mapping.get(header, "")
            if key and value is not None:
                row[key] = str(value).strip()
        yield offset, row
    workbook.close()


def _validate(line: int, row: dict[str, str]) -> ImportRow:
    name = row.get("full_name", "").strip()
    company = row.get("raw_company", "").strip()
    email = normalize_email(row.get("email", ""))

    missing = [
        label
        for label, value in (("name", name), ("company", company), ("email", email))
        if not value
    ]
    if missing:
        return ImportRow(line, row, None, f"missing {', '.join(missing)}")

    if not _EMAIL.match(email):
        return ImportRow(line, row, None, f"invalid email address: {email!r}")

    verdict = row.get("deliverability", "").strip().lower()
    if verdict and any(bad in verdict for bad in _UNDELIVERABLE):
        return ImportRow(line, row, None, f"address marked undeliverable: {verdict!r}")

    return ImportRow(
        line,
        row,
        RecruiterRow(
            full_name=name,
            raw_company=company,
            email=email,
            title=row.get("title") or None,
            linkedin_url=row.get("linkedin_url") or None,
            location=row.get("location") or None,
            source=row.get("source") or None,
            company_domain=(row.get("company_domain") or "").strip().lower() or None,
        ),
    )


def parse_rows(rows: Iterable[tuple[int, dict[str, str]]]) -> list[ImportRow]:
    """Validate rows and flag addresses repeated within the file."""
    seen: set[str] = set()
    parsed: list[ImportRow] = []

    for line, raw in rows:
        if not any(raw.values()):
            continue  # blank line
        item = _validate(line, raw)
        # Bound to a local because reassigning `item` below discards the narrowing.
        recruiter = item.parsed
        if recruiter is not None:
            if recruiter.email in seen:
                item = ImportRow(item.line, item.raw, recruiter, is_duplicate_in_file=True)
            else:
                seen.add(recruiter.email)
        parsed.append(item)

    return parsed


def preview_import(session: Session, text: str) -> ImportReport:
    """Parse and validate without writing anything (§7.12).

    No email is sent, and no row is stored. The user sees exactly what would
    happen before it does.
    """
    report = ImportReport(rows=parse_rows(parse_csv(text)))

    emails = [r.parsed.email for r in report.valid if r.parsed is not None]
    if emails:
        known = set(
            session.scalars(select(Recruiter.email).where(Recruiter.email.in_(emails))).all()
        )
        report.rows = [
            ImportRow(
                r.line,
                r.raw,
                r.parsed,
                r.error,
                r.is_duplicate_in_file,
                exists_in_database=r.parsed is not None and r.parsed.email in known,
            )
            for r in report.rows
        ]

    return report


def commit_import(session: Session, text: str) -> ImportReport:
    """Write valid rows, merging by email rather than duplicating."""
    report = preview_import(session, text)

    for item in report.valid:
        assert item.parsed is not None
        row = item.parsed
        existing = session.scalars(select(Recruiter).where(Recruiter.email == row.email)).first()

        company = session.scalars(
            select(Company).where(Company.normalized_name == row.normalized_company)
        ).first()

        if existing is not None:
            # Re-importing a corrected spreadsheet should fix the record, but must
            # never resurrect someone who asked not to be contacted.
            existing.full_name = row.full_name
            existing.raw_company = row.raw_company
            existing.title = row.title or existing.title
            existing.linkedin_url = row.linkedin_url or existing.linkedin_url
            existing.location = row.location or existing.location
            existing.email_domain = row.email_domain
            if company is not None:
                existing.company_id = company.id
            report.updated += 1
            continue

        session.add(
            Recruiter(
                full_name=row.full_name,
                raw_company=row.raw_company,
                email=row.email,
                email_domain=row.email_domain,
                title=row.title,
                linkedin_url=row.linkedin_url,
                location=row.location,
                source=row.source or "import",
                company_id=company.id if company else None,
            )
        )
        report.committed += 1

    session.flush()
    return report


# ------------------------------------------------------------------ matching


@dataclass(frozen=True, slots=True)
class MatchResult:
    recruiter: Recruiter | None
    matched_on: str | None = None
    confidence: float = 0.0
    candidates: tuple[Recruiter, ...] = ()
    needs_manual_selection: bool = False
    reason: str = ""


def _title_rank(recruiter: Recruiter) -> int:
    """Lower is better. Unranked titles sort last."""
    title = (recruiter.title or "").lower()
    for index, keyword in enumerate(_TITLE_PREFERENCE):
        if keyword in title:
            return index
    return len(_TITLE_PREFERENCE)


def _pick(
    candidates: Sequence[Recruiter],
    *,
    now: datetime,
    cooldown_days: int,
) -> tuple[Recruiter | None, bool]:
    """Choose one recruiter, preferring campus titles and uncontacted people."""
    available = [
        r
        for r in candidates
        if not r.do_not_contact
        and r.replied_at is None
        and (
            r.last_contacted_at is None
            or now - r.last_contacted_at >= timedelta(days=cooldown_days)
        )
    ]
    if not available:
        return None, False

    available.sort(
        key=lambda r: (
            _title_rank(r),
            r.last_contacted_at or datetime.min.replace(tzinfo=now.tzinfo),
        )
    )

    best_rank = _title_rank(available[0])
    tied = [r for r in available if _title_rank(r) == best_rank]
    # Several equally plausible people means the choice is the user's (§7.12).
    return available[0], len(tied) > 1 and best_rank == len(_TITLE_PREFERENCE)


def match_recruiter(
    session: Session,
    *,
    company_name: str,
    company_domain: str | None = None,
    now: datetime,
    cooldown_days: int = 30,
    fuzzy_threshold: float = FUZZY_THRESHOLD,
) -> MatchResult:
    """Find the recruiter to contact about a role at ``company_name``.

    Resolution order follows §7.12: exact normalized company, then email domain,
    then fuzzy name above a threshold. Below the threshold nothing is returned —
    emailing the wrong company is worse than emailing nobody.
    """
    normalized = normalize_company(company_name)
    if not normalized:
        return MatchResult(None, reason="company name was empty")

    exact = list(
        session.scalars(
            select(Recruiter)
            .join(Company, isouter=True)
            .where(Company.normalized_name == normalized)
        ).all()
    )
    if not exact:
        exact = [
            r
            for r in session.scalars(select(Recruiter)).all()
            if normalize_company(r.raw_company) == normalized
        ]
    if exact:
        chosen, ambiguous = _pick(exact, now=now, cooldown_days=cooldown_days)
        return MatchResult(
            chosen,
            matched_on="company",
            confidence=1.0,
            candidates=tuple(exact),
            needs_manual_selection=ambiguous or chosen is None,
            reason="exact company match" if chosen else "all matches are on cooldown or suppressed",
        )

    if company_domain:
        by_domain = list(
            session.scalars(
                select(Recruiter).where(Recruiter.email_domain == company_domain.lower())
            ).all()
        )
        if by_domain:
            chosen, ambiguous = _pick(by_domain, now=now, cooldown_days=cooldown_days)
            return MatchResult(
                chosen,
                matched_on="email_domain",
                confidence=0.95,
                candidates=tuple(by_domain),
                needs_manual_selection=ambiguous or chosen is None,
                reason=f"email domain matches {company_domain}",
            )

    best: tuple[float, list[Recruiter]] = (0.0, [])
    grouped: dict[str, list[Recruiter]] = {}
    for recruiter in session.scalars(select(Recruiter)).all():
        grouped.setdefault(normalize_company(recruiter.raw_company), []).append(recruiter)

    for candidate_name, group in grouped.items():
        ratio = SequenceMatcher(None, normalized, candidate_name).ratio()
        if ratio > best[0]:
            best = (ratio, group)

    if best[0] >= fuzzy_threshold:
        chosen, ambiguous = _pick(best[1], now=now, cooldown_days=cooldown_days)
        return MatchResult(
            chosen,
            matched_on="fuzzy_company",
            confidence=best[0],
            candidates=tuple(best[1]),
            # A fuzzy match is never acted on silently, however close.
            needs_manual_selection=True,
            reason=f"fuzzy company match at {best[0]:.2f}",
        )

    return MatchResult(
        None,
        confidence=best[0],
        needs_manual_selection=True,
        reason=f"no recruiter found for {company_name!r}",
    )
