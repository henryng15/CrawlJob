"""Which database a migration run targets (spec §19, AGENTS.md).

Small enough to look pointless, and it exists because getting it wrong is
invisible. ``alembic`` reports success against whichever database it connected to;
if that is not the one you named, the command says it worked and the database you
meant is unchanged. Nothing in the output distinguishes the two.

That happened here: ``env.py`` read the URL from the ini main option and from
``Settings``, and ignored ``-x sqlalchemy.url=...`` in silence. Every command of
the form ``alembic -x sqlalchemy.url=<test db> upgrade head`` migrated the
*development* database instead.

So the precedence is one function with one rule, and the fallback is a callable
that is not invoked unless it is actually needed — a default that is never
consulted cannot be reached by accident.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping

__all__ = ["X_ARGUMENT", "resolve_url"]

#: The ``-x`` key that names the target database.
X_ARGUMENT = "sqlalchemy.url"


def resolve_url(
    *,
    x_arguments: Mapping[str, str] | None = None,
    configured: str | None = None,
    default: Callable[[], str],
) -> str:
    """The database a migration run should connect to.

    Precedence, most explicit first:

    1. ``-x sqlalchemy.url=...`` on the command line.
    2. ``sqlalchemy.url`` already set on the Alembic config, which is how the test
       suite points a run at its own database.
    3. ``default()``, the application's configured database.

    ``default`` is a callable rather than a value so that it is only evaluated
    when nothing more explicit was given. That is the property worth having:
    an explicit target must make the default *unreachable*, not merely
    outranked.
    """
    explicit = (x_arguments or {}).get(X_ARGUMENT)
    if explicit:
        return explicit
    if configured:
        return configured
    return default()
