/**
 * The Company tab: which employers worth asking for a referral have opened yet.
 *
 * Two independent blocks side by side, A:H and I:P. A:H is the standing list of
 * employers that certified an H-1B Software Engineer LCA in FY2025 — the ones
 * where a visa is a question already answered. I:P is every other employer on the
 * same shortlist. Each block also shows the number of remaining referral emails
 * currently available from the Employees (seed) export.
 *
 * This file reads the Jobs tab and the sender-maintained Referral Seed Counts tab,
 * and writes the Company tab. The email count starts with every unique non-invalid
 * referral candidate in the generated seed, then removes addresses already
 * reserved or used by Referral, so it describes what can still be selected.
 * No other tab is written here.
 *
 * It also defines no onEdit. Apps Script binds exactly one onEdit per project and
 * silently keeps whichever definition loaded last, so a second one here would
 * take the tracker's with it. The Asked checkbox needs no handler — the sweep
 * below reads it back before every rewrite.
 */


var COMPANY_TAB = 'Company';

// The tab this one reads. Its own constant rather than the tracker's JOBS_TAB, so
// that nothing here depends on another file having loaded.
var COMPANY_JOBS_TAB = 'Jobs';
var COMPANY_REFERRAL_SEED_COUNTS_TAB = 'Referral Seed Counts';

// Where each block starts. The valid-email count sits beside the company name,
// and First sits beside Summer?, so each block is eight columns wide and the
// second starts at I.
var COMPANY_BLOCK_COLS = [1, 9];
var COMPANY_BLOCK_WIDTH = 8;   // company | valid count | Summer? | First | Asked | LinkedIn | subject | body
var COMPANY_FIRST_ROW = 2;     // row 1 is the header

var COMPANY_HEADERS = [
  ['Company - sponsors SWE H-1B, FY2025', 'Sendable referral emails', 'Summer?',
   'First', 'Asked', 'LinkedIn', 'Email subject', 'Email body'],
  ['Company - everyone else', 'Sendable referral emails', 'Summer?', 'First', 'Asked',
   'LinkedIn', 'Email subject', 'Email body']
];

// Who the templates are from. Lifted from docs/email-templates.md rather than
// written again here, so the tab and the sender introduce the same person.
var COMPANY_SENDER = 'Henry Nguyen';
var COMPANY_SENDER_STUDY = 'a Math and Computer Science student at Kenyon College';
// Shorter, for LinkedIn, where every character is one closer to the 300 a connection
// note allows.
var COMPANY_SENDER_STUDY_SHORT = 'a Math and CS student at Kenyon College';
var COMPANY_SENDER_CONTACT =
  'hoanng15.work@gmail.com · linkedin.com/in/hoanng15 · github.com/henryng15';

// How wide the three template columns are drawn. One number each, so changing
// your mind is changing it here — see companyPaintHeader_.
// The three template columns are drawn to fit their own header and nothing more.
// Their contents are a whole message each and no width short of absurd would show
// one, so the width is spent on the only thing worth reading in place: which
// column you are looking at.
//
// Derived from the header text rather than written down as three numbers, so that
// renaming a header cannot leave it clipped by a width nobody thought to update.
// The header row cannot overflow into its neighbour the way a lone cell can —
// the cell beside it is another header — so a column too narrow for its title
// silently cuts the title off.
var COMPANY_HEADER_CHAR_PX = 7.5;   // bold 10pt, near enough
var COMPANY_HEADER_PADDING_PX = 24;

function companyHeaderWidth_(text) {
  return Math.round(String(text).length * COMPANY_HEADER_CHAR_PX) + COMPANY_HEADER_PADDING_PX;
}

// And how tall every data row is pinned. 21px is the Sheets default — one line.
//
// This has to be set, not left alone, and the reason is easy to miss: CLIP stops a
// long line overflowing sideways, it does not stop a newline. The templates carry
// real '\n' characters, so without an explicit height Sheets grows each row to the
// ten or fifteen lines the message needs and the tab becomes a wall. Pinning the
// height clips it vertically the way CLIP clips it horizontally.
//
// It must be setRowHeightsForced, not setRowHeights. The plain one sets a height
// that rows are still free to grow past to fit their contents, which against a
// fifteen-line cell means it does nothing at all — the call succeeds, the rows
// stay tall, and there is no error anywhere to say why.
var COMPANY_ROW_HEIGHT_PX = 21;

// Light green 3, the same family as APP_OFFICIAL_YELLOW on the App tab, so that
// "this row wants your attention" looks like one idea across the spreadsheet.
var COMPANY_OPEN_GREEN = '#D9EAD3';

// What the Summer? cell says, and the rule is the opposite of the sender's.
//
// A posting is Summer only when its title carries the word, as a whole word. A
// title that names no intake — "Software Engineer Intern", "Software Engineering
// Intern" — is Off-cycle, not Summer. So is a company with three openings none of
// which say it.
//
// This deliberately disagrees with outreachSeason_, where an unlabelled role is
// Summer. That default is right for the tab it reads: every row on App is an
// application somebody chose to make, which says more about the intake than a
// title does. This tab reads the crawler's Jobs tab, where hundreds of postings
// nobody has looked at sit side by side — and outreach_config.gs says of exactly
// that case that "summer" was what picked out the intake worth asking about, and
// that its own reasoning "would not survive the path being pointed at a different
// one". This is that different path.
var COMPANY_SUMMER = 'Summer';
var COMPANY_OFFCYCLE = 'Off-cycle';
var COMPANY_SUMMER_WORD = 'summer';

// Intakes that have already closed. A posting naming one is dropped outright —
// not counted as an opening, not coloured, not sorted to the top — because a
// company whose only opening is one you can no longer apply to has not opened.
//
// It is a list rather than a constant so that rolling the year forward is adding
// '2027' here, in one place, rather than hunting for a hard-coded number.
var COMPANY_DEAD_INTAKE_WORDS = ['2026'];

// Legal-form noise, dropped before two names are compared. Same list the ColdEmail
// exporter normalises with, so a company classified as a sponsor there is the same
// company here.
var COMPANY_SUFFIXES = ['INC', 'LLC', 'CORP', 'CORPORATION', 'LTD', 'CO', 'LP', 'LLP',
  'THE', 'INCORPORATED', 'COMPANY', 'GROUP', 'HOLDINGS', 'USA', 'US', 'NA', 'PLC',
  'GMBH', 'SA', 'AG', 'LABS', 'TECHNOLOGIES', 'TECHNOLOGY'];

