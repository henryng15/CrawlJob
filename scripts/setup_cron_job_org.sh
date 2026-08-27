#!/usr/bin/env bash
#
# Create the four cron-job.org jobs that fire the sync workflow on time.
#
# GitHub's own schedule is not the problem people assume it is: over 21-27 August
# 2026 it delivered 52 of 54 firings, so it drops almost nothing. What it does is
# arrive late — median 25 minutes, p90 74, worst 106. A ninety-minute cadence
# absorbs that; a forty-five minute one does not, because the delay is over half
# the interval and the runs bunch up behind each other. A workflow_dispatch, by
# contrast, starts the instant it is asked: the dispatch measured on 27 August was
# accepted at 15:50:11Z and the run had started by 15:50:12Z.
#
# Forty-five minutes needs four jobs rather than one. cron-job.org schedules an
# hours-by-minutes grid, the same shape as cron, and 45 does not divide 60 — so
# the minute cycles :00 -> :45 -> :30 -> :15 and repeats every three hours. One
# job per minute-of-the-hour is the whole schedule.
#
# The times below are Eastern, not UTC, because cron-job.org takes a timezone per
# job. That is the reason to prefer it over a UTC-only scheduler: nothing has to
# be shifted by hand when EST starts on 1 November 2026.
#
# Both credentials are read from .env, or from the environment if already set.
# Neither is echoed or passed on the command line, where the process table would
# expose it.
#
#   CRON_JOB                                   cron-job.org Console -> Settings -> API
#   GITHUB_PERSONAL_ACCESS_TOKEN_FINE_GRAINED  fine-grained PAT, repository CrawlJob
#                                              only, permission Actions: Read and write
#
# Pass --dry-run to print the four payloads, with the token masked, and create
# nothing.
#
# Creating four jobs in a row trips cron-job.org's rate limit — the second PUT came
# back 429 on the first attempt at this — so the run is paced, and it re-reads the
# job list first and skips anything already there. Re-running after a partial
# failure therefore finishes the job rather than duplicating it.
#
set -euo pipefail

dry_run=false
[[ "${1:-}" == "--dry-run" ]] && dry_run=true

readonly ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env"

# Read one key out of .env without sourcing the file: it holds three dozen other
# secrets, and sourcing would put every one of them into this shell.
from_env_file() {
  local key=$1 line
  [[ -f "$ENV_FILE" ]] || return 0
  line=$(grep -m1 -E "^[[:space:]]*${key}=" "$ENV_FILE") || return 0
  line=${line#*=}
  line=${line%$'\r'}
  [[ $line == \"*\" && $line == *\" ]] && line=${line:1:${#line}-2}
  [[ $line == \'*\' && $line == *\' ]] && line=${line:1:${#line}-2}
  printf '%s' "$line"
}

: "${CRON_JOB:=$(from_env_file CRON_JOB)}"
: "${GITHUB_PERSONAL_ACCESS_TOKEN_FINE_GRAINED:=$(from_env_file GITHUB_PERSONAL_ACCESS_TOKEN_FINE_GRAINED)}"

[[ -n "$CRON_JOB" ]] || { echo "CRON_JOB not found in $ENV_FILE or the environment" >&2; exit 1; }
[[ -n "$GITHUB_PERSONAL_ACCESS_TOKEN_FINE_GRAINED" ]] || { echo "GITHUB_PERSONAL_ACCESS_TOKEN_FINE_GRAINED not found in $ENV_FILE or the environment" >&2; exit 1; }

readonly DISPATCH_URL="https://api.github.com/repos/henryng15/CrawlJob/actions/workflows/sync.yml/dispatches"
readonly API="https://api.cron-job.org/jobs"

# title | minute-of-the-hour | hours, Eastern
readonly JOBS=(
  "Sync internships - ET :00|0|9,12,15,18,21"
  "Sync internships - ET :45|45|9,12,15,18"
  "Sync internships - ET :30|30|10,13,16,19"
  "Sync internships - ET :15|15|11,14,17,20"
)

existing=""
if ! $dry_run; then
  existing=$(curl -sS -H "Authorization: Bearer ${CRON_JOB}" "$API" | jq -r '.jobs[].title')
fi

created=0
for spec in "${JOBS[@]}"; do
  IFS='|' read -r title minute hours <<<"$spec"

  if [[ -n "$existing" ]] && grep -Fxq "$title" <<<"$existing"; then
    printf 'Skipping %-28s already exists\n' "$title"
    continue
  fi

  # GitHub refuses a request that carries no User-Agent, so name ourselves even
  # though cron-job.org sends one of its own.
  payload=$(jq -n \
    --arg title "$title" \
    --arg url "$DISPATCH_URL" \
    --arg auth "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN_FINE_GRAINED}" \
    --argjson minutes "[${minute}]" \
    --argjson hours "[${hours}]" \
    '{job: {
        url: $url,
        title: $title,
        enabled: true,
        saveResponses: true,
        requestMethod: 1,
        extendedData: {
          headers: {
            "Authorization": $auth,
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "crawljob-scheduler"
          },
          body: ({ref: "main"} | tojson)
        },
        schedule: {
          timezone: "America/New_York",
          expiresAt: 0,
          hours: $hours,
          minutes: $minutes,
          mdays: [-1],
          months: [-1],
          wdays: [-1]
        }
      }}')

  printf 'Creating %-28s minute :%-2s hours %s ET\n' "$title" "$minute" "$hours"

  if $dry_run; then
    printf '%s' "$payload" |
      jq '.job.extendedData.headers.Authorization = "Bearer <PAT>"'
    continue
  fi

  # Space the requests out, then back off further on a 429. Four jobs are created
  # once in the life of this repo, so patience costs nothing.
  [[ $created -gt 0 ]] && sleep 30
  body=$(mktemp)
  for attempt in 1 2 3 4 5; do
    code=$(printf '%s' "$payload" | curl -sS -o "$body" -w '%{http_code}' -X PUT \
      -H "Authorization: Bearer ${CRON_JOB}" \
      -H "Content-Type: application/json" \
      --data @- "$API")
    case "$code" in
      2*)   jq -c . <"$body"; created=$((created + 1)); break ;;
      429)  wait=$((attempt * 30))
            echo "   rate limited, waiting ${wait}s (attempt ${attempt}/5)"
            sleep "$wait" ;;
      *)    echo "   failed with HTTP ${code}:" >&2; cat "$body" >&2; rm -f "$body"; exit 1 ;;
    esac
    [[ $attempt == 5 ]] && { echo "   gave up after five attempts" >&2; rm -f "$body"; exit 1; }
  done
  rm -f "$body"
done

if $dry_run; then
  echo
  echo "Dry run: nothing was created."
  exit 0
fi

echo
echo "Done. These four jobs are the only clock the sync has: .github/workflows/sync.yml"
echo "carries no schedule of its own, so if they stop, nothing runs and nothing warns."
