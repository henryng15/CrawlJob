/**
 * outreach_earlycareer_wave_0930.gs — two early-career recruiters each at Accenture, Fidelity and
 * Rivian, spread 09-30 to 10-02.
 *
 * Owner request on 2026-09-29: of the five firms with no campus contact on file — Persona, Replit,
 * Fidelity, Accenture, Rivian — find two early-career/campus/university recruiters each and send,
 * spread from today to Friday, with Friday's before noon.
 *
 * Today was already 20:25 ET when the list was finished, so "today" is Wednesday 09-30. Friday's
 * two go at 09:00 and 09:06 ET, inside the before-noon rule.
 *
 * Two of the five firms have nobody to send to, and no generic recruiter was substituted (the
 * 09-27 Vercel precedent):
 * - **Replit.** A LinkedIn lead search over campus, university, early-career, emerging/early-talent
 *   and recruiting-coordinator titles returns zero. Its seven recruiter contacts on file are all
 *   technical, and the only non-technical one is People Ops.
 * - **Persona.** The company has exactly one recruiter, titled "Recruiter", plus the two technical
 *   recruiters already on file. Note the tracker holds two different employers under this name:
 *   the identity company (withpersona.com, the Summer 2027 application used here) and Persona AI
 *   the robotics company (persona.ai, the "Manipulation" application).
 *
 * Addresses. accenture.com and fmr.com are both checkable (Proofpoint and Microsoft, neither
 * accept-all), so a name-specific valid there is a real answer. rivian.com is accept-all, so it
 * went through BounceBan at the 97 bar, as the 09-27 top-up did for Atlassian and Dropbox.
 *
 * Finding worth keeping: trykitt's verifier calls **every** rivian.com address invalid, including
 * `annehaber@rivian.com`, which this account emailed on 09-25 with no bounce. Its
 * `invalid_identity_provider` verdict on that domain says nothing; BounceBan was the arbiter.
 * Dropped for want of a deliverable address: Sabreen Akarah (Sr. Manager, TA - Emerging Talent,
 * Rivian) at both `sabreenakarah@` and `sakarah@`, and Cilly Neureuther (Campus Talent Acquisition
 * Specialist, Fidelity) whom eleven finders miss and whose pattern address is undeliverable.
 * Meredith Sheehy (Accenture) was dropped too: only a bot-generated `ms@accenture.com` was found.
 */

var EARLYCAREER_WAVE_0930_APPS_ = {
  Accenture: {role: 'Entry Level Technology Summer Analyst - Various Locations',
              jobLink: 'https://accenture.wd103.myworkdayjobs.com/en-US/AccentureCareers/job/Technology-Summer-Analyst---Various-Locations---NAELFY27_R00355981'},
  'Fidelity Investments': {role: 'Undergraduate Internship - Software',
              jobLink: 'https://fmr.wd1.myworkdayjobs.com/fidelitycareers/job/One-Destiny-Way-Westlake-TX/Summer-2027-Undergraduate-Internship---Software_2134524?utm_source=Simplify&ref=Simplify'},
  Rivian: {role: 'Software Engineering Intern - Connected Systems - January - August 2027',
              jobLink: 'https://jobs.ashbyhq.com/rivianvw.tech/13eeb795-a5dd-4b5a-9b98-808e5ec357c2'}
};

