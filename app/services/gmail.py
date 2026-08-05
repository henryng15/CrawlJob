"""Gmail draft service (spec §7.14).

The interface exposes ``create_draft``, ``update_draft``, ``delete_draft`` and
read-only reconciliation. It does not expose ``send`` — not a disabled ``send``,
not a ``send`` that raises. The method is absent, so a future refactor cannot
re-enable sending by flipping a flag, and
``assert_gmail_service_has_no_send`` fails the build if one reappears.

The user sends from Gmail themselves. Reconciliation then observes what happened:
the draft is gone and a matching message is in SENT, or a reply arrived on the
thread.

**Setup note.** A Google Cloud project left in "Testing" publishing status expires
refresh tokens after seven days, which breaks outreach weekly with an error that
looks like a code bug. Publish the OAuth app to "In production"; the unverified-app
warning is expected for personal use. The spec's §18.6 omits this.
"""

from __future__ import annotations

import base64
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from email.message import EmailMessage
from enum import StrEnum

__all__ = [
    "SCOPES",
    "DraftRecord",
    "GmailService",
    "InMemoryGmail",
    "MessageState",
    "build_mime",
    "reconcile",
]

#: The minimum that works. ``gmail.compose`` creates and updates drafts;
#: ``gmail.readonly`` is needed only to observe that the user sent one (§18.6).
SCOPES: tuple[str, ...] = (
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.readonly",
)

#: Content rules from §8.3. A tracking pixel or a hidden link would make a
#: personal email into marketing, and the recipient can tell.
_FORBIDDEN_BODY = (
    (re.compile(r"<img[^>]*\b(width|height)\s*=\s*[\"']?1[\"']?", re.I), "tracking pixel"),
    (re.compile(r"display\s*:\s*none", re.I), "hidden content"),
    (re.compile(r"\b(utm_source|utm_campaign|mc_eid)\b", re.I), "campaign tracking parameter"),
)

#: An unrendered merge token. "Hi {{first_name}}" arriving in a recruiter's inbox
#: says the message was mass-produced, which is the one impression §8.3 exists to
#: avoid — and it is trivially detectable before the draft is written.
_PLACEHOLDER = re.compile(r"\{\{\s*\w+\s*\}\}|\{%.*?%\}|<<\s*\w+\s*>>|\[\[\s*\w+\s*\]\]")


class MessageState(StrEnum):
    DRAFT = "DRAFT"
    SENT = "SENT"
    REPLIED = "REPLIED"
    BOUNCED = "BOUNCED"
    DELETED = "DELETED"


@dataclass(slots=True)
class DraftRecord:
    draft_id: str
    to: str
    subject: str
    body: str
    thread_id: str | None = None
    message_id: str | None = None
    created_at: datetime | None = None


def validate_content(subject: str, body: str) -> list[str]:
    """Check an email against §8.3. Returns the problems found.

    Empty means it may be drafted.
    """
    problems: list[str] = []
    if not subject.strip():
        problems.append("subject is empty")
    if not body.strip():
        problems.append("body is empty")
    if len(body) > 2000:
        problems.append(f"body is {len(body)} characters; §8.3 asks for a short one")

    for pattern, label in _FORBIDDEN_BODY:
        if pattern.search(body):
            problems.append(f"body contains a {label}")

    for where, text in (("subject", subject), ("body", body)):
        found = _PLACEHOLDER.search(text)
        if found:
            problems.append(f"{where} contains an unrendered placeholder {found.group(0)!r}")

    return problems


def build_mime(*, to: str, sender: str, subject: str, body: str) -> str:
    """Build a base64url-encoded plain-text message.

    Plain text only (§8.3): no HTML means no pixel, no hidden link, and nothing
    that renders differently from what the user reviewed.
    """
    message = EmailMessage()
    message["To"] = to
    message["From"] = sender
    message["Subject"] = subject
    message.set_content(body)
    return base64.urlsafe_b64encode(message.as_bytes()).decode()


