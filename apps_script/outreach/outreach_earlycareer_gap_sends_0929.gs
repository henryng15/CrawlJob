/**
 * outreach_earlycareer_gap_sends_0929.gs — the campus recruiters already on file but never written
 * to, sent from tonight through Thursday.
 *
 * Owner request on 2026-09-29: send the whole "on file, untouched" group this week, minus Cloudflare
 * and Shopify, starting tonight, three or four a day, finishing Thursday. The over-55 day limit is
 * waived for all of it.
 *
 * The group came from `diagnoseEarlyCareerCoverageForCompanies`: campus/early-career recruiters that
 * Contacts already holds, with no Gmail message to them. Nobody here needed finding or verifying —
 * each address was already researched into the seed, which is why this group could go out tonight
 * while the Accenture/Fidelity/Rivian wave needed a day of lookups.
 *
 * Cloudflare (Daisy Saenz, Trang Bi) and Shopify (Jennifer Clerici) are deliberately left out at
 * the owner's instruction.
 *
 * Roles are each company's newest active Applied row; every one passed
 * `diagnoseTargetCompanyRejectionPreflight` on 09-29. Qualcomm reuses the same application the
 * 10-01 follow-up file pins.
 */

var EARLYCAREER_GAP_0929_APPS_ = {
  McKinsey: {role: 'Software Engineer Intern - QuantumBlack, AI by McKinsey',
             jobLink: 'https://jobs.mckinsey.com/en_US/careers/JobApplicationReview?folderId=112343'},
  Qualcomm: {role: 'Software Engineering Internship - Summer 2027',
             jobLink: 'https://qualcomm.eightfold.ai/careers?jr_id=6aadbe8a2e757fcb5c8ba2ca&start=0&pid=446720740529&sort_by=timestamp'},
  'Dell Technologies': {role: 'Software Engineering Intern',
             jobLink: 'https://iawmqy.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/careers/job/297773?utm_source=Simplify&ref=Simplify'},
  Visa: {role: 'Software Engineer, Intern - 2027 Austin, TX',
             jobLink: 'https://visa.wd5.myworkdayjobs.com/en-US/Visa/job/Software-Engineer--Intern---2027-Austin--TX_REF088544W-1'},
  Walmart: {role: 'Summer 2027 Intern:: Software Engineer II',
             jobLink: 'https://walmart.wd504.myworkdayjobs.com/en-US/WalmartExternal/job/Summer-2027-Intern---Software-Engineer-II_R-2630029-1'},
  Cisco: {role: 'Software Engineer I (Intern) - United States',
             jobLink: 'https://careers.cisco.com/global/en/applythankyou?status=success&jobSeqNo=CISCISGLOBAL2025890EXTERNALENGLOBAL&jobTitle=Software%20Engineer%20I%20(Intern)%20-%20United%20States&jobId=2025890'}
};

var EARLYCAREER_GAP_0929_DAYS_ = [
  // Tonight. Late for a cold email, and the owner asked for it explicitly.
  {day: '2026-09-29', key: 'TARGET_RECRUITER_CAMPAIGN_20260929_EARLYCAREER_GAP',
   startIso: '2026-09-29T22:10:00-04:00', people: [
     {company: 'McKinsey', name: 'Katie Abbott', email: 'katie.abbott@mckinsey.com', role: 'campus recruiter'},
     {company: 'McKinsey', name: 'Nour Nafie', email: 'nour.nafie@mckinsey.com', role: 'campus recruiter'},
     {company: 'Qualcomm', name: 'Steph Savitz', email: 'ssavitz@qualcomm.com',
      role: 'Lead, Campus Recruiting & Intern Programs'}]},
  {day: '2026-09-30', key: 'TARGET_RECRUITER_CAMPAIGN_20260930_EARLYCAREER_GAP',
   startIso: '2026-09-30T15:30:00-04:00', people: [
     {company: 'Dell Technologies', name: 'Lexie Hluchanek', email: 'lexie.hluchanek@dell.com', role: 'campus recruiter'},
     {company: 'Dell Technologies', name: 'Manveena Singh', email: 'manveena_singh@dell.com',
      role: 'Global Operations Campus Recruiting Program Manager'},
     {company: 'Visa', name: 'Lisa Kappil', email: 'lkappil@visa.com', role: 'university recruiter'}]},
  {day: '2026-10-01', key: 'TARGET_RECRUITER_CAMPAIGN_20261001_EARLYCAREER_GAP',
   startIso: '2026-10-01T15:30:00-04:00', people: [
     {company: 'Walmart', name: 'Kenneth Burke', email: 'kenneth.burke@walmart.com', role: 'campus recruiter'},
     {company: 'Cisco', name: 'Matt Lorman', email: 'mlorman@cisco.com', role: 'early talent'}]}
];

