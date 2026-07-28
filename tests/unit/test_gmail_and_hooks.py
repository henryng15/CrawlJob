"""Gmail draft service and hook generation (spec §7.13, §7.14, §8.3).

``TestNoSendCapability`` is the hard rule from AGENTS.md expressed as a test. If
it fails, the system can send email, which it must never be able to do.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.safety import SafetyViolation, assert_gmail_service_has_no_send
from app.services.gmail import (
    SCOPES,
    GmailService,
    InMemoryGmail,
    MessageState,
    build_mime,
    reconcile,
    validate_content,
)
from app.services.hooks import (
    Hook,
    HookType,
    SourceDocument,
    compose_email,
    generate_hook,
    verify_hook,
)
from app.services.llm.base import NullProvider

NOW = datetime(2026, 7, 28, tzinfo=UTC)

JD = SourceDocument(
    url="https://boards.greenhouse.io/acme/jobs/1",
    text=(
        "Acme is hiring a Software Engineer Intern. "
        "Our team rebuilt the deployment pipeline around deterministic builds last year."
    ),
)

BLOG = SourceDocument(
    url="https://acme.com/engineering/deterministic-builds",
    text="We wrote about how deterministic builds cut our CI times by two thirds.",
    kind="engineering_blog",
)


# --------------------------------------------------------------------- gmail


class TestNoSendCapability:
    def test_the_interface_has_no_send_method(self):
        """§7.14: absent, not disabled. A flag cannot re-enable what is not there."""
        assert not hasattr(GmailService, "send")
        assert not hasattr(InMemoryGmail, "send")

    def test_the_safety_guard_accepts_the_service(self):
        assert_gmail_service_has_no_send(InMemoryGmail())

    def test_adding_a_send_method_would_fail_the_guard(self):
        class Rogue(InMemoryGmail):
            def send(self) -> None: ...

        with pytest.raises(SafetyViolation):
            assert_gmail_service_has_no_send(Rogue())

    def test_the_scopes_do_not_include_send(self):
        """gmail.send is never requested, so the token cannot send even if asked."""
        assert not any("gmail.send" in scope for scope in SCOPES)
        assert any(scope.endswith("gmail.compose") for scope in SCOPES)


class TestContentRules:
    def test_a_plain_short_email_is_accepted(self):
        assert validate_content("Hello", "A short note.") == []

    @pytest.mark.parametrize(
        ("subject", "body", "fragment"),
        [
            ("", "body", "subject is empty"),
            ("subject", "   ", "body is empty"),
            ("subject", "x" * 2500, "short one"),
            ("subject", '<img src="x" width="1" height="1">', "tracking pixel"),
            ("subject", '<div style="display:none">hi</div>', "hidden content"),
            ("subject", "See https://acme.com?utm_source=cold", "campaign tracking"),
            ("Hi {{first_name}}", "body", "unrendered placeholder"),
            ("subject", "Hi <<name>>, I applied", "unrendered placeholder"),
            ("subject", "Hi [[company]], I applied", "unrendered placeholder"),
            ("subject", "{% if x %}hello{% endif %}", "unrendered placeholder"),
        ],
    )
    def test_violations_are_reported(self, subject, body, fragment):
        problems = validate_content(subject, body)
        assert any(fragment in p for p in problems), problems

    def test_the_placeholder_check_names_what_it_found(self):
        """The user has to fix it; "invalid" would not tell them where."""
        problems = validate_content("Hi {{first_name}}", "body")
        assert "'{{first_name}}'" in problems[0]

    @pytest.mark.parametrize(
        "body",
        [
            "I loved your team's work on {ledger}, a single brace is prose.",
            "Salary expectations: $70k-$80k [negotiable]",
            "Your talk << my expectations, honestly.",
        ],
    )
    def test_ordinary_punctuation_is_not_a_placeholder(self, body):
        """A false positive here blocks a legitimate email, so the pattern must
        require the doubled delimiters a template engine actually emits."""
        assert validate_content("Following up", body) == []

    def test_a_draft_with_a_tracking_pixel_is_refused(self):
        """§8.3: no tracking pixel. A personal email that phones home is not one."""
        with pytest.raises(ValueError, match="tracking pixel"):
            InMemoryGmail().create_draft(
                to="r@acme.com", subject="Hi", body='<img width="1" height="1" src="x">'
            )


class TestDrafts:
    def test_create_and_read_back(self):
        gmail = InMemoryGmail()
        draft = gmail.create_draft(to="r@acme.com", subject="Hi", body="A note.")
        assert gmail.get_draft(draft.draft_id) == draft
        assert draft.thread_id

    def test_update_replaces_the_content(self):
        gmail = InMemoryGmail()
        draft = gmail.create_draft(to="r@acme.com", subject="Hi", body="First.")
        gmail.update_draft(draft.draft_id, subject="Hi again", body="Second.")
        assert gmail.get_draft(draft.draft_id).body == "Second."  # type: ignore[union-attr]

    def test_delete_removes_it(self):
        gmail = InMemoryGmail()
        draft = gmail.create_draft(to="r@acme.com", subject="Hi", body="A note.")
        assert gmail.delete_draft(draft.draft_id)
        assert gmail.get_draft(draft.draft_id) is None

    def test_mime_is_plain_text(self):
        import base64

        encoded = build_mime(to="a@b.com", sender="c@d.com", subject="S", body="Body")
        decoded = base64.urlsafe_b64decode(encoded).decode()
        assert "text/plain" in decoded
        assert "text/html" not in decoded


class TestReconciliation:
    def test_an_untouched_draft_is_still_a_draft(self):
        gmail = InMemoryGmail()
        draft = gmail.create_draft(to="r@acme.com", subject="Hi", body="A note.")
        result = reconcile(gmail, draft_id=draft.draft_id, thread_id=draft.thread_id)
        assert result.state is MessageState.DRAFT

    def test_a_user_send_is_detected(self):
        gmail = InMemoryGmail()
        draft = gmail.create_draft(to="r@acme.com", subject="Hi", body="A note.")
        gmail.simulate_user_sent(draft.draft_id)

        result = reconcile(gmail, draft_id=draft.draft_id, thread_id=draft.thread_id)
        assert result.state is MessageState.SENT
        assert result.message_id

    def test_a_reply_outranks_a_send(self):
        """§8.4: a replied thread must not stay merely SENT, or a follow-up fires."""
        gmail = InMemoryGmail()
        draft = gmail.create_draft(to="r@acme.com", subject="Hi", body="A note.")
        gmail.simulate_user_sent(draft.draft_id)
        assert draft.thread_id is not None
        gmail.simulate_reply(draft.thread_id, NOW)

        result = reconcile(gmail, draft_id=draft.draft_id, thread_id=draft.thread_id)
        assert result.state is MessageState.REPLIED
        assert result.replied_at == NOW

    def test_a_deleted_draft_is_not_recorded_as_sent(self):
        """Deleting a draft is a decision not to send. It must not read as sent."""
        gmail = InMemoryGmail()
        draft = gmail.create_draft(to="r@acme.com", subject="Hi", body="A note.")
        gmail.delete_draft(draft.draft_id)

        result = reconcile(gmail, draft_id=draft.draft_id, thread_id=draft.thread_id)
        assert result.state is MessageState.DELETED


# ---------------------------------------------------------------------- hooks


class TestHookVerification:
    def test_a_real_excerpt_verifies(self):
        hook = Hook(
            hook_type=HookType.COMPANY_SPECIFIC,
            hook="Your work on deterministic builds caught my attention.",
            source_url=BLOG.url,
            source_excerpt="deterministic builds cut our CI times by two thirds",
            confidence=0.9,
        )
        assert verify_hook(hook, [JD, BLOG]).hook_type is HookType.COMPANY_SPECIFIC

    def test_a_fabricated_excerpt_is_dropped(self):
        """The failure this prevents: telling a recruiter about a launch that never happened."""
        hook = Hook(
            hook_type=HookType.COMPANY_SPECIFIC,
            hook="Congratulations on your Series C.",
            source_url=BLOG.url,
            source_excerpt="Acme raised a Series C led by Sequoia",
            confidence=0.95,
        )
        result = verify_hook(hook, [JD, BLOG])
        assert result.hook_type is HookType.NONE
        assert result.hook == ""
        assert any("does not appear" in c for c in result.unsupported_claims)

    def test_citing_a_source_that_was_never_fetched_is_dropped(self):
        hook = Hook(
            hook_type=HookType.COMPANY_SPECIFIC,
            hook="Nice work.",
            source_url="https://techcrunch.com/acme",
            source_excerpt="anything",
        )
        result = verify_hook(hook, [JD])
        assert result.hook_type is HookType.NONE
        assert any("was not fetched" in c for c in result.unsupported_claims)

    def test_a_hook_with_no_source_is_dropped(self):
        hook = Hook(hook_type=HookType.COMPANY_SPECIFIC, hook="You seem great.")
        result = verify_hook(hook, [JD])
        assert result.hook_type is HookType.NONE
        assert any("missing a source" in c for c in result.unsupported_claims)

    def test_punctuation_differences_still_verify(self):
        source = SourceDocument(url="https://acme.com/x", text="We don't ship on Fridays.")
        hook = Hook(
            hook_type=HookType.COMPANY_SPECIFIC,
            hook="I liked the no-Friday-deploys rule.",
            source_url=source.url,
            source_excerpt="We don’t ship on Fridays",
        )
        assert verify_hook(hook, [source]).is_usable


class TestGenerateHook:
    def test_a_grounded_hook_survives(self):
        provider = NullProvider(
            [
                {
                    "hook_type": "COMPANY_SPECIFIC",
                    "hook": "Your deterministic build work is what drew me in.",
                    "source_url": BLOG.url,
                    "source_excerpt": "deterministic builds cut our CI times by two thirds",
                    "confidence": 0.9,
                    "unsupported_claims": [],
                }
            ]
        )
        hook = generate_hook([JD, BLOG], provider=provider, company="Acme", role="SWE Intern")
        assert hook.is_usable

    def test_an_ungrounded_hook_is_discarded(self):
        provider = NullProvider(
            [
                {
                    "hook_type": "COMPANY_SPECIFIC",
                    "hook": "Congratulations on the acquisition.",
                    "source_url": JD.url,
                    "source_excerpt": "Acme was acquired last quarter",
                    "confidence": 0.95,
                    "unsupported_claims": [],
                }
            ]
        )
        hook = generate_hook([JD], provider=provider, company="Acme", role="SWE Intern")
        assert hook.hook_type is HookType.NONE

    def test_no_sources_means_no_model_call(self):
        provider = NullProvider()
        hook = generate_hook([], provider=provider, company="Acme", role="SWE Intern")
        assert hook.hook_type is HookType.NONE
        assert provider.calls == []

    def test_the_model_may_answer_none(self):
        """§7.13: no hook is a valid answer, not a failure."""
        provider = NullProvider(
            [{"hook_type": "NONE", "hook": "", "confidence": 0.0, "unsupported_claims": []}]
        )
        assert generate_hook([JD], provider=provider, company="A", role="R").hook_type is (
            HookType.NONE
        )


class TestComposeEmail:
    HOOK = Hook(
        hook_type=HookType.COMPANY_SPECIFIC,
        hook="Your deterministic build work is what drew me in.",
        source_url=BLOG.url,
        source_excerpt="deterministic builds",
        confidence=0.9,
    )

    def build(self, hook: Hook) -> tuple[str, str]:
        return compose_email(
            recruiter_first_name="Alice",
            company="Acme",
            role="Software Engineer Intern",
            applicant_name="Hoan Nguyen",
            hook=hook,
            applied_on="26 July",
        )

    def test_names_the_role_and_company(self):
        subject, body = self.build(self.HOOK)
        assert "Software Engineer Intern" in subject
        assert "Acme" in body

    def test_includes_a_verified_hook(self):
        _, body = self.build(self.HOOK)
        assert "deterministic build work" in body

    def test_omits_an_unverified_hook_entirely(self):
        """§7.13 fallback: a short, direct email that claims nothing."""
        _, body = self.build(Hook(hook_type=HookType.NONE))
        assert "deterministic" not in body
        assert "Acme" in body

    def test_has_one_clear_ask(self):
        _, body = self.build(self.HOOK)
        assert body.count("?") == 1

    def test_stays_short_and_passes_the_content_rules(self):
        subject, body = self.build(self.HOOK)
        assert validate_content(subject, body) == []

    def test_can_be_drafted_end_to_end(self):
        gmail = InMemoryGmail()
        subject, body = self.build(self.HOOK)
        draft = gmail.create_draft(to="alice@acme.com", subject=subject, body=body)
        assert gmail.get_draft(draft.draft_id) is not None
