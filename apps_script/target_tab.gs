/**
 * The Target tab: the 100-company sourcing shortlist and the number of referral
 * addresses that can still be sent for each company.
 *
 * This tab is deliberately separate from Company. Company answers which
 * employers currently have openings; Target answers where to spend the next
 * contact-sourcing effort. It reads the same sender-maintained Referral Seed Counts
 * snapshot through companyReferralCounts_(), and writes only Target.
 *
 * The three blocks are A:B, D:E and G:H. Columns C and F are gutters so the three
 * lists remain visually separate. P2 and P3 from the sourcing shortlist are
 * intentionally combined into one Extended block so the tab has the three blocks
 * requested for tracking.
 */

var TARGET_TAB = 'Target';
var TARGET_BLOCK_COLS = [1, 4, 7];
var TARGET_BLOCK_WIDTH = 2;
var TARGET_FIRST_ROW = 2;
var TARGET_HEADERS = [
  ['P0 - Core targets', 'Sendable referral emails'],
  ['P1 - Strong targets', 'Sendable referral emails'],
  ['P2/P3 - Extended targets', 'Sendable referral emails']
];

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

var TARGET_EXTENDED = [
  'Perplexity', 'Replit', 'Hugging Face', 'Cohere', 'Mistral AI', 'Groq', 'Glean',
  'Harvey', 'Sierra', 'Vanta', 'Wiz', 'Fivetran', 'Retool', 'Temporal',
  'Cockroach Labs', 'Snyk', 'Supabase', 'Netlify', 'Miro', 'Coda', 'Airtable',
  'Cursor', 'Character AI', 'Together AI', 'Modal', 'Affirm', 'Amplitude',
  'Applied Intuition', 'Akamai', 'Aurora', 'Autodesk', 'Cisco', 'CrowdStrike',
  'Deel', 'Discord', 'Dropbox', 'Etsy', 'Flexport', 'Grammarly', 'Intuit', 'Lyft',
  'Marqeta', 'New Relic', 'Okta', 'Roblox', 'Robinhood', 'Rivian', 'Waymo', 'Zoox',
  'Twilio'
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
    return [name, Number(referralCounts[key] || 0)];
  });
}

function targetPaintHeader_(sheet) {
  sheet.setFrozenRows(1);
  for (var b = 0; b < TARGET_BLOCK_COLS.length; b++) {
    var col = TARGET_BLOCK_COLS[b];
    sheet.getRange(1, col, 1, TARGET_BLOCK_WIDTH)
      .setValues([TARGET_HEADERS[b]])
      .setFontWeight('bold')
      .setBackground('#EFEFEF')
      .setHorizontalAlignment('center');
    sheet.setColumnWidth(col, 220);
    sheet.setColumnWidth(col + 1, 140);
  }
  sheet.setColumnWidth(3, 24);
  sheet.setColumnWidth(6, 24);
}

function targetWriteBlock_(sheet, col, rows, clearDepth) {
  if (clearDepth > 0) {
    sheet.getRange(TARGET_FIRST_ROW, col, clearDepth, TARGET_BLOCK_WIDTH)
      .clearContent().clearDataValidations().setBackground(null);
  }
  if (!rows.length) return;
  sheet.getRange(TARGET_FIRST_ROW, col, rows.length, TARGET_BLOCK_WIDTH)
    .setValues(rows);
  sheet.getRange(TARGET_FIRST_ROW, col + 1, rows.length, 1)
    .setHorizontalAlignment('center');
}

function targetRebuild_() {
  var sheet = targetSheet_(true);
  var referralCounts = companyReferralCounts_();
  var blocks = [
    targetRows_(TARGET_P0, referralCounts),
    targetRows_(TARGET_P1, referralCounts),
    targetRows_(TARGET_EXTENDED, referralCounts)
  ];
  var clearDepth = Math.max(0, sheet.getLastRow() - TARGET_FIRST_ROW + 1);

  targetPaintHeader_(sheet);
  for (var b = 0; b < blocks.length; b++) {
    targetWriteBlock_(sheet, TARGET_BLOCK_COLS[b], blocks[b], clearDepth);
  }

  var total = TARGET_P0.length + TARGET_P1.length + TARGET_EXTENDED.length;
  var what = 'Target: ' + total + ' companies across 3 sourcing blocks.';
  Logger.log(what);
  return what;
}

/** Rebuild the sourcing shortlist and its current sendable counts. */
function rebuildTargetTab() {
  var what = targetRebuild_();
  SpreadsheetApp.getActiveSpreadsheet().toast(what, 'Target', 8);
  return what;
}
