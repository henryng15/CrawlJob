#!/usr/bin/env bash
# Start one browser worker.
#
# This used to bring up Xvfb, a window manager, x11vnc and noVNC, because a
# person finished the form inside this container over a live-review session.
# Nothing watches the browser now — it fills a form, submits it or gives up, and
# exits — so Chromium runs headless and there is no display to serve.

set -euo pipefail

: "${SLOT_NAME:=browser-1}"

log() { printf '%s [%s] %s\n' "$(date -Is)" "${SLOT_NAME}" "$*"; }

log "starting browser worker"
exec python -m app.worker.browser
