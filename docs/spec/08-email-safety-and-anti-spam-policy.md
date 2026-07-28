# 8. Email Safety and Anti-Spam Policy

The system is a personalized outreach assistant, not a bulk sender.

## 8.1 Default limits

```yaml
outreach:
  enabled: true
  initial_daily_draft_limit: 3
  maximum_daily_draft_limit: 5
  minimum_days_after_application: 2
  use_business_days: true
  allowed_weekdays: [MON, TUE, WED, THU, FRI]
  allowed_time_window_et:
    start: "09:30"
    end: "15:30"
  maximum_recruiters_per_application: 1
  maximum_recruiters_per_company_30d: 2
  recruiter_cooldown_days: 30
  maximum_followups: 1
  followup_business_days: 6
```

## 8.2 Suppression rules

Do not create another draft when:

- recruiter replied;
- recruiter bounced;
- recruiter asked not to be contacted;
- same recruiter and same role already contacted;
- same email appears on suppression list;
- same company hit its 30-day cap;
- application was withdrawn;
- application is not confirmed submitted;
- the user marked outreach as inappropriate;
- the recruiter email is unverified or malformed.

## 8.3 Content rules

- plain text or simple HTML;
- no tracking pixel;
- no hidden links;
- no misleading subject;
- no fake referral;
- no fake mutual connection;
- no unsupported personal fact;
- one clear ask;
- short body;
- include the role and company;
- do not claim an application was submitted unless confirmed.

## 8.4 Follow-up rules

- at most one follow-up;
- only after 5–7 business days;
- cancel immediately if a reply is detected;
- never follow up after bounce or opt-out;
- follow-up must remain a Gmail draft requiring manual send.

---