/** Companies without an active Applied App row for the pinned role, or blocked by the preflight. */
function earlyCareerGap0929Blocked_() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var apps = targetMirrorApplications_(tracker);
  var blocked = {};
  Object.keys(EARLYCAREER_GAP_0929_APPS_).forEach(function (company) {
    var spec = EARLYCAREER_GAP_0929_APPS_[company];
    var live = apps.filter(function (app) {
      return outreachSameEmployer_(outreachCompanyTokens_(app.company), outreachCompanyTokens_(company))
        && outreachNameKey_(app.role) === outreachNameKey_(spec.role)
        && outreachQualifies_(app.process);
    });
    if (!live.length) { blocked[company] = 'no active Applied App row for the role'; return; }
    var preflight = diagnoseTargetCompanyRejectionPreflight(company, spec.role, spec.jobLink);
    if (preflight.blocked) blocked[company] = 'rejection preflight: ' + preflight.reason;
  });
  return blocked;
}

/**
 * Schedule the three days on the shared Target recruiter trigger. Every recipient is already a
 * Contacts row, so nothing is appended. A blocked company is dropped, not replaced. The day limit
 * is waived by the owner, so `acknowledgeOver55` defaults to on here and the day totals are
 * reported rather than enforced.
 */
function scheduleEarlyCareerGap20260929() {
  var blocked = earlyCareerGap0929Blocked_();
  var results = [];
  EARLYCAREER_GAP_0929_DAYS_.forEach(function (day) {
    var people = day.people.filter(function (person) { return !blocked[person.company]; });
    if (!people.length) { results.push({day: day.day, scheduled: 0}); return; }
    var dayTotal = diagnoseTargetMessagesForDay(day.day).target.target + people.length;
    var companies = [], seen = {};
    people.forEach(function (person) {
      if (seen[person.company]) { seen[person.company].maxContacts++; return; }
      var app = EARLYCAREER_GAP_0929_APPS_[person.company];
      seen[person.company] = {company: person.company, maxContacts: 1, role: app.role, jobLink: app.jobLink};
      companies.push(seen[person.company]);
    });
    var result = scheduleTargetRecruiterCampaign_({
      propertyKey: day.key, handler: 'runTargetRecruiterSharedTick_', reuseExistingTrigger: true,
      label: 'Early-career gap ' + day.day, startIso: day.startIso,
      spacingMinutes: 6, minGapMinutes: 5, exactContacts: people.length,
      includeEmails: people.map(function (person) { return person.email; }),
      companies: companies
    });
    results.push({day: day.day, dayTotal: dayTotal, result: result});
  });
  return {blocked: blocked, days: results};
}

/** Read-only: blocked companies and each day's planned recipients. Writes nothing. */
function previewEarlyCareerGap20260929() {
  var blocked = earlyCareerGap0929Blocked_();
  return {blocked: blocked, days: EARLYCAREER_GAP_0929_DAYS_.map(function (day) {
    return {day: day.day, start: day.startIso,
            dayTotalAfter: diagnoseTargetMessagesForDay(day.day).target.target
              + day.people.filter(function (person) { return !blocked[person.company]; }).length,
            people: day.people.filter(function (person) { return !blocked[person.company]; })
              .map(function (person) { return person.company + ': ' + person.name + ' <' + person.email + '> — ' + person.role; })};
  })};
}

/** Cancel every still-pending entry in the three campaigns. Safe to re-run. */
function cancelEarlyCareerGap20260929() {
  var props = PropertiesService.getScriptProperties(), cancelled = 0;
  EARLYCAREER_GAP_0929_DAYS_.forEach(function (day) {
    var text = props.getProperty(day.key);
    if (!text) return;
    var state = JSON.parse(text);
    (state.entries || []).forEach(function (entry) {
      if (entry.status === 'pending') { entry.status = 'cancelled'; entry.completedAt = new Date().toISOString(); cancelled++; }
    });
    state.status = 'complete';
    props.setProperty(day.key, JSON.stringify(state));
  });
  return {cancelled: cancelled};
}