// The property that remembers what the Jobs tab looked like at the last rebuild.
// Without it every firing rewrites 173 rows to record that nothing happened.
var COMPANY_FINGERPRINT_KEY = 'companyTabJobsFingerprint';

var COMPANY_TRIGGER_HANDLER = 'syncCompanyTab';


// ---------------------------------------------------------------- the shortlist
//
// Split offline from the DOL LCA disclosure files, filtered to certified Software
// Engineer titles and aggregated across an employer's legal entities. A company is
// a sponsor when its FY2025 count is non-zero — FY2024 alone does not qualify it,
// and FY2024 plus FY2025 is already covered by the FY2025 half of that. The source
// list of employers worth writing to is ColdEmail's data/seed_manual.csv.
//
// Aggregating before the test is load-bearing: VMware files as VMware LLC and
// VMware, Inc., and a per-entity test loses the company.
//
// Regenerating: scripts/extract_h1b_software_engineer.py in the ColdEmail repo
// rebuilds the LCA extract, and the split is a name match against it. A company
// moving between these two arrays is a data change, not a code change — say which
// FY made it move.
//
// Two names are matched by hand rather than by the matcher: Walmart files as
// WAL-MART ASSOCIATES, whose hyphen splits the token, and Elastic files as
// Elasticsearch. Loosening the matcher instead is what pairs Runway with Rent the
// Runway and Loom with Bloomberg, so it stays strict and these two are listed.
// 173 employers with a certified SWE LCA in FY2025.
var COMPANY_SPONSORS = [
  'AMD', 'Activision Blizzard', 'Adobe', 'Affirm', 'Airbnb', 'Airbyte', 'Akamai',
  'Akuna Capital', 'Amazon', 'American Express', 'Amplitude', 'Apple',
  'Applied Intuition', 'Asana', 'Atlassian', 'Aurora', 'Autodesk', 'Bank of America',
  'Benchling', 'Bill', 'BlackRock', 'Block', 'Bloomberg', 'Boston Consulting Group',
  'Box', 'Brex', 'Bridgewater Associates', 'ByteDance', 'C3 AI', 'Capital One',
  'Cerebras', 'Chainalysis', 'Chewy', 'Chime', 'Circle', 'Cisco', 'Citadel',
  'Citadel Securities', 'Cloudflare', 'Coca-Cola', 'Cockroach Labs', 'Cohere',
  'Coinbase', 'Comcast', 'Confluent', 'CoreWeave', 'Costco', 'CrowdStrike', 'Cruise',
  'DRW', 'Databricks', 'Datadog', 'Deel', 'Dell Technologies', 'Deloitte',
  'DigitalOcean', 'Discord', 'Disney', 'DoorDash', 'Dropbox', 'Elastic',
  'Electronic Arts', 'Etsy', 'Fastly', 'Fidelity Investments', 'Figma', 'Fivetran',
  'Flexport', 'Ford', 'Fortinet', 'Gemini', 'General Motors', 'GitHub', 'Glean',
  'Google', 'Grammarly', 'Groq', 'Gusto', 'HP', 'Harvey', 'Home Depot', 'IBM', 'Intel',
  'Intuit', 'Ironclad', 'JPMorgan Chase', 'Jane Street', 'Johnson & Johnson', 'Lambda',
  'LangChain', 'LinkedIn', 'Lyft', 'Marqeta', 'Mastercard', 'McKinsey', 'Mercury',
  'Meta', 'Microsoft', 'Millennium', 'Mistral AI', 'Mixpanel', 'Moderna', 'MongoDB',
  'Netflix', 'New Relic', 'Nike', 'Notion', 'Nuro', 'Nvidia', 'Okta', 'OpenAI',
  'Optiver', 'Palantir', 'Palo Alto Networks', 'PayPal', 'PepsiCo', 'Persona',
  'Pinecone', 'Pinterest', 'Plaid', 'Point72', 'Qualcomm', 'Ramp', 'Recursion',
  'Reddit', 'Replit', 'Retool', 'Riot Games', 'Ripple', 'Rippling', 'Rivian',
  'Robinhood', 'Roblox', 'Runway', 'Salesforce', 'SambaNova', 'Samsara', 'Scale AI',
  'ServiceNow', 'Sierra', 'Snap', 'Snowflake', 'Squarespace', 'Stripe', 'T-Mobile',
  'Temporal', 'Tempus', 'Tesla', 'TikTok', 'Toast', 'Twilio', 'Twitch', 'Two Sigma',
  'Uber', 'Unity', 'VMware', 'Vanta', 'Vercel', 'Verkada', 'Visa', 'Walmart',
  'Wayfair', 'Waymo', 'Wealthfront', 'Wells Fargo', 'Wiz', 'Workday', 'X', 'Zoom',
  'Zoox', 'Zscaler', 'dbt Labs', 'eBay'
];


// 70 employers on the shortlist with no certified SWE LCA in FY2025. Absence here is
// absence from a title-filtered extract, not proof a company never sponsors: Oracle,
// Goldman Sachs and Morgan Stanley file under titles the SWE regex does not catch.
var COMPANY_OTHERS = [
  'AT&T', 'Accenture', 'Airtable', 'Anduril', 'Anthropic', 'Auth0', 'Bain',
  'Belvedere Trading', 'Betterment', 'Blue Origin', 'Boeing', 'Broadcom', 'CVS Health',
  'Canva', 'Carta', 'Character AI', 'Coda', 'Cursor', 'DE Shaw', 'Epic Games', 'Faire',
  'Five Rings', 'GitLab', 'Goldman Sachs', 'Gopuff', 'HPE', 'HashiCorp',
  'Hudson River Trading', 'Hugging Face', 'IMC Trading', 'Instacart', 'Jump Trading',
  'Kraken', 'Linear', 'Lockheed Martin', 'Loom', 'Lucid Motors', 'Miro', 'Modal',
  'Morgan Stanley', 'Netlify', 'Northrop Grumman', 'Nubank', 'Old Mission', 'Oracle',
  'Perplexity', 'Pfizer', 'PlanetScale', 'Procter & Gamble', 'Raytheon', 'SAP', 'SIG',
  'Segment', 'SendGrid', 'SentinelOne', 'Shopify', 'Slack', 'Snyk', 'SoFi', 'SpaceX',
  'Splunk', 'Spotify', 'Supabase', 'Target', 'Together AI', 'UnitedHealth Group',
  'Verizon', 'Warner Bros Discovery', 'Weights & Biases', 'Wix'
];


// --------------------------------------------------------------- name matching

