# 34. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Oracle Always Free capacity unavailable | Try another availability domain; keep paid VPS fallback documented |
| OCI idle reclaim | Off-instance backups; infrastructure reproducible; monitor notices |
| ARM64 browser incompatibility | Milestone 0 spike; custom image; system Chromium fallback |
| Browser RAM exhaustion | Two fixed slots; replay queue; watchdog; session TTL |
| ATS layout changes | Semantic locators; fixture tests; fail closed |
| Session expires | Storage state + replay package |
| CAPTCHA | Manual review only |
| Incorrect sponsorship answer | Locked candidate facts; JD policy separated from answer |
| Resume hallucination | Fact provenance; deterministic validator |
| Duplicate application | DB unique indexes; requisition and canonical URL checks |
| Recruiter spam | low limits; cooldown; suppression; manual send |
| Fake personal hook | source-required hook; fallback to no hook |
| Gmail token revoked | health alert; stop outreach tasks |
| LLM cost spike | task routing; monthly cap; cache; stop at limit |
| Public data exposure | Tailscale-only; app auth; encrypted backups |
| AGPL obligations | isolate third-party code; record provenance; legal review before sharing |
| Platform terms conflict | manual-assist mode; disable adapter |

---
