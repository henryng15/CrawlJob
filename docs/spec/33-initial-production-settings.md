# 33. Initial Production Settings

```yaml
project:
  name: internship-ops
  mode: single-user-private

jobs:
  target_country: US
  target_terms:
    - Summer 2027
  target_roles:
    - Software Engineer Intern
    - Software Engineering Intern
    - Backend Engineer Intern
    - Full Stack Engineer Intern
    - Platform Engineer Intern
    - Infrastructure Engineer Intern
  max_prepare_per_day: 10
  minimum_fit_score: 72
  max_role_age_days: 21

browser:
  workers: 2
  live_slots: 2
  queue_capacity: 10
  live_ttl_hours: 8
  replay: true

sponsorship:
  no_sponsorship_action: MANUAL_REVIEW
  citizenship_required_action: SKIP
  not_mentioned_action: CONTINUE
  ambiguous_action: MANUAL_REVIEW
  candidate_answers_locked: true

outreach:
  delay_business_days: 2
  initial_daily_limit: 3
  maximum_daily_limit: 5
  max_recruiters_per_application: 1
  max_recruiters_per_company_30d: 2
  recruiter_cooldown_days: 30
  max_followups: 1
  auto_send: false
  tracking_pixels: false

safety:
  auto_submit: false
  auto_send_email: false
  captcha_bypass: false
  linkedin_automation: false
```

---
