"""Alembic environment.

The database URL is read from ``Settings`` rather than ``alembic.ini`` so that the
password stays out of version control (AGENTS.md: no secrets in git).
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import get_settings
from app.db.migration_url import resolve_url
from app.db.models import Base  # registers every table on the metadata

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Which database this run touches. ``-x sqlalchemy.url=...`` wins, then whatever
# the config already carries (how the test suite points a run at its own
# database), then the application's configured one — which is read lazily, so an
# explicit target makes the development database unreachable rather than merely
# outranked. See :mod:`app.db.migration_url` for why that distinction earns a
# module of its own.
config.set_main_option(
    "sqlalchemy.url",
    resolve_url(
        x_arguments=context.get_x_argument(as_dictionary=True),
        configured=config.get_main_option("sqlalchemy.url", None),
        default=lambda: str(get_settings().database_url),
    ),
)

target_metadata = Base.metadata


def _include_object(obj, name, type_, reflected, compare_to):  # type: ignore[no-untyped-def]
    """Skip anything the application does not own."""
    return not (type_ == "table" and name in {"spatial_ref_sys"})


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        include_object=_include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            include_object=_include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
