#!/usr/bin/env bash
# Put your canonical LaTeX resume on the production instance.
#
#   ./deploy/push-base-resume.sh ~/VSCode/Resume/resume_dsswede/hoanng_resume.tex
#
# This is a different thing from push-resume.sh, and both are needed:
#
#   push-resume.sh       reads a resume and extracts the *facts* tailoring may
#                        cite. It answers "what is true about you".
#   push-base-resume.sh  installs the *document* every tailored resume is built
#                        from. It answers "what does your resume look like".
#
# The .tex and its compiled .pdf go into /data/internship-ops/resume, which the
# worker mounts read-only. Every application is built by splicing text into a
# copy of this .tex; a build that cannot produce one page falls back to this
# exact .pdf, byte for byte.
#
# The compile is verified here, on the instance, before anything is switched
# over. A resume that compiles on your laptop and not in the container would
# otherwise show up as every application quietly falling back.

set -euo pipefail

readonly REMOTE_USER="ubuntu"
readonly HOST="internshipops"
readonly REMOTE_DIR="/opt/internship-ops"
readonly RESUME_DIR="/data/internship-ops/resume"

die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

TEX="${1:-}"
[[ -n "$TEX" ]] || die "usage: $0 <resume.tex> [resume.pdf]"
[[ -f "$TEX" ]] || die "no such file: $TEX"
[[ "$TEX" == *.tex ]] || die "$TEX is not a .tex file"

# The compiled PDF beside it, unless one was named. This is the file an employer
# receives when a tailored build does not fit on one page, so it is your own
# output rather than something regenerated here.
PDF="${2:-${TEX%.tex}.pdf}"
[[ -f "$PDF" ]] || die "no compiled PDF at $PDF (pass one as the second argument)"

printf '\033[1m==> Copying\033[0m\n'
printf '  %s\n  %s\n' "$TEX" "$PDF"
ssh "$REMOTE_USER@$HOST" "mkdir -p $RESUME_DIR"
scp -q "$TEX" "$REMOTE_USER@$HOST:$RESUME_DIR/$(basename "$TEX")"
scp -q "$PDF" "$REMOTE_USER@$HOST:$RESUME_DIR/$(basename "$PDF")"

printf '\n\033[1m==> Checking it compiles in the container\033[0m\n'
# shellcheck disable=SC2029  # the remote path is meant to expand here
ssh "$REMOTE_USER@$HOST" "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml \
  run --rm worker internship-ops check-base-resume"

cat <<EOF

$(printf '\033[1mDone.\033[0m')

Point .env at the copies on the instance, then redeploy:

  BASE_RESUME_TEX=$RESUME_DIR/$(basename "$TEX")
  BASE_RESUME_PDF=$RESUME_DIR/$(basename "$PDF")
  BASE_RESUME_STATUS=READY

The originals on your laptop stay the source of truth. Nothing on the server
writes to these files — the mount is read-only.
EOF
