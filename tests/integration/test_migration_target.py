"""``alembic -x sqlalchemy.url=...`` migrates that database and no other.

A regression test for a bug that was invisible from the outside. ``env.py`` read
the URL from the ini main option and from ``Settings``, and ignored ``-x`` in
silence — so every ``alembic -x sqlalchemy.url=<test db> upgrade head`` migrated
the **development** database instead. The command printed "Running upgrade …" and
succeeded; the database named on the command line was untouched. Checking it
afterwards showed nothing had happened, which reads as "the migration is broken"
rather than "you migrated something else".

Two halves, because one alone would not have caught it:

* the resolver prefers ``-x`` **and never evaluates the default** — a default that
  is not consulted cannot be reached by mistake;
* a real ``alembic`` subprocess, given a database that does not exist, fails
  naming *that* database. If ``-x`` were ignored it would connect to the
  development database and succeed, which is precisely the old behaviour.

The second half deliberately points at a database that cannot be created, so the
test can prove where alembic went without writing to anything.
"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest

from app.db.migration_url import X_ARGUMENT, resolve_url

REPO = Path(__file__).resolve().parents[2]

#: A database name nothing will ever create.
ABSENT = f"internship_ops_absent_{uuid.uuid4().hex[:10]}"


def _with_database(url: str, name: str) -> str:
    parts = urlsplit(url)
    return urlunsplit(parts._replace(path=f"/{name}"))


class TestTheResolver:
    """The precedence rule, in isolation."""

    def test_the_x_argument_wins(self):
        assert (
            resolve_url(
                x_arguments={X_ARGUMENT: "postgresql://x/named"},
                configured="postgresql://x/configured",
                default=lambda: "postgresql://x/default",
            )
            == "postgresql://x/named"
        )

    def test_the_default_is_never_evaluated_when_a_target_is_named(self):
        """The property that matters.

        "Outranked" is not good enough: as long as the development URL is computed
        it can be used by the next line somebody adds. Not computing it at all is
        what makes the mistake unavailable.
        """

        def explode() -> str:
            raise AssertionError("the default database was consulted")

        assert (
            resolve_url(x_arguments={X_ARGUMENT: "postgresql://x/named"}, default=explode)
            == "postgresql://x/named"
        )

    def test_a_configured_url_is_used_before_the_default(self):
        """How the test suite points a run at its own database."""

        def explode() -> str:
            raise AssertionError("the default database was consulted")

        assert (
            resolve_url(configured="postgresql://x/configured", default=explode)
            == "postgresql://x/configured"
        )

    def test_the_default_is_used_when_nothing_is_named(self):
        assert resolve_url(default=lambda: "postgresql://x/default") == ("postgresql://x/default")

    def test_an_empty_x_argument_does_not_count_as_a_target(self):
        """An empty value is a mistake on the command line, not an instruction to
        connect to nothing."""
        assert (
            resolve_url(x_arguments={X_ARGUMENT: ""}, default=lambda: "postgresql://x/d")
            == "postgresql://x/d"
        )

    def test_other_x_arguments_are_ignored(self):
        assert (
            resolve_url(
                x_arguments={"something-else": "postgresql://x/wrong"},
                default=lambda: "postgresql://x/default",
            )
            == "postgresql://x/default"
        )


@pytest.mark.db
class TestARealAlembicRun:
    """Through the actual command line, in a subprocess."""

    def alembic(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(  # noqa: S603 - fixed argv, no shell
            [sys.executable, "-m", "alembic", *args],
            cwd=REPO,
            capture_output=True,
            text=True,
            check=False,
            timeout=120,
            env={**os.environ, "PYTHONWARNINGS": "ignore"},
        )

    @pytest.fixture
    def default_url(self) -> str:
        """The database a run with no ``-x`` would use."""
        from app.config import get_settings

        return str(get_settings().database_url)

    @pytest.fixture
    def override_honoured(self, default_url: str) -> None:
        """Refuse to run a destructive command until ``-x`` is proven to work.

        Without this guard the ``downgrade`` tests below are a hazard rather than a
        check: if ``env.py`` regresses to ignoring ``-x``, running them would send
        ``downgrade base`` to the developer's own database and drop every table —
        causing exactly the damage they exist to detect. (That is not
        hypothetical; it happened while this file was being written.)

        The probe is the harmless ``current`` command against a database that does
        not exist. It has to fail, and fail naming that database, before anything
        destructive is allowed to run.
        """
        absent = _with_database(default_url, ABSENT)
        probe = self.alembic("-x", f"{X_ARGUMENT}={absent}", "current")
        if probe.returncode == 0 or ABSENT not in probe.stdout + probe.stderr:
            pytest.fail(
                "-x sqlalchemy.url is not being honoured, so a downgrade here "
                "would target the default database. Fix app/db/migration_url.py "
                "before running the destructive checks."
            )

    def test_the_named_database_is_the_one_it_connects_to(self, default_url: str):
        """Given a database that does not exist, it must fail naming that one.

        If ``-x`` were ignored the run would reach the development database and
        succeed — so a pass here means the override was honoured, without writing
        anywhere.
        """
        absent = _with_database(default_url, ABSENT)
        result = self.alembic("-x", f"{X_ARGUMENT}={absent}", "current")

        assert result.returncode != 0, result.stdout
        assert ABSENT in result.stdout + result.stderr

    def test_the_only_database_it_tried_to_open_is_the_named_one(self, default_url: str):
        """It never reached the default, so the default cannot be in the error.

        Matched on the quoted name Postgres reports rather than a substring search:
        the development database is called ``internship_ops``, which is a prefix of
        the absent name, and a looser check would pass for the wrong reason.
        """
        import re

        absent = _with_database(default_url, ABSENT)
        result = self.alembic("-x", f"{X_ARGUMENT}={absent}", "current")
        combined = result.stdout + result.stderr

        tried = set(re.findall(r'database "([^"]+)"', combined))
        assert tried == {ABSENT}, combined

    def test_a_failed_run_against_an_absent_database_changes_nothing(
        self, default_url: str, override_honoured: None
    ):
        """The regression, stated as an observation.

        The development database's revision must be exactly what it was — the run
        named a different database, so nothing here may have moved.
        """
        from sqlalchemy import create_engine, text

        engine = create_engine(default_url, future=True)
        try:
            with engine.connect() as conn:
                before = conn.execute(text("SELECT version_num FROM alembic_version")).all()
        except Exception as exc:  # pragma: no cover - environment problem
            pytest.skip(f"the default database is unavailable: {exc}")

        absent = _with_database(default_url, ABSENT)
        assert self.alembic("-x", f"{X_ARGUMENT}={absent}", "upgrade", "head").returncode

        with engine.connect() as conn:
            after = conn.execute(text("SELECT version_num FROM alembic_version")).all()
        engine.dispose()
        assert after == before

    def test_a_downgrade_against_an_absent_database_changes_nothing_either(
        self, default_url: str, override_honoured: None
    ):
        """The dangerous direction. A downgrade that hit the wrong database would
        drop columns from it, and the command would report success."""
        from sqlalchemy import create_engine, text

        engine = create_engine(default_url, future=True)
        try:
            with engine.connect() as conn:
                before = conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_name = 'resume_versions' ORDER BY column_name"
                    )
                ).all()
        except Exception as exc:  # pragma: no cover - environment problem
            pytest.skip(f"the default database is unavailable: {exc}")
        if not before:  # pragma: no cover - a fresh machine
            pytest.skip("the default database has no schema to protect")

        absent = _with_database(default_url, ABSENT)
        assert self.alembic("-x", f"{X_ARGUMENT}={absent}", "downgrade", "base").returncode

        with engine.connect() as conn:
            after = conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'resume_versions' ORDER BY column_name"
                )
            ).all()
        engine.dispose()
        assert after == before

    def test_without_an_override_the_default_is_used(self, default_url: str):
        """The other half of the contract: omitting ``-x`` must still work, or the
        fix would have traded one silent wrong target for a broken command."""
        from sqlalchemy import create_engine, text

        engine = create_engine(default_url, future=True)
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception as exc:  # pragma: no cover - environment problem
            pytest.skip(f"the default database is unavailable: {exc}")
        finally:
            engine.dispose()

        result = self.alembic("current")
        assert result.returncode == 0, result.stderr
