#!/usr/bin/env bash
# Start one browser slot: display, VNC, noVNC, then the control service (§15.1).
#
# Ordering matters. Chromium started before Xvfb is listening picks headless
# defaults and the live-review window is then empty for the whole session, which
# looks like a hung slot rather than a race.

set -euo pipefail

: "${DISPLAY:=:99}"
: "${SCREEN_GEOMETRY:=1440x900x24}"
: "${SLOT_NAME:=slot-1}"
: "${NOVNC_PORT:=6080}"
: "${VNC_PORT:=5900}"

log() { printf '%s [%s] %s\n' "$(date -Is)" "${SLOT_NAME}" "$*"; }

cleanup() {
  log "stopping"
  # §23.4: clear the clipboard on the way out. A password pasted during a manual
  # login must not survive into the next application's session.
  DISPLAY="${DISPLAY}" xsel -bc 2>/dev/null || true
  kill $(jobs -p) 2>/dev/null || true
}
trap cleanup EXIT TERM INT

log "starting Xvfb on ${DISPLAY} (${SCREEN_GEOMETRY})"
Xvfb "${DISPLAY}" -screen 0 "${SCREEN_GEOMETRY}" -nolisten tcp &

for _ in $(seq 1 50); do
  if xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then break; fi
  sleep 0.1
done
xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1 || { log "Xvfb never came up"; exit 1; }

log "starting window manager"
fluxbox >/dev/null 2>&1 &

# -localhost: the VNC port is reachable only from inside this container, so the
# only way in is through websockify, which is itself only on the Docker network
# (§15.1, §23.1). No password here because there is no path to it; the review
# token is checked before Caddy ever proxies the page (§15.3).
log "starting x11vnc on ${VNC_PORT}"
x11vnc -display "${DISPLAY}" -rfbport "${VNC_PORT}" -localhost -forever -shared -nopw -quiet &

log "starting noVNC on ${NOVNC_PORT}"
websockify --web=/usr/share/novnc "${NOVNC_PORT}" "localhost:${VNC_PORT}" &

log "starting control service"
exec python -m app.worker.browser_slot
