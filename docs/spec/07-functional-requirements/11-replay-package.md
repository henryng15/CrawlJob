# 7.11 Replay package

> Part of **7. Functional Requirements**

A replay package must contain:

```json
{
  "application_id": "uuid",
  "application_url": "https://...",
  "ats_type": "GREENHOUSE",
  "storage_state_path": "...",
  "resume_artifact_path": "...",
  "fields": [
    {
      "semantic_key": "candidate.first_name",
      "label": "First name",
      "field_type": "text",
      "value_ref": "candidate.legal_first_name",
      "source_type": "LOCKED_FACT",
      "required": true,
      "last_locator_strategy": {
        "role": "textbox",
        "label": "First name"
      }
    }
  ],
  "manual_fields": [],
  "page_fingerprint": "...",
  "created_at": "..."
}
```

Replay must prioritize semantic matching:

1. accessible label;
2. ARIA role/name;
3. HTML `name`;
4. associated label;
5. nearby question text;
6. stable ATS-specific attributes;
7. CSS selector only as last fallback.

If the page fingerprint changed materially, stop and request manual review.
