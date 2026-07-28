# 28. Testing Strategy

## 28.1 Unit tests

Required:

- company normalization;
- URL canonicalization;
- requisition extraction;
- duplicate fingerprints;
- sponsorship classification parsing;
- candidate locked-field enforcement;
- resume fact provenance;
- outreach cooldown;
- business-day calculations;
- task idempotency;
- state transitions;
- secret redaction.

## 28.2 ATS fixture tests

Store sanitized local HTML fixtures for:

- Greenhouse;
- Lever;
- Ashby;
- multi-page form;
- file upload;
- dropdown;
- radio group;
- checkbox;
- autocomplete;
- sponsorship question;
- EEO section;
- custom question.

Never include real candidate PII in fixtures.

## 28.3 Fake ATS app

Build a local fake ATS service with:

- configurable forms;
- fake submission endpoint;
- fake success page;
- deliberate selector changes;
- session expiration;
- validation errors;
- CAPTCHA placeholder that forces manual handling.

Use it for end-to-end tests without submitting real applications.

## 28.4 Browser tests

Test:

- field mapping;
- file upload;
- screenshot;
- storage-state restore;
- replay;
- manual edit persistence;
- submit observation;
- slot crash recovery;
- noVNC access token;
- two concurrent slots.

## 28.5 Integration tests

- Gmail draft creation against a test mailbox;
- recruiter import;
- Postgres task locking;
- encrypted backup and restore;
- Tailscale route verified manually in deployment checklist.

## 28.6 Production smoke tests

Before enabling a real ATS adapter:

1. run dry mode;
2. block submit button through injected guard;
3. use one real application URL;
4. verify every field;
5. compare screenshot;
6. close without submitting;
7. document tenant-specific differences.

---
