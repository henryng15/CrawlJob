// Explicit Target campaigns requested on 2026-09-13.
//
// This file has the narrow exception to the Contacts (manual) hand-entry rule:
// each listed address was found with the user's authorized Hunter account, has
// a valid Hunter verdict, and is appended only after an explicit user request.
// The generated Contacts (seed) export never writes this tab.

var TARGET_PRIORITY_HUNTER_RECRUITERS_ = [
  {company: 'Anduril', name: 'Brittney Tighe', email: 'btighe@anduril.com',
   role: 'Emerging Talent Manager (Technical)', focus: 'university'},
  {company: 'Anduril', name: 'Victoria Hillis', email: 'vhillis@anduril.com',
   role: 'Technical Talent Acquisition Recruiter — Software Engineering', focus: ''},
  {company: 'Anduril', name: 'Miles Petricone', email: 'mpetricone@anduril.com',
   role: 'Technical Recruiter — Engineering', focus: ''},
  {company: 'Anduril', name: 'Ethan Scharf', email: 'escharf@anduril.com',
   role: 'Technical Talent Acquisition Partner — Software Engineering', focus: ''},
  {company: 'Anduril', name: 'Stephanie Nguyen', email: 'snguyen@anduril.com',
   role: 'Early Career Technical Recruiter — Engineering Internships', focus: 'university'},
  {company: 'Notion', name: 'Gabri Posard', email: 'gabriele@makenotion.com',
   role: 'Technical Recruiter', focus: ''},
  {company: 'Notion', name: 'Christopher Magalotti', email: 'christopher@makenotion.com',
   role: 'Technical Recruiter', focus: ''},
  {company: 'Notion', name: 'Marie Fuchslin', email: 'marie@makenotion.com',
   role: 'Senior Technical Recruiter', focus: ''},
  {company: 'Notion', name: 'Shivani Patel', email: 'shivani@makenotion.com',
   role: 'University Recruiter and Program Manager', focus: 'university'},
  {company: 'Notion', name: 'Maria Gorecki', email: 'mgorecki@makenotion.com',
   role: 'Technical Recruiter', focus: ''}
];

/**
 * Append only user-approved, Hunter-validated recruiters to the protected
 * manual tab. Existing seed or manual contacts win and are never rewritten.
 */
function appendTargetPriorityHunterRecruiters_() {
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var known = {};
  outreachReadContacts_(contactsBook).forEach(function (contact) {
    known[contact.email] = true;
  });
  var sheet = contactsBook.getSheetByName(TAB_CONTACTS_MANUAL);
  if (!sheet) throw new Error('Contacts (manual) is missing.');
  var rows = [], added = [];
  TARGET_PRIORITY_HUNTER_RECRUITERS_.forEach(function (person) {
    var email = String(person.email).toLowerCase();
    if (known[email]) return;
    var row = new Array(C_WIDTH).fill('');
    row[C_COMPANY - 1] = person.company;
    row[C_NAME - 1] = person.name;
    row[C_EMAIL - 1] = email;
    row[C_ROLE - 1] = person.role;
    row[C_FOCUS - 1] = person.focus;
    row[C_VERIFY - 1] = 'valid';
    row[C_FROM - 1] = 'Hunter Email Finder — user approved 2026-09-13';
    rows.push(row);
    added.push({company: person.company, name: person.name, role: person.role});
    known[email] = true;
  });
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, C_WIDTH).setValues(rows);
  return {added: added, existing: TARGET_PRIORITY_HUNTER_RECRUITERS_.length - rows.length};
}

/** Schedule five new Lyft referral asks for 2026-09-15 without ambiguous Vietnamese greetings. */
function scheduleTargetReferralCampaign0915Lyft() {
  return scheduleTargetReferralCampaign_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260915_LYFT',
    handler: 'runTargetReferralCampaignTick0915Lyft_',
    startIso: '2026-09-15T13:00:00-04:00',
    spacingMinutes: 9,
    minGapMinutes: 8,
    excludeEmails: targetReferralCampaignEmails_('TARGET_REFERRAL_CAMPAIGN_20260911_LYFT', 'Lyft'),
    // The first candidates contain names requiring a Vietnamese-copy decision.
    // This requested five-person wave selects the next five unambiguous names.
    excludeNames: ['Bao Tran', 'Brian Nguyen', 'Christopher Nguyen', 'Hoai An Phan', 'Josh Tran'],
    companies: [{
      company: 'Lyft', maxContacts: 5,
      role: 'Software Engineer Intern, Backend (Summer 2027)',
      jobLink: 'https://app.careerpuck.com/job-board/lyft/job/8767726002?gh_jid=8767726002'
    }]
  });
}

/** Schedule five Hunter-validated Anduril technical/early-career recruiters for 2026-09-15. */
function scheduleTargetRecruiterCampaign0915Anduril() {
  appendTargetPriorityHunterRecruiters_();
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260915_ANDURIL',
    handler: 'runTargetRecruiterCampaignTick0915Anduril_',
    label: 'Anduril',
    startIso: '2026-09-15T14:00:00-04:00',
    spacingMinutes: 6,
    minGapMinutes: 5,
    companies: [{
      company: 'Anduril', maxContacts: 5,
      role: '2027 Software Engineer Intern',
      jobLink: 'https://job-boards.greenhouse.io/embed/job_app?for=andurilindustries&jr_id=6a52dc25e726ec56126a4c9b&token=5148079007&utm_source=jobright'
    }]
  });
}

/** Schedule five Hunter-validated Notion technical/university recruiters for 2026-09-16. */
function scheduleTargetRecruiterCampaign0916Notion() {
  appendTargetPriorityHunterRecruiters_();
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260916_NOTION',
    handler: 'runTargetRecruiterCampaignTick0916Notion_',
    label: 'Notion',
    startIso: '2026-09-16T10:00:00-04:00',
    spacingMinutes: 6,
    minGapMinutes: 5,
    companies: [{
      company: 'Notion', maxContacts: 5,
      role: 'Software Engineer Intern (Summer 2027)',
      jobLink: 'https://jobs.ashbyhq.com/notion/3fba1c39-c5cb-47d7-9ad2-1cec4d7e9d0c/application'
    }]
  });
}

/** Direct Target delivery tick for the 2026-09-15 Lyft referral campaign. */
function runTargetReferralCampaignTick0915Lyft_() {
  return runTargetReferralCampaignTickFor_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260915_LYFT',
    handler: 'runTargetReferralCampaignTick0915Lyft_'
  });
}

/** Direct Target delivery tick for the 2026-09-15 Anduril recruiter campaign. */
function runTargetRecruiterCampaignTick0915Anduril_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260915_ANDURIL',
    handler: 'runTargetRecruiterCampaignTick0915Anduril_'
  });
}

/** Direct Target delivery tick for the 2026-09-16 Notion recruiter campaign. */
function runTargetRecruiterCampaignTick0916Notion_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260916_NOTION',
    handler: 'runTargetRecruiterCampaignTick0916Notion_'
  });
}
