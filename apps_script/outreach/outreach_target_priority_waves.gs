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

/** Schedule the seven remaining Palantir campus/technical recruiter emails for 2026-09-17. */
function scheduleTargetRecruiterCampaign0917Palantir() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260917_PALANTIR',
    handler: 'runTargetRecruiterCampaignTick0917Palantir_',
    label: 'Palantir',
    startIso: '2026-09-17T11:00:00-04:00',
    spacingMinutes: 6,
    minGapMinutes: 5,
    companies: [{
      company: 'Palantir', maxContacts: 7,
      role: 'Software Engineer Intern, Production Infrastructure (Summer 2027, grad 2028)',
      jobLink: 'https://jobs.lever.co/palantir/373367a9-3160-49d8-b7af-2efec062fad1'
    }]
  });
}

/** Schedule two unambiguous Lockheed Martin referral asks for 2026-09-15. */
function scheduleTargetReferralCampaign0915LockheedMartin() {
  return scheduleTargetReferralCampaign_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260915_LOCKHEED_MARTIN',
    handler: 'runTargetReferralCampaignTick0915LockheedMartin_',
    startIso: '2026-09-15T15:00:00-04:00',
    spacingMinutes: 9,
    minGapMinutes: 8,
    // Preserve pure-Vietnamese contacts for a separate owner-reviewed run.
    excludeNames: ['David Nguyen', 'John Nguyen', 'Thomas Pham'],
    companies: [{
      company: 'Lockheed Martin', maxContacts: 2,
      role: 'Winter 2027 Co-op - Software Developer (International Program Team)',
      jobLink: 'https://jobright.ai/jobs/info/6aa38cea959a10d7230d2543?utm_campaign=1079&utm_source=git'
    }]
  });
}

/** Schedule every currently sendable Lockheed Martin recruiter one week after its referral wave. */
function scheduleTargetRecruiterCampaign0922LockheedMartin() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260922_LOCKHEED_MARTIN',
    handler: 'runTargetRecruiterCampaignTick0922LockheedMartin_',
    label: 'Lockheed Martin',
    startIso: '2026-09-22T09:00:00-04:00',
    spacingMinutes: 6,
    minGapMinutes: 5,
    companies: [{
      company: 'Lockheed Martin', maxContacts: 5,
      role: 'Winter 2027 Co-op - Software Developer (International Program Team)',
      jobLink: 'https://jobright.ai/jobs/info/6aa38cea959a10d7230d2543?utm_campaign=1079&utm_source=git'
    }]
  });
}

/** Schedule seven Datadog recruiter emails after the existing September 16 waves. */
function scheduleTargetRecruiterCampaign0916Datadog() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260916_DATADOG',
    handler: 'runTargetRecruiterCampaignTick0916Datadog_',
    label: 'Datadog', startIso: '2026-09-16T11:00:00-04:00',
    spacingMinutes: 6, minGapMinutes: 5,
    companies: [{company: 'Datadog', maxContacts: 7,
      role: 'Software Engineering Intern (Summer)',
      jobLink: 'https://careers.datadoghq.com/detail/8052118/?gh_jid=8052118'}]
  });
}

/** Schedule seven Scale AI recruiter emails after the existing September 17 waves. */
function scheduleTargetRecruiterCampaign0917ScaleAi() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260917_SCALE_AI',
    handler: 'runTargetRecruiterSharedTick_', reuseExistingTrigger: true,
    label: 'Scale AI', startIso: '2026-09-17T12:00:00-04:00',
    spacingMinutes: 6, minGapMinutes: 5,
    companies: [{company: 'Scale AI', maxContacts: 7,
      role: 'Software Engineering Intern (Summer 2027)',
      jobLink: 'https://job-boards.greenhouse.io/scaleai/jobs/4730845005/'}]
  });
}

