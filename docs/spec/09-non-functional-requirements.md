# 9. Non-Functional Requirements

## 9.1 Reliability

- all tasks idempotent;
- durable state in PostgreSQL;
- restart-safe workers;
- no duplicate task execution after crash;
- browser slot heartbeat;
- stale-lock recovery;
- daily reconciliation;
- retry with exponential backoff for transient errors;
- no unbounded retry loops.

## 9.2 Performance

Target on OCI A1:

- dashboard response: under 500 ms for normal pages;
- daily discovery: under 30 minutes;
- resume generation: under 90 seconds per selected job, excluding API delays;
- browser form preparation: under 5 minutes per supported ATS;
- replay: target under 60 seconds;
- maximum two browser preparations concurrently.

## 9.3 Capacity

- 10 prepared applications/day;
- 2 live sessions;
- 100 recruiters initially;
- 10,000 stored job records;
- 2 years of application history;
- 20 GB maximum backup footprint in OCI Object Storage.

## 9.4 Security

- no public application ports;
- Tailscale-only access;
- app-level authorization;
- secrets encrypted or permission-restricted;
- PII removed from logs;
- database backups encrypted;
- signed session links;
- browser sessions scoped to one application;
- CSRF protection;
- secure cookies;
- content security policy;
- no remote code execution from job-page content.

## 9.5 Maintainability

- typed Python;
- migrations;
- adapter interface;
- fixture-driven ATS tests;
- structured logging;
- documented commands;
- lint and test in CI;
- architecture decision records.

---
