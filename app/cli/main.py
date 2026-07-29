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

    resume = sub.add_parser("import-resume", help="store your resume and derive its facts")
    resume.add_argument("path", type=Path, help="your resume: .pdf, .docx, .md or .txt")
    resume.add_argument(
        "--facts",
        type=Path,
        default=None,
        help="a JSON facts file you wrote yourself; skips extraction and is stored verified",
    )
    resume.set_defaults(run=_import_resume)

    verify = sub.add_parser(
        "verify-facts", help="confirm extracted resume facts, one at a time"
    )
    verify.add_argument("--all", action="store_true", help="confirm every pending fact")
    verify.set_defaults(run=_verify_facts)

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
    from app.config import get_settings
    from app.db.session import session_scope
    from app.domain.tasks import TaskType, idempotency_key
    from app.services.queue import enqueue

    payload: dict[str, Any] = {"kind": args.kind, "names": list(args.names)}
    with session_scope() as session:
        key = idempotency_key(TaskType.DISCOVER_SOURCE, args.kind, *args.names)
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
    from app.services.llm.anthropic import build_provider
    from app.services.resume_import import import_resume

    settings = get_settings()
    if not args.path.exists():
        print(f"no such file: {args.path}", file=sys.stderr)
        return 1

    with session_scope() as session:
        result = import_resume(
            session,
            args.path,
            settings=settings,
            provider=build_provider(settings) if args.facts is None else None,
            facts_file=args.facts,
        )
        print(result.summary())
        for fact_id in result.needs_verification:
            print(f"  unverified: {fact_id}")

    if result.needs_verification:
        print("\nConfirm them with: internship-ops verify-facts")
    return 0


def _verify_facts(args: argparse.Namespace) -> int:
    """Walk the pending facts and record the user's confirmation.

    Tailoring cites only verified facts, so this is the step that decides what may
    appear on a document the user signs their name to. Deliberately one at a time
    unless --all: reading them is the entire point.
    """
    from app.db.session import session_scope
    from app.services.candidate import Actor, get_fact, set_fact
    from app.services.resume_import import FACT_PREFIX, unverified

    with session_scope() as session:
        pending = unverified(session)
        if not pending:
            print("Nothing to confirm.")
            return 0

        for fact_id in pending:
            stored = get_fact(session, f"{FACT_PREFIX}{fact_id}")
            if stored is None:
                continue
            value = stored.value if isinstance(stored.value, dict) else {}
            print(f"\n[{fact_id}] {value.get('text', '')}")
            print(
                f"    organisation: {value.get('organisation') or '—'}"
                f"    technologies: {', '.join(value.get('technologies', [])) or '—'}"
            )
            if not args.all and input("    correct? [y/N] ").strip().lower() != "y":
                print("    left unverified")
                continue
            set_fact(session, f"{FACT_PREFIX}{fact_id}", value, actor=Actor.USER, verified=True)
            print("    confirmed")

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
    from app.worker.runtime import health

    settings = get_settings()
    with session_scope() as session:
        queue = health(session)
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


# ---------------------------------------------------------------- migrate


def _migrate(args: argparse.Namespace) -> int:
    from alembic import command
    from alembic.config import Config

    command.upgrade(Config("alembic.ini"), args.revision)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
