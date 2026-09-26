/**
 * Owner-requested Spectrum university-recruiting wave for Wednesday 2026-09-30.
 *
 * Spectrum had no recruiter contacts, so on 2026-09-25 the three were sourced
 * through treg: Apollo and Crustdata for current University Relations /
 * University Programs staff, Kitt for the address, and BounceBan deepverify
 * (`deliverable`, score 99) with an invented control mailbox returning
 * `undeliverable`, which rules out a catch-all domain. Alex Cunningham, the
 * team's Senior University Relations Recruiter, is left out on purpose: that
 * address was emailed in November 2025 about a different role, and the
 * scheduler's Gmail history guard would drop it anyway.
 *
 * The Wednesday gap wave starts 09:00 ET at seven-minute spacing. A 09:10 start
 * with 21-minute spacing stays three minutes off that grid.
 */
var TARGET_RECRUITER_SPECTRUM_20260930_ = {
  propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260930_SPECTRUM',
  dayIso: '2026-09-30',
  startIso: '2026-09-30T09:10:00-04:00',
  company: 'Spectrum',
  role: '2027 Summer Intern: Software Developer',
  // The tracker has no official posting link for this application; the
  // jobright link is the application's identity key, not part of the email.
  jobLink: 'https://jobright.ai/jobs/info/6a9a0f12ad752e2ad55039e4?utm_campaign=1079&utm_source=git',
  roster: [
    {company: 'Spectrum', name: 'Alyssa Clendening', email: 'alyssa.clendening@spectrum.com',
     role: 'University Relations Program Lead', focus: 'university', verify: 'deliverable'},
    {company: 'Spectrum', name: 'Peyton Hammer', email: 'peyton.hammer@spectrum.com',
     role: 'Sr University Relations Program Specialist', focus: 'university', verify: 'deliverable'},
    {company: 'Spectrum', name: 'Megan Ludwig', email: 'megan.ludwig@spectrum.com',
     role: 'Manager of University Programs', focus: 'university', verify: 'deliverable'}
  ]
};

/** Add the three sourced Spectrum contacts and queue them for Wednesday morning. */
function scheduleTargetRecruiterCampaign0930Spectrum() {
  var spec = TARGET_RECRUITER_SPECTRUM_20260930_;
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
    throw new Error('Expected exactly one active Spectrum application for '
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

  var appended = appendApprovedManualRecruiters_(spec.roster,
    'treg Apollo/Crustdata + Kitt, BounceBan deepverify 99 — owner request 2026-09-25');
  var emails = spec.roster.map(function (person) { return person.email; });
  return {
    plannedForDay: planned,
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
