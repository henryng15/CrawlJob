# 7.1 Candidate profile

> Part of **7. Functional Requirements**

The profile must store:

- legal name;
- preferred name;
- email;
- phone;
- address;
- LinkedIn;
- GitHub;
- portfolio;
- school;
- degree;
- major;
- graduation month/year;
- GPA and display policy;
- employment history;
- projects;
- skills;
- work authorization;
- sponsorship requirements;
- location preferences;
- internship terms;
- EEO defaults;
- compensation preference;
- source-of-truth resume facts.

Every field must have:

- a stable fact ID;
- value;
- sensitivity class;
- locked/unlocked status;
- verification timestamp;
- optional evidence;
- allowed transformation policy.

Example:

```yaml
candidate:
  legal_name:
    value: "Viet Hoan Nguyen"
    locked: true
    sensitivity: restricted
  preferred_name:
    value: "Henry"
    locked: true
    sensitivity: personal
  graduation_date:
    value: "2028-05"
    locked: true
    sensitivity: personal

work_authorization:
  currently_authorized_in_us:
    value: true
    locked: true
  requires_future_sponsorship:
    value: true
    locked: true
  explanation:
    value: "User-supplied statement goes here."
    locked: true
```

The real values must be confirmed by the user. Example values in this document are not legal advice.
