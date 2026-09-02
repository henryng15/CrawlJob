/**
 * The Target tab: the 100-company sourcing shortlist and the number of referral
 * addresses that can still be sent for each company.
 *
 * This tab is deliberately separate from Company. Company answers which
 * employers currently have openings; Target answers where to spend the next
 * contact-sourcing effort. It reads the same sender-maintained Referral Seed Counts
 * snapshot through companyReferralCounts_(), and writes only Target.
 *
 * The four blocks are A:C, E:G, I:K and M:O. Columns D, H and L are gutters so
 * the lists remain visually separate.
 */

var TARGET_TAB = 'Target';
var TARGET_BLOCK_COLS = [1, 5, 9, 13];
var TARGET_BLOCK_WIDTH = 3;
var TARGET_RENDER_WIDTH = 15;
var TARGET_FIRST_ROW = 2;
var TARGET_AGE_THRESHOLD_DAYS = 5;
var TARGET_OPENING_START_DAY = '2026-07-20';
var TARGET_NOT_OPEN_GREEN = '#D9EAD3';
var TARGET_OPEN_WHITE = '#FFFFFF';
var TARGET_URGENT_RED = '#F4CCCC';
var TARGET_HEADERS = [
  ['P0 - Core targets', 'Sendable referral emails', 'Summer 2026 first posted'],
  ['P1 - Strong targets', 'Sendable referral emails', 'Summer 2026 first posted'],
  ['P2 - AI/startup targets', 'Sendable referral emails', 'Summer 2026 first posted'],
  ['P3 - Tech adjacent targets', 'Sendable referral emails', 'Summer 2026 first posted']
];

