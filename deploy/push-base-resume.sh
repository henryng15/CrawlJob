#!/usr/bin/env bash
# Put the resume every application uploads on the production instance.
#
#   ./deploy/push-base-resume.sh ~/VSCode/Resume/official/henryng_swe.pdf
#
# One PDF. Nothing on the server rewrites it: each application gets a copy in
# its own artifact folder, hashed there, and that copy is what the browser
# attaches to the employer's form.
#
# It lands in /data/internship-ops/resume, which the worker mounts read-only, so
# the file cannot be modified even by a bug. The check afterwards runs on the
# instance rather than here — a path that exists on your laptop and not in the
# container would otherwise show up as every application failing to prepare.

set -euo pipefail

readonly REMOTE_USER="ubuntu"
readonly HOST="internshipops"
readonly REMOTE_DIR="/opt/internship-ops"
readonly RESUME_DIR="/data/internship-ops/resume"

die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

PDF="${1:-}"
[[ -n "$PDF" ]] || die "usage: $0 <resume.pdf>"
[[ -f "$PDF" ]] || die "no such file: $PDF"
[[ "$PDF" == *.pdf ]] || die "$PDF is not a .pdf — that is what an employer's form takes"

printf '\033[1m==> Copying\033[0m\n  %s\n' "$PDF"
ssh "$REMOTE_USER@$HOST" "mkdir -p $RESUME_DIR"
scp -q "$PDF" "$REMOTE_USER@$HOST:$RESUME_DIR/$(basename "$PDF")"

printf '\n\033[1m==> Registering it and checking it in the container\033[0m\n'
# shellcheck disable=SC2029  # the remote path is meant to expand here
ssh "$REMOTE_USER@$HOST" "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml \
  run --rm worker internship-ops import-resume $RESUME_DIR/$(basename "$PDF") && \
  docker compose -f docker-compose.prod.yml \
  run --rm worker internship-ops check-base-resume"

cat <<EOF

$(printf '\033[1mDone.\033[0m')

Point .env at the copy on the instance, then redeploy:

  BASE_RESUME_PDF=$RESUME_DIR/$(basename "$PDF")
  BASE_RESUME_STATUS=READY

The original on your laptop stays the source of truth. Nothing on the server
writes to this file — the mount is read-only.
EOF
