# 29. Hard Safety Guards in Code

Implement an immutable production safety module:

```python
class SafetySettings(BaseModel):
    auto_submit_enabled: Literal[False] = False
    auto_send_email_enabled: Literal[False] = False
    captcha_bypass_enabled: Literal[False] = False
    linkedin_automation_enabled: Literal[False] = False
```

Application startup must fail if environment variables attempt to enable these options.

Before browser review:

```python
assert not adapter.has_clicked_submit
assert application.status in ALLOWED_PRE_SUBMIT_STATES
```

Before Gmail draft:

```python
assert application.status == ApplicationStatus.SUBMITTED
assert application.submitted_at is not None
assert outreach.due_at <= now
assert not suppression_service.is_suppressed(recruiter)
assert limiter.can_create_draft(...)
```

The Gmail service interface in MVP should not expose a `send` method.

---