/**
 * One company name reduced to the tokens that identify it.
 *
 * Upper case, punctuation to spaces, legal forms dropped: "Rivian and Volkswagen
 * Group Technologies" and "Rivian" both start RIVIAN, "VMware, Inc." and "VMware
 * LLC" both become VMWARE.
 */
function companyTokens_(name) {
  var raw = String(name == null ? '' : name).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').split(' ');
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    if (raw[i] && COMPANY_SUFFIXES.indexOf(raw[i]) === -1) out.push(raw[i]);
  }
  return out;
}

/**
 * Does `posting` name `shortlisted`? True when the shortlisted name appears as a
 * contiguous run of whole tokens inside the posting's name.
 *
 * Whole tokens and contiguous, not a substring, and the difference is the whole
 * rule. Substring matching puts Maxlinear under Linear, JobTarget under Target and
 * Bloomberg under Loom — every one of those is a real pair the loose version
 * produced against this data. Contiguous whole tokens still catches what matters:
 * "Amazon Web Services (AWS)" is Amazon, "The Walt Disney Company" is Disney.
 *
 * A shortlisted name whose first token is under three characters has to match the
 * posting exactly. Otherwise X — the company — claims every posting with a stray
 * initial in its name, and HP claims Hewlett Packard Enterprise.
 */
function companyNameMatches_(shortlisted, posting) {
  if (!shortlisted.length || !posting.length) return false;
  if (shortlisted[0].length < 3) return shortlisted.join(' ') === posting.join(' ');
  for (var i = 0; i + shortlisted.length <= posting.length; i++) {
    var hit = true;
    for (var j = 0; j < shortlisted.length; j++) {
      if (posting[i + j] !== shortlisted[j]) { hit = false; break; }
    }
    if (hit) return true;
  }
  return false;
}

/**
 * Whether a title says Summer. It has to say it — see COMPANY_SUMMER.
 *
 * Whole word, so a company called Summerlin is not an intake.
 */
function companyIsSummerRole_(role) {
  var text = String(role == null ? '' : role).toLowerCase();
  return new RegExp('\\b' + COMPANY_SUMMER_WORD + '\\b').test(text);
}

/**
 * Whether a title names an intake that has already closed, and so should not
 * count as an opening at all. See COMPANY_DEAD_INTAKE_WORDS.
 *
 * Checked before the season, and that order matters: "Summer 2026" is both, and
 * it is the closed half that decides. Matching digits as a whole word keeps 2026
 * from being found inside a req number.
 */
function companyIsDeadIntake_(role) {
  var text = String(role == null ? '' : role).toLowerCase();
  for (var i = 0; i < COMPANY_DEAD_INTAKE_WORDS.length; i++) {
    if (new RegExp('\\b' + COMPANY_DEAD_INTAKE_WORDS[i] + '\\b').test(text)) return true;
  }
  return false;
}


// ----------------------------------------------------------------- the templates
//
// Every message, email and LinkedIn alike, follows the same respectful sequence.
// This is a hand-sent referral request, not a cold-email experiment: consistency
// makes sure nobody has to infer why a stranger wrote or what is being asked.
//
//   1. a greeting
//   2. who is writing: the name and the subject read
//   3. we have never met, and I saw that you are at this company
//   4. the open SWE role and why the sender's SWE background is relevant
//   5. the ask: review the resume, then refer only if the reader sees a fit
//   6. appreciation for a chance to move forward, with resume and link below
//   7. an easy, respectful way to decline
//   8. thank you for the time it took to read this
//
// The register is deliberately humble and a little formal. An earlier draft of
// these was written closer to the sender's cold-email voice, which is brisk
// because it is writing to recruiters, whose job is to read applications. This is
// writing to an engineer who owes the reader nothing and is being asked to spend
// their own credibility. It therefore asks for a resume review before a referral,
// makes the referral conditional on genuine fit, and gives the reader an easy way
// out before thanking them either way.
//
// Both messages carry the whole structure. The LinkedIn one is therefore not a
// connection note - it is far past the 300-character cap and is meant to be sent
// as a DM. It differs from the email only in dropping the subject, the signature
// block and the paragraph breaks.
//
// The tab knows only that a posting exists, not whether an application was made.
// It must therefore never claim that the application is already in. The direct
// link at the foot is useful precisely because it leaves that decision honest.
//
// A company with no opening cannot be asked for a referral against a req that does
// not exist, and cannot have been applied to either. Beats 4 to 6 are replaced
// there by one that says no posting has appeared and asks whether one is expected.
//
// The company, role season and application link make every message specific. The
// greeting and sign-off are drawn deterministically by company name, so a rebuild
// gives back exactly what was reviewed and copied by hand.

var COMPANY_GREETINGS = [
  'I hope this message finds you well.', 'I hope this note finds you at a good time.',
  'I hope your week has been going well.', 'I hope this finds you well.',
  'I hope I am not catching you at a busy moment.',
  'I hope the week is treating you kindly.', 'I hope this reaches you well.',
  'I hope you are doing well.', 'I hope all is well with you.',
  'I hope this message reaches you at a good moment.',
  'I hope things are going well for you.', 'I hope you are keeping well.',
  'I hope this finds you in good spirits.', 'I hope your day is going well.',
  'I hope I find you at a quiet moment.', 'I hope this note reaches you well.',
  'I hope you are well.', 'I hope this finds you having a good week.',
  'I hope the day is going kindly for you.', 'I hope this finds you at a reasonable hour.'
];

var COMPANY_MET_LINES = [
  'We have never met or spoken, but I came across your profile and saw that you are at {C}.',
  'You and I have not met, though I noticed from your profile that you are with {C}.',
  'We have not spoken before, and I found your profile while reading about {C}.',
  'I hope you will forgive a message from a stranger; I saw that you are part of the team at {C}.',
  'We are not acquainted, but your profile came up as I was looking into {C}.',
  'I realise we have never been introduced. I noticed that you are working at {C}.',
  'We have never corresponded, though I saw from your profile that you are at {C}.',
  'This is the first time I am writing to you. I came across your name while reading about {C}.',
  'You do not know me, and I saw from your profile that you are with {C}.',
  'We have not had the chance to meet, but I noticed you are on the team at {C}.',
  'I am writing without an introduction. Your profile showed me that you are at {C}.',
  'We have never spoken, and I hope you do not mind my writing; I saw that you are at {C}.',
  'I have not had the pleasure of meeting you, though I noticed you work at {C}.',
  'We are strangers, I know. I came across your profile and saw that you are with {C}.',
  'I hope it is all right to write to you unannounced. I saw that you are at {C}.',
  'We have not met, and I found my way to your profile while looking into {C}.',
  'I am reaching out without any prior introduction, having seen that you are at {C}.',
  'You have not heard from me before. I noticed from your profile that you are with {C}.',
  'We have never been in touch, though I saw that you are part of {C}.',
  'I hope you will excuse an unexpected message. Your profile told me that you are at {C}.'
];

