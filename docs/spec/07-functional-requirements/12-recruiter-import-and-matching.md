# 7.12 Recruiter import and matching

> Part of **7. Functional Requirements**

Input columns currently available:

```text
name
company
email
```

Optional future columns:

```text
title
linkedin_url
location
team
source
verified_at
notes
```

Importer requirements:

- CSV and XLSX support;
- email syntax validation;
- lowercase email;
- company normalization;
- duplicate merge;
- preview before commit;
- import report;
- no emails sent during import.

Recruiter match order:

1. exact normalized company;
2. email domain equals company domain;
3. approved company alias;
4. fuzzy company match requiring confidence threshold;
5. manual selection.

When multiple recruiters match:

1. prefer titles containing:
   - university;
   - campus;
   - early career;
   - technical recruiter;
   - software;
2. prefer recruiter not contacted recently;
3. select only one recruiter by default;
4. require manual selection when confidence is low.
