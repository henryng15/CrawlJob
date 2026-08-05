"""``internship-ops`` — the operator's interface (spec §20).

Everything a person needs to run this by hand: start the web app, start a worker,
hash a password, queue a discovery run, and see what the queue is doing. No
command here submits an application or sends an email; there is no flag that
would.
"""

from __future__ import annotations

import argparse
import getpass
import json
import logging
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

__all__ = ["main"]


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="internship-ops", description=__doc__)
    parser.add_argument(
        "--log-level", default="INFO", help="DEBUG, INFO, WARNING, ERROR (default: INFO)"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    serve = sub.add_parser("serve", help="run the web application")
    serve.add_argument("--host", default="127.0.0.1", help="bind address (default: loopback)")
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--reload", action="store_true", help="development auto-reload")
    serve.set_defaults(run=_serve)

    worker = sub.add_parser("worker", help="run a task worker")
    worker.add_argument(
        "--types",
        default="",
        help="comma-separated task types to claim; default is all registered",
    )
    worker.add_argument("--once", action="store_true", help="run one task and exit")
    worker.add_argument(
        "--no-scheduler",
        action="store_true",
        help="do not enqueue recurring work from this worker",
    )
    worker.add_argument("--max-tasks", type=int, default=None)
    worker.set_defaults(run=_worker)

    hash_password = sub.add_parser(
        "hash-password", help="produce a value for ADMIN_PASSWORD_HASH"
    )
    hash_password.set_defaults(run=_hash_password)

    discover = sub.add_parser("discover", help="queue a discovery run")
    discover.add_argument("kind", choices=["greenhouse", "lever", "ashby", "github_feed"])
    discover.add_argument("names", nargs="+", help="board ids, company slugs, or repos")
    discover.add_argument("--now", action="store_true", help="also run it immediately")
    discover.set_defaults(run=_discover)

    resume = sub.add_parser("import-resume", help="register the resume every application uploads")
    resume.add_argument("path", type=Path, help="your resume: .pdf or .docx")
    resume.set_defaults(run=_import_resume)

    recruiters = sub.add_parser("import-recruiters", help="import a recruiter spreadsheet")
    recruiters.add_argument("path", type=Path)
    recruiters.add_argument("--commit", action="store_true", help="write; default is preview")
    recruiters.set_defaults(run=_import_recruiters)

    source = sub.add_parser("add-source", help="watch a job board")
    source.add_argument("kind", choices=["greenhouse", "lever", "ashby", "github_feed"])
    source.add_argument("identifier", help="board id, company slug, or owner/repo")
    source.add_argument("--label", default=None, help="what to call it on screen")
    source.set_defaults(run=_add_source)

    sources = sub.add_parser("sources", help="list watched job boards")
    sources.set_defaults(run=_list_sources)

    fact = sub.add_parser("set-fact", help="record a candidate fact")
    fact.add_argument("key", help="e.g. candidate.preferred_name")
    fact.add_argument("value", help="JSON if it parses as JSON, otherwise a string")
    fact.set_defaults(run=_set_fact)

    status = sub.add_parser("status", help="show the queue and what is waiting on you")
    status.set_defaults(run=_status)

    base_resume = sub.add_parser(
        "check-base-resume", help="check the resume that will be uploaded"
    )
    base_resume.set_defaults(run=_check_base_resume)

    validate = sub.add_parser(
        "validate-adapters",
        help="one-shot check of the Greenhouse, Lever and Ashby adapters",
        description=(
            "Runs beside the pipeline, never through it: no task is queued, no "
            "application is created, no daily quota is used, and PIPELINE_ENABLED "
            "is not read or changed. Stage 1 only reads public job feeds. Stage 2 "
            "opens one real application form per ATS and stops before Submit."
        ),
    )
    validate.add_argument(
        "--stage",
        type=int,
        choices=(1, 2),
        default=1,
        help="1: read the feeds (default). 2: also open one real form per ATS.",
    )
    validate.add_argument(
        "--boards",
        default="",
        help="ats=board,board;ats=board — defaults to a built-in set",
    )
    validate.add_argument(
        "--only", default="", help="restrict to one ATS: greenhouse, lever or ashby"
    )
    validate.add_argument(
        "--url",
        action="append",
        default=[],
        metavar="ATS=URL",
        help=(
            "stage 2: name the job to open for one ATS, instead of taking the "
            "first that passed the screen. For when the screen rejects a role a "
            "person would call suitable — which is itself worth reporting."
        ),
    )
    validate.add_argument(
        "--out",
        default="",
        help=(
            "where to write reports and screenshots. Defaults to the artifacts "
            "directory, which on a workstation is usually the server's path and "
            "not writable."
        ),
    )
    validate.add_argument(
        "--headed",
        action="store_true",
        help="stage 2: show the browser instead of running it headless",
    )
    validate.add_argument(
        "--yes",
        action="store_true",
        help=(
            "skip the typed confirmation for stage 2. Only for a run you have "
            "already decided on; stage 2 loads a real employer's form."
        ),
    )
    validate.set_defaults(run=_validate_adapters)

    migrate = sub.add_parser("migrate", help="apply database migrations")
    migrate.add_argument("--revision", default="head")
    migrate.set_defaults(run=_migrate)

    args = parser.parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, str(args.log_level).upper(), logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    result: int = args.run(args)
    return result


# ------------------------------------------------------------------ serve


def _serve(args: argparse.Namespace) -> int:
    import uvicorn

    from app.config import get_settings

    settings = get_settings()
    if args.host not in {"127.0.0.1", "localhost", "::1"} and settings.app_env == "production":
        # §23.1: the app binds to loopback and Caddy publishes it. Binding wider
        # would put it on the network with no TLS and no proxy in front.
        print(
            f"Refusing to bind {args.host} in production. The app must stay on "
            "loopback behind Caddy and Tailscale Serve (§23.1).",
            file=sys.stderr,
        )
        return 1

    uvicorn.run(
        "app.web.app:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        # Behind Caddy on loopback. Without this the app would see the proxy's
        # address as the client's on every request.
        proxy_headers=True,
        forwarded_allow_ips="127.0.0.1",
    )
    return 0


# ----------------------------------------------------------------- worker


def _worker(args: argparse.Namespace) -> int:
    from app.config import get_settings
    from app.db.session import get_sessionmaker
    from app.domain.tasks import TaskType
    from app.worker.handlers import register_pipeline
    from app.worker.runtime import Registry, Worker

    settings = get_settings()
    registry = register_pipeline(Registry(), settings=settings)

    from app.worker.scheduler import tick

    types = [TaskType(t.strip()) for t in args.types.split(",") if t.strip()] or None
    worker = Worker(
        session_factory=get_sessionmaker(),
        registry=registry,
        task_types=types,
        # Every worker may tick: the scheduler's keys carry the time bucket, so
        # concurrent ticks collapse in the queue rather than double-firing.
        on_tick=None if args.no_scheduler else (lambda s, now: tick(s, settings, now=now)),
    )

    missing = sorted(t.value for t in registry.missing())
    if missing:
        # Not fatal: a web-only worker legitimately lacks the browser handlers.
        # Saying so at startup beats discovering it when a task is buried.
        logging.getLogger(__name__).info(
            "no handler for: %s (those tasks will be buried if this worker claims them)",
            ", ".join(missing),
        )

    if args.once:
        return 0 if worker.run_once() else 1

    worker.install_signal_handlers()
    worker.run_forever(max_tasks=args.max_tasks)
    return 0


# ---------------------------------------------------------- hash-password


def _hash_password(args: argparse.Namespace) -> int:
    from app.web.security import hash_password

    password = getpass.getpass("New admin password: ")
    if len(password) < 12:
        print("Use at least 12 characters.", file=sys.stderr)
        return 1
    if password != getpass.getpass("Again: "):
        print("They do not match.", file=sys.stderr)
        return 1

    print("\nPut this in your .env, and keep the password itself out of it:\n")
    print(f"ADMIN_PASSWORD_HASH={hash_password(password)}")
    return 0


# --------------------------------------------------------------- discover


def _discover(args: argparse.Namespace) -> int:
    from datetime import datetime

    from app.config import get_settings
    from app.db.session import session_scope
    from app.domain.tasks import TaskType, idempotency_key
    from app.services.queue import enqueue

    settings = get_settings()
    payload: dict[str, Any] = {"kind": args.kind, "names": list(args.names)}
    # The bucket is what the scheduler puts in its own key, and for the same
    # reason: ``dedupe_key`` is unique across every task ever inserted, finished
    # ones included. Without it this command works exactly once per database and
    # then reports "already queued" forever, having done nothing. A minute is
    # the right grain for something a person typed — it still swallows a
    # double-invocation, but asking again later means asking again.
    bucket = datetime.now(settings.timezone).strftime("%Y-%m-%dT%H:%M")
    with session_scope() as session:
        key = idempotency_key(TaskType.DISCOVER_SOURCE, args.kind, *args.names, bucket)
        task = enqueue(
            session,
            task_type=TaskType.DISCOVER_SOURCE,
            dedupe_key=key,
            payload=payload,
        )
        # None means the same run is already queued. That is the idempotency key
        # working, not a failure.
        print(f"queued {key}" if task is not None else f"already queued: {key}")

    if not args.now:
        return 0

    from app.db.session import get_sessionmaker
    from app.worker.handlers import register_pipeline
    from app.worker.runtime import Registry, Worker

    worker = Worker(
        session_factory=get_sessionmaker(),
        registry=register_pipeline(Registry(), settings=get_settings()),
        task_types=[TaskType.DISCOVER_SOURCE],
    )
    return 0 if worker.run_once() else 1


# ----------------------------------------------------------------- resume


def _import_resume(args: argparse.Namespace) -> int:
    from app.config import get_settings
    from app.db.session import session_scope
    from app.services.resume_import import import_resume

    settings = get_settings()
    if not args.path.exists():
        print(f"no such file: {args.path}", file=sys.stderr)
        return 1

    with session_scope() as session:
        result = import_resume(session, settings, path=args.path)
        print(result.summary())
        if result.pages is not None and result.pages != 1:
            print(
                f"\nNote: it is {result.pages} pages. Nothing here shortens it — "
                "this file is uploaded as it is.",
                file=sys.stderr,
            )

    print("\nSet BASE_RESUME_STATUS=READY to let the pipeline use it.")
    return 0


def _import_recruiters(args: argparse.Namespace) -> int:
    from app.db.session import session_scope
    from app.services.recruiters import Source, commit_import, parse_xlsx, preview_import

    if not args.path.exists():
        print(f"no such file: {args.path}", file=sys.stderr)
        return 1

    source: Source = (
        list(parse_xlsx(args.path))
        if args.path.suffix.lower() == ".xlsx"
        else args.path.read_text(encoding="utf-8")
    )
    with session_scope() as session:
        report = commit_import(session, source) if args.commit else preview_import(session, source)
        print(report.summary())
        if not args.commit:
            print("\nPreview only. Re-run with --commit to write.")
    return 0


def _add_source(args: argparse.Namespace) -> int:
    from sqlalchemy import select

    from app.db.models import SourceRegistry
    from app.db.session import session_scope

    with session_scope() as session:
        existing = session.scalars(
            select(SourceRegistry)
            .where(SourceRegistry.kind == args.kind)
            .where(SourceRegistry.identifier == args.identifier)
        ).first()
        if existing is not None:
            existing.enabled = True
            existing.label = args.label or existing.label
            print(f"{args.kind}:{args.identifier} already watched; re-enabled")
            return 0

        session.add(
            SourceRegistry(
                kind=args.kind, identifier=args.identifier, label=args.label, enabled=True
            )
        )
        print(f"watching {args.kind}:{args.identifier} — discovery runs daily at 07:00")
    return 0


def _list_sources(args: argparse.Namespace) -> int:
    from sqlalchemy import select

    from app.db.models import SourceRegistry
    from app.db.session import session_scope

    with session_scope() as session:
        rows = session.scalars(select(SourceRegistry).order_by(SourceRegistry.kind)).all()
        if not rows:
            print("No sources. Add one:  internship-ops add-source greenhouse stripe")
            return 0
        for row in rows:
            state = "on " if row.enabled else "off"
            last = row.last_fetched_at.strftime("%d %b %H:%M") if row.last_fetched_at else "never"
            note = f"  !! {row.last_error}" if row.consecutive_failures else ""
            print(f"[{state}] {row.kind:<12} {row.identifier:<28} last: {last}{note}")
    return 0


def _set_fact(args: argparse.Namespace) -> int:
    from app.db.session import session_scope
    from app.services.candidate import Actor, set_fact

    try:
        value: Any = json.loads(args.value)
    except json.JSONDecodeError:
        value = args.value

    with session_scope() as session:
        fact = set_fact(session, args.key, value, actor=Actor.USER, verified=True)
        print(f"{fact.fact_key} set{' (locked)' if fact.is_locked else ''}")
    return 0


# ----------------------------------------------------------------- status


def _status(args: argparse.Namespace) -> int:
    from app.config import get_settings
    from app.db.session import session_scope
    from app.web.queries import dashboard
    from app.worker.browser_slot import register_browser_handlers
    from app.worker.handlers import register_pipeline
    from app.worker.runtime import Registry, health

    settings = get_settings()
    # Both registries: between them they are every handler the deployment has,
    # which is the question "what is missing" actually means.
    everything = register_pipeline(Registry(), settings=settings)
    register_browser_handlers(everything, settings=settings)

    with session_scope() as session:
        queue = health(session, registry=everything)
        board = dashboard(session, settings)

    print(json.dumps(queue, indent=2))
    print(
        f"\njobs discovered today: {len(board.discovered_today)}"
        f"\nselected, not applied: {len(board.selected)}"
        f"\nwaiting on you:        {board.needs_attention}"
        f"\ndrafts ready:          {len(board.drafts_ready)}"
        f"\napplications prepared: {board.limits.prepared_today}/{board.limits.prepared_cap}"
    )
    return 0


# ------------------------------------------------------------ base resume


def _check_base_resume(args: argparse.Namespace) -> int:
    """Look at the file every application will upload.

    Nothing rewrites or shortens this document, so whatever is wrong with it is
    wrong on every application. Worth one command that says what it is before a
    hundred of them go out.
    """
    from app.config import get_settings
    from app.db.session import session_scope
    from app.services.resume_artifacts import page_count, sha256_of
    from app.services.resume_import import base_version

    settings = get_settings()
    pdf = settings.base_resume_pdf
    if pdf is None or not pdf.is_file():
        print(
            f"No resume at BASE_RESUME_PDF={settings.base_resume_pdf}.",
            file=sys.stderr,
        )
        return 1

    print(f"file:        {pdf}")
    print(f"size:        {pdf.stat().st_size:,} bytes")
    print(f"fingerprint: {sha256_of(pdf)[:16]}")

    pages = page_count(pdf)
    print(f"pages:       {pages if pages is not None else 'unreadable'}")
    if pages is None:
        print(
            "\nThe file could not be read as a PDF. An employer's form will not "
            "read it either.",
            file=sys.stderr,
        )
        return 1
    if pages != 1:
        # Not fatal: a two-page resume is a choice some people make, and this
        # command reports rather than decides. It is still almost always a
        # surprise, which is why it is called out.
        print(
            f"\nIt is {pages} pages. Nothing here shortens it — every application "
            "gets exactly this file.",
            file=sys.stderr,
        )

    with session_scope() as session:
        imported = base_version(session)
    if imported is None:
        print(
            "\nIt has not been imported yet, so the pipeline gate is still shut.\n"
            f"Run: internship-ops import-resume {pdf}",
            file=sys.stderr,
        )
        return 1

    print("\nReady. Set BASE_RESUME_STATUS=READY to let the pipeline use it.")
    return 0


# ------------------------------------------------------ adapter validation


#: What has to be typed before stage 2 opens somebody's application form. A
#: y/n prompt is too easy to answer without reading; this is not.
_STAGE_TWO_PHRASE = "open one real form per ATS"


def _parse_boards(raw: str) -> dict[str, tuple[str, ...]] | None:
    """``greenhouse=stripe,figma;lever=ramp`` into a mapping."""
    if not raw.strip():
        return None
    boards: dict[str, tuple[str, ...]] = {}
    for group in raw.split(";"):
        if not group.strip():
            continue
        ats, _, names = group.partition("=")
        listed = tuple(n.strip() for n in names.split(",") if n.strip())
        if ats.strip() and listed:
            boards[ats.strip().lower()] = listed
    return boards or None


def _validate_adapters(args: argparse.Namespace) -> int:
    """Check the ATS adapters against the live world, once, on request."""
    from datetime import UTC, datetime

    from app.config import get_settings
    from app.services.validation import validate_feeds
    from app.services.validation.report import Severity, write_report

    settings = get_settings()
    boards = _parse_boards(args.boards)
    if args.only:
        wanted = args.only.strip().lower()
        source = boards or _default_boards()
        boards = {k: v for k, v in source.items() if k == wanted}
        if not boards:
            print(f"No boards configured for {wanted!r}.", file=sys.stderr)
            return 1

    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    root = Path(args.out) if args.out else settings.artifacts_dir / "validation"
    out_dir = root / stamp
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        print(
            f"Cannot write reports to {out_dir}: {exc}\n"
            "Pass --out with somewhere writable.",
            file=sys.stderr,
        )
        return 1

    print("Stage 1 — reading public job feeds. Nothing is written to any board.\n")
    stage_one = validate_feeds(settings, boards)
    _print_stage_one(stage_one)
    write_report(out_dir / "stage-1.json", stage_one.as_dict())
    print(f"\nReport: {out_dir / 'stage-1.json'}")

    if args.stage < 2:
        return 0 if stage_one.ok else 1

    if not stage_one.ok:
        print(
            "\nStage 1 found blockers. Fix those before opening a real form.",
            file=sys.stderr,
        )
        return 1

    candidates = _stage_two_candidates(stage_one)
    for override in args.url:
        ats, _, target = override.partition("=")
        if not ats.strip() or not target.strip():
            print(f"Ignoring malformed --url {override!r}", file=sys.stderr)
            continue
        candidates[ats.strip().lower()] = {
            "company": "(named on the command line)",
            "title": "(chosen by hand)",
            "location": "",
            "url": target.strip(),
            "posted_at": "",
        }
    if not candidates:
        print("\nNo posting passed the screen, so there is nothing to open.")
        return 1

    print("\nStage 2 will open exactly one real application form per ATS:\n")
    for ats, job in candidates.items():
        print(f"  {ats:<12} {job['company']} — {job['title']}")
        print(f"  {'':<12} {job['url']}")
    print(
        "\nIt fills only the safe fields, attaches the base resume, and stops.\n"
        "It never clicks Submit, and leaves sponsorship, work authorization, EEO,\n"
        "demographic and signature fields blank. No application is created and no\n"
        "daily quota is used."
    )

    if not args.yes:
        print(f'\nType "{_STAGE_TWO_PHRASE}" to continue, or anything else to stop.')
        try:
            typed = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nStopped.", file=sys.stderr)
            return 1
        if typed != _STAGE_TWO_PHRASE:
            print("Stopped; nothing was opened.", file=sys.stderr)
            return 1

    reports = _run_stage_two(settings, candidates, out_dir, headless=not args.headed)
    _print_stage_two(reports)
    write_report(
        out_dir / "stage-2.json",
        {"stage": 2, "runs": [r.as_dict() for r in reports]},
    )
    print(f"\nReport: {out_dir / 'stage-2.json'}")

    worst = [r for r in reports if not r.ok]
    if any(f.severity is Severity.BLOCKER for r in reports for f in r.findings):
        return 1
    return 1 if worst else 0


def _default_boards() -> dict[str, tuple[str, ...]]:
    from app.services.validation.stage_one import DEFAULT_BOARDS

    return DEFAULT_BOARDS


def _stage_two_candidates(stage_one: Any) -> dict[str, dict[str, str]]:
    """One posting per ATS: the first that passed the pre-spend screen.

    Deterministic rather than random, so a rerun opens the same form and an
    employer sees one page view rather than a series of them.
    """
    chosen: dict[str, dict[str, str]] = {}
    for adapter in stage_one.adapters:
        if adapter.ats in chosen or not adapter.eligible:
            continue
        chosen[adapter.ats] = adapter.eligible[0]
    return chosen


def _run_stage_two(
    settings: Any, candidates: dict[str, dict[str, str]], out_dir: Any, *, headless: bool
) -> list[Any]:
    from app.db.session import session_scope
    from app.services.candidate import list_facts
    from app.services.validation.stage_two import validate_form

    with session_scope() as session:
        stored = {f.key: f.value for f in list_facts(session)}
        locked = frozenset(f.key for f in list_facts(session) if f.is_locked)

    resume = settings.base_resume_pdf
    if resume is None or not resume.is_file():
        resume = None
        print(
            "No base resume PDF is configured; the upload step cannot be checked.",
            file=sys.stderr,
        )

    reports = []
    for ats, job in candidates.items():
        print(f"\n--- {ats}: {job['company']} — {job['title']}")
        reports.append(
            validate_form(
                settings,
                ats=ats,
                company=job["company"],
                title=job["title"],
                url=job["url"],
                facts=stored,
                locked_keys=locked,
                resume_path=resume,
                out_dir=out_dir / ats,
                headless=headless,
            )
        )
    return reports


def _print_stage_one(report: Any) -> None:
    from app.services.validation.report import Severity

    for ats, adapters in report.by_ats().items():
        print(f"== {ats}")
        for entry in adapters:
            if entry.fetch_error:
                print(f"   {entry.board:<14} FETCH FAILED  {entry.fetch_error}")
                continue
            stats = entry.stats
            print(
                f"   {entry.board:<14} {entry.fetched:>4} postings, "
                f"{stats.get('with_posted_at', 0)} dated, "
                f"{stats.get('with_description', 0)} described, "
                f"{stats.get('passed_screen', 0)} pass the screen"
            )
            for finding in entry.findings:
                if finding.severity is not Severity.NOTE:
                    print(f"      {finding.line()}")
        print()


def _print_stage_two(reports: list[Any]) -> None:
    print()
    for entry in reports:
        print(f"== {entry.ats}: {entry.company} — {entry.title}")
        if entry.error:
            print(f"   FAILED  {entry.error}")
            continue
        print(f"   fields found:      {entry.fields_found}")
        print(f"   filled:            {len(entry.filled)}")
        print(f"   left for you:      {len(entry.left_for_human)}")
        print(f"   not recognised:    {len(entry.unrecognised)}")
        print(f"   resume attached:   {entry.resume_attached}"
              + (f"  ({entry.resume_confirmation})" if entry.resume_confirmation else ""))
        print(f"   submitted:         {entry.submitted}")
        for finding in entry.findings:
            print(f"      {finding.line()}")


# ---------------------------------------------------------------- migrate


def _migrate(args: argparse.Namespace) -> int:
    from alembic import command
    from alembic.config import Config

    command.upgrade(Config("alembic.ini"), args.revision)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
