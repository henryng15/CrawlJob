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
# The uid the containers run as — see the `useradd --uid 10001` in
# docker/worker.Dockerfile. The token has to belong to the account that reads
# it, not to the account that delivers it. Owned by $REMOTE_USER instead, the
# worker gets PermissionError on every draft while /setup cheerfully reports
# Gmail as connected, because stat succeeds where read does not.
readonly APP_UID=10001

die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# The loopback redirect needs the browser to reach this process. Under WSL it
# usually cannot, and the failure looks like a hang followed by a timeout error
# while the browser sits on a page that never loads. --manual reads the
# redirected address back instead.
MANUAL_FLAG=""
[[ "${2:-}" == "--manual" ]] && MANUAL_FLAG=1
readonly MANUAL_FLAG

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
      --client-secrets "$CLIENT_SECRETS" --out "$local_token" ${MANUAL_FLAG:+--manual}
)

printf '\n\033[1m==> Copying the encrypted token\033[0m\n'
scp -q "$local_token" "$REMOTE_USER@$HOST:/tmp/gmail_token.enc"
ssh "$REMOTE_USER@$HOST" "
  sudo install -m 600 -o $APP_UID -g $APP_UID /tmp/gmail_token.enc $REMOTE_TOKEN &&
  rm -f /tmp/gmail_token.enc &&
  cd /opt/internship-ops &&
  docker compose -f docker-compose.prod.yml restart worker
"
shred -u "$local_token" 2>/dev/null || rm -f "$local_token"

# A successful scp proves the bytes arrived, and nothing else. Ownership,
# permissions and the encryption key can each be wrong in a way that leaves the
# file sitting there looking finished while every draft fails — and the setup
# screen, which can only see that a file exists, would agree that it is done.
# Ask the process that actually has to use it.
printf '\n\033[1m==> Checking the worker can use it\033[0m\n'
if ! ssh "$REMOTE_USER@$HOST" \
     "cd /opt/internship-ops && docker compose -f docker-compose.prod.yml exec -T worker python -" \
     <<'PY'
from app.config import get_settings
from app.services.gmail_google import load_credentials

settings = get_settings()
credentials = load_credentials(
    settings.gmail_token_path, settings.app_encryption_key.get_secret_value()
)
if not credentials.refresh_token:
    raise SystemExit("the stored credential has no refresh token")
if any("send" in scope for scope in credentials.scopes or []):
    raise SystemExit("a send scope is present, which this system must never hold")
print("  the worker reads and decrypts the token")
PY
then
  die "the token is on the server but the worker cannot use it.

  Most likely the file belongs to the wrong account: it is read by uid $APP_UID
  inside the container, not by $REMOTE_USER. Check with:

    ssh $REMOTE_USER@$HOST 'sudo ls -ln $REMOTE_TOKEN'"
fi

cat <<'EOT'

Done. Drafts will now be written into your real mailbox.

Reminder: nothing in this system can send them. The token has no send scope, and
the Gmail interface has no send method. Pressing Send in Gmail is the only way an
email leaves.
EOT
