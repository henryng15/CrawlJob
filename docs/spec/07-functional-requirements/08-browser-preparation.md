# 7.8 Browser preparation

> Part of **7. Functional Requirements**

The system must:

1. allocate a browser slot;
2. launch or restore the correct browser profile;
3. navigate to the canonical application URL;
4. detect ATS type;
5. map form fields;
6. fill deterministic fields;
7. draft safe free-text fields;
8. upload the tailored resume;
9. identify unresolved/manual fields;
10. take a screenshot;
11. save a replay package;
12. stop before Submit.

Field source types:

```text
LOCKED_FACT
PROFILE_FACT
DERIVED_DETERMINISTIC
AI_DRAFT
USER_OVERRIDE
MANUAL_REQUIRED
UNRESOLVED
```

Fields that must default to manual or locked answers:

- sponsorship;
- work authorization;
- citizenship;
- export control;
- criminal-history questions;
- disability;
- veteran status;
- race/ethnicity;
- gender;
- salary;
- relocation commitment;
- noncompete/conflict questions;
- attestation;
- electronic signature;
- “I certify” checkboxes.

The system may prefill a user-configured locked EEO preference, but it must never infer one.