var COMPANY_FIT_LINES = [
  'Having read about the role and about {C}, I believe my background and skills would genuinely fit, and it is work I would care about doing well.',
  'From what I have read of the role and of {C}, my background feels like a real fit.',
  'I have spent some time with the posting, and I think my skills line up with what the role asks for.',
  'Looking at the role and at what {C} builds, I feel my background and skills would suit it.',
  'The more I read about {C}, the more I felt my background might be a genuine match for the role.',
  'I believe the experience I have built lines up honestly with what this role is asking for.',
  'My coursework and projects have pointed me in this direction, and the role at {C} looks like a real fit.',
  'Having studied the posting, I think my skills and background would serve the role well.',
  'I would not write if I did not think the fit was real; the role and my background line up closely.',
  'What {C} is building is close to the work I have been preparing myself for.',
  'I have looked carefully at the role, and I believe my background gives me something useful to offer.',
  'From the posting, the role seems to ask for the things I have spent my time learning.',
  'I think my skills fit the role, and {C} is a place I would be proud to learn at.',
  'The role reads like a close match for the background I have built so far.',
  'Reading the posting, I felt my skills and my direction line up with what is wanted.',
  'I believe I could do this work well, and I would very much like the chance to try.',
  'My background sits close to the role, and {C} is somewhere I would genuinely like to be.',
  'Having considered the role honestly, I think my skills would be a good fit for it.',
  'The work described is the work I have been building toward, and I think the fit is real.',
  'I feel that my background and what the role asks for meet quite closely.'
];

var COMPANY_APPLIED_LINES = [
  'I applied as soon as the posting went up, though I know an application on its own can go unseen, and I would like to give it the best chance I can.',
  'My application went in the day it opened. I am writing because I would like it to have the fairest look it can get.',
  'I submitted my application as soon as the role appeared, and I am reaching out in the hope of giving it a better chance of being read.',
  'I have already applied, on the day the posting went live. I know how many applications a req collects, and I would like mine to have a real look.',
  'I put my application in the moment the role opened. I am writing because I would like the chance to be considered properly.',
  'I applied straight away when the posting appeared, and I am reaching out to give the application the best chance I can.',
  'My application is already in, sent the day the role opened, and I hoped a word from someone inside might help it be seen.',
  'I applied as soon as it was posted. I am asking because I would like the application to reach someone rather than sit in a queue.',
  'I submitted my application on the day the role went up, and I would like to do what I can to give it a fair hearing.',
  'I have applied already, as soon as the posting appeared, and I am writing in the hope of improving its chances of being read.',
  'The application went in the day the role opened. I am reaching out because I would like it to have every chance it deserves.',
  'I applied the moment I saw the posting, and I am writing because I would like to give myself the best chance of being considered.',
  'My application has been in since the day the role opened, and I am asking in the hope that it might be looked at properly.',
  'I applied as soon as the role opened. I know the form alone is often not enough, and I would like to give it a better chance.',
  'I sent my application in on the first day the posting was up, and I am reaching out to help it stand a fairer chance.',
  'I have already applied, straight after the role appeared, and I would like to do what I can so that it is genuinely considered.',
  'My application went in immediately when the posting opened, and I am writing to give it the best chance of a real look.',
  'I applied the day the role was listed. I am reaching out because I would like the chance to show what I can actually do.',
  'I submitted my application as soon as it opened, and I am asking so that it might have a better chance of reaching someone.',
  'I applied right away when the posting went live, and I am writing in the hope of giving it a fairer chance of being seen.'
];

var COMPANY_ASK_LINES = [
  'I wanted to ask, with respect, whether you might be willing to refer me.',
  'Might I ask whether you would consider referring me?',
  'I hope it is not too much to ask whether you would be open to referring me.',
  'Would you consider putting a referral in for me? I ask knowing it is a favour.',
  'If it is not an imposition, might you be willing to refer me?',
  'I would be grateful if you would consider referring me.',
  'May I ask whether a referral is something you would feel comfortable giving?',
  'I wondered whether you might be willing to refer me for it.',
  'Would you be open to referring me? I know it is a real ask.',
  'I hope you will not mind my asking whether you could refer me.',
  'If you felt it were warranted, would you consider referring me?',
  'I would be very grateful for a referral, if that is something you would consider.',
  'Might you be willing to put my name forward?',
  'Could I ask, respectfully, for your referral?',
  'I wanted to ask whether a referral from you might be possible.',
  'Would you consider recommending me for the role?',
  'If you thought it appropriate, would you be willing to refer me?',
  'I hope I may ask whether you would consider referring me.',
  'Might a referral be something you would be willing to give?',
  'I would be honoured if you felt able to refer me.'
];

var COMPANY_OKAY_LINES = [
  'It is completely all right if not, and I will understand entirely.',
  'Please do say no if it is not something you are comfortable with; I will understand.',
  'If that is not something you can do, that is entirely fine.',
  'It is perfectly all right to say no.',
  'Please feel free to decline; I know I am a stranger asking a favour.',
  'If not, I completely understand, and there is no need to reply.',
  'A no is entirely fine, and I would rather you felt free to give one.',
  'Please do not feel any obligation; it is quite all right either way.',
  'If you would rather not, that is completely understandable.',
  'It is genuinely fine if the answer is no.',
  'Please say no freely if that is the honest answer.',
  'I will understand completely if this is not something you can do.',
  'There is no obligation at all, and no is a perfectly good answer.',
  'If it is not possible, I quite understand.',
  'Please do not feel bad about declining; I know what I am asking.',
  'It is entirely all right if you would rather not.',
  'I would not want you to feel pressed; no is completely fine.',
  'If the answer is no, that is genuinely all right.',
  'Please feel no obligation whatsoever.', 'And if not, that is entirely understandable.'
];

