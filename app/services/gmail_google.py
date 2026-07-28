"""The Google-backed Gmail client (spec §7.14, §18.6).

Separate from ``gmail.py`` so the interface — the one with no ``send`` method —
stays importable without any Google library present, and so the test suite can
never accidentally construct this.

Everything here is draft-scoped. The credential is minted with
``gmail.compose`` and ``gmail.readonly`` only, so the API would refuse a send even
if this file asked for one; it does not ask.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from email.message import EmailMessage
from pathlib import Path
from typing import Any

from app.services.gmail import DraftRecord, GmailService, validate_content

__all__ = ["GoogleGmail", "load_credentials"]


def load_credentials(token_path: Path, encryption_key: str) -> Any:
    """Decrypt the token written by ``scripts/gmail_authorize.py``.

    Fernet is authenticated, so a truncated or edited token file fails to load
    rather than being half-used.
    """
    from cryptography.fernet import Fernet, InvalidToken
    from google.oauth2.credentials import Credentials

    material = base64.urlsafe_b64encode(encryption_key.encode().ljust(32, b"0")[:32])
    try:
        payload = json.loads(Fernet(material).decrypt(token_path.read_bytes()))
    except InvalidToken as exc:
        raise RuntimeError(
            f"{token_path} could not be decrypted. Either APP_ENCRYPTION_KEY changed "
            "or the file is damaged; re-run scripts/gmail_authorize.py."
        ) from exc

    # google-auth ships no annotations for this constructor; the keyword names
    # are the documented ones and are covered by the round-trip test.
    credentials: Any = Credentials(  # type: ignore[no-untyped-call]
        token=None,
        refresh_token=payload["refresh_token"],
        client_id=payload["client_id"],
        client_secret=payload["client_secret"],
        token_uri=payload["token_uri"],
        scopes=payload["scopes"],
    )
    return credentials


@dataclass(slots=True)
class GoogleGmail(GmailService):
    """Draft-only Gmail over the real API."""

    credentials: Any
    sender: str = "me"
    _service: Any = field(default=None, repr=False)

    @property
    def service(self) -> Any:
        if self._service is None:
            from googleapiclient.discovery import build

            # cache_discovery=False: the file cache warns under any non-oauth2
            # client and buys nothing for a long-lived process.
            self._service = build(
                "gmail", "v1", credentials=self.credentials, cache_discovery=False
            )
        return self._service

    # -- drafts -------------------------------------------------------------

    def _encode(self, *, to: str, subject: str, body: str) -> dict[str, Any]:
        problems = validate_content(subject, body)
        if problems:
            raise ValueError(f"refusing to draft: {'; '.join(problems)}")

        message = EmailMessage()
        message["To"] = to
        message["From"] = self.sender
        message["Subject"] = subject
        # Plain text only (§8.3): no HTML means no tracking pixel and nothing
        # that renders differently from what the user reviewed.
        message.set_content(body)
        return {"raw": base64.urlsafe_b64encode(message.as_bytes()).decode()}

    def create_draft(self, *, to: str, subject: str, body: str) -> DraftRecord:
        created = (
            self.service.users()
            .drafts()
            .create(userId="me", body={"message": self._encode(to=to, subject=subject, body=body)})
            .execute()
        )
        return DraftRecord(
            draft_id=created["id"],
            to=to,
            subject=subject,
            body=body,
            thread_id=created.get("message", {}).get("threadId"),
            message_id=created.get("message", {}).get("id"),
            created_at=datetime.now(UTC),
        )

    def update_draft(self, draft_id: str, *, subject: str, body: str) -> DraftRecord:
        existing = self.get_draft(draft_id)
        if existing is None:
            raise KeyError(draft_id)

        updated = (
            self.service.users()
            .drafts()
            .update(
                userId="me",
                id=draft_id,
                body={
                    "message": self._encode(to=existing.to, subject=subject, body=body)
                },
            )
            .execute()
        )
        return DraftRecord(
            draft_id=updated["id"],
            to=existing.to,
            subject=subject,
            body=body,
            thread_id=updated.get("message", {}).get("threadId"),
            message_id=updated.get("message", {}).get("id"),
        )

    def delete_draft(self, draft_id: str) -> bool:
        from googleapiclient.errors import HttpError

        try:
            self.service.users().drafts().delete(userId="me", id=draft_id).execute()
        except HttpError as exc:
            if exc.status_code == 404:
                return False
            raise
        return True

    def get_draft(self, draft_id: str) -> DraftRecord | None:
        from googleapiclient.errors import HttpError

        try:
            draft = (
                self.service.users()
                .drafts()
                .get(userId="me", id=draft_id, format="metadata")
                .execute()
            )
        except HttpError as exc:
            if exc.status_code == 404:
                # Not an error: the user deleting a draft is a decision, and
                # reconciliation reads the absence as exactly that.
                return None
            raise

        message = draft.get("message", {})
        headers = {
            h["name"].lower(): h["value"] for h in message.get("payload", {}).get("headers", [])
        }
        return DraftRecord(
            draft_id=draft["id"],
            to=headers.get("to", ""),
            subject=headers.get("subject", ""),
            body="",  # metadata format; the body is not needed to reconcile
            thread_id=message.get("threadId"),
            message_id=message.get("id"),
        )

    # -- reconciliation -----------------------------------------------------

    def list_sent(self, *, thread_ids: list[str]) -> dict[str, str]:
        found: dict[str, str] = {}
        for thread_id in thread_ids:
            messages = self._thread_messages(thread_id)
            for message in messages:
                if "SENT" in message.get("labelIds", []):
                    found[thread_id] = message["id"]
                    break
        return found

    def list_replies(self, *, thread_ids: list[str]) -> dict[str, datetime]:
        """Timestamps of inbound messages on each thread.

        A message the user sent is not a reply, so SENT-labelled messages are
        excluded — without that, every outreach would look answered the moment it
        left the outbox.
        """
        found: dict[str, datetime] = {}
        for thread_id in thread_ids:
            for message in self._thread_messages(thread_id):
                labels = message.get("labelIds", [])
                if "SENT" in labels:
                    continue
                epoch_ms = int(message.get("internalDate", 0))
                if epoch_ms:
                    found[thread_id] = datetime.fromtimestamp(epoch_ms / 1000, tz=UTC)
                    break
        return found

    def _thread_messages(self, thread_id: str) -> list[dict[str, Any]]:
        from googleapiclient.errors import HttpError

        try:
            thread = (
                self.service.users()
                .threads()
                .get(userId="me", id=thread_id, format="metadata")
                .execute()
            )
        except HttpError as exc:
            if exc.status_code == 404:
                return []
            raise
        messages = thread.get("messages", [])
        return list(messages) if isinstance(messages, list) else []
