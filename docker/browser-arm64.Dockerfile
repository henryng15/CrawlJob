# Browser slot: Chromium, a control service, and a noVNC view of it (spec §15.1).
#
# The user has to be able to watch and take over — a CAPTCHA, an SSO login, a
# question only they can answer — so the browser runs on a real X display with
# x11vnc and websockify in front of it, rather than headless.
#
# Built on Playwright's own image because it ships the exact browser build its
# Python package expects. Multi-arch: the same file builds on the arm64 OCI
# instance and on an x86 laptop.

# Pinned to the playwright version in uv.lock. The image ships the exact browser
# build that release expects; a mismatch is not a warning, it is a container that
# starts cleanly and then cannot open a page.
FROM mcr.microsoft.com/playwright/python:v1.61.0-noble

# Xvfb gives Chromium a display; x11vnc exports it; websockify turns that into
# something a browser tab can render. fluxbox exists so dialogs have a window
# manager to place them — without one, some ATS modals open off-screen.
RUN apt-get update \
 && apt-get install --no-install-recommends -y \
      xvfb x11vnc x11-utils xsel fluxbox websockify novnc tini \
 && rm -rf /var/lib/apt/lists/*

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH=/src \
    PYTHONUNBUFFERED=1 \
    DISPLAY=":99" \
    SCREEN_GEOMETRY="1440x900x24" \
    SLOT_NAME="slot-1"

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv

WORKDIR /src
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-install-project --no-dev --extra browser
COPY app ./app
COPY alembic.ini ./
RUN uv sync --frozen --no-dev --extra browser

COPY docker/browser-entrypoint.sh /usr/local/bin/browser-entrypoint.sh
RUN chmod +x /usr/local/bin/browser-entrypoint.sh \
 && mkdir -p /home/pwuser/profile /session /artifacts \
 && chown -R pwuser:pwuser /home/pwuser /session /artifacts /src

# §23.4: Chromium runs as a non-root user. Running as root would mean a page
# that escapes the renderer sandbox lands as root in the container.
USER pwuser

# Control 9221, noVNC 6080, health 7080 — the same inside every slot. The spec's
# port table gives each slot distinct numbers, but each container has its own
# network namespace, so distinct ports buy nothing and the Caddyfile in §15.2
# already assumes 6080 for both. See docs/spec/README.md#known-defects.
EXPOSE 9221 6080 7080

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/browser-entrypoint.sh"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:7080/health')"