var COMPANY_THANKS_LINES = [
  'Either way, thank you for taking the time to read this. I am grateful for it.',
  'Thank you sincerely for reading this far; I know your time is not free.',
  'I am genuinely grateful that you read this at all. Thank you.',
  'Thank you for the time it took to read this. I do not take it for granted.',
  'However you answer, thank you for reading; I appreciate it more than I can say.',
  'I am thankful for the minutes this took of your day.',
  'Thank you for reading a message you did not ask for. I am grateful.',
  'Whatever you decide, I am grateful that you gave this your attention.',
  'Thank you for your time and your attention; both are worth more than this ask.',
  'I appreciate you reading this, truly, and I thank you for it.',
  'Thank you for hearing me out. It means a great deal.',
  'I am grateful for the time you have already given this.',
  'Thank you for reading, and I am sorry for the intrusion on your day.',
  'Either way, I am thankful that you took the time.',
  'Thank you very much for reading this through.',
  'I know this took time you had not planned to give. Thank you.',
  'Thank you for your patience with a message from a stranger.',
  'I am grateful for your time, whatever comes of this.',
  'Thank you for considering it, and for reading this at all.',
  'I appreciate your time, and I thank you sincerely for it.'
];

var COMPANY_EMAIL_CLOSES = [
  'With gratitude,', 'Respectfully,', 'With thanks,', 'Sincerely,', 'With appreciation,',
  'Gratefully,', 'With respect,', 'Thank you,', 'Warm regards,', 'Kind regards,',
  'With sincere thanks,', 'Respectfully yours,', 'All the best,', 'With much appreciation,',
  'Yours sincerely,', 'In gratitude,', 'With my thanks,', 'Best regards,',
  'Sincerely and with thanks,', 'With genuine thanks,'
];

var COMPANY_EMAIL_SUBJECTS = [
  'A referral request for the {C} {S}SWE intern role',
  'Kenyon student asking respectfully about a {C} referral',
  'May I ask you about a referral at {C}?',
  'A humble ask about the {C} {S}software engineering internship',
  'Referral request: {C} {S}SWE intern',
  'Kenyon student, {C} {S}SWE intern - a small request',
  'Asking respectfully about a referral at {C}',
  'A request regarding the {C} {S}SWE intern opening',
  '{C} {S}SWE intern - may I ask for your referral?',
  'A referral ask for {C}, from a Kenyon student',
  'Regarding the {C} {S}software engineering internship',
  'A short and respectful ask about {C}',
  'Kenyon undergraduate asking about a {C} referral',
  '{C} {S}SWE internship - a referral request', 'May I ask for a referral at {C}?',
  'A request for your consideration - {C} {S}SWE intern',
  'Referral ask regarding {C}\'s {S}SWE intern role',
  'Kenyon student hoping for a referral at {C}',
  'About the {C} {S}SWE intern opening, and a small request',
  'A respectful ask about a {C} referral'
];

var COMPANY_NO_ROLE_ASKS = [
  'I do not see an opening posted at the moment, and I wondered whether {C} is likely to take interns this cycle.',
  'There does not seem to be a posting just now, and I wanted to ask whether one is expected at {C} this cycle.',
  'I could not find an opening yet, and I hoped you might know whether {C} plans to post one.',
  'No role is listed at present, and I wondered whether {C} takes interns this cycle.',
  'I have not seen a posting yet, and I wanted to ask whether one is likely at {C}.',
  'There is nothing listed at the moment, and I hoped you might know if {C} is hiring interns this cycle.',
  'I could not find a req open just now, and I wondered whether one is coming at {C}.',
  'Nothing appears to be posted yet, and I wanted to ask whether {C} expects to open something.',
  'I have not found an opening, and I hoped you could tell me whether {C} takes interns.',
  'No posting has appeared so far, and I wondered whether one is planned at {C} this cycle.',
  'I could not see a role listed, and I wanted to ask whether {C} is likely to open one.',
  'There is no opening I can find yet, and I hoped you might know {C}\'s plans for this cycle.'
];


/**
 * A stable unsigned hash of a string. djb2, which is enough to spread a couple of
 * hundred company names evenly and is four lines rather than a dependency.
 */
