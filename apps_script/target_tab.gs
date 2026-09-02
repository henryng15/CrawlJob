/**
 * The Target tab: the 138-company sourcing shortlist and the number of referral
 * addresses that can still be sent for each company.
 *
 * This tab is deliberately separate from Company. Company answers which
 * employers currently have openings; Target answers where to spend the next
 * contact-sourcing effort. It reads the same sender-maintained Referral Seed Counts
 * snapshot through companyReferralCounts_(), and writes only Target.
 *
 * The four blocks are A:E, G:K, M:Q and S:W. Columns F, L and R are gutters so
 * the lists remain visually separate.
 */

var TARGET_TAB = 'Target';
var TARGET_BLOCK_COLS = [1, 7, 13, 19];
var TARGET_BLOCK_WIDTH = 5;
var TARGET_RENDER_WIDTH = 23;
var TARGET_FIRST_ROW = 2;
var TARGET_AGE_THRESHOLD_DAYS = 5;
var TARGET_OPENING_START_DAY = '2026-07-20';
var TARGET_NOT_OPEN_GREEN = '#D9EAD3';
var TARGET_OPEN_WHITE = '#FFFFFF';
var TARGET_URGENT_RED = '#F4CCCC';
var TARGET_HEADERS = [
  ['P0 - Core targets', 'Sendable referral emails', 'Summer 2026 first posted', 'Date open', 'Asked'],
  ['P1 - Strong targets', 'Sendable referral emails', 'Summer 2026 first posted', 'Date open', 'Asked'],
  ['P2 - AI/startup targets', 'Sendable referral emails', 'Summer 2026 first posted', 'Date open', 'Asked'],
  ['P3 - Tech adjacent targets', 'Sendable referral emails', 'Summer 2026 first posted', 'Date open', 'Asked']
];

