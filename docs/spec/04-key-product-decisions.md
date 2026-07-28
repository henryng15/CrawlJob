# 4. Key Product Decisions

| Area | Decision |
|---|---|
| Deployment | One OCI Ampere A1 VM in the tenancy home region |
| Compute target | 2 OCPU, 12 GB RAM |
| Storage | 50 GB boot volume + 100 GB data block volume |
| Private access | Tailscale + Tailscale Serve |
| Domain | Not required |
| Web stack | FastAPI + Jinja2 + HTMX + Alpine.js |
| Database | PostgreSQL 16 |
| Queue | PostgreSQL-backed durable task queue |
| Browser automation | Playwright |
| Remote review | Chromium + Xvfb + x11vnc + noVNC/websockify |
| Live browser capacity | 2 fixed browser slots |
| Daily application capacity | 10 prepared applications |
| Session fallback | Semantic replay package |
| Initial ATS adapters | Greenhouse, Lever, Ashby |
| Workday | Phase 2 after core system is stable |
| LinkedIn Easy Apply | Excluded from MVP |
| Discovery | Curated 2027 repos + public ATS feeds |
| AI runtime | Provider abstraction; Anthropic API default |
| Email | Gmail API drafts only |
| Cold-email delay | Two business days after confirmed application |
| Public analytics | None |
| IaC | Terraform with the official OCI provider |
| Runtime deployment | Docker Compose |
| Backups | Nightly encrypted backup to OCI Object Storage |

---
