/**
 * Owner-requested General Motors recruiter wave for Tuesday 2026-09-29.
 *
 * Six technical / early-career recruiters, asked for on 2026-09-25 against the
 * Applied 2027 Summer Digital Product SWE internship. The Tuesday gap wave
 * holds 09:00-12:52 ET at eight-minute spacing, so these entries sit four
 * minutes off that grid (09:04-10:24 ET, sixteen minutes apart) instead of
 * competing for the same shared-tick minute.
 */
var TARGET_RECRUITER_GM_20260929_ = {
  propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260929_GENERAL_MOTORS',
  dayIso: '2026-09-29',
  startIso: '2026-09-29T09:04:00-04:00',
  company: 'General Motors',
  role: '2027 Summer Intern - Digital Product: Software Engineering',
  jobLink: 'https://generalmotors.wd5.myworkdayjobs.com/en-US/careers_gm/job/Warren-Michigan-United-States-of-America/XMLNAME-2027-Summer-Intern---Digital-Product--Software-Engineering_JR-202620546',
  // Seed rows carry debounce "Safe to Send"; the four manual rows were
  // BounceBan deepverify `deliverable`, score 99, on 2026-09-25.
  emails: [
    'sophia.jewell@gm.com',
    'donald.rose@gm.com',
    'drew.torkelson@gm.com',
    'isabella.wang@gm.com',
    'sheraz.hussain@gm.com',
    'rick.martin@gm.com'
  ]
};

/** Queue the six approved General Motors recruiter emails for Tuesday morning. */
function scheduleTargetRecruiterCampaign0929GeneralMotors() {
  var spec = TARGET_RECRUITER_GM_20260929_;
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
    throw new Error('Expected exactly one active General Motors application for '
      + spec.role + '; found ' + applications.length + '.');
  }
  var rejection = outreachGmailApiRejectedTarget_(spec);
  if (rejection.rejected) return {blocked: true, company: spec.company, role: spec.role, reason: rejection.why};

  // Exactly 55 is allowed; only a day above it needs the owner's acknowledgement.
  var day = diagnoseTargetMessagesForDay(spec.dayIso);
  var automatic = diagnoseAutomaticOutreachForDay(spec.dayIso);
  var planned = Number(day.target.target || 0) + Number(automatic.reportableAutomaticTotal || 0)
    + spec.emails.length;
  if (planned > 55) {
    throw new Error(spec.dayIso + ' would reach ' + planned
      + ' planned messages, above the 55-message threshold.');
  }

  return {
    plannedForDay: planned,
    campaign: scheduleTargetRecruiterCampaign_({
      propertyKey: spec.propertyKey,
      handler: 'runTargetRecruiterSharedTick_', reuseExistingTrigger: true,
      label: spec.company, startIso: spec.startIso,
      spacingMinutes: 16, minGapMinutes: 5, exactContacts: spec.emails.length,
      includeEmails: spec.emails,
      companies: [{company: spec.company, maxContacts: spec.emails.length,
        role: spec.role, jobLink: spec.jobLink}]
    })
  };
}
