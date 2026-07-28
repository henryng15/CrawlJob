# Web application (spec §19).
#
# Two stages so the runtime image carries no build tools and no uv cache. The
# result runs as a non-root user with a read-only root filesystem in compose —
# this container renders text scraped from the open web, and the less it can do
# the better.

FROM python:3.13-slim-bookworm AS build

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv

WORKDIR /src

# Dependencies first: they change far less often than the code, so this layer is
# reused across almost every rebuild.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-install-project --no-dev

COPY app ./app
COPY alembic.ini ./
RUN uv sync --frozen --no-dev


FROM python:3.13-slim-bookworm AS runtime

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

EXPOSE 8000

# Loopback would be wrong here: the container's own network namespace is the
# boundary, and Caddy reaches it over the internal Docker network. The host
# never publishes this port (§23.1).
CMD ["uvicorn", "app.web.app:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/health/live')"
