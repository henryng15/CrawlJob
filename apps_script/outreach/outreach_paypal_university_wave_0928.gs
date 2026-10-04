/**
 * Owner-requested PayPal university-recruiting wave for Monday 2026-09-28.
 *
 * PayPal's earlier recruiter waves (2026-09-18) reached technical recruiters
 * only. paypal.com accepts all mail, so a BounceBan verdict proves nothing
 * there; the three were confirmed current and US-based through treg (Apollo
 * search, Crustdata profile) and their addresses taken from sources that name
 * the person: Apollo enrich `verified` for Kellyn Creese and Iris Lin, and a
 * crawled Tomba record carrying the matching LinkedIn and title for Heather
 * Myers. All three follow PayPal's dominant first-initial + last-name form.
 *
 * Three existing Contacts rows are retired with UNSENDABLE_VERIFY so no later
 * wave can pick them up: kellyn.creese@ (a second, unsupported address for the
 * same person), chaydon@ (now at CrowdStrike) and ssipani@ (APAC region).
 *
 * The Monday gap wave starts 09:00 ET at seven-minute spacing. A 09:10 start
 * with 21-minute spacing stays three minutes off that grid.
 */
var TARGET_RECRUITER_PAYPAL_20260928_ = {
  propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260928_PAYPAL_UNIVERSITY',
  dayIso: '2026-09-28',
  startIso: '2026-09-28T09:10:00-04:00',
  company: 'PayPal',
  role: 'Software Engineer Intern',
  jobLink: 'https://paypal.wd1.myworkdayjobs.com/en-US/jobs/job/Software-Engineer-Intern_R0137285',
  roster: [
    {company: 'PayPal', name: 'Kellyn Creese', email: 'kcreese@paypal.com',
     role: 'University Recruiter', focus: 'university', verify: 'apollo:verified'},
    {company: 'PayPal', name: 'Heather Myers', email: 'hmyers@paypal.com',
     role: 'Sr. Manager, Talent Acquisitions - University Programs', focus: 'university',
     verify: 'tomba:valid'},
    {company: 'PayPal', name: 'Iris Lin', email: 'irlin@paypal.com',
     role: 'Senior Recruiter - University Recruiting', focus: 'university', verify: 'apollo:verified'}
  ],
  retire: ['kellyn.creese@paypal.com', 'chaydon@paypal.com', 'ssipani@paypal.com']
};

/** Mark stale contact rows unsendable in both Contacts tabs. */
function retireUnsentContactRows_(emails) {
  var wanted = {};
  emails.forEach(function (email) { wanted[String(email).toLowerCase()] = true; });
  var book = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var retired = [];
  [TAB_CONTACTS_SEED, TAB_CONTACTS_MANUAL].forEach(function (tab) {
    var sheet = book.getSheetByName(tab);
    if (!sheet || sheet.getLastRow() < 2) return;
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, C_WIDTH).getValues();
    rows.forEach(function (row, index) {
      var email = String(row[C_EMAIL - 1] || '').trim().toLowerCase();
      if (!wanted[email] || row[C_VERIFY - 1] === UNSENDABLE_VERIFY) return;
      sheet.getRange(index + 2, C_VERIFY).setValue(UNSENDABLE_VERIFY);
      retired.push({tab: tab, email: email, previousVerify: row[C_VERIFY - 1]});
    });
  });
  return retired;
}

/** Add the three sourced PayPal contacts and queue them for Monday morning. */
function scheduleTargetRecruiterCampaign0928PayPalUniversity() {
  var spec = TARGET_RECRUITER_PAYPAL_20260928_;
  var existingText = PropertiesService.getScriptProperties().getProperty(spec.propertyKey);
  if (existingText) {
    return {alreadyStarted: true,
      state: summarizeTargetCampaignState_(JSON.parse(existingText), spec.company)};
  }

  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var applications = targetMirrorApplications_(tracker).filter(function (app) {
    return outreachSameEmployer_(outreachCompanyTokens_(app.company), outreachCompanyTokens_(spec.company))
      && outreachNameKey_(app.role) === outreachNameKey_(spec.role)
      && outreachQualifies_(app.process);
  });
  if (applications.length !== 1) {
    throw new Error('Expected exactly one active PayPal application for '
      + spec.role + '; found ' + applications.length + '.');
  }
  var rejection = outreachGmailApiRejectedTarget_(spec);
  if (rejection.rejected) return {blocked: true, company: spec.company, role: spec.role, reason: rejection.why};

  // Exactly 55 is allowed; only a day above it needs the owner's acknowledgement.
  var day = diagnoseTargetMessagesForDay(spec.dayIso);
  var automatic = diagnoseAutomaticOutreachForDay(spec.dayIso);
  var planned = Number(day.target.target || 0) + Number(automatic.reportableAutomaticTotal || 0)
    + spec.roster.length;
  if (planned > 55) {
    throw new Error(spec.dayIso + ' would reach ' + planned
      + ' planned messages, above the 55-message threshold.');
  }

  var retired = retireUnsentContactRows_(spec.retire);
  var appended = appendApprovedManualRecruiters_(spec.roster,
    'treg Apollo/Crustdata + Apollo enrich / Tomba (paypal.com is accept-all) — owner request 2026-09-26');
  var emails = spec.roster.map(function (person) { return person.email; });
  return {
    plannedForDay: planned,
    retired: retired,
    contacts: appended,
    campaign: scheduleTargetRecruiterCampaign_({
      propertyKey: spec.propertyKey,
      handler: 'runTargetRecruiterSharedTick_', reuseExistingTrigger: true,
      label: spec.company, startIso: spec.startIso,
      spacingMinutes: 21, minGapMinutes: 5, exactContacts: emails.length,
      includeEmails: emails,
      companies: [{company: spec.company, maxContacts: emails.length,
        role: spec.role, jobLink: spec.jobLink}]
    })
  };
}