class GmailService(ABC):
    """Draft-only Gmail interface.

    Deliberately has no ``send``. See the module docstring.
    """

    @abstractmethod
    def create_draft(self, *, to: str, subject: str, body: str) -> DraftRecord:
        """Create a draft. Raises ``ValueError`` if the content breaks §8.3."""

    @abstractmethod
    def update_draft(self, draft_id: str, *, subject: str, body: str) -> DraftRecord:
        """Replace a draft's content, e.g. after the user asks for a regeneration."""

    @abstractmethod
    def delete_draft(self, draft_id: str) -> bool:
        """Remove a draft the user decided against."""

    @abstractmethod
    def get_draft(self, draft_id: str) -> DraftRecord | None: ...

    @abstractmethod
    def list_sent(self, *, thread_ids: list[str]) -> dict[str, str]:
        """Map thread id to sent message id, for threads the user actually sent."""

    @abstractmethod
    def list_replies(self, *, thread_ids: list[str]) -> dict[str, datetime]:
        """Map thread id to the timestamp of an inbound reply."""


@dataclass(slots=True)
class InMemoryGmail(GmailService):
    """A GmailService that touches no network.

    The default in development and the whole test suite, so nothing can create a
    real draft in the user's mailbox during a test run. It also stands in for the
    real client in every test of the outreach pipeline, which keeps those tests
    fast and free of OAuth setup.
    """

    sender: str = "user@example.com"
    drafts: dict[str, DraftRecord] = field(default_factory=dict)
    sent: dict[str, str] = field(default_factory=dict)
    replies: dict[str, datetime] = field(default_factory=dict)
    _counter: int = 0

    def create_draft(self, *, to: str, subject: str, body: str) -> DraftRecord:
        problems = validate_content(subject, body)
        if problems:
            raise ValueError(f"refusing to draft: {'; '.join(problems)}")

        self._counter += 1
        draft = DraftRecord(
            draft_id=f"draft-{self._counter}",
            to=to,
            subject=subject,
            body=body,
            thread_id=f"thread-{self._counter}",
        )
        self.drafts[draft.draft_id] = draft
        return draft

    def update_draft(self, draft_id: str, *, subject: str, body: str) -> DraftRecord:
        problems = validate_content(subject, body)
        if problems:
            raise ValueError(f"refusing to update: {'; '.join(problems)}")
        draft = self.drafts[draft_id]
        draft.subject = subject
        draft.body = body
        return draft

    def delete_draft(self, draft_id: str) -> bool:
        return self.drafts.pop(draft_id, None) is not None

    def get_draft(self, draft_id: str) -> DraftRecord | None:
        return self.drafts.get(draft_id)

    def list_sent(self, *, thread_ids: list[str]) -> dict[str, str]:
        return {tid: mid for tid, mid in self.sent.items() if tid in thread_ids}

    def list_replies(self, *, thread_ids: list[str]) -> dict[str, datetime]:
        return {tid: at for tid, at in self.replies.items() if tid in thread_ids}

    # -- test affordances, not part of the interface ------------------------

    def simulate_user_sent(self, draft_id: str) -> None:
        """Stand in for the user pressing Send in Gmail."""
        draft = self.drafts.pop(draft_id)
        assert draft.thread_id is not None
        self.sent[draft.thread_id] = f"msg-{draft_id}"

    def simulate_reply(self, thread_id: str, at: datetime) -> None:
        self.replies[thread_id] = at


@dataclass(frozen=True, slots=True)
class Reconciliation:
    """What reconciliation concluded about one outreach task."""

    state: MessageState
    message_id: str | None = None
    replied_at: datetime | None = None
    reason: str = ""


def reconcile(
    service: GmailService,
    *,
    draft_id: str | None,
    thread_id: str | None,
) -> Reconciliation:
    """Work out what the user did with a draft (§7.14).

    A reply is checked first: a thread with an answer in it has certainly been
    sent, and treating it as merely SENT would leave a follow-up scheduled against
    a live conversation (§8.4).
    """
    if thread_id:
        replies = service.list_replies(thread_ids=[thread_id])
        if thread_id in replies:
            return Reconciliation(
                MessageState.REPLIED,
                replied_at=replies[thread_id],
                reason="a reply was found on the thread",
            )

        sent = service.list_sent(thread_ids=[thread_id])
        if thread_id in sent:
            return Reconciliation(
                MessageState.SENT,
                message_id=sent[thread_id],
                reason="a sent message was found on the thread",
            )

    if draft_id and service.get_draft(draft_id) is not None:
        return Reconciliation(MessageState.DRAFT, reason="the draft is still unsent")

    # The draft is gone and nothing was found in SENT. Deleting a draft is a
    # decision not to send, so it must not be recorded as sent (§8.3).
    return Reconciliation(
        MessageState.DELETED,
        reason="the draft no longer exists and no sent message was found",
    )
