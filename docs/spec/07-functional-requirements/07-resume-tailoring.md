# 7.7 Resume tailoring

> Part of **7. Functional Requirements**

The resume system must consist of:

1. **Facts registry**
2. **Resume template**
3. **Tailoring plan**
4. **Validation**
5. **Rendering**
6. **Immutable artifact storage**

Allowed changes:

- reorder existing bullets;
- select relevant experiences/projects;
- shorten wording;
- emphasize relevant technologies;
- use JD keywords when factually supported;
- adjust summary only when all claims map to candidate facts.

Disallowed changes:

- new employers;
- new projects;
- new metrics;
- inflated ownership;
- fabricated users or scale;
- fabricated technologies;
- fabricated dates;
- altered title;
- altered GPA;
- altered graduation date.

Every generated bullet must include provenance:

```json
{
  "text": "Implemented ...",
  "fact_ids": ["experience.todd.3", "skill.fastapi"],
  "transformation": "rewrite",
  "validation": "passed"
}
```

Artifacts per job:

```text
/data/artifacts/applications/{application_id}/
├── job-description.html
├── job-description.txt
├── sponsorship-analysis.json
├── fit-score.json
├── resume-plan.json
├── resume-source.html
├── resume-tailored.pdf
├── resume-diff.json
├── resume-validation.json
└── sha256sums.txt
```

The application record must point to the exact `resume_version_id` uploaded.