/** Schedule seven Vercel recruiter emails on the next available weekday. */
function scheduleTargetRecruiterCampaign0918Vercel() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260918_VERCEL',
    handler: 'runTargetRecruiterSharedTick_', reuseExistingTrigger: true,
    label: 'Vercel', startIso: '2026-09-18T09:00:00-04:00',
    spacingMinutes: 6, minGapMinutes: 5,
    companies: [{company: 'Vercel', maxContacts: 7,
      role: 'Software Engineering Intern - Summer 27',
      jobLink: 'https://job-boards.greenhouse.io/vercel/jobs/6181759004?gh_src=Simplify'}]
  });
}

/** Schedule seven Dropbox recruiter emails on the following Monday. */
function scheduleTargetRecruiterCampaign0921Dropbox() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260921_DROPBOX',
    handler: 'runTargetRecruiterSharedTick_', reuseExistingTrigger: true,
    label: 'Dropbox', startIso: '2026-09-21T09:00:00-04:00',
    spacingMinutes: 6, minGapMinutes: 5,
    companies: [{company: 'Dropbox', maxContacts: 7,
      role: 'Software Engineering Intern (Summer 2027)',
      jobLink: 'https://www.dropbox.jobs/en/jobs/apply/?id=8106224'}]
  });
}

/** Schedule seven Lyft recruiter emails after the Lockheed Martin recruiter wave. */
function scheduleTargetRecruiterCampaign0922Lyft() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260922_LYFT',
    handler: 'runTargetRecruiterSharedTick_', reuseExistingTrigger: true,
    label: 'Lyft', startIso: '2026-09-22T10:00:00-04:00',
    spacingMinutes: 6, minGapMinutes: 5,
    companies: [{company: 'Lyft', maxContacts: 7,
      role: 'Software Engineer Intern, Backend (Summer 2027)',
      jobLink: 'https://app.careerpuck.com/job-board/lyft/job/8767726002?gh_jid=8767726002'}]
  });
}

/** Schedule seven Mastercard recruiter emails on September 23. */
function scheduleTargetRecruiterCampaign0923Mastercard() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260923_MASTERCARD',
    handler: 'runTargetRecruiterSharedTick_', reuseExistingTrigger: true,
    label: 'Mastercard', startIso: '2026-09-23T09:00:00-04:00',
    spacingMinutes: 6, minGapMinutes: 5,
    companies: [{company: 'Mastercard', maxContacts: 7,
      role: 'Software Engineer Intern, Summer 2027 – United States',
      jobLink: 'https://mastercard.wd1.myworkdayjobs.com/campusapplyonly/job/OFallon-Missouri/Software-Engineer-Intern--Summer-2027---United-States_R-287618?jr_id=6a889bbdd34f700f87fc97ff'}]
  });
}

/** Schedule the earliest safe Walmart referral wave, excluding ambiguous Vietnamese greetings. */
function scheduleTargetReferralCampaign0915Walmart() {
  return scheduleTargetReferralCampaign_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260915_WALMART',
    handler: 'runTargetReferralCampaignTick0915Walmart_',
    startIso: '2026-09-15T16:00:00-04:00',
    spacingMinutes: 9, minGapMinutes: 8,
    excludeNames: ['An Tran', 'Huynh Le'],
    vietnameseOverridesByName: {
      'Duc Nguyen': {name: 'Duc', title: 'anh', variant: 1},
      'Luan Nguyen': {name: 'Luan', title: 'anh', variant: 2},
      'Nhi Nguyen, CPWA': {name: 'Nhi', title: 'chị', variant: 3}
    },
    companies: [{company: 'Walmart', maxContacts: 10,
      role: 'Summer 2027 Intern:: Software Engineer II',
      jobLink: 'https://walmart.wd504.myworkdayjobs.com/en-US/WalmartExternal/job/Summer-2027-Intern---Software-Engineer-II_R-2630029-1'}]
  });
}