// Earliest concrete 2025 date found in the public sources checked for this
// research pass. Dates are strings so the sheet displays the same ISO value in
// every locale. A missing entry is rendered as Unknown.
var TARGET_OPENING_EVIDENCE = {
  'Databricks': { date: '2025-08-08', note: 'US tracker snapshot dated 2025-08-15; Software Engineering Intern listing. Source: https://github.com/geoffguin124/summer2026-internships' },
  'Anduril': { date: '2025-08-11', note: 'US tracker snapshot dated 2025-08-15; Software Engineer Intern listing. Source: https://github.com/geoffguin124/summer2026-internships' },
  'Google': { date: '2025-09-16', note: 'UK Summer 2026 tracker; Software Engineering Intern, 2026. This is a UK posting date, not a claim about the US requisition. Source: https://2026-swe-internship-uk.vercel.app/' },
  'Microsoft': { date: '2025-08-14', note: 'US tracker snapshot dated 2025-08-15; Software Engineer Intern listing. Source: https://github.com/geoffguin124/summer2026-internships' },
  'Meta': { date: '2025-09-17', note: 'UK Summer 2026 tracker; Software Engineer Intern. This is a UK posting date, not a claim about the US requisition. Source: https://2026-swe-internship-uk.vercel.app/' },
  'Apple': { date: '2025-06-01', note: 'US tracker snapshot dated 2025-08-15; Software Engineering Intern listing. Source: https://github.com/geoffguin124/summer2026-internships' },
  'Amazon': { date: '2025-07-04', note: 'US tracker snapshot dated 2025-08-15; Software Development Intern listing. Source: https://github.com/geoffguin124/summer2026-internships' },
  'Stripe': { date: '2025-11-11', note: 'UK Summer 2026 tracker; Software Engineer, Intern. This is a UK posting date, not a claim about the US requisition. Source: https://2026-swe-internship-uk.vercel.app/' },
  'Ramp': { date: '2025-08-02', note: 'US tracker snapshot dated 2025-08-15; Software Engineer Intern, Backend listing. Source: https://github.com/geoffguin124/summer2026-internships' },
  'Cloudflare': { date: '2025-10-17', note: 'UK Summer 2026 tracker; Software Engineer Intern (Summer 2026). The tracker card did not expose a direct role URL. Source: https://2026-swe-internship-uk.vercel.app/' },
  'Figma': { date: '2025-09-09', note: 'UK Summer 2026 tracker; Software Engineer Intern. This is a UK posting date, not a claim about the US requisition. Source: https://2026-swe-internship-uk.vercel.app/' },
  'Palantir': { date: '2025-07-01', note: 'US tracker snapshot dated 2025-08-15; Software Engineer Intern listing. Source: https://github.com/geoffguin124/summer2026-internships' },
  'Coinbase': { date: '2025-11-07', note: 'UK Summer 2026 tracker; Software Engineer Intern. This is a UK posting date, not a claim about the US requisition. Source: https://2026-swe-internship-uk.vercel.app/' },
  'Salesforce': { date: '2025-04-28', note: 'US tracker snapshot dated 2025-08-15; Software Engineer Intern - 2026 listing. Source: https://github.com/geoffguin124/summer2026-internships' },
  'Shopify': { date: '2025-08-13', note: 'US tracker snapshot dated 2025-08-15; USA Engineering Internships listing. Source: https://github.com/geoffguin124/summer2026-internships' },
  'Confluent': { date: '2025-08-06', note: 'US tracker snapshot dated 2025-08-15; Software Engineering Intern listing. Source: https://github.com/geoffguin124/summer2026-internships' },
  'Notion': { date: '2025-08-08', note: 'US tracker snapshot dated 2025-08-15; Software Engineer Intern listing. Source: https://github.com/geoffguin124/summer2026-internships' },
  'Asana': { date: '2025-07-22', note: 'US tracker snapshot dated 2025-08-15; Software Engineer Intern listing. Source: https://github.com/geoffguin124/summer2026-internships' },
  'Cohere': { date: '2025-09-11', note: 'UK Summer 2026 tracker; Software Engineer Intern. This is a UK posting date, not a claim about the US requisition. Source: https://2026-swe-internship-uk.vercel.app/' },
  'Perplexity': { date: '2025-09-11', note: 'UK Summer 2026 tracker; UK Internship Program engineering listing. This is a UK posting date, not a claim about the US requisition. Source: https://2026-swe-internship-uk.vercel.app/' },
  'Aurora': { date: '2025-11-01', note: 'AIJobs.app listing archive; Software Engineering Internship, Summer 2026. Source: https://aijobs.app/internships' },
  'Autodesk': { date: '2025-09-30', note: 'UK Summer 2026 tracker; Intern, Software Engineer. This is a UK posting date, not a claim about the US requisition. Source: https://2026-swe-internship-uk.vercel.app/' },
  'Cisco': { date: '2025-08-14', note: 'US tracker snapshot dated 2025-08-15; Software Engineer Intern listing. Source: https://github.com/geoffguin124/summer2026-internships' },
  'Roblox': { date: '2025-08-06', note: 'US tracker snapshot dated 2025-08-15; Software Engineer Intern listing. Source: https://github.com/geoffguin124/summer2026-internships' }
};

var TARGET_P0 = [
  'OpenAI', 'Anthropic', 'Databricks', 'Anduril', 'Nvidia', 'Google', 'Microsoft',
  'Meta', 'Apple', 'Amazon', 'Uber', 'Airbnb', 'Stripe', 'Ramp', 'Plaid',
  'Cloudflare', 'Snowflake', 'Figma', 'GitHub', 'Palantir', 'Coinbase', 'Vercel',
  'Scale AI', 'CoreWeave', 'Canva'
];

var TARGET_P1 = [
  'Adobe', 'Salesforce', 'Atlassian', 'DoorDash', 'Instacart', 'Pinterest', 'Reddit',
  'Shopify', 'MongoDB', 'Datadog', 'Confluent', 'Elastic', 'HashiCorp', 'GitLab',
  'Notion', 'Linear', 'Airbyte', 'Asana', 'Box', 'Brex', 'Chime', 'Circle',
  'Rippling', 'Gusto', 'Mercury'
];

var TARGET_P2 = [
  'Perplexity', 'Replit', 'Hugging Face', 'Cohere', 'Mistral AI', 'Groq', 'Glean',
  'Harvey', 'Sierra', 'Vanta', 'Wiz', 'Fivetran', 'Retool', 'Temporal',
  'Cockroach Labs', 'Snyk', 'Supabase', 'Netlify', 'Miro', 'Coda', 'Airtable',
  'Cursor', 'Character AI', 'Together AI', 'Modal'
];

