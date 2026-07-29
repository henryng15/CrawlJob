# Task worker (spec §19).
#
# Deliberately does **not** mount the Docker socket. The spec's sample compose
# does, and its own security note advises against it: the socket is root on the
# host, and this process runs model output. Browser slots are fixed services
# reached over the internal network instead (§19 security note, §15.1).
#
# Includes the optional extras the pipeline needs at runtime — the model client,
# Gmail and spreadsheet parsing — which the web image does not.

FROM python:3.13-slim-bookworm AS build

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv

WORKDIR /src

COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-install-project --no-dev \
      --extra llm --extra gmail --extra recruiters --extra resume

COPY app ./app
COPY alembic.ini ./
RUN uv sync --frozen --no-dev --extra llm --extra gmail --extra recruiters --extra resume


FROM python:3.13-slim-bookworm AS runtime

# WeasyPrint renders the tailored resume; postgresql-client provides pg_dump for
# the nightly backup. Without the latter the backup task fails every night with a
# message that reads like a bug rather than a missing package.
RUN apt-get update \
 && apt-get install --no-install-recommends -y \
      libcairo2 libpango-1.0-0 libpangoft2-1.0-0 libgdk-pixbuf-2.0-0 \
      libffi8 shared-mime-info fonts-dejavu-core postgresql-client \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid app --create-home app

# PYTHONPATH, not just WORKDIR: a console script's sys.path starts at the
# script's own directory, so `internship-ops worker` would not find the package
# that `python -c "import app"` finds from the working directory.
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY --from=build /opt/venv /opt/venv
COPY --from=build /src/app /app/app
COPY --from=build /src/alembic.ini /app/alembic.ini

WORKDIR /app
USER app

# SIGTERM finishes the task in hand and then exits (Worker.install_signal_handlers),
# so a deploy never kills work mid-transaction.
STOPSIGNAL SIGTERM

CMD ["internship-ops", "worker"]
