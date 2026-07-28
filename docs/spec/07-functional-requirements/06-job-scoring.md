# 7.6 Job scoring

> Part of **7. Functional Requirements**

Score components:

| Component | Weight |
|---|---:|
| Internship/level fit | 20 |
| Core SWE relevance | 20 |
| Skills overlap | 15 |
| Project/experience relevance | 15 |
| Graduation eligibility | 10 |
| Location fit | 5 |
| Sponsorship compatibility | 10 |
| Application freshness | 5 |

The deterministic filter runs before the AI score.

The LLM must return structured output and cite profile fact IDs.

Do not allow a high AI score to override a hard ineligibility rule.