function companyHash_(text) {
  var h = 5381;
  for (var i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/** One beat, drawn for this company. The salt is what decorrelates the beats. */
function companyPick_(company, salt, list) {
  return list[companyHash_(company + '|' + salt) % list.length];
}

/** {C} is the company, {S} is "summer " or nothing. */
function companyFill_(text, company, label) {
  return text.replace(/\{C\}/g, company)
             .replace(/\{S\}/g, label === COMPANY_SUMMER ? 'summer ' : '');
}

/**
 * The substantive beats, shared by email and LinkedIn so the two cannot drift.
 *
 * The Company tab cannot prove that a person has applied, so it never claims an
 * application is already in. It gives the reader the actual application link and
 * leaves the decision to apply before or after a referral to the sender.
 */
function companyMiddleBeats_(company, label) {
  var met = 'We have not met before, but I came across your profile and saw that you work at '
    + company + '.';
  if (!label) {
    return [met,
            'I do not see an open software engineering internship at ' + company
              + ' right now, but I wanted to ask whether one may be expected this cycle.',
            'If you have a moment, I would appreciate any guidance on the right team or time to apply.'
              + ' I have attached my resume and included my contact details below.'];
  }
  return [met,
          'I noticed that ' + company + ' currently has an open '
            + (label === COMPANY_SUMMER ? 'summer ' : '')
            + 'software engineering internship. My software engineering background aligns with'
            + ' the kind of work the role describes, so I wanted to reach out.',
          'If you have a moment, would you be willing to review my resume? If you feel I could'
            + ' be a fit, I would be very grateful if you would consider referring me for the role.',
          'I would appreciate any opportunity to move forward in the process. I have attached my'
            + ' resume and included the application link below. I completely understand if a referral'
            + ' is not something you can offer.'];
}

/** Beat 2, the one fixed sentence in the message. */
function companyIntro_(study) {
  return 'My name is ' + COMPANY_SENDER + '. I am ' + study
    + ' with a background in software engineering.';
}

/**
 * The LinkedIn message. A DM: it carries the full structure and so runs well past
 * the 300 characters a connection note allows. No signature block, because the
 * profile is the signature.
 */
function companyLinkedInTemplate_(company, label, link) {
  var beats = companyMiddleBeats_(company, label);
  return 'Hi [Name], ' + companyPick_(company, 'greet', COMPANY_GREETINGS) + ' '
    + companyIntro_(COMPANY_SENDER_STUDY_SHORT) + '\n\n'
    + beats.join(' ') + '\n\n'
    + companyPick_(company, 'thanks', COMPANY_THANKS_LINES)
    + (link ? '\n\n' + link : '');
}

/**
 * The email's subject line, on its own so it can live in its own column. Kept
 * apart from the body because pasting an email means pasting two things into two
 * fields, and a body cell that starts with "Subject:" makes that a manual edit
 * every single time.
 */
function companyEmailSubject_(company, label) {
  if (!label) return 'Question about software engineering internships at ' + company;
  return 'Resume review and referral request for the ' + company + ' '
    + (label === COMPANY_SUMMER ? 'summer ' : '') + 'software engineering internship';
}

/**
 * The email body: the same respectful sequence, in paragraphs.
 *
 * The link sits on its own line at the foot, not inside the sentence naming the
 * role, for the reason docs/email-templates.md gives: a link inside a sentence
 * asking for a favour reads as a demand to click.
 */
function companyEmailBody_(company, label, link) {
  var beats = companyMiddleBeats_(company, label);
  // The last two beats - the ask and the leave-it-freely - open their own
  // paragraph, so that the ask is never buried mid-block. What is left in front of
  // them is beat 3 alone when there is no role, and beats 3 and 4 when there is.
  var okay = beats.pop();
  var ask = beats.pop();
  return 'Hi [Name],\n\n'
    + companyPick_(company, 'greet', COMPANY_GREETINGS) + ' '
    + companyIntro_(COMPANY_SENDER_STUDY) + '\n\n'
    + beats.join(' ') + '\n\n'
    + ask + ' ' + okay + '\n\n'
    + companyPick_(company, 'thanks', COMPANY_THANKS_LINES) + '\n\n'
    + companyPick_(company, 'em-close', COMPANY_EMAIL_CLOSES) + '\n'
    + COMPANY_SENDER + '\n' + COMPANY_SENDER_CONTACT
    + (link ? '\n\nApplication link: ' + link : '');
}


// ------------------------------------------------------------- reading the Jobs tab

/**
 * Where Company, Role and Expired sit on the Jobs tab, read off its own header row.
 *
 * Never hard-coded, for the reason job_sync's sheet.py gives for doing the same on
 * App: the tab has been through four layouts and a column was once inserted at E,
 * moving everything right. A position guessed here would go on reading the column
 * that used to be Role and nothing would look wrong.
 *
 * Returns null when the header does not name what this needs, and the caller then
 * leaves the tab alone rather than rebuilding it from columns it guessed at.
 */
function companyJobsLayout_(header) {
  var want = { company: -1, role: -1, expired: -1, link: -1, posted: -1 };
  for (var i = 0; i < header.length; i++) {
    var cell = String(header[i] == null ? '' : header[i]).trim().toLowerCase();
    if (cell === 'company' && want.company < 0) want.company = i;
    else if (cell === 'role' && want.role < 0) want.role = i;
    else if (cell === 'expired' && want.expired < 0) want.expired = i;
    else if (cell === 'link apply' && want.link < 0) want.link = i;
    else if (cell === 'date posted' && want.posted < 0) want.posted = i;
  }
  return (want.company < 0 || want.role < 0) ? null : want;
}

/**
 * Every posting still worth counting, as {tokens, summer, posted, postedDay} — one
 * entry per live row.
 *
 * A row ticked Expired is left out: the posting is gone, and a company whose only
 * opening has expired has not opened. A row ticked Applied is kept, because having
 * applied is the reason to want a referral rather than a reason not to.
 *
 * A row naming a closed intake is left out for the same reason an expired one is —
 * see companyIsDeadIntake_. It is dropped here rather than labelled, so that a
 * company with nothing but 2026 rows reads as not open at all.
 */
function companyLivePostings_() {
  var jobs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COMPANY_JOBS_TAB);
  if (!jobs) return null;
  var lastRow = jobs.getLastRow(), lastCol = jobs.getLastColumn();
  if (lastRow < 2 || lastCol < 2) return [];
  var values = jobs.getRange(1, 1, lastRow, lastCol).getValues();
  var at = companyJobsLayout_(values[0]);
  if (!at) return null;

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var name = String(values[r][at.company] == null ? '' : values[r][at.company]).trim();
    if (!name) continue;
    if (at.expired >= 0 && companyIsTicked_(values[r][at.expired])) continue;
    if (companyIsDeadIntake_(values[r][at.role])) continue;
    out.push({
      tokens: companyTokens_(name),
      summer: companyIsSummerRole_(values[r][at.role]),
      link: at.link < 0 ? '' : String(values[r][at.link] == null ? '' : values[r][at.link]).trim(),
      posted: at.posted < 0 ? 0 : companyPostedTime_(values[r][at.posted]),
      postedDay: at.posted < 0 ? '' : companyPostedDay_(values[r][at.posted])
    });
  }
  return out;
}

/**
 * A Date Posted cell as a sortable number. The column comes back as a Date when the
 * sheet has typed it as one and as an ISO string when it has not, so both are
 * handled; anything unparseable sorts as the oldest thing on the tab rather than
 * throwing, because one malformed date is not a reason to leave the tab unbuilt.
 */
function companyPostedTime_(cell) {
  if (cell instanceof Date) return cell.getTime();
  var parsed = Date.parse(String(cell == null ? '' : cell).trim());
  return isNaN(parsed) ? 0 : parsed;
}

/** The posting day as YYYY-MM-DD, preserving date-only cells without timezone drift. */
function companyPostedDay_(cell) {
  if (cell instanceof Date) {
    return Utilities.formatDate(
      cell,
      SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(),
      'yyyy-MM-dd'
    );
  }
  var text = String(cell == null ? '' : cell).trim();
  var dateOnly = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateOnly) return dateOnly[1];
  var parsed = Date.parse(text);
  return isNaN(parsed) ? '' : Utilities.formatDate(
    new Date(parsed),
    SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(),
    'yyyy-MM-dd'
  );
}

/** A checkbox cell reads back as a boolean, but a hand-typed one reads as text. */
function companyIsTicked_(cell) {
  if (cell === true) return true;
  return String(cell == null ? '' : cell).trim().toLowerCase() === 'true';
}

/** Count unique non-invalid referral addresses from the sender's hidden snapshot. */
function companyReferralCounts_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(COMPANY_REFERRAL_SEED_COUNTS_TAB);
  if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 2) return {};

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  var counts = {};
  values.forEach(function (row) {
    var name = String(row[0] == null ? '' : row[0]).trim();
    var count = Number(row[1]) || 0;
    if (name && count > 0) counts[companyTokens_(name).join(' ')] = count;
  });
  return counts;
}


// ------------------------------------------------------------------ the rebuild

