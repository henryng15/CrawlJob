/**
 * Outreach — the contact list, and who counts as the same employer.
 *
 * Contacts live in a spreadsheet owned by the sending account, never in the
 * tracker. Two tabs, and the split is the whole point:
 *
 *   Contacts (seed)    overwritten wholesale by the ColdEmail export
 *   Contacts (manual)  hand-curated and never touched by bulk export; an
 *                      explicit user-approved source may append a bounded row
 *
 * One tab would mean a single re-export silently destroying months of contacts
 * gathered by hand. Two tabs make that impossible rather than merely unlikely.
 */

// Legal form and filler, dropped before comparing. Mirrors COMPANY_NOISE in
// job_sync/sources.py — the two lists have to agree or the tracker and the
// queue will disagree about what one employer is.
var COMPANY_NOISE = [
  'inc', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company',
  'companies', 'group', 'holdings', 'plc', 'gmbh', 'ag', 'nv', 'bv', 'sa',
  'technologies', 'technology', 'the', 'an', 'and'
];

function outreachNameKey_(value) {
  return String(value == null ? '' : value)
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** An employer as the words that actually name it, legal form dropped. */
function outreachCompanyTokens_(company) {
  var seen = {};
  outreachNameKey_(company).split(' ').forEach(function (word) {
    if (word && COMPANY_NOISE.indexOf(word) === -1) seen[word] = true;
  });
  return Object.keys(seen).sort();
}

/**
 * Either name contained in the other is enough: a contact list writes "Google
 * Cloud" where the application says "Google". Containment is over whole words,
 * so "Dice" does not match "Dicerna".
 */
function outreachSameEmployer_(left, right) {
  if (!left.length || !right.length) return false;
  var contains = function (big, small) {
    return small.every(function (word) { return big.indexOf(word) !== -1; });
  };
  return contains(right, left) || contains(left, right);
}

// The words a campus recruiter's title actually uses, as whole words rather than
// substrings: `intern` must not match `internal`, which is a different job and a
// different email.
//
// Campus, university, early career and emerging talent are one team under
// different company names, and the owner treats them as one group. The spellings
// seen in live contact data so far: "Campus Recruiter", "University Recruiter",
// "Early Career Technical Recruiter", "Senior Manager, Early Careers Talent
// Acquisition" (plural, which an `early[\s-]?career\b` test misses), "Emerging
// Talent Recruiter" and "Head of Emerging Talent" (Dropbox's whole early-career
// team), "Future Talent", and "new grad" on an engineer who came through that
// pipeline. Adding a name here is cheaper than discovering later that a company's
// campus recruiter was filed as a generic one and written to last.
var CAMPUS_TITLE =
  /\b(campus|university|college|school|students?|interns?|internships?|graduates?|grads?)\b|\b(early|emerging|future)[\s-]?(careers?|talent)\b|\bnew[\s-]?grad(uate)?s?\b/;

/**
 * The focus a recruiter's own title implies, used only when Focus is empty.
 *
 * Only 'university' is worth deriving, because it is the one value
 * outreachVariantOrder_ reads: it moves the campus subject — the one that asks
 * whether Kenyon sits on the campus list this cycle — ahead of the industry hook.
 * Anything else a title might say is already carried by the company's bucket, so
 * inventing more values here would be guessing rather than reading.
 *
 * This exists for the hand-curated tab. A seed row arrives from ColdEmail with Focus
 * already filled; a row typed by hand carries a title and little else, and asking
 * for a second column whose only useful value is one word is how a tab stops being
 * used. An explicit Focus still wins — the caller only falls back to this.
 */
function outreachFocusFromRole_(role) {
  var text = String(role == null ? '' : role).toLowerCase().trim();
  if (!text) return '';
  return CAMPUS_TITLE.test(text) ? 'university' : '';
}

function outreachCell_(row, index) {
  var value = row[index - 1];
  return String(value == null ? '' : value).trim();
}

/**
 * Every contact worth writing to, from both tabs, newest-typed last.
 *
 * A manual row carries only Company, Recruiter Name and Email — that is all the
 * typing this system asks for. Hook and angle stay empty and are borrowed from the
 * company's seed contacts at compose time. Focus is borrowed from nobody: it
 * describes the person, not the employer, so an empty one is read off their own
 * title instead.
 */
function outreachReadContacts_(contactsSpreadsheet) {
  var out = [];
  var byEmail = {};

  [[TAB_CONTACTS_SEED, 'seed'], [TAB_CONTACTS_MANUAL, 'manual']].forEach(function (pair) {
    var sheet = contactsSpreadsheet.getSheetByName(pair[0]);
    if (!sheet) return;
    var last = sheet.getLastRow();
    if (last < 2) return;
    // C_WIDTH, not C_BUCKET: the Sent tick sits one past the last column this
    // used to read, and a row read too narrow reports every contact as unwritten.
    var rows = sheet.getRange(2, 1, last - 1, C_WIDTH).getValues();

    rows.forEach(function (row, index) {
      var email = outreachCell_(row, C_EMAIL).toLowerCase();
      var company = outreachCell_(row, C_COMPANY);
      if (!email || email.indexOf('@') === -1 || !company) return;

      // The seed tab is read first, so a hand-curated duplicate of a seed contact
      // loses — the seed row is the one carrying an angle and a hook.
      if (byEmail[email]) return;

      var verify = outreachCell_(row, C_VERIFY);
      if (verify === UNSENDABLE_VERIFY) return;

      var contact = {
        company: company,
        tokens: outreachCompanyTokens_(company),
        name: outreachCell_(row, C_NAME),
        email: email,
        role: outreachCell_(row, C_ROLE),
        // A hand-curated row carries a title and no Focus. Deriving it here rather
        // than at compose time means the Email tab's Template column names the
        // campus subject when the row is queued, which is before the message is
        // written and while there is still time to disagree with it.
        focus: outreachCell_(row, C_FOCUS)
          || outreachFocusFromRole_(outreachCell_(row, C_ROLE)),
        hook: outreachCell_(row, C_HOOK),
        angle: outreachCell_(row, C_ANGLE),
        bucket: outreachCell_(row, C_BUCKET),
        // Already written to, on any earlier run or before the rebuild. The
        // planner drops these; nothing downstream has to remember why.
        sent: outreachSentTicked_(row[C_SENT - 1]),
        rowNumber: 0,
        tab: pair[0],
        source: pair[1]
      };
      contact.rowNumber = index + 2;
      byEmail[email] = contact;
      out.push(contact);
    });
  });

  return out;
}

/**
 * The industry this employer sits in, borrowed the same way the angle is.
 *
 * A hand-curated contact carries no bucket, so it inherits the one its company's
 * seed contacts already have — which is what lets a hand-curated recruiter at a
 * fintech still get the payments subject line rather than a generic one.
 */
function outreachBucketFor_(companyContacts) {
  for (var i = 0; i < companyContacts.length; i++) {
    if (companyContacts[i].bucket) return companyContacts[i].bucket;
  }
  return '';
}

/** Every contact at one employer, seed before manual. */
function outreachContactsFor_(contacts, company) {
  var tokens = outreachCompanyTokens_(company);
  if (!tokens.length) return [];
  return contacts.filter(function (contact) {
    return outreachSameEmployer_(tokens, contact.tokens);
  });
}

/**
 * The company's opening line, borrowed from whichever contact has one.
 *
 * A hand-curated contact at a company ColdEmail has already written for inherits
 * that company's angle for free. A hand-typed contact at a company it has never
 * seen has none, and the caller sends that as a draft rather than as mail.
 */
function outreachAngleFor_(companyContacts) {
  for (var i = 0; i < companyContacts.length; i++) {
    if (companyContacts[i].angle) return companyContacts[i].angle;
  }
  return '';
}

/** How many people we could actually write to at this employer. */
function outreachRecruiterCount_(contacts, company) {
  return outreachContactsFor_(contacts, company).length;
}

// ------------------------------------------------ owner-supplied recruiter import

// The recruiters with an email on the owner's shared list (spreadsheet
// 17KnCRwNrjmuwjCLbCuHl8xiI-qSchiEcWbWJuDvXZHM, gid 165100402), read on
// 2026-09-23. A blank Company on that sheet was filled from the address's domain
// (`inferred`); names are only the ones the sheet itself gives, never guessed
// from the address. Obvious spelling slips were corrected (Mercesdes, DataDog).
var OWNER_RECRUITER_SHEET_20260923_ = [
  {"company": "NVIDIA", "name": "Lexy Aldape", "email": "laldape@nvidia.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "MongoDB", "name": "", "email": "sammy.attia@mongodb.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "MongoDB", "name": "", "email": "earlytalent@mongodb.com", "note": "", "linkedin": "", "inferred": true},
  {"company": "Rippling", "name": "", "email": "ctung@rippling.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "Adobe", "name": "", "email": "cfelix@adobe.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "F5", "name": "", "email": "ki.nguyen@f5.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "DoorDash", "name": "", "email": "jessica.woo@doordash.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "DoorDash", "name": "", "email": "alexandra.graw@ext.doordash.com", "note": "", "linkedin": "", "inferred": true},
  {"company": "Wayfair", "name": "", "email": "cmcbride1@wayfair.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "Twilio", "name": "", "email": "bfeicho@twilio.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "Confluent", "name": "", "email": "lzabel@confluent.io", "note": "", "linkedin": "", "inferred": false},
  {"company": "Palantir", "name": "", "email": "ajordan@palantir.com", "note": "UK", "linkedin": "", "inferred": false},
  {"company": "Microsoft", "name": "", "email": "tamiwilbur@microsoft.com", "note": "", "linkedin": "", "inferred": true},
  {"company": "Microsoft", "name": "", "email": "moanonuevo@microsoft.com", "note": "", "linkedin": "", "inferred": true},
  {"company": "Microsoft", "name": "", "email": "v-tonnguyen@microsoft.com", "note": "", "linkedin": "", "inferred": true},
  {"company": "Microsoft", "name": "", "email": "v-coupeavy@microsoft.com", "note": "", "linkedin": "", "inferred": true},
  {"company": "Microsoft", "name": "", "email": "elizabeth.rutledge@microsoft.com", "note": "", "linkedin": "", "inferred": true},
  {"company": "Meta", "name": "", "email": "kvsona@meta.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "Bloomberg", "name": "", "email": "bkoempel@bloomberg.com", "note": "", "linkedin": "", "inferred": true},
  {"company": "Coinbase", "name": "", "email": "victoria.mackey@coinbase.com", "note": "", "linkedin": "https://www.linkedin.com/in/victoriamackey10/", "inferred": true},
  {"company": "Coinbase", "name": "", "email": "brittany.green@coinbase.com", "note": "", "linkedin": "", "inferred": true},
  {"company": "The Trade Desk", "name": "", "email": "tracy.perlongo@thetradedesk.com", "note": "", "linkedin": "https://www.linkedin.com/in/tracy-perlongo-deschenes-65b2b1/", "inferred": true},
  {"company": "LinkedIn", "name": "", "email": "jecook@linkedin.com", "note": "Lesbian In Tech - just connect and reach out to him", "linkedin": "https://www.linkedin.com/in/jeffscook/", "inferred": false},
  {"company": "Expedia", "name": "", "email": "manrsingh@expediagroup.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "Graditude", "name": "", "email": "steven.adelberg@graditudeconnects.org", "note": "", "linkedin": "", "inferred": false},
  {"company": "Autodesk", "name": "", "email": "jason.lu@autodesk.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "PIMCO", "name": "", "email": "annie.orlich@pimco.com", "note": "", "linkedin": "https://linkedin.com/in/annie-orlich", "inferred": false},
  {"company": "LinkSquares", "name": "", "email": "barry@linksquares.com", "note": "", "linkedin": "https://www.linkedin.com/in/barrysylvia/", "inferred": false},
  {"company": "VecFlow AI", "name": "", "email": "founders@vecflow.ai", "note": "", "linkedin": "", "inferred": false},
  {"company": "Datadog", "name": "", "email": "hayley.biason@datadoghq.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "AMD", "name": "", "email": "christy.jackson@amd.com", "note": "", "linkedin": "", "inferred": true},
  {"company": "Amazon", "name": "", "email": "tarturkt@amazon.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "Dropbox", "name": "", "email": "jcarranza@dropbox.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "Jane Street", "name": "Alyssa Placa", "email": "aplaca@recruiting.janestreet.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "Goldman Sachs", "name": "", "email": "glenmar.molina@gs.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "Goldman Sachs", "name": "", "email": "katie.dewald@gs.com", "note": "", "linkedin": "", "inferred": true},
  {"company": "Goldman Sachs", "name": "", "email": "gscampusengineering@ny.email.gs.com", "note": "", "linkedin": "", "inferred": true},
  {"company": "Goldman Sachs", "name": "", "email": "gscampusengineering@gs.com", "note": "", "linkedin": "", "inferred": true},
  {"company": "Two Sigma", "name": "Helen", "email": "helen.yip@twosigma.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "Niantic", "name": "", "email": "kaleywilson@nianticlabs.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "Bank of America", "name": "", "email": "camila.camargo@bofa.com", "note": "", "linkedin": "", "inferred": true},
  {"company": "Akamai", "name": "", "email": "jgath@akamai.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "Google", "name": "Estelle D. Williams", "email": "estellew@google.com", "note": "", "linkedin": "https://www.linkedin.com/in/estelle-d-williams-she-her-637a9238/", "inferred": false},
  {"company": "Google", "name": "Bryan Radziewski", "email": "radziewski@google.com", "note": "", "linkedin": "https://www.linkedin.com/in/bryanradziewski/", "inferred": true},
  {"company": "Google", "name": "", "email": "defaria@google.com", "note": "", "linkedin": "https://www.linkedin.com/in/juliana-defaria/", "inferred": true},
  {"company": "State Street", "name": "", "email": "elemire@statestreet.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "Morgan Stanley", "name": "", "email": "itcolrec@morganstanley.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "Duolingo", "name": "", "email": "micheller@duolingo.com", "note": "", "linkedin": "", "inferred": true},
  {"company": "eBay", "name": "", "email": "valramirez@ebay.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "GoDaddy", "name": "", "email": "scampos@godaddy.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "UiPath", "name": "", "email": "stacey.goldman@uipath.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "BlackRock", "name": "", "email": "tamera.johnson@blackrock.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "BlackRock", "name": "", "email": "michael.herzberg@blackrock.com", "note": "", "linkedin": "", "inferred": true},
  {"company": "BlackRock", "name": "", "email": "jackson.hambridge@blackrock.com", "note": "", "linkedin": "", "inferred": true},
  {"company": "Affirm", "name": "", "email": "amanda.ballesteros@affirm.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "Tesla", "name": "", "email": "twesolowski@tesla.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "PayPal", "name": "", "email": "tikirby@paypal.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "PayPal", "name": "Kellyn Creese", "email": "kcreese@talent.paypal.com", "note": "", "linkedin": "", "inferred": true},
  {"company": "Verkada", "name": "", "email": "christine.higgins@verkada.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "Asana", "name": "", "email": "andiesummers@asana.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "Databricks", "name": "", "email": "katie.tenboer@databricks.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "HubSpot", "name": "", "email": "lgomez@hubspot.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "HubSpot", "name": "", "email": "cverdugo@hubspot.com", "note": "New grad", "linkedin": "", "inferred": true},
  {"company": "Red Hat", "name": "", "email": "nsalazar@redhat.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "AppFolio", "name": "", "email": "noah.argao@appfolio.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "Mercedes-Benz", "name": "", "email": "kimberly.birch@mercedes-benz.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "Oracle", "name": "", "email": "casey.medina@oracle.com", "note": "", "linkedin": "", "inferred": true},
  {"company": "Snap", "name": "", "email": "lforghani@snapchat.com", "note": "", "linkedin": "", "inferred": true},
  {"company": "Airbnb", "name": "Jessica Hernandez", "email": "jess.hernandez@airbnb.com", "note": "", "linkedin": "", "inferred": false},
  {"company": "Appian", "name": "Madison Nordyke", "email": "madison.nordyke@appian.com", "note": "", "linkedin": "", "inferred": false}
];

/**
 * Append the owner's recruiter list to Contacts (manual), skipping every address
 * already on either contacts tab. With `dryRun` it writes nothing and only
 * reports: which addresses already exist (tab and row), which would be added,
 * and where a company already has a seed spelling that differs from ours — the
 * seed spelling wins, so the new row groups with the employer it already has.
 * `hold` lists addresses left out for the owner to decide — a person already on
 * file under a different address, where appending would make them plannable twice.
 */
function importOwnerRecruiterSheet20260923(dryRun, hold) {
  var held = {};
  (hold || []).forEach(function (email) { held[String(email).toLowerCase()] = true; });
  var book = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var manual = book.getSheetByName(TAB_CONTACTS_MANUAL);
  if (!manual) throw new Error('Contacts (manual) is missing.');

  var seenAt = {}, companyByKey = {};
  [TAB_CONTACTS_SEED, TAB_CONTACTS_MANUAL].forEach(function (name) {
    var sheet = book.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 2) return;
    sheet.getRange(2, 1, sheet.getLastRow() - 1, C_WIDTH).getValues().forEach(function (row, i) {
      var email = outreachCell_(row, C_EMAIL).toLowerCase();
      if (email) (seenAt[email] = seenAt[email] || []).push(
        name + ':' + (i + 2) + ' ' + outreachCell_(row, C_COMPANY) + ' / ' + outreachCell_(row, C_NAME));
      var company = outreachCell_(row, C_COMPANY);
      if (company && !companyByKey[outreachNameKey_(company)]) companyByKey[outreachNameKey_(company)] = company;
    });
  });

  var rows = [], added = [], existing = [], heldBack = [], respelled = [], newCompanies = {};
  OWNER_RECRUITER_SHEET_20260923_.forEach(function (person) {
    var email = person.email.toLowerCase();
    if (seenAt[email]) { existing.push(email + '\t' + seenAt[email].join(' + ')); return; }
    if (held[email]) { heldBack.push(email); return; }
    var company = companyByKey[outreachNameKey_(person.company)] || person.company;
    if (company !== person.company) respelled.push(person.company + ' -> ' + company);
    if (!companyByKey[outreachNameKey_(person.company)]) newCompanies[company] = true;
    var from = 'Owner recruiter sheet 17KnCR… gid 165100402 — imported 2026-09-23' +
      (person.inferred ? '; company inferred from domain' : '') +
      (person.note ? '; note: ' + person.note : '') +
      (person.linkedin ? '; ' + person.linkedin : '');
    var row = new Array(C_WIDTH).fill('');
    row[C_COMPANY - 1] = company;
    row[C_NAME - 1] = person.name;
    row[C_EMAIL - 1] = email;
    row[C_FROM - 1] = from;
    rows.push(row);
    added.push(company + '\t' + email + '\t' + person.name);
    seenAt[email] = ['this import'];
  });

  if (!dryRun && rows.length) {
    manual.getRange(manual.getLastRow() + 1, 1, rows.length, C_WIDTH).setValues(rows);
  }
  return {dryRun: !!dryRun, total: OWNER_RECRUITER_SHEET_20260923_.length,
          existing: existing, held: heldBack, added: added, respelled: respelled,
          companiesNotYetOnFile: Object.keys(newCompanies)};
}

// The 59 addresses the 2026-09-23 import appended; the other 11 were already on
// file or held for the owner, and are not part of any wave built from the import.
var OWNER_RECRUITER_SHEET_20260923_HELD_ = [
  'jgath@akamai.com', 'kcreese@talent.paypal.com', 'andiesummers@asana.com'
];
var OWNER_RECRUITER_SHEET_20260923_ALREADY_ON_FILE_ = [
  'jessica.woo@doordash.com', 'bfeicho@twilio.com', 'helen.yip@twosigma.com',
  'radziewski@google.com', 'amanda.ballesteros@affirm.com',
  'christine.higgins@verkada.com', 'katie.tenboer@databricks.com', 'casey.medina@oracle.com'
];

function ownerRecruiterSheet20260923Appended_() {
  var skip = {};
  OWNER_RECRUITER_SHEET_20260923_HELD_.concat(OWNER_RECRUITER_SHEET_20260923_ALREADY_ON_FILE_)
    .forEach(function (email) { skip[email] = true; });
  return OWNER_RECRUITER_SHEET_20260923_.filter(function (person) { return !skip[person.email]; });
}

/**
 * Read-only: for every employer among the appended recruiters, the App rows at
 * that employer, whether each still qualifies (Applied / Completed OA), and the
 * Gmail rejection preflight for the qualifying ones. Nothing is written.
 */
function diagnoseOwnerRecruiterSheet20260923Applications() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var apps = targetMirrorApplications_(tracker);
  var candidates = outreachGmailApiRejectionCandidates_();
  var byCompany = {};
  ownerRecruiterSheet20260923Appended_().forEach(function (person) {
    (byCompany[person.company] = byCompany[person.company] || []).push(person.email);
  });
  return Object.keys(byCompany).sort().map(function (company) {
    var tokens = outreachCompanyTokens_(company);
    var rows = apps.filter(function (app) {
      return app.company && outreachSameEmployer_(outreachCompanyTokens_(app.company), tokens);
    }).map(function (app) {
      var line = [app.rowNumber, app.company, app.role, app.process || '(blank)',
        app.dateApplied ? Utilities.formatDate(app.dateApplied, 'America/New_York', 'yyyy-MM-dd') : '',
        app.official || app.link || ''];
      if (outreachQualifies_(app.process)) {
        var rejection = outreachGmailApiRejectedTarget_(
          {company: app.company, role: app.role, jobLink: app.official || app.link}, candidates);
        line.push(rejection.rejected ? 'REJECTED ' + rejection.why : 'clear');
      }
      return line.join(' | ');
    });
    return {company: company, recruiters: byCompany[company].length, apps: rows};
  });
}

// The live application each appended recruiter is written about: the most recent
// Applied / Completed OA row at that employer on 2026-09-23 (Microsoft uses the
// Edge posting because two of the three CoreAI locations are already rejected).
// Rippling is left out at the owner's request; employers with no active
// application, or only rejected ones, get no wave.
var OWNER_SHEET_WAVE_APPLICATIONS_20260923_ = {
  'Adobe': {role: '2027 Intern - Software Engineer',
    jobLink: 'https://careers.adobe.com/us/en/job/R171666/2027-Intern-Software-Engineer?jr_id=6a99bd37ad752e2ad55018ea'},
  'Amazon': {role: 'Software Development Engineer Internship - Summer -2027 (USA)',
    jobLink: 'https://www.amazon.jobs/en/jobs/10552937/software-development-engineer-internship-summer-2027-usa'},
  'Coinbase': {role: 'Software Engineer Intern',
    jobLink: 'https://job-boards.greenhouse.io/embed/job_app?token=8168315&for=coinbase&utm_source=Simplify&gh_src=Simplify'},
  'Datadog': {role: 'Software Engineering Intern',
    jobLink: 'https://careers.datadoghq.com/detail/8052118/?gh_jid=8052118'},
  'DoorDash': {role: 'Software Engineer, Intern (Summer 2027) - US',
    jobLink: 'https://job-boards.greenhouse.io/doordashusa/jobs/8171041'},
  'Dropbox': {role: 'Software Engineering Intern (Summer 2027)',
    jobLink: 'https://www.dropbox.jobs/en/jobs/apply/?id=8106224'},
  'GoDaddy': {role: 'AI4All - Summer 2027 Internships',
    jobLink: 'https://job-boards.greenhouse.io/eventsandinterns/jobs/7982663003'},
  'Goldman Sachs': {role: '2027 Summer Analyst Program - Engineering',
    jobLink: 'https://hdpc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/LateralHiring/my-profile/sign-in'},
  'Google': {role: 'Software Engineering Intern, BS, Summer 2027',
    jobLink: 'https://www.google.com/about/careers/applications/jobs/results/85564713261245126-software-engineering-intern-bs-summer-2027'},
  'Microsoft': {role: 'AI Software Engineering Intern - Edge',
    jobLink: 'https://microsoft.eightfold.ai/careers/job/1970393556979054?domain=microsoft.com'},
  'NVIDIA': {role: 'Software Engineering Intern',
    jobLink: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/NVIDIA-2027-Internships--Software-Engineering_JR2023495?utm_source=Simplify&ref=Simplify'},
  'PIMCO': {role: '2027 Summer Intern - Technology Analyst, Software Engineering',
    jobLink: 'https://pimco.wd1.myworkdayjobs.com/pimco-careers/job/Austin-TX-USA/XMLNAME-2027-Summer-Intern---Technology-Analyst--Software-Engineering_R106745'},
  'Palantir': {role: 'Software Engineer Intern, Production Infrastructure (Summer 2027, grad 2028)',
    jobLink: 'https://jobs.lever.co/palantir/373367a9-3160-49d8-b7af-2efec062fad1'},
  'PayPal': {role: 'Software Engineer Intern',
    jobLink: 'https://paypal.wd1.myworkdayjobs.com/en-US/jobs/job/Software-Engineer-Intern_R0137285'},
  'Tesla': {role: 'Internship, Software Engineering, People Products (Summer 2027)',
    jobLink: 'https://www.tesla.com/careers/search/job/284004?ref=jobbys.vercel.app&utm_source=jobbys.vercel.app'}
};

// Owner asked for the whole wave today and tomorrow, before 14:00 ET, with the
// daily capacity waived. Split 12/12; a company with several new recruiters is
// spread over both days.
var OWNER_SHEET_WAVE_DAYS_20260923_ = [
  {key: 'TARGET_RECRUITER_CAMPAIGN_20260923_OWNER_SHEET', startIso: '2026-09-23T11:40:00-04:00',
   emails: ['cfelix@adobe.com', 'tarturkt@amazon.com', 'laldape@nvidia.com',
            'ajordan@palantir.com', 'twesolowski@tesla.com', 'victoria.mackey@coinbase.com',
            'estellew@google.com', 'glenmar.molina@gs.com', 'katie.dewald@gs.com',
            'tamiwilbur@microsoft.com', 'moanonuevo@microsoft.com', 'elizabeth.rutledge@microsoft.com']},
  {key: 'TARGET_RECRUITER_CAMPAIGN_20260924_OWNER_SHEET', startIso: '2026-09-24T09:00:00-04:00',
   emails: ['hayley.biason@datadoghq.com', 'alexandra.graw@ext.doordash.com', 'jcarranza@dropbox.com',
            'scampos@godaddy.com', 'annie.orlich@pimco.com', 'tikirby@paypal.com',
            'brittany.green@coinbase.com', 'defaria@google.com',
            'gscampusengineering@ny.email.gs.com', 'gscampusengineering@gs.com',
            'v-tonnguyen@microsoft.com', 'v-coupeavy@microsoft.com']}
];

// Greeting names for rows the owner's sheet left unnamed: the given name when
// the address is plainly first.last, or when the sheet's own LinkedIn URL names
// the person. Used for the greeting only; Contacts (manual) keeps what the sheet gave.
var OWNER_SHEET_WAVE_GREETINGS_20260923_ = {
  'victoria.mackey@coinbase.com': 'Victoria', 'brittany.green@coinbase.com': 'Brittany',
  'hayley.biason@datadoghq.com': 'Hayley', 'alexandra.graw@ext.doordash.com': 'Alexandra',
  'glenmar.molina@gs.com': 'Glenmar', 'katie.dewald@gs.com': 'Katie',
  'defaria@google.com': 'Juliana', 'elizabeth.rutledge@microsoft.com': 'Elizabeth',
  'annie.orlich@pimco.com': 'Annie'
};

/**
 * Queue the owner-sheet recruiter wave as two direct Target recruiter campaigns
 * on the shared trigger. Each employer's application is re-checked against App
 * (exact link, still Applied / Completed OA) and the Gmail rejection preflight
 * before any state is written; the delivery tick repeats the rejection check.
 */
function scheduleOwnerSheetRecruiterWave20260923() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var apps = targetMirrorApplications_(tracker);
  var candidates = outreachGmailApiRejectionCandidates_();
  var companyOf = {};
  ownerRecruiterSheet20260923Appended_().forEach(function (person) { companyOf[person.email] = person.company; });

  Object.keys(OWNER_SHEET_WAVE_APPLICATIONS_20260923_).forEach(function (company) {
    var spec = OWNER_SHEET_WAVE_APPLICATIONS_20260923_[company];
    var live = apps.filter(function (app) {
      return String(app.official || app.link || '') === spec.jobLink && outreachQualifies_(app.process);
    });
    if (live.length !== 1) throw new Error(company + ': expected one active application; found ' + live.length + '.');
    var rejection = outreachGmailApiRejectedTarget_({company: company, role: spec.role, jobLink: spec.jobLink}, candidates);
    if (rejection.rejected) throw new Error(company + ': Gmail rejection preflight blocked (' + rejection.why + ').');
  });

  var props = PropertiesService.getScriptProperties();
  return OWNER_SHEET_WAVE_DAYS_20260923_.map(function (day) {
    var companies = [], seen = {};
    day.emails.forEach(function (email) {
      var company = companyOf[email];
      if (!company || !OWNER_SHEET_WAVE_APPLICATIONS_20260923_[company]) {
        throw new Error(email + ' is not an appended recruiter at an employer in this wave.');
      }
      if (seen[company]) { seen[company].maxContacts++; return; }
      seen[company] = {company: company, maxContacts: 1,
        role: OWNER_SHEET_WAVE_APPLICATIONS_20260923_[company].role,
        jobLink: OWNER_SHEET_WAVE_APPLICATIONS_20260923_[company].jobLink};
      companies.push(seen[company]);
    });
    var result = scheduleTargetRecruiterCampaign_({
      propertyKey: day.key, handler: 'runTargetRecruiterSharedTick_', reuseExistingTrigger: true,
      label: 'Owner-sheet recruiters', startIso: day.startIso,
      spacingMinutes: 6, minGapMinutes: 5, exactContacts: day.emails.length,
      includeEmails: day.emails, companies: companies
    });
    var state = JSON.parse(props.getProperty(day.key));
    var named = 0;
    state.entries.forEach(function (entry) {
      var greeting = OWNER_SHEET_WAVE_GREETINGS_20260923_[entry.email];
      if (!entry.name && greeting) { entry.name = greeting; named++; }
    });
    props.setProperty(day.key, JSON.stringify(state));
    result.greetingNamesAdded = named;
    return result;
  });
}

/**
 * Owner call-off: cancel every still-pending entry for the named employers in
 * both owner-sheet wave campaigns. Sent entries are left as they are.
 */
function cancelOwnerSheetRecruiterWaveCompanies(companies, reason) {
  var names = {};
  (companies || []).forEach(function (company) { names[company] = true; });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var result = OWNER_SHEET_WAVE_DAYS_20260923_.map(function (day) {
      var state = JSON.parse(props.getProperty(day.key));
      var cancelled = [], alreadyDone = [];
      state.entries.forEach(function (entry) {
        if (!names[entry.company]) return;
        if (entry.status !== 'pending') { alreadyDone.push(entry.company + ' ' + entry.status); return; }
        entry.status = 'cancelled';
        entry.completedAt = new Date().toISOString();
        entry.error = 'Cancelled by owner: ' + (reason || 'called off');
        cancelled.push(entry.company + ' ' + entry.email);
      });
      if (!state.entries.some(function (entry) { return entry.status === 'pending'; })) {
        state.status = 'complete';
        state.completedAt = new Date().toISOString();
      }
      props.setProperty(day.key, JSON.stringify(state));
      return {key: day.key, cancelled: cancelled, notPending: alreadyDone};
    });
    try { refreshTargetQueueTabs_(); }
    catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
    return result;
  } finally {
    lock.releaseLock();
  }
}
