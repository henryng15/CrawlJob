# 20. Repository Layout

```text
internship-ops/
├── CLAUDE.md
├── README.md
├── THIRD_PARTY.md
├── SECURITY.md
├── pyproject.toml
├── docker-compose.yml
├── .env.example
├── alembic.ini
├── app/
│   ├── main.py
│   ├── config.py
│   ├── api/
│   ├── auth/
│   ├── db/
│   │   ├── models/
│   │   ├── repositories/
│   │   └── migrations/
│   ├── domain/
│   │   ├── jobs/
│   │   ├── applications/
│   │   ├── resumes/
│   │   ├── sponsorship/
│   │   ├── recruiters/
│   │   ├── outreach/
│   │   └── tasks/
│   ├── services/
│   │   ├── discovery/
│   │   ├── dedupe/
│   │   ├── scoring/
│   │   ├── resume/
│   │   ├── browser/
│   │   ├── gmail/
│   │   ├── llm/
│   │   └── backup/
│   ├── ats/
│   │   ├── base.py
│   │   ├── greenhouse.py
│   │   ├── lever.py
│   │   ├── ashby.py
│   │   └── workday/
│   ├── templates/
│   ├── static/
│   └── cli/
├── browser/
│   ├── control_service/
│   ├── scripts/
│   └── fixtures/
├── resume_templates/
├── prompts/
│   ├── sponsorship/
│   ├── scoring/
│   ├── resume/
│   ├── form_answers/
│   └── outreach/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── ats_fixtures/
│   └── e2e/
├── docker/
│   ├── web.Dockerfile
│   ├── worker.Dockerfile
│   └── browser-arm64.Dockerfile
├── deploy/
│   ├── Caddyfile
│   ├── systemd/
│   └── scripts/
└── infra/
    └── terraform/
```

---