// Earliest date on which a US Summer 2026 software-engineering INTERN
// requisition was first seen, per company. US only: Canada, UK and other
// non-US postings are excluded, as are Winter/Spring/Fall 2026 requisitions.
// Reconstructed from 25 monthly snapshots of the SimplifyJobs Summer2026
// tracker's listings.json (2025-06 -> 2026-09, recovering the 2025 dates the
// live file has since pruned) cross-checked against monthly snapshots of the
// speedyapply 2026-SWE-College-Jobs USA README. Dates are strings so the sheet
// displays the same ISO value in every locale. An empty date renders blank and
// its note says what was found instead.
var TARGET_OPENING_EVIDENCE = {
  'OpenAI': { date: '2025-09-17', note: 'US Summer 2026: Software Engineer Internship / Co-op - Applied Emerging Talent - Summer 2026 [Seattle, WA; SF]. Cross-checked: the other tracker first carried it 2025-09-18. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Anthropic': { date: '', note: 'No Summer 2026 SWE internship. Anthropic\'s careers page states it does not offer internships; the early-career route is the Anthropic Fellows Program (research, 4 months) and Claude Corps. Only Fellows/Safety-Fellow requisitions appear in the trackers (from 2025-12-11). Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://www.anthropic.com/careers' },
  'Databricks': { date: '2025-08-09', note: 'US Summer 2026: Software Engineering Intern - Multiple Teams [SF; Bellevue, WA; Mountain View, CA; Vancouver, BC, Canada]. Cross-checked: the other tracker first carried it 2025-08-10. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Anduril': { date: '2025-08-13', note: 'US Summer 2026: Software Engineer Intern [Boston, MA; Seattle, WA; Newport Beach, CA; Irvine, CA +2 more]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Nvidia': { date: '2025-09-03', note: 'US Summer 2026: Systems Software Engineering Intern [Santa Clara, CA]. Cross-checked: the other tracker first carried it 2025-09-12. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Google': { date: '2025-08-25', note: 'US Summer 2026: Software Engineering Intern, BS [Mountain View, CA; Atlanta, GA; Austin, TX; Boulder, CO +26 more]. Cross-checked: the other tracker first carried it 2025-08-26. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Microsoft': { date: '2025-08-14', note: 'US Summer 2026: Software Engineering Intern [Redmond, WA]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Meta': { date: '2025-09-15', note: 'US Summer 2026: Software Engineer – Intern/Co-op [Seattle, WA; Menlo Park, CA; NYC; Bellevue, WA]. Cross-checked: the other tracker first carried it 2025-09-17. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Apple': { date: '2025-07-08', note: 'US Summer 2026: Software Engineering Intern [United States]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Amazon': { date: '2025-12-01', note: 'Software Development Engineer Test Intern - Summer (Seattle WA / Los Gatos CA / NYC / Bellevue WA). The flagship "Software Development Engineer Internship - Summer 2026 - US" followed on 2025-12-10; Amazon ran an unusually late Summer 2026 US cycle. A Canada-only SDE intern went up 2025-11-06 and does not count here. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Uber': { date: '2025-09-27', note: 'US Summer 2026: Software Engineering Intern - Multiple Teams [Seattle, WA; SF; Sunnyvale, CA]. Cross-checked: the other tracker first carried it 2025-09-28. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Airbnb': { date: '2025-12-09', note: 'US Summer 2026: Software Engineering Intern [United States]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Stripe': { date: '2025-09-03', note: 'US Summer 2026: Software Engineer, Intern [San Francisco, CA; Seattle, WA; New York, NY]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Ramp': { date: '2025-05-15', note: 'US Summer 2026: Software Engineer Internship - iOS [NYC]. Cross-checked: the other tracker first carried it 2025-08-01. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Plaid': { date: '', note: 'A "Software Engineering Intern, Summer 2026" did exist (NY/SF, posted through RippleMatch), but neither tracker carried it and no archived copy gives a posting date, so the first-posted day is unverified. Plaid\'s previous cycle SWE intern went up 2023-09-05 (Summer 2024). Source: https://app.ripplematch.com/v2/public/job/146d369a' },
  'Cloudflare': { date: '2025-08-29', note: 'US Summer 2026: Software Engineer Intern [Austin, TX]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Snowflake': { date: '2026-02-23', note: 'Software Engineering Intern - Full Stack Applications, Menlo Park / Dublin CA. Earlier Snowflake intern postings were Toronto Spring 2026 (2025-09-24) and Berlin 2026 (2025-09-27) - neither is a US Summer 2026 SWE role. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Figma': { date: '2025-08-19', note: 'US Summer 2026: Software Engineering Intern [San Francisco, CA; New York, NY]. Cross-checked: the other tracker first carried it 2025-08-21. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'GitHub': { date: '2025-10-30', note: 'US Summer 2026: Software Engineering Intern [Remote in USA]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Palantir': { date: '2025-06-28', note: 'US Summer 2026: Software Engineer - Internship - Infrastructure [New York, NY]. Cross-checked: the other tracker first carried it 2025-07-01. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Coinbase': { date: '2025-10-13', note: 'US Summer 2026: Software Engineer Intern [SF; NYC]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Vercel': { date: '2025-09-04', note: 'US Summer 2026: Engineering Summer Intern [SF; NYC]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Scale AI': { date: '2025-09-09', note: 'US Summer 2026: Software Engineering Intern [SF]. Cross-checked: the other tracker first carried it 2025-09-10. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'CoreWeave': { date: '', note: 'No Summer 2026 SWE intern posting found; the only Summer 2026 CoreWeave intern requisition in the trackers is a Data Center Apprentice (2026-07-02). Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Canva': { date: '', note: 'No US Summer 2026 SWE intern posting found. Canva\'s tracked intern requisitions are ANZ ("Software Engineer Intern Frontend/Backend 2026/27", Sydney) and Fall 2026 PhD research roles. Source: https://www.lifeatcanva.com/en/jobs/' },
  'Adobe': { date: '2025-08-15', note: 'US Summer 2026: 2026 Intern - Software Engineer [Seattle, WA; SF; Austin, TX; San Jose, CA +2 more]. Cross-checked: the other tracker first carried it 2025-08-17. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Salesforce': { date: '2025-09-02', note: 'US Summer 2026: Intern - Software Engineer [Seattle, WA; SF; Bellevue, WA]. Cross-checked: the other tracker first carried it 2025-09-04. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Atlassian': { date: '2025-09-11', note: 'US Summer 2026: Software Engineer Intern [Seattle, WA; SF]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'DoorDash': { date: '2025-10-07', note: 'US Summer 2026: Software Engineer – Intern - Summer 2026 [Seattle, WA; SF; LA; NYC +1 more]. Cross-checked: the other tracker first carried it 2025-10-08. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Instacart': { date: '', note: 'No Summer 2026 SWE intern posting found; the only Summer 2026 Instacart intern rows are Data Science PhD Intern (2026-02-05). A Machine Learning Engineer Intern went up 2026-01-20 but for Spring 2026. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Pinterest': { date: '2025-09-24', note: 'US Summer 2026: Software Engineer Intern 2026 [San Francisco, CA; Palo Alto, CA]. Cross-checked: the other tracker first carried it 2025-09-25. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Reddit': { date: '', note: 'No Summer 2026 SWE intern posting found in either tracker. Reddit\'s last tracked SWE intern was the Summer 2025 one, posted 2024-11-02. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Shopify': { date: '2025-08-13', note: 'US Summer 2026: Engineering Internship [New York, New York; Bellevue, Washington]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'MongoDB': { date: '2025-09-12', note: 'US Summer 2026: Software Engineering Intern [SF; Austin, TX; NYC]. Cross-checked: the other tracker first carried it 2025-09-14. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Datadog': { date: '2025-09-08', note: 'US Summer 2026: Software Engineering Intern - Summer [Boston, MA; NYC]. Cross-checked: the other tracker first carried it 2025-09-10. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Confluent': { date: '2025-08-07', note: 'US Summer 2026: Software Engineering Intern [Austin, TX]. Cross-checked: the other tracker first carried it 2025-08-07. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Elastic': { date: '', note: 'No Summer 2026 intern posting of any kind found; Elastic has not run a tracked SWE internship since 2024. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'HashiCorp': { date: '', note: 'No Summer 2026 SWE intern posting found. The last tracked "Software Engineering Intern - Undergraduate" was the Summer 2025 one, posted 2024-11-08 (before the IBM acquisition closed). Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'GitLab': { date: '', note: 'No Summer 2026 SWE intern posting found. GitLab\'s Greenhouse board carried no intern requisition through the cycle; its internship is a pilot, not an annual cohort. Source: https://job-boards.greenhouse.io/gitlab' },
  'Notion': { date: '2025-08-10', note: 'US Summer 2026: Software Engineer - AI Intern - Summer 2026 [SF; NYC]. Cross-checked: the other tracker first carried it 2025-08-14. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Linear': { date: '', note: 'No intern posting of any kind found in either tracker for any cycle; Linear runs no internship program.' },
  'Airbyte': { date: '', note: 'No intern posting of any kind found in either tracker for any cycle.' },
  'Asana': { date: '2025-07-25', note: 'US Summer 2026: Software Engineer Intern [San Francisco CA]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Box': { date: '2026-01-30', note: 'Software Engineering (Summer 2026) - the title carries no "Intern" word but it is Box\'s Summer 2026 engineering intern requisition. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Brex': { date: '2025-05-16', note: 'US Summer 2026: Software Engineer - Intern [SF]. Cross-checked: the other tracker first carried it 2026-02-24. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Chime': { date: '', note: 'No Summer 2026 SWE intern posting found. Chime\'s last tracked SWE intern cohort was Summer 2024, posted 2024-01-26. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Circle': { date: '2025-11-12', note: 'US Summer 2026: Software Engineer Intern [Boston, MA; Seattle, WA; Washington, DC; SF +6 more]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Rippling': { date: '2025-09-19', note: 'US Summer 2026: Full Stack Software Engineer Intern [SF]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Gusto': { date: '2025-09-19', note: 'US Summer 2026: Software Engineering Intern - Summer 2026 [SF; NYC; Denver, CO]. Cross-checked: the other tracker first carried it 2025-09-24. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Mercury': { date: '2025-10-14', note: 'US Summer 2026: Frontend Engineering Intern [San Francisco, CA; New York, NY; Portland, OR; Remote in US +1 more]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Perplexity': { date: '', note: 'No US Summer 2026 engineering intern posting found. Both Perplexity Summer 2026 intern rows are London, UK (AI Inference Intern 2026-02-12, Search ML Engineer Intern 2026-04-08). The 2025-09-11 date previously in this cell came from a UK tracker. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Replit': { date: '2025-10-03', note: 'US Summer 2026: Software Engineering Intern - Multiple Teams [San Mateo, CA]. Cross-checked: the other tracker first carried it 2025-10-03. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Hugging Face': { date: '', note: 'No Summer 2026 intern posting found. Hugging Face\'s last tracked intern cohort was Summer 2024 ML Engineer internships, posted 2023-11-30. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Cohere': { date: '', note: 'No Summer 2026 SWE intern posting found. The 2025-09-11 "Software Engineer Intern" that used to sit in this cell is a WINTER 2026 role, not Summer - Cohere posted Winter 2026 and Fall 2025 only. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Mistral AI': { date: '', note: 'No Summer 2026 SWE intern posting found; the only Summer 2026 row is an AI Data Solutions Intern (2026-07-24, data partnerships). Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Groq': { date: '', note: 'No Summer 2026 intern posting found. Groq\'s last tracked engineering interns were the 2025-01-06 multi-term (Spring/Summer/Fall 2025) Cloud Backend / Compiler / Distributed Systems roles. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Glean': { date: '2025-09-05', note: 'US Summer 2026: Software Engineer - Intern - Summer. Source: https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Harvey': { date: '2026-01-30', note: 'US Summer 2026: Software Engineering Intern - Summer 2026 [SF]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Sierra': { date: '2025-12-17', note: 'Intern - Agent Development - Summer 2026; Sierra ran no separately titled SWE intern posting. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Vanta': { date: '', note: 'No intern posting of any kind found in either tracker for any cycle.' },
  'Wiz': { date: '', note: 'No intern posting of any kind found in either tracker for any cycle.' },
  'Fivetran': { date: '', note: 'No Summer 2026 intern posting found. Fivetran\'s last tracked "Intern Software Engineer - Systems Engineering" was Summer 2024, posted 2024-05-10. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Retool': { date: '', note: 'No intern posting of any kind found in either tracker for any cycle.' },
  'Temporal': { date: '', note: 'No intern posting of any kind found in either tracker for any cycle.' },
  'Cockroach Labs': { date: '2026-03-17', note: 'US Summer 2026: Engineering Intern [NYC]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Snyk': { date: '2026-03-17', note: 'US Summer 2026: Software Engineer Intern [Boston, MA]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Supabase': { date: '', note: 'No intern posting of any kind found in either tracker for any cycle.' },
  'Netlify': { date: '', note: 'No intern posting of any kind found in either tracker for any cycle.' },
  'Miro': { date: '', note: 'No intern posting of any kind found in either tracker for any cycle.' },
  'Coda': { date: '', note: 'No intern posting of any kind found in either tracker for any cycle.' },
  'Airtable': { date: '', note: 'No intern posting of any kind found in either tracker for any cycle.' },
  'Cursor': { date: '', note: 'No intern posting found in either tracker (checked both Cursor and Anysphere); Cursor hires interns off-cycle through direct referral, not a posted requisition.' },
  'Character AI': { date: '', note: 'No intern posting of any kind found in either tracker for any cycle.' },
  'Together AI': { date: '2026-01-06', note: 'US Summer 2026: Software Engineer Intern [SF]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Modal': { date: '', note: 'No Summer 2026 intern posting found; the only Modal intern row is a Fall 2026 Machine Learning Research Intern (2026-07-28). Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Affirm': { date: '2025-11-26', note: 'US Summer 2026: Software Engineer Intern [SF]. Cross-checked: the other tracker first carried it 2025-11-26. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Amplitude': { date: '', note: 'No intern posting of any kind found in either tracker for any cycle.' },
  'Applied Intuition': { date: '', note: 'No Summer 2026 SWE intern posting found; Applied Intuition\'s Summer 2026 rows are Research Interns (3D Vision, RL, Robotic Hardware) from 2026-02-13. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Akamai': { date: '2026-02-19', note: 'US Summer 2026: Intern Software Engineer [Remote in USA]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Aurora': { date: '2025-11-03', note: 'US Summer 2026: Software Engineering Internship, Summer 2026 [Mountain View, CA]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Autodesk': { date: '2025-09-15', note: 'US Summer 2026: Intern – Software Engineer [SF; Novi, MI; Atlanta, GA]. Cross-checked: the other tracker first carried it 2025-09-17. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Cisco': { date: '2025-08-15', note: 'US Summer 2026: Software Engineer I (Intern) [San Jose, CA; Remote, USA; Milpitas, CA; New York, NY +10 more]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'CrowdStrike': { date: '2026-01-26', note: 'US Summer 2026: Software Engineer Intern [Redmond, WA; Sunnyvale, CA]. Cross-checked: the other tracker first carried it 2026-01-28. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Deel': { date: '', note: 'No intern posting of any kind found in either tracker for any cycle.' },
  'Discord': { date: '', note: 'No Summer 2026 SWE intern posting found. Discord\'s last tracked SWE intern cohort was Summer 2024, posted 2023-11-13. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Dropbox': { date: '2025-08-26', note: 'US Summer 2026: Software Engineer Intern [Remote in USA]. Cross-checked: the other tracker first carried it 2025-12-17. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Etsy': { date: '2026-01-30', note: 'US Summer 2026: Software Engineering Intern [Brooklyn, NY]. Cross-checked: the other tracker first carried it 2026-02-05. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Flexport': { date: '', note: 'No intern posting of any kind found in either tracker for any cycle.' },
  'Grammarly': { date: '2025-09-17', note: 'US Summer 2026: Software Engineering Intern [SF]. Cross-checked: the other tracker first carried it 2025-09-18. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Intuit': { date: '2025-09-13', note: 'US Summer 2026: Full Stack Engineering Intern [NYC; Mountain View, CA; Atlanta, GA; San Diego, CA]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Lyft': { date: '2025-09-05', note: 'US Summer 2026: Software Engineer Intern - Backend [SF]. Cross-checked: the other tracker first carried it 2025-09-07. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Marqeta': { date: '', note: 'No US Summer 2026 SWE intern posting found; the only Marqeta engineering intern row is a Product Security Engineering Intern (2026-03-26, Remote in USA). Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'New Relic': { date: '', note: 'No intern posting of any kind found in either tracker for any cycle.' },
  'Okta': { date: '2025-12-03', note: 'US Summer 2026: Software Engineer Intern [SF; Bellevue, WA]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Roblox': { date: '2025-08-07', note: 'US Summer 2026: Software Engineer Intern [San Mateo, CA]. Cross-checked: the other tracker first carried it 2025-08-08. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Robinhood': { date: '2025-09-23', note: 'US Summer 2026: Software Engineering Intern - IOS [Menlo Park, CA]. Cross-checked: the other tracker first carried it 2025-09-24. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Rivian': { date: '2025-11-06', note: 'US Summer 2026: Software Engineering Intern - Applications - Infotainment & Mobile [Palo Alto, CA; Irvine, CA; Vancouver, BC, Canada]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Waymo': { date: '2025-09-11', note: 'US Summer 2026: 2026 Summer Intern - MS/PhD - Software Engineering - Behavior Test [Mountain View, CA]. Cross-checked: the other tracker first carried it 2025-09-17. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Zoox': { date: '2025-12-25', note: 'Embedded Software Development Intern, San Mateo CA. Softer-titled Zoox software interns (Mapping Software Intern, Core Software Systems Intern) went up 2025-11-08/2025-11-12; the plain Software Engineer Intern - Perception Data only 2026-04-17. Sources: https://github.com/speedyapply/2026-SWE-College-Jobs, https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Twilio': { date: '2026-02-09', note: 'US Summer 2026: Software Engineer Intern - United States [Remote in USA]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Toast': { date: '2025-11-08', note: 'US Summer 2026: US SWE Summer Internship [Boston, MA]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Block': { date: '2025-09-09', note: 'US Summer 2026: Software Engineer Intern [Seattle, WA; SF; Oakland, CA; Remote in USA +4 more]. Cross-checked: the other tracker first carried it 2025-09-11. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'BILL': { date: '2025-07-16', note: 'US Summer 2026: Software Engineer Intern [Draper, UT; San Jose, CA]. Cross-checked: the other tracker first carried it 2025-07-16. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'Samsara': { date: '2025-08-27', note: 'US Summer 2026: Software Engineering Intern [SF]. Cross-checked: the other tracker first carried it 2025-08-29. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' },
  'DigitalOcean': { date: '2026-01-28', note: 'US Summer 2026: Engineering Intern [Boston, MA]. Source: https://github.com/SimplifyJobs/Summer2026-Internships' },
  'Squarespace': { date: '2026-01-29', note: 'US Summer 2026: Software Engineer Intern - Frontend - Backend [NYC]. Cross-checked: the other tracker first carried it 2026-01-31. Sources: https://github.com/SimplifyJobs/Summer2026-Internships, https://github.com/speedyapply/2026-SWE-College-Jobs' }
};

var TARGET_P0 = [
  'OpenAI', 'Databricks', 'Anduril', 'Nvidia', 'Google', 'Microsoft',
  'Meta', 'Apple', 'Amazon', 'Uber', 'Airbnb', 'Stripe', 'Ramp', 'Plaid',
  'Cloudflare', 'Snowflake', 'Figma', 'GitHub', 'Palantir', 'Coinbase', 'Vercel',
  'Scale AI', 'CoreWeave', 'Canva',
  // Large software employers and engineering-heavy platforms added from the
  // multi-source 150-company research pass. Quant firms are intentionally
  // excluded from the Target shortlist.
  'Walmart', 'JPMorgan Chase', 'Capital One', 'Oracle', 'IBM', 'ServiceNow',
  'Tesla', 'Dell Technologies', 'AMD', 'Intel'
];

var TARGET_P1 = [
  'Adobe', 'Salesforce', 'Atlassian', 'DoorDash', 'Instacart', 'Pinterest', 'Reddit',
  'Shopify', 'MongoDB', 'Datadog', 'Confluent', 'Elastic', 'HashiCorp', 'GitLab',
  'Notion', 'Asana', 'Box', 'Brex', 'Chime', 'Circle',
  'Rippling', 'Gusto', 'Mercury',
  'Broadcom', 'Qualcomm', 'Cadence Design Systems', 'Arista Networks', 'NetApp',
  'Red Hat', 'Juniper Networks', 'PayPal', 'Goldman Sachs', 'Morgan Stanley'
];

var TARGET_P2 = [
  'Perplexity', 'Replit', 'Hugging Face', 'Cohere', 'Mistral AI', 'Groq', 'Glean',
  'Harvey', 'Sierra', 'Vanta', 'Fivetran', 'Temporal',
  'Cockroach Labs', 'Snyk', 'Supabase', 'Coda', 'Airtable',
  'Cursor', 'Together AI', 'Modal',
  'xAI', 'Thinking Machines Lab', 'Abridge', 'Figure AI', 'Shield AI',
  'Fireworks AI', 'ElevenLabs', 'Runway', 'World Labs', 'Nebius'
];

var TARGET_P3 = [
  'Affirm', 'Amplitude', 'Applied Intuition', 'Akamai', 'Aurora', 'Autodesk', 'Cisco',
  'CrowdStrike', 'Deel', 'Discord', 'Dropbox', 'Etsy', 'Flexport', 'Grammarly',
  'Intuit', 'Lyft', 'Marqeta', 'New Relic', 'Okta', 'Roblox', 'Robinhood', 'Rivian',
  'Waymo', 'Zoox', 'Twilio',
  // Toast and adjacent commerce/fintech/SaaS peers requested for additional sourcing.
  'Toast', 'Block', 'BILL', 'Samsara', 'DigitalOcean', 'Squarespace',
  // Additional non-quant employers from the multi-source 150-company research.
  'American Express', 'Northrop Grumman', 'Lockheed Martin', 'General Motors',
  'TikTok', 'Spotify', 'Saviynt', 'Rubrik', 'Arctic Wolf', 'Zscaler'
];

function targetSheet_(create) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TARGET_TAB);
  if (!sheet && create) sheet = ss.insertSheet(TARGET_TAB);
  return sheet;
}

function targetRows_(names, referralCounts, statuses, askedStates) {
  return names.map(function (name) {
    var key = companyTokens_(name).join(' ');
    var evidence = TARGET_OPENING_EVIDENCE[name];
    var status = statuses && statuses[key];
    return [
      name,
      Number(referralCounts[key] || 0),
      evidence ? evidence.date : '',
      status && status.latestOpeningDay ? status.latestOpeningDay : '',
      askedStates && askedStates[key] === true
    ];
  });
}

/** Read manual Asked checkbox states before Target is rebuilt or repositioned. */
function targetAskedStates_(sheet) {
  var states = {};
  var lastRow = sheet.getLastRow();
  if (lastRow < TARGET_FIRST_ROW) return states;
  var width = Math.max(sheet.getLastColumn(), TARGET_RENDER_WIDTH);
  var values = sheet.getRange(1, 1, lastRow, width).getValues();
  for (var b = 0; b < TARGET_BLOCK_COLS.length; b++) {
    var companyCol = TARGET_BLOCK_COLS[b] - 1;
    var askedCol = companyCol + 4;
    for (var r = 1; r < values.length; r++) {
      var name = String(values[r][companyCol] == null ? '' : values[r][companyCol]).trim();
      if (!name) continue;
      states[companyTokens_(name).join(' ')] = companyIsTicked_(values[r][askedCol]);
    }
  }
  return states;
}

/** Calendar-day age in the spreadsheet timezone, avoiding UTC/date-only drift. */
function targetAgeDays_(postedDay, todayDay) {
  var posted = String(postedDay == null ? '' : postedDay).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  var today = String(todayDay == null ? '' : todayDay).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!posted || !today) return -1;
  var postedUtc = Date.UTC(Number(posted[1]), Number(posted[2]) - 1, Number(posted[3]));
  var todayUtc = Date.UTC(Number(today[1]), Number(today[2]) - 1, Number(today[3]));
  return Math.floor((todayUtc - postedUtc) / 86400000);
}

/** Whether a title belongs to the software-engineering role family. */
function targetIsSoftwareEngineerRole_(role) {
  var title = String(role == null ? '' : role).trim();
  return /\b(?:software\s+(?:engineer(?:ing)?|developer)|swe|application\s+development)\b/i.test(title);
}

/** Whether a title explicitly names a Summer intake. */
function targetIsExplicitSummerRole_(role) {
  return /\bsummer\b/i.test(String(role == null ? '' : role));
}

/** Whether a title explicitly names an off-cycle intake. */
function targetIsExplicitOffCycleRole_(role) {
  return /\b(?:winter|spring|fall)\b/i.test(String(role == null ? '' : role));
}

/**
 * Read live SWE roles from Jobs and classify each Target company for Summer.
 *
 * An explicit Summer row counts for a company with any number of SWE rows. If
 * there are no season words across the company's SWE rows, infer Summer even if
 * there are multiple rows. Winter, Spring and Fall rows without Summer are
 * evidence that the company has not opened Summer yet. `urgentOpening` wins over
 * `hasOpening`: any recognized Summer row from the last five calendar days
 * is the red referral warning. An older recognized Summer row leaves the company
 * white. Companies with no recognized Summer row are green.
 * Applied and Expired are deliberately ignored: either flag may describe an
 * application choice, a duplicate, or a stale row, but the user's rule is that
 * appearance in Jobs is enough evidence. A missing/unreadable Jobs tab returns
 * null so the caller can avoid falsely marking every company as not opened.
 */
function targetOpeningStatuses_() {
  var jobs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COMPANY_JOBS_TAB);
  if (!jobs) return null;
  var lastRow = jobs.getLastRow(), lastCol = jobs.getLastColumn();
  if (lastRow < 2 || lastCol < 2) return {};
  var values = jobs.getRange(1, 1, lastRow, lastCol).getValues();
  var at = companyJobsLayout_(values[0]);
  if (!at) return null;

  var targetNames = TARGET_P0.concat(TARGET_P1, TARGET_P2, TARGET_P3);
  var statuses = {};
  targetNames.forEach(function (name) {
    statuses[companyTokens_(name).join(' ')] = {
      hasOpening: false,
      urgentOpening: false,
      latestOpeningDay: '',
      roleRows: []
    };
  });
  var today = Utilities.formatDate(
    new Date(),
    SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(),
    'yyyy-MM-dd'
  );

  for (var r = 1; r < values.length; r++) {
    var role = String(values[r][at.role] == null ? '' : values[r][at.role]).trim();
    if (!role || !targetIsSoftwareEngineerRole_(role)) continue;
    var postingTokens = companyTokens_(values[r][at.company]);
    if (!postingTokens.length) continue;
    var postedDay = at.posted < 0 ? '' : companyPostedDay_(values[r][at.posted]);
    if (targetAgeDays_(TARGET_OPENING_START_DAY, postedDay) < 0) continue;
    var age = targetAgeDays_(postedDay, today);

    targetNames.forEach(function (name) {
      if (!companyNameMatches_(companyTokens_(name), postingTokens)) return;
      var status = statuses[companyTokens_(name).join(' ')];
      status.roleRows.push({
        summer: targetIsExplicitSummerRole_(role),
        offCycle: targetIsExplicitOffCycleRole_(role),
        postedDay: postedDay,
        age: age
      });
    });
  }

  targetNames.forEach(function (name) {
    var status = statuses[companyTokens_(name).join(' ')];
    var summerRows = status.roleRows.filter(function (row) { return row.summer; });
    var offCycleRows = status.roleRows.filter(function (row) { return row.offCycle; });
    // Explicit Summer wins; otherwise a completely unlabelled SWE set is
    // inferred as Summer, whether it has one row or several. Any off-cycle
    // label blocks that inference.
    var openingRows = summerRows.length ? summerRows : (offCycleRows.length ? [] : status.roleRows);
    status.hasOpening = openingRows.length > 0;
    openingRows.forEach(function (row) {
      if (!status.latestOpeningDay || row.postedDay > status.latestOpeningDay) {
        status.latestOpeningDay = row.postedDay;
      }
      if (row.age >= 0 && row.age <= TARGET_AGE_THRESHOLD_DAYS) {
        status.urgentOpening = true;
      }
    });
    delete status.roleRows;
  });
  return statuses;
}

function targetCompanyFill_(name, statuses) {
  if (statuses === null) return TARGET_OPEN_WHITE;
  var status = statuses[companyTokens_(name).join(' ')];
  if (!status || !status.hasOpening) return TARGET_NOT_OPEN_GREEN;
  if (status.urgentOpening) return TARGET_URGENT_RED;
  return TARGET_OPEN_WHITE;
}

function targetPaintHeader_(sheet) {
  sheet.setFrozenRows(1);
  for (var b = 0; b < TARGET_BLOCK_COLS.length; b++) {
    var col = TARGET_BLOCK_COLS[b];
    sheet.getRange(1, col, 1, TARGET_BLOCK_WIDTH)
      .setValues([TARGET_HEADERS[b]])
      .setFontWeight('bold')
      .setBackground('#EFEFEF')
      .setHorizontalAlignment('center')
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP)
      .setVerticalAlignment('middle');
    sheet.setColumnWidth(col, 125);
    sheet.setColumnWidth(col + 1, 105);
    sheet.setColumnWidth(col + 2, 100);
    sheet.setColumnWidth(col + 3, 85);
    sheet.setColumnWidth(col + 4, 55);
  }
  sheet.setRowHeight(1, 42);
  sheet.setColumnWidth(6, 18);
  sheet.setColumnWidth(12, 18);
  sheet.setColumnWidth(18, 18);
}

function targetWriteBlock_(sheet, col, rows, clearDepth, statuses) {
  if (clearDepth > 0) {
    sheet.getRange(TARGET_FIRST_ROW, col, clearDepth, TARGET_BLOCK_WIDTH)
      .clearContent().clearDataValidations().clearNote().setBackground(null);
  }
  if (!rows.length) return;
  // The old three-column layout left DATE formatting behind in some columns;
  // reset each new block's types before writing values so counts cannot display
  // as dates and both date columns stay consistent.
  sheet.getRange(TARGET_FIRST_ROW, col + 1, rows.length, 1).setNumberFormat('0');
  sheet.getRange(TARGET_FIRST_ROW, col + 2, rows.length, 2).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(TARGET_FIRST_ROW, col + 4, rows.length, 1).setNumberFormat('General');
  sheet.getRange(TARGET_FIRST_ROW, col, rows.length, TARGET_BLOCK_WIDTH)
    .setValues(rows);
  sheet.getRange(TARGET_FIRST_ROW, col + 1, rows.length, 1)
    .setHorizontalAlignment('center');
  sheet.getRange(TARGET_FIRST_ROW, col + 2, rows.length, 1)
    .setHorizontalAlignment('center')
    .setNotes(rows.map(function (row) {
      var evidence = TARGET_OPENING_EVIDENCE[row[0]];
      return [evidence ? evidence.note : 'No exact public 2025 opening date found in the sources checked. Unknown does not mean the company did not open a role; it means the date was not sufficiently verifiable.'];
    }));
  sheet.getRange(TARGET_FIRST_ROW, col + 3, rows.length, 1)
    .setHorizontalAlignment('center');
  sheet.getRange(TARGET_FIRST_ROW, col + 4, rows.length, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build())
    .setHorizontalAlignment('center');
  sheet.getRange(TARGET_FIRST_ROW, col, rows.length, 1)
    .setBackgrounds(rows.map(function (row) {
      return [targetCompanyFill_(row[0], statuses)];
    }));
}

function targetRebuild_() {
  var sheet = targetSheet_(true);
  var askedStates = targetAskedStates_(sheet);
  var referralCounts = companyReferralCounts_();
  var statuses = targetOpeningStatuses_();
  var blocks = [
    targetRows_(TARGET_P0, referralCounts, statuses, askedStates),
    targetRows_(TARGET_P1, referralCounts, statuses, askedStates),
    targetRows_(TARGET_P2, referralCounts, statuses, askedStates),
    targetRows_(TARGET_P3, referralCounts, statuses, askedStates)
  ];
  var clearDepth = Math.max(1, sheet.getLastRow());

  // Clear stale values/notes from the prior A:B / D:E / G:H / J:K layout.
  sheet.getRange(1, 1, clearDepth, TARGET_RENDER_WIDTH)
    .clearContent().clearDataValidations().clearNote().setBackground(null);

  targetPaintHeader_(sheet);
  for (var b = 0; b < blocks.length; b++) {
    targetWriteBlock_(sheet, TARGET_BLOCK_COLS[b], blocks[b], clearDepth, statuses);
  }

  var total = TARGET_P0.length + TARGET_P1.length + TARGET_P2.length + TARGET_P3.length;
  var what = 'Target: ' + total + ' companies across 4 sourcing blocks.';
  Logger.log(what);
  return what;
}

/** Rebuild the sourcing shortlist and its current sendable counts. */
function rebuildTargetTab() {
  var what = targetRebuild_();
  SpreadsheetApp.getActiveSpreadsheet().toast(what, 'Target', 8);
  return what;
}
