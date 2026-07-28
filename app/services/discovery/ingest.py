"""Persist discovery results (spec §7.2, §7.4).

Ties an adapter's output to the deduplication engine and the source-record trail.
The rule this enforces is that provenance survives merging: when four feeds report
one role, one ``Job`` row results but four ``JobSourceRecord`` rows remain, each
linked to it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Job, JobSourceLink, JobSourceRecord
from app.services.dedupe import DedupeVerdict, upsert_job
from app.services.discovery.base import DiscoveryAdapter, RawPosting

__all__ = ["IngestReport", "ingest", "ingest_all"]


@dataclass(slots=True)
class IngestReport:
    """What one discovery run did. Rendered on the dashboard (§22.1)."""

    source_name: str
    fetched: int = 0
    new_jobs: int = 0
    duplicates: int = 0
    probable_duplicates: int = 0
    skipped: int = 0
    errors: list[str] | None = None

    def __post_init__(self) -> None:
        if self.errors is None:
            self.errors = []

    @property
    def ok(self) -> bool:
        return not self.errors


def _record_source(
    session: Session,
    raw: RawPosting,
    job: Job,
) -> None:
    """Store the verbatim payload and link it to the job, unless already stored.

    Feeds republish unchanged rows daily. The uniqueness key includes the content
    hash, so an unchanged row is a no-op and a changed one produces a new record
    rather than overwriting history.
    """
    existing = session.scalars(
        select(JobSourceRecord).where(
            JobSourceRecord.source_type == raw.source_type,
            JobSourceRecord.source_name == raw.source_name,
            JobSourceRecord.external_id == raw.external_id,
            JobSourceRecord.content_hash == raw.content_hash,
        )
    ).first()

    if existing is None:
        existing = JobSourceRecord(
            source_type=raw.source_type,
            source_name=raw.source_name,
            external_id=raw.external_id,
            source_url=raw.source_url,
            raw_payload=raw.raw_payload,
            content_hash=raw.content_hash,
            fetched_at=raw.fetched_at,
        )
        session.add(existing)
        session.flush()

    link_exists = session.get(JobSourceLink, (job.id, existing.id))
    if link_exists is None:
        session.add(JobSourceLink(job_id=job.id, source_record_id=existing.id))
        session.flush()


def ingest(
    session: Session,
    postings: list[RawPosting],
    *,
    source_name: str,
    now: datetime | None = None,
) -> IngestReport:
    """Deduplicate and store a batch of postings."""
    report = IngestReport(source_name=source_name, fetched=len(postings))

    for raw in postings:
        try:
            job, result = upsert_job(session, raw.posting, now=now)
        except ValueError as exc:
            report.skipped += 1
            assert report.errors is not None
            report.errors.append(f"{raw.posting.application_url}: {exc}")
            continue

        _record_source(session, raw, job)

        match result.verdict:
            case DedupeVerdict.NEW:
                report.new_jobs += 1
            case DedupeVerdict.DUPLICATE_PROBABLE:
                report.probable_duplicates += 1
            case _:
                report.duplicates += 1

    return report


def ingest_all(
    session: Session,
    adapters: list[DiscoveryAdapter],
    *,
    now: datetime | None = None,
) -> list[IngestReport]:
    """Run several adapters, isolating failures.

    One board returning a 500 must not cost the other nine their results, so each
    adapter's exception is captured into its own report and the run continues.
    """
    reports = []
    for adapter in adapters:
        try:
            postings = list(adapter.fetch())
        except Exception as exc:  # a bad feed is expected, not exceptional
            reports.append(
                IngestReport(
                    source_name=adapter.source_name,
                    errors=[f"{type(exc).__name__}: {exc}"],
                )
            )
            continue
        reports.append(ingest(session, postings, source_name=adapter.source_name, now=now))
    return reports
