# 7.10 Submission detection

> Part of **7. Functional Requirements**

The browser worker must monitor:

1. URL changes;
2. success-text patterns;
3. DOM replacement;
4. form disappearance;
5. network responses associated with submission;
6. known ATS confirmation patterns.

A positive automatic confirmation should require at least:

- one strong signal; or
- two medium signals.

Strong signals:

- known confirmation URL;
- explicit “application submitted” confirmation element;
- successful known application-submit network request plus confirmation DOM.

Medium signals:

- submit button disappears;
- application form is replaced;
- “thank you” text appears;
- page title changes.

Fallbacks:

- manual `Mark Submitted`;
- Gmail confirmation reconciliation.

Store:

- `submitted_at`;
- detection method;
- confirmation URL;
- confirmation text;
- screenshot;
- relevant response metadata;
- confidence.

Never store sensitive request bodies in logs.
