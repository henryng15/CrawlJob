#!/usr/bin/env bash
# Put your resume on the production instance.
#
#   ./deploy/push-resume.sh ~/resume.pdf
#   ./deploy/push-resume.sh ~/resume.pdf --facts ~/facts.json
#
# Copies the file, extracts facts, and walks you through confirming each one.
#
# The confirmation step is interactive and stays that way. A model read your PDF
# and can have misread a date, a percentage, or which employer a project belonged
# to. Every tailored resume cites these facts, so a fact nobody read is a claim
# nobody checked — and you are the one who has to defend it in an interview.
#
# Passing --facts skips extraction entirely: a file you wrote yourself is
# verified by construction.

set -euo pipefail

readonly REMOTE_USER="ubuntu"
readonly HOST="internshipops"
readonly REMOTE_DIR="/opt/internship-ops"

die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

RESUME="${1:-}"
[[ -n "$RESUME" ]] || die "usage: $0 <resume.pdf|.docx|.md|.txt> [--facts facts.json]"
[[ -f "$RESUME" ]] || die "no such file: $RESUME"

FACTS=""
if [[ "${2:-}" == "--facts" ]]; then
  FACTS="${3:-}"
  [[ -f "$FACTS" ]] || die "no such facts file: $FACTS"
fi

# /tmp on the instance, not /data: the original is copied into the artifacts
# directory by the importer, and a second copy lying around in a world-readable
# place is a second copy to forget about.
remote_resume="/tmp/$(basename "$RESUME")"
scp -q "$RESUME" "$REMOTE_USER@$HOST:$remote_resume"

remote_facts=""
if [[ -n "$FACTS" ]]; then
  remote_facts="/tmp/$(basename "$FACTS")"
  scp -q "$FACTS" "$REMOTE_USER@$HOST:$remote_facts"
fi

printf '\033[1m==> Importing\033[0m\n'
# shellcheck disable=SC2029  # the remote paths are meant to expand here
ssh "$REMOTE_USER@$HOST" "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml run --rm \
  -v $remote_resume:$remote_resume ${remote_facts:+-v $remote_facts:$remote_facts} \
  worker internship-ops import-resume $remote_resume ${remote_facts:+--facts $remote_facts}"

if [[ -z "$FACTS" ]]; then
  printf '\n\033[1m==> Confirm what was extracted\033[0m\n'
  printf '  Read each one. Tailoring cites only the facts you confirm.\n\n'
  # -t for a TTY: this is a prompt-and-answer loop, and without it the questions
  # arrive after the answers.
  ssh -t "$REMOTE_USER@$HOST" \
    "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml run --rm \
     worker internship-ops verify-facts"
fi

ssh "$REMOTE_USER@$HOST" "rm -f $remote_resume ${remote_facts:-}"
printf '\n\033[1mDone.\033[0m Check /setup in the browser.\n'