var EARLYCAREER_WAVE_0930_DAYS_ = [
  {day: '2026-09-30', key: 'TARGET_RECRUITER_CAMPAIGN_20260930_EARLYCAREER_WAVE',
   startIso: '2026-09-30T14:30:00-04:00', people: [
     {company: 'Accenture', name: 'Rizzalyn Burke', email: 'rizzalyn.s.burke@accenture.com',
      role: 'US Early Careers Talent Delivery Manager', focus: 'early-career',
      verify: 'trykitt valid; identity and SMTP, accenture.com not accept-all'},
     {company: 'Accenture', name: 'Anastasia Komarnicki', email: 'anastasia.komarnicki@accenture.com',
      role: 'Campus Recruiter', focus: 'early-career',
      verify: 'trykitt valid; identity and SMTP, accenture.com not accept-all'}]},
  {day: '2026-10-01', key: 'TARGET_RECRUITER_CAMPAIGN_20261001_EARLYCAREER_WAVE',
   startIso: '2026-10-01T14:30:00-04:00', people: [
     {company: 'Fidelity Investments', name: 'Bridget Giannini', email: 'bridget.giannini@fmr.com',
      role: 'University Talent Acquisition Partner', focus: 'early-career',
      verify: 'BounceBan deliverable 99; fmr.com not accept-all'},
     {company: 'Fidelity Investments', name: 'Jessica Rattenni', email: 'jessica.rattenni@fmr.com',
      role: 'Director, Early Talent Strategy & Experiences', focus: 'early-career',
      verify: 'BounceBan deliverable 99; fmr.com not accept-all'}]},
  {day: '2026-10-02', key: 'TARGET_RECRUITER_CAMPAIGN_20261002_EARLYCAREER_WAVE',
   startIso: '2026-10-02T09:00:00-04:00', people: [
     {company: 'Rivian', name: 'Ryan Campbell', email: 'ryancampbell@rivian.com',
      role: 'Sr. Recruiter - Software Early Career', focus: 'early-career',
      verify: 'BounceBan deliverable 97; accept_all'},
     {company: 'Rivian', name: 'Katrina Vacca', email: 'katrinavacca@rivian.com',
      role: 'Sr. Emerging Talent Recruiter', focus: 'early-career',
      verify: 'BounceBan deliverable 97; accept_all'}]}
];
var EARLYCAREER_WAVE_0930_SOURCE_ =
  'harvestapi LinkedIn lead search; treg email find; BounceBan/trykitt verify — early-career wave 2026-09-29';

/** Companies without an active Applied App row for the role, or blocked by the rejection preflight. */
function earlyCareerWave0930Blocked_() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var apps = targetMirrorApplications_(tracker);
  var blocked = {};
  Object.keys(EARLYCAREER_WAVE_0930_APPS_).forEach(function (company) {
    var spec = EARLYCAREER_WAVE_0930_APPS_[company];
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
 * Schedule the three days on the shared Target recruiter trigger. A day whose Target total would
 * pass 55 is refused unless `acknowledgeOver55` is true. A blocked company is dropped, not
 * replaced.
 */
function scheduleEarlyCareerWave20260930(acknowledgeOver55) {
  var blocked = earlyCareerWave0930Blocked_();
  var results = [];
  EARLYCAREER_WAVE_0930_DAYS_.forEach(function (day) {
    var people = day.people.filter(function (person) { return !blocked[person.company]; });
    if (!people.length) { results.push({day: day.day, scheduled: 0}); return; }
    var dayTotal = diagnoseTargetMessagesForDay(day.day).target.target + people.length;
    if (dayTotal > 55 && acknowledgeOver55 !== true) {
      throw new Error(day.day + ' total would be ' + dayTotal + ' (over 55); pass acknowledgeOver55 = true after the owner confirms.');
    }
    appendApprovedManualRecruiters_(people, EARLYCAREER_WAVE_0930_SOURCE_);
    var companies = [], seen = {};
    people.forEach(function (person) {
      if (seen[person.company]) { seen[person.company].maxContacts++; return; }
      var app = EARLYCAREER_WAVE_0930_APPS_[person.company];
      seen[person.company] = {company: person.company, maxContacts: 1, role: app.role, jobLink: app.jobLink};
      companies.push(seen[person.company]);
    });
    var result = scheduleTargetRecruiterCampaign_({
      propertyKey: day.key, handler: 'runTargetRecruiterSharedTick_', reuseExistingTrigger: true,
      label: 'Early-career wave ' + day.day, startIso: day.startIso,
      spacingMinutes: 6, minGapMinutes: 5, exactContacts: people.length,
      includeEmails: people.map(function (person) { return person.email; }),
      companies: companies
    });
    results.push({day: day.day, dayTotal: dayTotal, result: result});
  });
  return {blocked: blocked, days: results};
}

/** Read-only: blocked companies and each day's planned recipients. Writes nothing. */
function previewEarlyCareerWave20260930() {
  var blocked = earlyCareerWave0930Blocked_();
  return {blocked: blocked, days: EARLYCAREER_WAVE_0930_DAYS_.map(function (day) {
    return {day: day.day, start: day.startIso, people: day.people.filter(function (person) {
      return !blocked[person.company];
    }).map(function (person) { return person.company + ': ' + person.name + ' <' + person.email + '> — ' + person.role; })};
  })};
}

/** Cancel every still-pending entry in the three campaigns. Safe to re-run. */
function cancelEarlyCareerWave20260930() {
  var props = PropertiesService.getScriptProperties(), cancelled = 0;
  EARLYCAREER_WAVE_0930_DAYS_.forEach(function (day) {
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
