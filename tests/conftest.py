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

import pytest
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session

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
