# 14. Application Adapters

## 14.1 Adapter interface

```python
class ATSAdapter(Protocol):
    ats_type: str

    async def detect(self, page: Page) -> bool: ...
    async def extract_form_schema(self, page: Page) -> FormSchema: ...
    async def fill(self, page: Page, answers: AnswerSet) -> FillResult: ...
    async def upload_resume(self, page: Page, path: Path) -> UploadResult: ...
    async def validate_before_review(self, page: Page) -> ValidationResult: ...
    async def observe_submission(self, page: Page) -> SubmissionObservation: ...
    async def create_replay_package(self, page: Page) -> ReplayPackage: ...
```

## 14.2 Greenhouse MVP adapter

Must support:

- embedded and hosted Greenhouse forms;
- personal info;
- links;
- resume upload;
- education;
- common custom questions;
- EEO section;
- multi-select questions;
- location/autocomplete;
- review stop before Submit.

Use public Job Board API when possible to obtain question labels before browser navigation.

## 14.3 Lever MVP adapter

Must support:

- hosted Lever form;
- name/contact;
- resume;
- links;
- free-text questions;
- checkbox and dropdown questions;
- multiple pages if present;
- stop before Submit.

## 14.4 Ashby MVP adapter

Must support:

- hosted Ashby form;
- structured job metadata;
- form sections;
- file upload;
- work authorization;
- custom questions;
- stop before Submit.

## 14.5 Workday Phase 2

Workday must not be added until:

- core state machine is stable;
- replay packages work;
- browser slot recovery is tested;
- Greenhouse/Lever/Ashby have fixture coverage.

Workday-specific requirements:

- tenant-specific account/profile handling;
- multi-page wizard;
- dynamic fields;
- repeated education/work-history sections;
- save-and-continue behavior;
- session expiration;
- possible email verification;
- application profile reuse;
- tenant adapter registry;
- manual-login queue.

## 14.6 Unsupported application behavior

For unsupported ATS or heavily customized form:

- collect page schema;
- fill only deterministic common fields;
- save screenshot;
- mark `MANUAL_FIELD_REQUIRED`;
- never guess or submit.

---