/**
 * One block's rows, ordered and ready to write.
 *
 * Ordering is the point of the tab. Three tiers, and the date sorts inside a tier
 * rather than across them:
 *
 *   0. a summer opening, newest first
 *   1. an off-cycle opening, newest first
 *   2. nothing open, alphabetical
 *
 * The tier comes before the date deliberately. A summer req posted a fortnight ago
 * is still worth more than an off-cycle one posted this morning, because summer is
 * the intake being applied for — sorting on the date alone buried every summer row
 * under whatever the crawler happened to find that day.
 *
 * A list you have to read past to find the work is a list that stops being read,
 * which is the same reason the hourly sweep lifts the App worklist back to the top.
 *
 * The date is the newest posting the company has on Jobs, whichever intake it
 * names: an employer that posted anything yesterday is an employer hiring now.
 *
 * Tier 2's order was called free. Alphabetical is the one free order that keeps a
 * name where it was last seen.
 *
 * `asked` carries the checkbox forward by company name. It is the one column a
 * person owns, it survives every rebuild, and keying it by name rather than by row
 * is what lets the rows move underneath it.
 */
function companyBlockRows_(names, postings, asked, referralCounts) {
  var rows = names.map(function (name) {
    var tokens = companyTokens_(name);
    var open = false, summer = false, link = '', posted = 0, first = 0,
      firstDay = '', linkTime = -1;
    for (var i = 0; i < postings.length; i++) {
      var p = postings[i];
      if (!companyNameMatches_(tokens, p.tokens)) continue;
      open = true;
      if (p.posted > posted) posted = p.posted;
      if (p.posted > 0 && (!first || p.posted < first)) {
        first = p.posted;
        firstDay = p.postedDay;
      }
      // Which posting the templates name. The newest, except that once anything
      // summer has been seen only a summer posting may supply it — otherwise the
      // message says "summer opening" over a link to an off-cycle req.
      if (p.summer) {
        if (!summer || p.posted > linkTime) { link = p.link; linkTime = p.posted; }
        summer = true;
      } else if (!summer && p.posted > linkTime) {
        link = p.link; linkTime = p.posted;
      }
    }
    var label = open ? (summer ? COMPANY_SUMMER : COMPANY_OFFCYCLE) : '';
    return {
      name: name,
      validReferralEmails: Number(referralCounts[tokens.join(' ')] || 0),
      open: open,
      label: label,
      posted: posted,
      firstDay: firstDay,
      tier: open ? (summer ? 0 : 1) : 2,
      asked: asked[tokens.join(' ')] === true,
      linkedin: companyLinkedInTemplate_(name, label, link),
      subject: companyEmailSubject_(name, label),
      body: companyEmailBody_(name, label, link)
    };
  });
  rows.sort(function (a, b) {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.tier < 2 && a.posted !== b.posted) return b.posted - a.posted;
    return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
  });
  return rows;
}

/**
 * The Asked ticks currently on the tab, keyed by company rather than by row.
 *
 * Read before anything is written, because the rewrite below replaces the block
 * wholesale and the ticks are the only thing on this tab a person put there.
 *
 * It scans every column rather than the two the blocks are at, and pairs any cell
 * holding a shortlisted company name with the checkbox four to its right. It also
 * accepts the prior three- and two-column offsets once, so adding First does not
 * erase an existing Asked tick during the migration.
 *
 * A company name inside a template cell cannot be mistaken for a name cell, because
 * the match is against the whole cell rather than against part of it.
 */
function companyExistingAsked_(sheet) {
  var asked = {};
  if (!sheet) return asked;
  var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow < COMPANY_FIRST_ROW || lastCol < 3) return asked;

  var known = {};
  COMPANY_SPONSORS.concat(COMPANY_OTHERS).forEach(function (name) {
    known[companyTokens_(name).join(' ')] = true;
  });

  var values = sheet.getRange(COMPANY_FIRST_ROW, 1,
                              lastRow - COMPANY_FIRST_ROW + 1, lastCol).getValues();
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c + 4 < values[r].length; c++) {
      var text = String(values[r][c] == null ? '' : values[r][c]).trim();
      if (!text) continue;
      var key = companyTokens_(text).join(' ');
      if (known[key] && (companyIsTicked_(values[r][c + 4])
          || companyIsTicked_(values[r][c + 3])
          || companyIsTicked_(values[r][c + 2]))) asked[key] = true;
    }
  }
  return asked;
}

/**
 * What the Jobs tab currently says, reduced to the company, season, posting day
 * and link this tab reads off it. Compared against the last rebuild's value so
 * that a firing which finds nothing new writes nothing at all.
 *
 * Nothing at all is the point rather than an optimisation. The sweep fires every
 * quarter of an hour; a rewrite that reordered the rows each time would move the
 * row somebody was about to tick out from under their cursor.
 */
function companyJobsFingerprint_(postings) {
  var parts = postings.map(function (p) {
    return p.tokens.join(' ') + (p.summer ? '|s|' : '|o|') + p.posted + '|'
      + p.postedDay + '|' + p.link;
  });
  parts.sort();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, parts.join('\n'));
  return digest.map(function (b) {
    return ((b < 0 ? b + 256 : b) + 256).toString(16).slice(1);
  }).join('');
}


// -------------------------------------------------------------------- the writes

/** The tab, made if it is not there yet. */
function companySheet_(create) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(COMPANY_TAB);
  if (!sheet && create) {
    sheet = ss.insertSheet(COMPANY_TAB);
  }
  return sheet;
}

/**
 * Header row, column widths and the gutter. Run on every rebuild rather than only
 * at creation, so a tab somebody has widened or retitled comes back to itself.
 */
function companyPaintHeader_(sheet) {
  sheet.setFrozenRows(1);
  var neededColumns = COMPANY_BLOCK_COLS[COMPANY_BLOCK_COLS.length - 1]
    + COMPANY_BLOCK_WIDTH - 1;
  if (sheet.getMaxColumns() < neededColumns) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), neededColumns - sheet.getMaxColumns());
  }
  for (var b = 0; b < COMPANY_BLOCK_COLS.length; b++) {
    var col = COMPANY_BLOCK_COLS[b];
    sheet.getRange(1, col, 1, COMPANY_BLOCK_WIDTH)
      .setValues([COMPANY_HEADERS[b]])
      .setFontWeight('bold')
      .setBackground('#EFEFEF')
      .setHorizontalAlignment('center');
    sheet.setColumnWidth(col, 230);
    sheet.setColumnWidth(col + 1, 115);
    sheet.setColumnWidth(col + 2, 80);
    sheet.setColumnWidth(col + 3, 95);
    sheet.setColumnWidth(col + 4, 60);
    // Clipped, so what shows is the first line and nothing spills into the block
    // beside it. Wide enough to read that first line: the subject entire, the other
    // two far enough in to tell which variant a row drew. Widen one by hand to
    // proofread a whole message; the next rebuild puts it back.
    for (var t = 5; t < COMPANY_BLOCK_WIDTH; t++) {
      sheet.setColumnWidth(col + t, companyHeaderWidth_(COMPANY_HEADERS[b][t]));
    }
  }
}

