"""Shared fixtures.

Database tests run against the ``postgres-test`` container from
``docker-compose.yml`` (port 5443, tmpfs-backed), never the development database.
The schema is built by running the real Alembic migrations once per session, so a
broken migration fails the suite rather than being papered over by
``create_all()``.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import Base

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://internship_ops:internship_ops_dev@localhost:5443/internship_ops_test",
)


@pytest.fixture(scope="session")
def db_engine() -> Iterator[Engine]:
    engine = create_engine(TEST_DATABASE_URL, future=True)
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - environment problem, not a bug
        pytest.skip(f"test database unavailable at {TEST_DATABASE_URL}: {exc}")

    from alembic import command
    from alembic.config import Config

    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")

    yield engine
    engine.dispose()


@pytest.fixture
def committing_db(db_engine: Engine) -> Iterator[sessionmaker[Session]]:
    """Sessions on independent connections that really commit.

    Needed for concurrency tests: ``SELECT ... FOR UPDATE SKIP LOCKED`` only has
    observable behaviour across separate connections, so the rollback-wrapped
    ``db`` fixture cannot exercise it. Tables are truncated afterwards.
    """
    factory = sessionmaker(bind=db_engine, expire_on_commit=False, future=True)
    yield factory
    with db_engine.begin() as conn:
        tables = ", ".join(
            f'"{name}"' for name in Base.metadata.tables if name != "alembic_version"
        )
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest.fixture
def db(db_engine: Engine) -> Iterator[Session]:
    """A session wrapped in a transaction that is always rolled back.

    Tests therefore see a clean database without paying for a schema rebuild, and
    a test that leaves rows behind cannot poison the next one.
    """
    connection = db_engine.connect()
    transaction = connection.begin()
    session = Session(
        bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture(scope="session")
def sample_resume(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A one-page PDF, for tests that need a base resume but not *the* one.

    Written here rather than read from ``.env`` so the pipeline can be exercised
    on a machine that has never configured a real resume. Blank on purpose:
    nothing in this system reads a resume's contents any more — it copies the
    file, hashes it, counts its pages and uploads it.
    """
    pdf = tmp_path_factory.mktemp("base-resume") / "resume.pdf"

    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    with pdf.open("wb") as handle:
        writer.write(handle)

    return pdf
