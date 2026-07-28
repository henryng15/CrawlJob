"""Open the Gmail client a worker should use (spec §7.14, §18.6).

Development gets an in-memory client, so nothing during a local run can put a
draft in the user's real mailbox. Production gets the Google client, and refuses
clearly when its credential is missing rather than failing three calls later.
"""

from __future__ import annotations

from functools import lru_cache

from app.config import Settings
from app.safety import assert_gmail_service_has_no_send
from app.services.gmail import GmailService, InMemoryGmail
from app.worker.runtime import PermanentFailure

__all__ = ["open_gmail"]


@lru_cache(maxsize=1)
def _in_memory() -> InMemoryGmail:
    """One instance per process, so a draft created in one task is visible in the
    next — matching how the real mailbox behaves."""
    return InMemoryGmail()


def open_gmail(settings: Settings) -> GmailService:
    if settings.app_env != "production" or settings.gmail_token_path is None:
        service: GmailService = _in_memory()
    else:
        token_path = settings.gmail_token_path
        if not token_path.exists():
            # No retry will conjure a credential. §16.6: stop, and say what to do.
            raise PermanentFailure(
                f"No Gmail token at {token_path}. Run scripts/gmail_authorize.py "
                "and copy the encrypted token to the server."
            )

        from app.services.gmail_google import GoogleGmail, load_credentials

        service = GoogleGmail(
            credentials=load_credentials(
                token_path, settings.app_encryption_key.get_secret_value()
            )
        )

    # Belt and braces (§29): the interface has no send method, and this proves the
    # concrete object did not grow one.
    assert_gmail_service_has_no_send(service)
    return service
