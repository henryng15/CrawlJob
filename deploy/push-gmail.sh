#!/usr/bin/env bash
# One-time Gmail authorisation for the production instance.
#
#   ./deploy/push-gmail.sh ~/Downloads/client_secret_*.json
#
# The OAuth flow runs on *this* machine, in *your* browser, and only the
# resulting encrypted token is copied to the server. That ordering is not
# incidental:
#
#   * The consent screen needs a browser and a human. A headless server has
#     neither, and driving one from the server would mean your Google password
#     passing through software you did not write.
#   * The token is encrypted with APP_ENCRYPTION_KEY before it moves, so it is
#     useless to anyone who intercepts it — and useless on any server that does
#     not have the same key.
#
# The credential this produces cannot send email. gmail.send is never requested.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly REPO_ROOT
readonly SECRETS="$REPO_ROOT/deploy/secrets.env"
readonly REMOTE_USER="ubuntu"
readonly HOST="internshipops"
readonly REMOTE_TOKEN="/data/internship-ops/secrets/gmail_token.enc"

die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

CLIENT_SECRETS="${1:-}"
[[ -n "$CLIENT_SECRETS" ]] || cat <<'EOT' >&2
usage: ./deploy/push-gmail.sh <client_secret.json>

Get that file from the Google Cloud console, once:

  1. console.cloud.google.com -> create a project
  2. APIs & Services -> Library -> enable "Gmail API"
  3. APIs & Services -> OAuth consent screen
       User type: External, add your own address as a test user
  4. *** Publishing status -> In production ***
       Left in "Testing", Google expires refresh tokens after SEVEN DAYS and
       outreach breaks every week with an error that reads like a bug in this
       code. This is the step everyone misses.
  5. Credentials -> Create credentials -> OAuth client ID -> Desktop app
  6. Download the JSON, and pass its path to this script.

EOT
[[ -n "$CLIENT_SECRETS" ]] || exit 1
[[ -f "$CLIENT_SECRETS" ]] || die "no such file: $CLIENT_SECRETS"
[[ -f "$SECRETS" ]] || die "no $SECRETS — run ./deploy/deploy.sh first"

# The same key the server uses. A token encrypted with any other key decrypts to
# nothing there, and the failure would show up as a broken Gmail integration
# rather than as a key mismatch.
set -a
# shellcheck source=/dev/null
source "$SECRETS"
set +a

printf '\033[1m==> Authorising in your browser\033[0m\n'
local_token="$(mktemp -d)/gmail_token.enc"
(
  cd "$REPO_ROOT"
  APP_ENCRYPTION_KEY="$APP_ENCRYPTION_KEY" \
    uv run --extra gmail python scripts/gmail_authorize.py \
      --client-secrets "$CLIENT_SECRETS" --out "$local_token"
)

printf '\n\033[1m==> Copying the encrypted token\033[0m\n'
scp -q "$local_token" "$REMOTE_USER@$HOST:/tmp/gmail_token.enc"
ssh "$REMOTE_USER@$HOST" "
  install -m 600 -o $REMOTE_USER -g $REMOTE_USER /tmp/gmail_token.enc $REMOTE_TOKEN &&
  rm -f /tmp/gmail_token.enc &&
  cd /opt/internship-ops &&
  docker compose -f docker-compose.prod.yml restart worker
"
shred -u "$local_token" 2>/dev/null || rm -f "$local_token"

cat <<'EOT'

Done. Drafts will now be written into your real mailbox.

Reminder: nothing in this system can send them. The token has no send scope, and
the Gmail interface has no send method. Pressing Send in Gmail is the only way an
email leaves.
EOT