var TARGET_P3 = [
  'Affirm', 'Amplitude', 'Applied Intuition', 'Akamai', 'Aurora', 'Autodesk', 'Cisco',
  'CrowdStrike', 'Deel', 'Discord', 'Dropbox', 'Etsy', 'Flexport', 'Grammarly',
  'Intuit', 'Lyft', 'Marqeta', 'New Relic', 'Okta', 'Roblox', 'Robinhood', 'Rivian',
  'Waymo', 'Zoox', 'Twilio',
  // Toast and adjacent commerce/fintech/SaaS peers requested for additional sourcing.
  'Toast', 'Block', 'BILL', 'Samsara', 'DigitalOcean', 'Squarespace'
];

function targetSheet_(create) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TARGET_TAB);
  if (!sheet && create) sheet = ss.insertSheet(TARGET_TAB);
  return sheet;
}

function targetRows_(names, referralCounts) {
  return names.map(function (name) {
    var key = companyTokens_(name).join(' ');
    var evidence = TARGET_OPENING_EVIDENCE[name];
    return [name, Number(referralCounts[key] || 0), evidence ? evidence.date : 'Unknown'];
  });
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
  return /\bsoftware\s+(?:engineer(?:ing)?|developer)\b/i.test(title);
}

/**
 * A software-engineering role counts as opened when it says Summer, or when it
 * is unlabelled and does not explicitly say Winter or Spring.
 */
function targetCountsAsOpeningRole_(role) {
  var title = String(role == null ? '' : role).trim();
  if (!title || !targetIsSoftwareEngineerRole_(title)) return false;
  if (/\bsummer\b/i.test(title)) return true;
  return !/\b(?:winter|spring)\b/i.test(title);
}

/**
 * Read live opening roles from Jobs and classify each Target company.
 *
 * `urgentOpening` wins over `hasOpening`: any qualifying software-engineering role from the last
 * five calendar days is the red referral warning. An older qualifying role
 * leaves the company white. Companies with no qualifying role are green.
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
    statuses[companyTokens_(name).join(' ')] = { hasOpening: false, urgentOpening: false };
  });
  var today = Utilities.formatDate(
    new Date(),
    SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(),
    'yyyy-MM-dd'
  );

  for (var r = 1; r < values.length; r++) {
    var role = String(values[r][at.role] == null ? '' : values[r][at.role]).trim();
    if (!targetCountsAsOpeningRole_(role)) continue;
    var postingTokens = companyTokens_(values[r][at.company]);
    if (!postingTokens.length) continue;
    var postedDay = at.posted < 0 ? '' : companyPostedDay_(values[r][at.posted]);
    if (targetAgeDays_(TARGET_OPENING_START_DAY, postedDay) < 0) continue;
    var age = targetAgeDays_(postedDay, today);

    targetNames.forEach(function (name) {
      if (!companyNameMatches_(companyTokens_(name), postingTokens)) return;
      var status = statuses[companyTokens_(name).join(' ')];
      status.hasOpening = true;
      if (age >= 0 && age <= TARGET_AGE_THRESHOLD_DAYS) {
        status.urgentOpening = true;
      }
    });
  }
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
  }
  sheet.setRowHeight(1, 42);
  sheet.setColumnWidth(4, 18);
  sheet.setColumnWidth(8, 18);
  sheet.setColumnWidth(12, 18);
}

function targetWriteBlock_(sheet, col, rows, clearDepth, statuses) {
  if (clearDepth > 0) {
    sheet.getRange(TARGET_FIRST_ROW, col, clearDepth, TARGET_BLOCK_WIDTH)
      .clearContent().clearDataValidations().clearNote().setBackground(null);
  }
  if (!rows.length) return;
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
  sheet.getRange(TARGET_FIRST_ROW, col, rows.length, 1)
    .setBackgrounds(rows.map(function (row) {
      return [targetCompanyFill_(row[0], statuses)];
    }));
}

function targetRebuild_() {
  var sheet = targetSheet_(true);
  var referralCounts = companyReferralCounts_();
  var statuses = targetOpeningStatuses_();
  var blocks = [
    targetRows_(TARGET_P0, referralCounts),
    targetRows_(TARGET_P1, referralCounts),
    targetRows_(TARGET_P2, referralCounts),
    targetRows_(TARGET_P3, referralCounts)
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