/**
 * Write one block: values, the green on the companies that have opened, and the
 * checkbox on Asked.
 *
 * The block is cleared to the tab's current depth before it is written, not to the
 * depth of what is about to be written. A shortlist that loses a company would
 * otherwise leave its last row sitting under the new bottom, ticked and green and
 * belonging to nothing.
 */
function companyWriteBlock_(sheet, col, rows, clearDepth) {
  if (clearDepth > 0) {
    sheet.getRange(COMPANY_FIRST_ROW, col, clearDepth, COMPANY_BLOCK_WIDTH)
      .clearContent().clearDataValidations().setBackground(null);
  }
  if (!rows.length) return;

  var values = rows.map(function (r) {
    return [r.name, r.validReferralEmails, r.label, r.firstDay, r.asked,
      r.linkedin, r.subject, r.body];
  });
  var greens = rows.map(function (r) {
    var fill = r.open ? COMPANY_OPEN_GREEN : null;
    return [fill, null, fill, fill, null, null, null, null];
  });

  var range = sheet.getRange(COMPANY_FIRST_ROW, col, rows.length, COMPANY_BLOCK_WIDTH);
  range.setValues(values);
  range.setBackgrounds(greens);
  sheet.getRange(COMPANY_FIRST_ROW, col + 2, rows.length, 1)
    .setHorizontalAlignment('center');
  sheet.getRange(COMPANY_FIRST_ROW, col + 1, rows.length, 1)
    .setHorizontalAlignment('center');
  sheet.getRange(COMPANY_FIRST_ROW, col + 3, rows.length, 1)
    .setHorizontalAlignment('center');
  sheet.getRange(COMPANY_FIRST_ROW, col + 4, rows.length, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  // Clipped, not wrapped, and not overflowing either. Overflow is the Sheets
  // default and would spill a fifteen-line message across the block beside it;
  // clip cuts it at the cell border, which is what makes a 26px column legible as
  // a column rather than as a smear over its neighbours.
  sheet.getRange(COMPANY_FIRST_ROW, col + 5, rows.length, 3)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP)
    .setVerticalAlignment('top');
}

/**
 * Rebuild both blocks from the Jobs tab. Returns what it did, for the log.
 *
 * `force` skips the fingerprint check. The sweep does not pass it; a person asking
 * for the tab to be rebuilt does, because the reason to ask by hand is usually that
 * the tab looks wrong rather than that Jobs has moved.
 */
function companyRebuild_(force) {
  var postings = companyLivePostings_();
  if (postings === null) {
    Logger.log('Company: the Jobs tab is missing or its header does not name Company and Role. Nothing written.');
    return 'skipped: Jobs unreadable';
  }

  var props = PropertiesService.getDocumentProperties();
  var fingerprint = companyJobsFingerprint_(postings);
  var sheet = companySheet_(false);
  if (!force && sheet && props.getProperty(COMPANY_FINGERPRINT_KEY) === fingerprint) {
    return 'unchanged';
  }

  sheet = companySheet_(true);
  var asked = companyExistingAsked_(sheet);
  var referralCounts = companyReferralCounts_();
  var clearDepth = Math.max(0, sheet.getLastRow() - COMPANY_FIRST_ROW + 1);
  var blocks = [
    companyBlockRows_(COMPANY_SPONSORS, postings, asked, referralCounts),
    companyBlockRows_(COMPANY_OTHERS, postings, asked, referralCounts)
  ];

  companyPaintHeader_(sheet);
  var open = 0;
  for (var b = 0; b < blocks.length; b++) {
    companyWriteBlock_(sheet, COMPANY_BLOCK_COLS[b], blocks[b], clearDepth);
    open += blocks[b].filter(function (r) { return r.open; }).length;
  }

  // Once, over both blocks, because row height belongs to the row rather than to
  // either block. Done after the writes: setting it first and then writing a
  // multi-line cell lets Sheets grow the row again.
  var depth = Math.max(blocks[0].length, blocks[1].length);
  if (depth > 0) {
    sheet.setRowHeightsForced(COMPANY_FIRST_ROW, depth, COMPANY_ROW_HEIGHT_PX);
  }
  props.setProperty(COMPANY_FINGERPRINT_KEY, fingerprint);

  var what = 'Company: ' + blocks[0].length + ' sponsors + ' + blocks[1].length
    + ' others, ' + open + ' with an opening, from ' + postings.length + ' live Jobs rows.';
  Logger.log(what);
  return what;
}


// ------------------------------------------------------------------- the trigger

/**
 * The sweep. Rebuilds the tab when the Jobs tab has moved since the last one.
 *
 * It polls rather than being told, and the reason is that nothing can tell it.
 * job_sync writes Jobs through the Sheets API from GitHub Actions, and a Sheets
 * change made through the API fires no trigger in this project — not onChange,
 * not onEdit. There is no event to hang this on, so the only honest options are a
 * clock and a Jobs fingerprint, which is what this is.
 *
 * Every fifteen minutes against a sync that runs every forty-five: the tab is
 * never more than a quarter of an hour behind the crawler, and three firings in
 * four find the fingerprint unchanged and write nothing.
 */
function syncCompanyTab() {
  companyRebuild_(false);
  targetRebuild_();
}

/** Rebuild now, whatever the fingerprint says. For a person, from the editor. */
function rebuildCompanyTab() {
  var what = companyRebuild_(true);
  var targetWhat = targetRebuild_();
  var combined = what + ' ' + targetWhat;
  SpreadsheetApp.getActiveSpreadsheet().toast(combined, 'Company + Target', 8);
  return combined;
}

/**
 * Build the tab and put the sweep on the clock. The one function to run by hand.
 *
 * Safe to run again: the trigger is removed before it is made, so running this
 * three times leaves one trigger rather than three rebuilds a quarter of an hour.
 *
 * Its own trigger and its own remover, deliberately not folded into the hourly
 * housekeeping pair. That pair is documented as the kill switch people reach for
 * when the Python half or the sender is being worked on, and this tab has nothing
 * to do with either — it writes no tab any of them read.
 */
function setupCompanyTab() {
  removeCompanyTrigger();
  ScriptApp.newTrigger(COMPANY_TRIGGER_HANDLER).timeBased().everyMinutes(15).create();
  var what = companyRebuild_(true);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    what + ' Rebuilding every 15 minutes when Jobs changes.', 'Company', 10);
  return what;
}

/** The kill switch. Leaves the tab as it stands and stops it being rewritten. */
function removeCompanyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === COMPANY_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}
