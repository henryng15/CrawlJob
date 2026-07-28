# 25. Monitoring and Operations

## 25.1 Health endpoints

```text
/health/live
/health/ready
/health/database
/health/browser-slots
/health/gmail
/health/llm
/health/storage
```

## 25.2 Metrics

Track:

- jobs discovered;
- jobs deduplicated;
- jobs selected;
- resumes generated;
- resume validation failures;
- application fill success by ATS;
- replay success;
- manual fields per application;
- submission detection success;
- Gmail draft success;
- replies;
- bounce/suppression;
- LLM tokens and cost;
- RAM;
- disk;
- task latency;
- task retries.

Do not use a public telemetry vendor in MVP.

A lightweight internal metrics page is sufficient.

## 25.3 Alerts

Notify the user in the dashboard and optionally by email for:

- disk over 80%;
- database unavailable;
- backup failed;
- browser slot unhealthy;
- Gmail token revoked;
- LLM budget exceeded;
- Oracle instance reboot;
- Tailscale disconnected;
- repeated ATS adapter failure;
- possible duplicate submission.

---
