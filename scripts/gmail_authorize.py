#!/usr/bin/env python
"""One-time Gmail authorization helper (spec §18.6).

Run this on your own machine. It opens *your* browser, you approve the scopes in
your own Google session, and the resulting refresh token is encrypted and written
to disk. Your password is never typed anywhere but Google's own login page, and
nothing else — including this tool — ever sees it.

    uv run python scripts/gmail_authorize.py

Prerequisites, done once in the Google Cloud console:

1. Create a project.
2. Enable the Gmail API.
3. OAuth consent screen -> External -> add yourself as the sole user.
4. **Publishing status -> In production.**
   Left in "Testing", Google expires refresh tokens after seven days and outreach
   breaks every week with an error that reads like a bug in this code. The
   "unverified app" warning on the consent screen is expected and safe to accept
   for your own project.
5. Credentials -> Create credentials -> OAuth client ID -> **Desktop app**.
6. Download the JSON and pass its path below.

The token this produces can create and read drafts. It cannot send: the send
scope is never requested, so even a compromised token could not email anyone.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import stat
import sys
from pathlib import Path

from app.services.gmail import SCOPES


def encrypt(plaintext: bytes, key: str) -> bytes:
    """Encrypt with the application master key.

    Fernet gives authenticated encryption, so a tampered token file fails to load
    rather than being used.
    """
    from cryptography.fernet import Fernet

    material = base64.urlsafe_b64encode(key.encode().ljust(32, b"0")[:32])
    return Fernet(material).encrypt(plaintext)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--client-secrets",
        type=Path,
        required=True,
        help="the OAuth client JSON downloaded from Google Cloud",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("/data/internship-ops/secrets/gmail_token.enc"),
        help="where to write the encrypted token",
    )
    parser.add_argument(
        "--manual",
        action="store_true",
        help=(
            "print the URL and read the redirected address back, instead of "
            "catching the redirect on a local port. Use this where the browser "
            "cannot reach this process — WSL, a container, an ssh session."
        ),
    )
    args = parser.parse_args()

    if not args.client_secrets.exists():
        print(f"client secrets not found: {args.client_secrets}", file=sys.stderr)
        return 1

    master_key = os.environ.get("APP_ENCRYPTION_KEY", "")
    if not master_key or "dev-only" in master_key:
        print(
            "Set APP_ENCRYPTION_KEY to a real value first:\n"
            '  python -c "import secrets; print(secrets.token_urlsafe(48))"',
            file=sys.stderr,
        )
        return 1

    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        print(
            "Install the Gmail extra first:  uv sync --extra gmail",
            file=sys.stderr,
        )
        return 1

    print("Requesting these scopes:")
    for scope in SCOPES:
        print(f"  - {scope}")
    print("\nNote there is no gmail.send scope. This token cannot send email.\n")

    flow = InstalledAppFlow.from_client_secrets_file(str(args.client_secrets), list(SCOPES))

    if args.manual:
        # The loopback listener assumes the browser can reach this process. Under
        # WSL, in a container, or over ssh it often cannot — and the failure is
        # not a clean refusal: run_local_server() serves the first connection to
        # arrive, and any stray probe leaves it with no request URI at all, so it
        # gives up with a timeout error while the browser is still waiting.
        #
        # Here the redirect is allowed to fail in the browser. The address bar
        # still holds the authorization code, and pasting the address back is the
        # same exchange the listener would have done.
        flow.redirect_uri = "http://localhost"
        url, _ = flow.authorization_url(prompt="consent", access_type="offline")
        print("Open this in your browser, approve, then copy the address it lands on.")
        print("That page will not load. It does not need to — the code is in the URL.\n")
        print(url, "\n")
        response = input("Paste the address (or just the code) here: ").strip()
        if not response:
            print("nothing pasted", file=sys.stderr)
            return 1
        if response.startswith(("http://", "https://")):
            # oauthlib refuses to read an authorization response over plain http.
            # The loopback redirect is always http, so google-auth-oauthlib rewrites
            # the scheme before handing it over; the exchange itself goes to
            # Google over TLS either way. Same trick here, for the same reason.
            if response.startswith("http://"):
                response = "https://" + response.removeprefix("http://")
            flow.fetch_token(authorization_response=response)
        else:
            flow.fetch_token(code=response)
        credentials = flow.credentials
    else:
        # Opens the system browser and waits on a loopback redirect. Nothing is
        # typed into a browser this tool controls.
        credentials = flow.run_local_server(port=0, prompt="consent", access_type="offline")

    if not credentials.refresh_token:
        print(
            "Google returned no refresh token. Revoke this app's access at\n"
            "  https://myaccount.google.com/permissions\n"
            "and run this again — Google only issues one on first consent.",
            file=sys.stderr,
        )
        return 1

    payload = json.dumps(
        {
            "refresh_token": credentials.refresh_token,
            "client_id": credentials.client_id,
            "client_secret": credentials.client_secret,
            "token_uri": credentials.token_uri,
            "scopes": list(credentials.scopes or SCOPES),
        }
    ).encode()

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(encrypt(payload, master_key))
    args.out.chmod(stat.S_IRUSR | stat.S_IWUSR)  # 0600

    print(f"\nEncrypted token written to {args.out}")
    print("Copy it to the server's secrets directory. Do not commit it.")
    print(
        "\nIf outreach starts failing after about a week, the OAuth app is still "
        "in Testing status — change it to In production."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