/** Schedule seven Walmart recruiter emails exactly one week after its referral wave. */
function scheduleTargetRecruiterCampaign0922Walmart() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260922_WALMART',
    handler: 'runTargetRecruiterSharedTick_', reuseExistingTrigger: true,
    label: 'Walmart', startIso: '2026-09-22T11:00:00-04:00',
    spacingMinutes: 6, minGapMinutes: 5,
    companies: [{company: 'Walmart', maxContacts: 7,
      role: 'Summer 2027 Intern:: Software Engineer II',
      jobLink: 'https://walmart.wd504.myworkdayjobs.com/en-US/WalmartExternal/job/Summer-2027-Intern---Software-Engineer-II_R-2630029-1'}]
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

/** Direct Target delivery tick for the 2026-09-17 Palantir recruiter campaign. */
function runTargetRecruiterCampaignTick0917Palantir_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260917_PALANTIR',
    handler: 'runTargetRecruiterCampaignTick0917Palantir_'
  });
}

/** Direct Target delivery tick for the 2026-09-15 Lockheed Martin referral campaign. */
function runTargetReferralCampaignTick0915LockheedMartin_() {
  return runTargetReferralCampaignTickFor_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260915_LOCKHEED_MARTIN',
    handler: 'runTargetReferralCampaignTick0915LockheedMartin_'
  });
}

/** Direct Target delivery tick for the 2026-09-22 Lockheed Martin recruiter campaign. */
function runTargetRecruiterCampaignTick0922LockheedMartin_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260922_LOCKHEED_MARTIN',
    handler: 'runTargetRecruiterCampaignTick0922LockheedMartin_'
  });
}

/** Direct Target delivery tick for the 2026-09-16 Datadog recruiter campaign. */
function runTargetRecruiterCampaignTick0916Datadog_() {
  return runTargetRecruiterCampaignTickFor_({propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260916_DATADOG', handler: 'runTargetRecruiterCampaignTick0916Datadog_'});
}

/** Direct Target delivery tick for the 2026-09-17 Scale AI recruiter campaign. */
function runTargetRecruiterCampaignTick0917ScaleAi_() {
  return runTargetRecruiterCampaignTickFor_({propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260917_SCALE_AI', handler: 'runTargetRecruiterCampaignTick0917ScaleAi_'});
}

/** Direct Target delivery tick for the 2026-09-18 Vercel recruiter campaign. */
function runTargetRecruiterCampaignTick0918Vercel_() {
  return runTargetRecruiterCampaignTickFor_({propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260918_VERCEL', handler: 'runTargetRecruiterCampaignTick0918Vercel_'});
}

/** Direct Target delivery tick for the 2026-09-21 Dropbox recruiter campaign. */
function runTargetRecruiterCampaignTick0921Dropbox_() {
  return runTargetRecruiterCampaignTickFor_({propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260921_DROPBOX', handler: 'runTargetRecruiterCampaignTick0921Dropbox_'});
}

/** Direct Target delivery tick for the 2026-09-22 Lyft recruiter campaign. */
function runTargetRecruiterCampaignTick0922Lyft_() {
  return runTargetRecruiterCampaignTickFor_({propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260922_LYFT', handler: 'runTargetRecruiterCampaignTick0922Lyft_'});
}

/** Direct Target delivery tick for the 2026-09-23 Mastercard recruiter campaign. */
function runTargetRecruiterCampaignTick0923Mastercard_() {
  return runTargetRecruiterCampaignTickFor_({propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260923_MASTERCARD', handler: 'runTargetRecruiterCampaignTick0923Mastercard_'});
}

/** Direct Target delivery tick for the 2026-09-15 Walmart referral campaign. */
function runTargetReferralCampaignTick0915Walmart_() {
  return runTargetReferralCampaignTickFor_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260915_WALMART',
    handler: 'runTargetReferralCampaignTick0915Walmart_'
  });
}

/** Direct Target delivery fallback for the 2026-09-22 Walmart recruiter campaign. */
function runTargetRecruiterCampaignTick0922Walmart_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260922_WALMART',
    handler: 'runTargetRecruiterCampaignTick0922Walmart_'
  });
}
