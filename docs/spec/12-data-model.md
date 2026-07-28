# 12. Data Model

Use UUID primary keys and UTC timestamps.

## 12.1 Core tables

### `candidate_facts`

```sql
CREATE TABLE candidate_facts (
    id UUID PRIMARY KEY,
    fact_key TEXT NOT NULL UNIQUE,
    value_json JSONB NOT NULL,
    data_type TEXT NOT NULL,
    sensitivity TEXT NOT NULL,
    is_locked BOOLEAN NOT NULL DEFAULT TRUE,
    source TEXT NOT NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `companies`

```sql
CREATE TABLE companies (
    id UUID PRIMARY KEY,
    canonical_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    domain TEXT,
    aliases JSONB NOT NULL DEFAULT '[]',
    ats_types JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `job_source_records`

```sql
CREATE TABLE job_source_records (
    id UUID PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_name TEXT NOT NULL,
    external_id TEXT,
    source_url TEXT NOT NULL,
    raw_payload JSONB NOT NULL,
    content_hash TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL,
    UNIQUE(source_type, source_name, external_id, content_hash)
);
```

### `jobs`

```sql
CREATE TABLE jobs (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id),
    canonical_url TEXT NOT NULL,
    canonical_url_hash TEXT NOT NULL,
    ats_type TEXT,
    ats_board_id TEXT,
    requisition_id TEXT,
    title TEXT NOT NULL,
    normalized_title TEXT NOT NULL,
    location_text TEXT,
    normalized_location TEXT,
    country_code TEXT,
    employment_type TEXT,
    season TEXT,
    description_html TEXT,
    description_text TEXT,
    description_hash TEXT,
    posted_at TIMESTAMPTZ,
    discovered_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    dedupe_fingerprint TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Recommended unique indexes:

```sql
CREATE UNIQUE INDEX uq_job_ats_requisition
ON jobs (ats_type, ats_board_id, requisition_id)
WHERE requisition_id IS NOT NULL;

CREATE UNIQUE INDEX uq_job_url
ON jobs (canonical_url_hash);

CREATE UNIQUE INDEX uq_job_fingerprint
ON jobs (dedupe_fingerprint)
WHERE status <> 'DUPLICATE_PROBABLE';
```

### `job_source_links`

```sql
CREATE TABLE job_source_links (
    job_id UUID NOT NULL REFERENCES jobs(id),
    source_record_id UUID NOT NULL REFERENCES job_source_records(id),
    PRIMARY KEY (job_id, source_record_id)
);
```

### `sponsorship_assessments`

```sql
CREATE TABLE sponsorship_assessments (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES jobs(id),
    classification TEXT NOT NULL,
    work_authorization_restriction TEXT NOT NULL,
    evidence JSONB NOT NULL,
    confidence NUMERIC(4,3) NOT NULL,
    recommended_action TEXT NOT NULL,
    model_name TEXT,
    prompt_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(job_id)
);
```

### `job_scores`

```sql
CREATE TABLE job_scores (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES jobs(id),
    total_score NUMERIC(5,2) NOT NULL,
    components JSONB NOT NULL,
    hard_filter_result TEXT NOT NULL,
    fact_references JSONB NOT NULL,
    model_name TEXT,
    prompt_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(job_id)
);
```

### `resume_versions`

```sql
CREATE TABLE resume_versions (
    id UUID PRIMARY KEY,
    job_id UUID REFERENCES jobs(id),
    parent_resume_id UUID REFERENCES resume_versions(id),
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    source_path TEXT NOT NULL,
    pdf_path TEXT NOT NULL,
    diff_path TEXT,
    validation_path TEXT,
    sha256 TEXT NOT NULL,
    prompt_version TEXT,
    model_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `applications`

```sql
CREATE TABLE applications (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL UNIQUE REFERENCES jobs(id),
    resume_version_id UUID REFERENCES resume_versions(id),
    status TEXT NOT NULL,
    application_url TEXT NOT NULL,
    ats_type TEXT,
    browser_slot_id TEXT,
    ready_for_review_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    submission_detection_method TEXT,
    submission_confidence NUMERIC(4,3),
    confirmation_data JSONB,
    outreach_due_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `application_fields`

```sql
CREATE TABLE application_fields (
    id UUID PRIMARY KEY,
    application_id UUID NOT NULL REFERENCES applications(id),
    semantic_key TEXT,
    page_index INTEGER NOT NULL DEFAULT 0,
    question_text TEXT NOT NULL,
    field_type TEXT NOT NULL,
    answer_json JSONB,
    source_type TEXT NOT NULL,
    source_fact_ids JSONB NOT NULL DEFAULT '[]',
    confidence NUMERIC(4,3),
    required BOOLEAN NOT NULL DEFAULT FALSE,
    manual_required BOOLEAN NOT NULL DEFAULT FALSE,
    user_overridden BOOLEAN NOT NULL DEFAULT FALSE,
    locator_strategy JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `browser_sessions`

```sql
CREATE TABLE browser_sessions (
    id UUID PRIMARY KEY,
    slot_name TEXT NOT NULL,
    application_id UUID REFERENCES applications(id),
    status TEXT NOT NULL,
    review_token_hash TEXT,
    profile_path TEXT,
    storage_state_path TEXT,
    replay_package_path TEXT,
    heartbeat_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    error_summary TEXT
);
```

### `recruiters`

```sql
CREATE TABLE recruiters (
    id UUID PRIMARY KEY,
    full_name TEXT NOT NULL,
    company_id UUID REFERENCES companies(id),
    raw_company TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    email_domain TEXT,
    title TEXT,
    linkedin_url TEXT,
    location TEXT,
    source TEXT,
    verified_at TIMESTAMPTZ,
    last_contacted_at TIMESTAMPTZ,
    replied_at TIMESTAMPTZ,
    do_not_contact BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `outreach_tasks`

```sql
CREATE TABLE outreach_tasks (
    id UUID PRIMARY KEY,
    application_id UUID NOT NULL REFERENCES applications(id),
    recruiter_id UUID REFERENCES recruiters(id),
    status TEXT NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    hook_json JSONB,
    subject TEXT,
    body TEXT,
    gmail_draft_id TEXT,
    gmail_message_id TEXT,
    gmail_thread_id TEXT,
    sent_at TIMESTAMPTZ,
    replied_at TIMESTAMPTZ,
    followup_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(application_id)
);
```

### `suppression_entries`

```sql
CREATE TABLE suppression_entries (
    id UUID PRIMARY KEY,
    email TEXT,
    company_id UUID REFERENCES companies(id),
    reason TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `scheduled_tasks`

```sql
CREATE TABLE scheduled_tasks (
    id UUID PRIMARY KEY,
    task_type TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    payload JSONB NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    run_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    locked_by TEXT,
    locked_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `audit_events`

```sql
CREATE TABLE audit_events (
    id UUID PRIMARY KEY,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Audit metadata must not contain raw secrets or unnecessary PII.

---
