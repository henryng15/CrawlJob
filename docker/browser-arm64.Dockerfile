# Browser worker: Chromium, headless, filling and submitting one form at a time.
#
# It used to run on a real X display with x11vnc and noVNC in front, so the user
# could watch and take over. They cannot take over any more — a form the machine
# cannot finish is handed back as a link and finished in their own browser — so
# the display stack is gone and with it about 200 MB of image and a running
# Xvfb, x11vnc and websockify per container.
#
# Built on Playwright's own image because it ships the exact browser build its
# Python package expects. Multi-arch: the same file builds on the arm64 OCI
# instance and on an x86 laptop.

# Pinned to the playwright version in uv.lock. The image ships the exact browser
# build that release expects; a mismatch is not a warning, it is a container that
# starts cleanly and then cannot open a page.
FROM mcr.microsoft.com/playwright/python:v1.61.0-noble

# tini only: it reaps the zombie processes Chromium leaves behind.
RUN apt-get update \
 && apt-get install --no-install-recommends -y tini \
 && rm -rf /var/lib/apt/lists/*

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH=/src \
    PYTHONUNBUFFERED=1 \
    SLOT_NAME="browser-1"

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv

WORKDIR /src
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-install-project --no-dev --extra browser
COPY app ./app
COPY alembic.ini ./
RUN uv sync --frozen --no-dev --extra browser

COPY docker/browser-entrypoint.sh /usr/local/bin/browser-entrypoint.sh
RUN chmod +x /usr/local/bin/browser-entrypoint.sh \
 && mkdir -p /artifacts \
 && chown -R pwuser:pwuser /home/pwuser /artifacts /src

# §23.4: Chromium runs as a non-root user. Running as root would mean a page
# that escapes the renderer sandbox lands as root in the container.
USER pwuser

# Health only. Each container has its own network namespace, so the same port in
# every one of them is fine.
EXPOSE 7080

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/browser-entrypoint.sh"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:7080/health')"
