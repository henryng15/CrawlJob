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
def sample_resume(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path]:
    """A small canonical resume, for tests that need one but not *the* one.

    Written here rather than read from ``.env`` so the tailoring path can be
    exercised on a machine that has never configured a real resume. The PDF is a
    blank page: it exists to be copied byte for byte when a build falls back, and
    nothing reads its contents.

    Tests that need the user's actual resume — the ones proving the template is
    preserved — read ``BASE_RESUME_TEX`` directly and skip when it is unset.
    """
    directory = tmp_path_factory.mktemp("base-resume")

    tex = directory / "resume.tex"
    tex.write_text(SAMPLE_RESUME_TEX, encoding="utf-8")

    pdf = directory / "resume.pdf"
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    with pdf.open("wb") as handle:
        writer.write(handle)

    return tex, pdf


#: Deliberately close in shape to a real resume: custom commands, sections, entry
#: headings, and more than one bullet per list. The headings matter — bullet ids
#: are built from the employer or project a line sits under, so a fixture without
#: them would give every bullet an id with no entry in it and never exercise the
#: check that stops one employer's work being written under another's name.
SAMPLE_RESUME_TEX = r"""\documentclass[letterpaper,10pt]{article}
\usepackage[top=0.4in,bottom=0.4in,left=0.4in,right=0.4in]{geometry}
\usepackage{enumitem}
\newcommand{\resumeItem}[1]{\item\small{#1}}
\newcommand{\resumeItemListStart}{\begin{itemize}[topsep=5pt]}
\newcommand{\resumeItemListEnd}{\end{itemize}}
\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[itemsep=3pt,label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeSubheading}[4]{\item\textbf{#1} #2 \\ \emph{#3} #4}
\newcommand{\resumeProjectHeadingDesc}[3]{\item\textbf{#1} #2 \\ #3}
\begin{document}
\section{Work Experience}
  \resumeSubHeadingListStart
    \resumeSubheading
      {Todd Labs}{June 2026 - Present}
      {Software Engineer Intern}{}
      \resumeItemListStart
        \resumeItem{Built a FastAPI service at Todd Labs}
        \resumeItem{Contributed to a PostgreSQL migration}
      \resumeItemListEnd
  \resumeSubHeadingListEnd
\section{Projects}
  \resumeSubHeadingListStart
    \resumeProjectHeadingDesc
      {ThesisLedger $|$ \emph{DuckDB, Python}}{}
      {Research tool}
      \resumeItemListStart
        \resumeItem{ThesisLedger, a DuckDB-backed research tool}
        \resumeItem{A Kubernetes operator for batch jobs}
      \resumeItemListEnd
  \resumeSubHeadingListEnd
\section{Education}
  \resumeSubHeadingListStart
    \resumeSubheading
      {Kenyon College}{May 2028}
      {Bachelor of Arts}{GPA: 4.0}
      \resumeItemListStart
        \resumeItem{Coursework: algorithms, databases, operating systems}
      \resumeItemListEnd
  \resumeSubHeadingListEnd
\end{document}
"""
