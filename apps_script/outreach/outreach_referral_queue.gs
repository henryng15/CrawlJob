/**
 * Referral — deciding who gets asked, and for which posting.
 *
 * Both paths start from an application on the App tab: something was applied to,
 * so there is a company, a role, a date and a link. What differs is who is
 * written to and what is asked. The cold path writes to a recruiter and asks them
 * to look; this one writes to an engineer and asks them to spend their own
 * credibility.
 *
 * It read the crawler's Jobs tab first, on the reasoning that a referral attached
 * before an application helps more than one attached after. That reasoning is
 * sound and the tab was still wrong: Jobs holds every posting the crawler found,
 * six hundred rows of which two were at a company this project has engineers for.
 * Reading applications instead is not a narrowing. An application is a decision,
 * and a favour is worth asking for where a decision has already been made.
 *
 * Four things have to be true before a row is queued, and each is here as its own
 * function so that a row nobody expected can be argued with one rule at a time:
 *
 *   the employer is one ColdEmail found engineers at   outreachEmployeesFor_
 *   the application has not already been rejected      outreachReferralLive_
 *   the link goes to the employer's own application    outreachReferralLinkOk_
 *   this person has never been written to before       outreachReferralPlan_
 *
 * The link rule is the one worth reading twice. A crawled link is not usable just
 * because it resolves: half the trackers this project reads republish a posting
 * under an id of their own, and a referral form wants the requisition, not a
 * redirect to it. So the gate is an allowlist of applicant tracking systems plus
 * the employer's own domain, and everything else is refused by default. A refused
 * row is not dropped, it is painted yellow on the App tab and waits for a link
 * pasted by hand into the Official column.
 *
 * Deny by default, rather than a list of aggregators to reject. The rejects are
 * unbounded and grow whenever somebody launches another job board; the systems
 * that actually receive applications are a list of about twenty and change
 * roughly never. A new aggregator under the wrong rule silently sends a referral
 * ask pointing at a redirect. Under this one it turns a row yellow.
 */

/**
 * The applicant tracking systems, matched as domain suffixes.
 *
 * A suffix rather than an exact host, because every one of these hands an
 * employer its own subdomain: boards.greenhouse.io and job-boards.greenhouse.io
 * are both Greenhouse, and Workday gives out numbered ones by the thousand
 * (nvidia.wd5.myworkdayjobs.com). Matched on a dot boundary so that a host like
 * "notgreenhouse.io" cannot pass by ending in the same letters.
 */
var REFERRAL_ATS_DOMAINS = [
  'greenhouse.io', 'lever.co', 'ashbyhq.com',
  'myworkdayjobs.com', 'myworkdaysite.com', 'workday.com',
  'smartrecruiters.com', 'icims.com', 'taleo.net', 'brassring.com',
  'successfactors.com', 'successfactors.eu', 'csod.com',
  'jobvite.com', 'workable.com', 'breezy.hr', 'recruitee.com',
  'bamboohr.com', 'teamtailor.com', 'rippling.com', 'eightfold.ai',
  'phenompeople.com', 'avature.net', 'oraclecloud.com', 'dayforcehcm.com',
  'paylocity.com', 'applytojob.com', 'jazzhr.com', 'workatastartup.com'
];

/**
 * Hosts known to republish somebody else's posting.
 *
 * This list used to gate nothing, and the reasoning was sound while it held: the
 * allowlist refused everything it did not recognise, so a second list that could
 * also refuse would have been a second place to be wrong. It existed only so the
 * App tab could say which kind of wrong a link is, because "that is a Jobright
 * redirect, paste the real one" and "I do not recognise this host" ask a person to
 * do different things.
 *
 * It became load-bearing on 2026-08-30, when outreachReferralNameMatchesHost_ was
 * added. That rule accepts hosts nothing recognises, on the strength of the
 * company's own name appearing at the front of them — so for the first time
 * something here can say yes to a domain that is on no allowlist, and this list is
 * the one thing standing between that and an aggregator handing out
 * "stripe.someboard.com" style subdomains. Adding a host here now changes a
 * decision, not just a message.
 *
 * Mirrors AGGREGATOR_HOSTS in job_sync/sources.py, which knows only jobright
 * because that is the only one whose links the crawler can currently produce.
 */
var REFERRAL_AGGREGATOR_DOMAINS = [
  'jobright.ai', 'simplify.jobs', 'linkedin.com', 'indeed.com',
  'glassdoor.com', 'ziprecruiter.com', 'wellfound.com', 'angel.co',
  'builtin.com', 'dice.com', 'monster.com', 'joinhandshake.com',
  'ripplematch.com', 'untapped.io', 'lensa.com', 'talent.com',
  'adzuna.com', 'speedyapply.com', 'levels.fyi', 'hiring.cafe'
];

/** The host of a URL, lowercased, with any leading www dropped. */
function outreachReferralHost_(url) {
  var text = String(url == null ? '' : url).trim();
  var match = text.match(/^https?:\/\/([^\/?#]+)/i);
  if (!match) return '';
  return match[1].toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
}

/**
 * Whether a host is at or under a domain.
 *
 * The dot is what makes this a rule rather than a substring search: without it
 * "mygreenhouse.io" ends in "greenhouse.io" and would be accepted as Greenhouse.
 */
function outreachReferralUnder_(host, domain) {
  if (!host || !domain) return false;
  return host === domain || host.slice(-(domain.length + 1)) === '.' + domain;
}

function outreachReferralIsAggregator_(url) {
  var host = outreachReferralHost_(url);
  return REFERRAL_AGGREGATOR_DOMAINS.some(function (domain) {
    return outreachReferralUnder_(host, domain);
  });
}

/**
 * The spellings of a company's name that may stand at the front of a host.
 *
 * Two, and the second is why this is not one line. The full name with everything
 * that is not a letter or a digit taken out — "Old Mission Capital" becomes
 * "oldmissioncapital" — and, only when the noise-stripped name is a single word,
 * that word on its own. The single-word clause is what lets "Acme Technologies,
 * Inc." be recognised as "acme"; the restriction to one word is what stops
 * "General Motors" being recognised as "general", which would hand the rule to
 * whoever registers general.anything.
 *
 * outreachCompanyTokens_ sorts, so its output is never joined back together here.
 * "Old Mission Capital" tokenises to capital,mission,old, and a key built from
 * that would be a word the company has never been called.
 */
function outreachReferralNameKeys_(company) {
  var key = outreachNameKey_(company).replace(/ /g, '');
  if (!key) return [];
  var keys = [key];
  var tokens = outreachCompanyTokens_(company);
  if (tokens.length === 1 && tokens[0] !== key) keys.push(tokens[0]);
  return keys;
}

/**
 * Whether the host's first label is the company's name.
 *
 * blackrock.tal.net and amazon.jobs are both an employer's own application system
 * and both were refused: TalentLink is on no allowlist worth keeping, and Amazon
 * takes applications on a domain that is not the one its staff read mail at, so
 * neither the ATS list nor the employer's own domain could recognise them. What
 * does recognise them is the thing a person uses at a glance — the company's name,
 * sitting at the front of the host.
 *
 * The first label only. "blackrock" in "blackrock.tal.net" is a name TalentLink
 * assigned to a customer; "blackrock" anywhere further right would be a domain
 * somebody else registered, and the difference is the whole rule.
 *
 * Matched whole, never as a substring, which is the lesson outreachSameEmployer_
 * already carries: "dice" must not match "dicerna", and "amazon" must not match
 * "notamazon". A label is split on hyphens first, so campus-amd is AMD, and the
 * undivided label is also compared so general-motors is General Motors.
 *
 * This is the loosest rule in the gate and the only one that can say yes to a host
 * on no list at all, so it refuses anything on REFERRAL_AGGREGATOR_DOMAINS
 * outright. Without that, the day a job board starts handing out
 * stripe.thatboard.com is the day referral asks start pointing at redirects again
 * — which is exactly what deny-by-default was built to prevent.
 */
function outreachReferralNameMatchesHost_(host, company) {
  var keys = outreachReferralNameKeys_(company);
  if (!keys.length || !host) return false;
  var label = host.split('.')[0];
  if (!label) return false;
  var parts = label.split('-').filter(function (part) { return !!part; });
  var candidates = parts.length > 1 ? parts.concat(parts.join('')) : parts;
  return candidates.some(function (candidate) {
    return keys.indexOf(candidate) !== -1;
  });
}

/**
 * Whether this link can be put in front of somebody being asked for a referral.
 *
 * Three ways to pass, in the order they are cheapest to be sure about:
 *
 *   the host is the employer's own domain    jobs.apple.com for apple.com
 *   the host is an applicant tracking system  REFERRAL_ATS_DOMAINS
 *   the host wears the company's own name     blackrock.tal.net, amazon.jobs
 *
 * The first two are the original gate and are unchanged. The third was added on
 * 2026-08-30 and is deliberately the last thing tried: it is the only one that can
 * accept a domain nothing on any list has ever seen, so everything that can be
 * decided from a list is decided first, and the aggregator refusal inside it is
 * what keeps the relaxation from reopening the hole the allowlist closed.
 *
 * `company` is optional. Called with two arguments — as every caller did before
 * the third rule existed — the name rule simply never fires.
 *
 * An http link is refused. Everything here is a form that will be typed into.
 */
function outreachReferralLinkOk_(url, companyDomain, company) {
  var text = String(url == null ? '' : url).trim();
  if (!/^https:\/\//i.test(text)) return false;
  var host = outreachReferralHost_(text);
  if (!host) return false;
  if (outreachReferralUnder_(host, String(companyDomain || '').toLowerCase().replace(/^www\./, ''))) {
    return true;
  }
  if (REFERRAL_ATS_DOMAINS.some(function (domain) {
        return outreachReferralUnder_(host, domain);
      })) return true;
  if (outreachReferralIsAggregator_(text)) return false;
  return outreachReferralNameMatchesHost_(host, company);
}

/**
 * Why a link was refused, for the person who has to fix it.
 *
 * Returned rather than logged, because where this ends up is next to the row on
 * the App tab that it is about. '' means the link was accepted.
 */
function outreachReferralLinkProblem_(url, companyDomain, company) {
  var text = String(url == null ? '' : url).trim();
  if (!text) return 'no link';
  if (outreachReferralLinkOk_(text, companyDomain, company)) return '';
  if (outreachReferralIsAggregator_(text)) {
    return 'aggregator link (' + outreachReferralHost_(text) + '), paste the employer one';
  }
  if (/^http:\/\//i.test(text)) return 'not https';
  if (!/^https?:\/\//i.test(text)) return 'not a link';
  return 'unrecognised host (' + outreachReferralHost_(text) + ')';
}

/**
 * Whether a posting names the intake this is being asked about.
 *
 * A whole word, so "summertime" and a surname are not a season. Checked on the
 * role alone: a company whose name contains the word would otherwise put every
 * one of its postings into the queue.
 */
function outreachReferralSeason_(role) {
  var text = String(role == null ? '' : role);
  // The excludes apply always, and they are the rule that matters. A title naming
  // a different intake is refused whether or not it also says summer: "Fall /
  // Winter 2026" is an intake that has gone, "Winter/Spring 2027" is not the one
  // being asked about, and "Summer 2026" is both at once.
  if (REFERRAL_SEASON_EXCLUDES.some(function (word) {
        return new RegExp('\\b' + word + '\\b', 'i').test(text);
      })) return false;
  // Requiring the season word is separate and off. A title that names no intake at
  // all is the one that was applied to, and having applied says more about which
  // intake matters than how a job board chose to word the heading.
  if (!REFERRAL_REQUIRE_SEASON) return true;
  return new RegExp('\\b' + REFERRAL_SEASON_WORD + '\\b', 'i').test(text);
}


/**
 * Employees, by employer, from the tab ColdEmail exports.
 *
 * Read into the same shape outreachReadContacts_ produces, tokens and all, so
 * that outreachSameEmployer_ can decide what one company is for both paths. Two
 * spellings of that rule would eventually disagree, and the disagreement would
 * be a referral asked for at a company already being written to.
 */
function outreachReadEmployees_(contactsSpreadsheet) {
  var sheet = contactsSpreadsheet.getSheetByName(TAB_EMPLOYEES_SEED);
  if (!sheet) return [];
  var last = sheet.getLastRow();
  if (last < 2) return [];

  var out = [], seen = {};
  sheet.getRange(2, 1, last - 1, E_WIDTH).getValues().forEach(function (row, index) {
    var email = outreachCell_(row, E_EMAIL).toLowerCase();
    var company = outreachCell_(row, E_COMPANY);
    if (!email || email.indexOf('@') === -1 || !company) return;
    // Every verdict is admitted except the explicit DeBounce invalid verdict.
    // This is the user's broad referral policy: valid, risky,
    // pattern-calibrated, Hunter/Anymail, blank and other non-invalid verdicts
    // may be used; only an explicit invalid result is blocked.
    var verify = outreachCell_(row, E_VERIFY).toLowerCase();
    if (verify === REFERRAL_REJECTED_VERIFY) return;
    // Already asked, on any earlier run or before the rebuild. Dropped here
    // rather than in the planner so that every count of "people available at
    // this employer" agrees -- the referral cap is six per company for life, and
    // a person counted but never bookable would silently shrink that to five.
    if (outreachSentTicked_(row[E_SENT - 1])) return;
    if (seen[email]) return;
    seen[email] = true;
    out.push({
      company: company,
      tokens: outreachCompanyTokens_(company),
      name: outreachCell_(row, E_NAME),
      email: email,
      title: outreachCell_(row, E_TITLE),
      domain: outreachCell_(row, E_DOMAIN).toLowerCase(),
      seniority: outreachCell_(row, E_SENIORITY),
      angle: outreachCell_(row, E_ANGLE),
      bucket: outreachCell_(row, E_BUCKET),
      rowNumber: index + 2
    });
  });
  return out;
}

/** Everyone in the dataset at one employer. */
function outreachEmployeesFor_(employees, company) {
  var tokens = outreachCompanyTokens_(company);
  if (!tokens.length) return [];
  return employees.filter(function (person) {
    return outreachSameEmployer_(tokens, person.tokens);
  });
}


/**
 * One App row, as the fields this path reads.
 *
 * The App tab, not the crawler's Jobs tab, and the change of tab is the whole
 * design rather than a detail. Jobs holds every posting the crawler found, which
 * on the live sheet meant six hundred rows of which two were at a company this
 * project has engineers for. App holds the applications actually made. Reading
 * the second is not a narrowing of the first: an application is a decision, and a
 * referral is worth asking for exactly where a decision has already been made.
 *
 * The link is decided here rather than by the caller, because which of the two
 * columns won is a fact about the row that both the queue and the yellow paint
 * have to agree on.
 */
function outreachParseApplication_(row, index, domainFor) {
  var company = outreachCell_(row, APP_COMPANY);
  var applied = outreachCell_(row, APP_LINK);
  var official = outreachCell_(row, APP_OFFICIAL);
  var domain = domainFor ? domainFor(company) : '';
  // The pasted link is preferred when both pass. Somebody typed it deliberately,
  // and the only reason to type one over a link that already works is that they
  // know something the row does not say.
  var link = outreachReferralLinkOk_(official, domain, company) ? official
           : (outreachReferralLinkOk_(applied, domain, company) ? applied : '');
  return {
    index: index,
    property: Number(outreachCell_(row, APP_PROPERTY)) || 0,
    company: company,
    role: outreachCell_(row, APP_ROLE),
    dateApplied: outreachDate_(row[APP_DATE_APPLIED - 1]),
    process: outreachCell_(row, APP_PROCESS),
    appliedLink: applied,
    officialLink: official,
    link: link,
    domain: domain
  };
}

/** Whether this employer is intentionally outside the referral campaign. */
function outreachReferralIsQuantFirm_(company) {
  var tokens = outreachCompanyTokens_(company);
  if (!tokens.length) return false;
  return REFERRAL_QUANT_COMPANIES.some(function (name) {
    return outreachSameEmployer_(tokens, outreachCompanyTokens_(name));
  });
}

// Target is maintained by the bound tracker script, but the sender owns the
// Referral decision. Read the four five-column blocks directly so a manual
// addition on Target becomes a hard exclusion on the next referral cycle.
var REFERRAL_TARGET_BLOCK_COLS = [1, 7, 13, 19];
var REFERRAL_TARGET_BLOCK_WIDTH = 5;
var REFERRAL_TARGET_READ_WIDTH = 23;

function outreachReferralTargetCompanies_(tracker) {
  var target = tracker.getSheetByName('Target');
  if (!target) return null;
  var last = target.getLastRow();
  if (last < 2) return {};
  var values;
  try {
    values = target.getRange(2, 1, last - 1, REFERRAL_TARGET_READ_WIDTH).getValues();
  } catch (error) {
    Logger.log('Target could not be read; Referral planning is held: '
      + String(error.message || error));
    return null;
  }
  var names = [];
  values.forEach(function (row) {
    REFERRAL_TARGET_BLOCK_COLS.forEach(function (column) {
      var name = outreachCell_(row, column);
      if (name) names.push(name);
    });
  });
  var companies = {};
  names.forEach(function (name) {
    var tokens = outreachCompanyTokens_(name);
    if (tokens.length) companies[tokens.join('\u0000')] = tokens;
  });
  return companies;
}

function outreachReferralCompanyIsTarget_(company, targetCompanies) {
  if (!targetCompanies) return false;
  var tokens = outreachCompanyTokens_(company);
  if (!tokens.length) return false;
  return Object.keys(targetCompanies).some(function (key) {
    return outreachSameEmployer_(tokens, targetCompanies[key]);
  });
}

function outreachReferralApplicationAge_(application, today) {
  var applied = application && application.dateApplied;
  if (!applied) return Infinity;
  return outreachDaysBetween_(outreachMidnight_(applied), outreachMidnight_(today));
}

/** Why an unsent Referral row is no longer inside the fresh-application gate. */
function outreachReferralWindowProblem_(referralRow, applications, targetCompanies, today) {
  if (!targetCompanies) return 'target-unavailable';
  if (outreachReferralCompanyIsTarget_(referralRow.company, targetCompanies)) {
    return 'Target company';
  }
  var companyTokens = outreachCompanyTokens_(referralRow.company);
  var roleKey = outreachNameKey_(referralRow.role);
  var candidates = (applications || []).filter(function (application) {
    if (!application.company || !outreachReferralLive_(application)) return false;
    if (!outreachSameEmployer_(companyTokens, outreachCompanyTokens_(application.company))) {
      return false;
    }
    return !roleKey || outreachNameKey_(application.role) === roleKey;
  });
  if (!candidates.length) return 'No matching live application';
  var fresh = candidates.some(function (application) {
    return outreachReferralAdmission_(application, today, targetCompanies).eligible;
  });
  return fresh ? '' : 'Application referral window expired';
}

/**
 * The admission rule for a new Referral row.
 *
 * Existing rows are deliberately not passed through this gate. A queued or
 * drafted ask is already a commitment with a scheduled hour (and perhaps a
 * Gmail draft); changing eligibility must never silently withdraw it.
 */
function outreachReferralAdmission_(application, today, targetCompanies) {
  if (outreachReferralIsQuantFirm_(application.company)) {
    return { eligible: false, priority: false, reason: 'quant' };
  }
  if (!targetCompanies) {
    return { eligible: false, priority: false, reason: 'target-unavailable' };
  }
  if (outreachReferralCompanyIsTarget_(application.company, targetCompanies)) {
    return { eligible: false, priority: false, reason: 'target-company' };
  }
  var days = outreachReferralApplicationAge_(application, today);
  if (days >= 0 && days <= REFERRAL_RECENT_APPLICATION_DAYS) {
    return { eligible: true, priority: days <= REFERRAL_PRIORITY_APPLICATION_DAYS,
             reason: 'outside-target-fresh-application', days: days };
  }
  return { eligible: false, priority: false, reason: 'outside-target-window', days: days };
}

/**
 * Existing queued asks inherit the fast lane when their employer has a fresh
 * application. New rows receive the same tick during planning, but without this
 * pass a row already waiting in Referral would miss the policy merely because it
 * had been created before the application date was corrected or replaced.
 *
 * Drafted and Sent rows are deliberately untouched: changing an addressed draft
 * to urgency after it exists breaks the review promise. The result is just the
 * row indexes; the sender owns the actual sheet writes.
 */
function outreachReferralAutomaticPriorities_(referralRows, applications, today, targetCompanies) {
  var priorityDaysByIndex = outreachReferralAutomaticPriorityDays_(
    referralRows, applications, today, targetCompanies);
  return referralRows.filter(function (row) {
    return row.status === STATUS_QUEUED && !row.cancel && !row.priority
      && priorityDaysByIndex[row.index] !== undefined;
  }).map(function (row) { return row.index; });
}

/**
 * The application age behind each queued automatic Priority row.
 *
 * Priority is a class, but freshness is the order inside that class: today is
 * zero days old and yesterday is one. Keeping the age by Referral row lets a
 * re-plan fix an already queued yesterday/today pair too; looking only at the
 * Priority checkbox would leave whichever row happened to be scheduled first
 * in front forever.
 */
function outreachReferralAutomaticPriorityDays_(referralRows, applications, today, targetCompanies) {
  var hot = {};
  (applications || []).forEach(function (application) {
    if (!application.company) return;
    var admission = outreachReferralAdmission_(application, today, targetCompanies);
    if (!admission.priority || typeof admission.days !== 'number'
        || !isFinite(admission.days)) return;
    var key = outreachNameKey_(application.company);
    if (hot[key] === undefined || admission.days < hot[key]) hot[key] = admission.days;
  });

  var priorityDaysByIndex = {};
  (referralRows || []).forEach(function (row) {
    if (row.status !== STATUS_QUEUED || row.cancel) return;
    var days = hot[outreachNameKey_(row.company)];
    if (days !== undefined) priorityDaysByIndex[row.index] = days;
  });
  return priorityDaysByIndex;
}

/**
 * Whether this application is still one worth asking a favour about.
 *
 * A rejected application is not. Asking somebody to spend their credibility on a
 * req that has already turned you down is the one version of this email that
 * cannot lead anywhere, and it is the version most likely to be mentioned to the
 * recruiter who sent the rejection.
 */
function outreachReferralLive_(application) {
  return String(application.process || '').trim() !== STAGE_REJECTED;
}

/**
 * Whether a drafted ask points at an application rejected since the last cycle.
 *
 * The hourly reconcile normally closes this row first, but the one-minute send
 * trigger can arrive between that pass and the next one. This last-mile check
 * deliberately errs on the side of cancelling: a rejected application must not
 * be used to ask an engineer for a referral, even if another replan would later
 * have repointed the row to a newer application.
 */
function outreachReferralRejectedFor_(referralRow, applications) {
  var companyTokens = outreachCompanyTokens_(referralRow.company);
  var roleTokens = outreachRoleTokens_(referralRow.role);
  var roleKey = outreachNameKey_(referralRow.role);
  if (!companyTokens.length || !roleTokens.length) return false;
  return (applications || []).some(function (application) {
    if (outreachReferralLive_(application) || !application.company) return false;
    if (!outreachSameEmployer_(companyTokens, outreachCompanyTokens_(application.company))) return false;
    var applicationRoleKey = outreachNameKey_(application.role);
    return applicationRoleKey === roleKey
      || outreachSameRole_(roleTokens, outreachRoleTokens_(application.role));
  });
}

/**
 * Which of a company's applications is the one to ask about.
 *
 * Four applications at one employer is not four referrals. Asking six people at
 * one company about six different requisitions reads, if any two of them compare
 * notes, as somebody applying to everything rather than to something. One
 * application is chosen and everybody there is asked about that one.
 *
 * Ordered, and every tie broken so the answer does not move between runs: a
 * Software Engineer/Engineering Intern first; then a role naming Technology;
 * then the remaining usable roles. Within one tier the most recently applied
 * role wins, because that is the one still moving and the one the writer can
 * speak about; role text settles whatever is left.
 *
 * An application with no usable link is never the one chosen, so a single
 * aggregator row cannot hide a company's good link behind it. Nor is a rejected
 * one, which is a distinction this tab can make and the Jobs tab could not.
 */
function outreachPickReferralRole_(applications) {
  var usable = applications.filter(function (one) {
    return one.link && outreachReferralLive_(one) && outreachReferralSeason_(one.role);
  });
  if (!usable.length) return null;
  var rank = function (one) {
    var tokens = outreachRoleTokens_(one.role);
    var softwareEngineerIntern = tokens.indexOf('software') !== -1
      && tokens.indexOf('engineer') !== -1
      && tokens.indexOf('intern') !== -1;
    if (softwareEngineerIntern) return 0;
    if (tokens.indexOf('technology') !== -1) return 1;
    return 2;
  };
  usable.sort(function (left, right) {
    if (rank(left) !== rank(right)) return rank(left) - rank(right);
    var leftAt = left.dateApplied ? left.dateApplied.getTime() : 0;
    var rightAt = right.dateApplied ? right.dateApplied.getTime() : 0;
    if (leftAt !== rightAt) return rightAt - leftAt;
    return left.role < right.role ? -1 : (left.role > right.role ? 1 : 0);
  });
  return usable[0];
}

/**
 * Rows on the App tab that should be yellow, and why.
 *
 * Yellow means one thing: this is an application worth asking about and the link
 * on it is not one a referral can be submitted against. A row nobody would ask
 * about is never painted, because a colour that appears on rows requiring no
 * action is a colour people stop seeing.
 */
function outreachReferralNeedsLink_(applications, employees) {
  return applications.filter(function (one) {
    if (!outreachReferralSeason_(one.role)) return false;
    if (!outreachReferralLive_(one)) return false;
    if (one.link) return false;
    return outreachEmployeesFor_(employees, one.company).length > 0;
  }).map(function (one) {
    return {
      index: one.index,
      company: one.company,
      role: one.role,
      reason: outreachReferralLinkProblem_(
        one.officialLink || one.appliedLink, one.domain, one.company)
    };
  });
}

/** One row of the Referral tab, as the fields the planner and the sender read. */
function outreachParseReferral_(row, index) {
  return {
    index: index,
    company: outreachCell_(row, R_COMPANY),
    tokens: outreachCompanyTokens_(outreachCell_(row, R_COMPANY)),
    role: outreachCell_(row, R_ROLE),
    jobLink: outreachCell_(row, R_JOB_LINK),
    person: outreachCell_(row, R_PERSON),
    email: outreachCell_(row, R_EMAIL).toLowerCase(),
    title: outreachCell_(row, R_TITLE),
    tier: outreachCell_(row, R_TIER),
    template: Number(outreachCell_(row, R_TEMPLATE)) || 0,
    draftedAt: outreachDate_(row[R_DRAFTED_AT - 1]),
    scheduled: outreachDate_(row[R_SCHEDULED - 1]),
    status: outreachCell_(row, R_STATUS),
    mode: outreachCell_(row, R_MODE),
    draftId: outreachCell_(row, R_DRAFT_ID),
    // A checkbox reads back as the boolean, not as the word, and an untouched one
    // reads as the empty string rather than as false — so the test is for truth,
    // not for "not false".
    cancel: row[R_CANCEL - 1] === true,
    priority: row[R_PRIORITY - 1] === true,
    sentAt: outreachDate_(row[R_SENT_AT - 1]),
    // The id of the message that went out, which scanReferralReplies needs to
    // find the thread again. It shares a column with the human-readable outcome
    // because a row only ever holds one of the two: the id until something comes
    // back, the sentence about what came back afterwards.
    result: outreachCell_(row, R_RESULT),
    // Read because repairMisreadReferralBounces has to tell the rows it cancelled
    // from the ones a person called off by hand, and the sentence in this column
    // is the only thing that distinguishes them.
    lastError: outreachCell_(row, R_ERROR),
    id: outreachCell_(row, R_ID)
  };
}

/**
 * Everyone this path has ever written to, or is about to.
 *
 * By address, and by address only. A person is asked once and never again: there
 * is no second attempt in this design, because the thing being asked for is a
 * favour and asking twice for a favour that was not granted is not persistence.
 *
 * Cancelled and Failed rows do not count as written: no message reached that
 * person. This lets a fresh-plan reset safely return unsent recipients to the
 * pool while Sent, Replied and Bounced remain permanent history.
 */
function outreachReferralAsked_(referralRows) {
  var asked = {};
  referralRows.forEach(function (row) {
    if (row.email && STATUS_SPENDS_CONTACT.indexOf(row.status) !== -1) {
      asked[row.email] = true;
    }
  });
  return asked;
}

/**
 * How many people at one employer already have an active or sent row.
 *
 * Cancelled and Failed rows are free. They never reached a person, so an
 * operational reset or a transient Gmail failure does not lose a valid contact.
 */
function outreachReferralSpent_(referralRows, company) {
  var tokens = outreachCompanyTokens_(company);
  if (!tokens.length) return 0;
  return referralRows.filter(function (row) {
    return STATUS_SPENDS_CONTACT.indexOf(row.status) !== -1
      && outreachSameEmployer_(tokens, row.tokens);
  }).length;
}

/**
 * Rows already booked for a given day, in total and at one employer.
 *
 * The day key comes from outreach_followup.gs rather than being spelled again
 * here. Every .gs file in an Apps Script project shares one global scope, so a
 * second outreachDayKey_ would not be a local convenience, it would replace the
 * follow-up's and change how its own daily cap counts.
 */
function outreachReferralLoadAdd_(load, when, company, priority) {
  if (!when) return;
  var key = outreachDayKey_(when);
  if (!load[key]) load[key] = { total: 0, companies: {}, hours: {}, times: [], priorityTimes: [] };
  load[key].total++;
  var name = outreachNameKey_(company);
  load[key].companies[name] = (load[key].companies[name] || 0) + 1;
  var hour = when.getHours();
  load[key].hours[hour] = (load[key].hours[hour] || 0) + 1;
  load[key].times.push(when.getTime());
  if (priority) load[key].priorityTimes.push(when.getTime());
}

function outreachReferralLoad_(referralRows, booked) {
  var load = {};
  referralRows.forEach(function (row) {
    if (row.status !== STATUS_CANCELLED) {
      outreachReferralLoadAdd_(load, row.scheduled, row.company, row.priority);
    }
  });
  (booked || []).forEach(function (item) {
    outreachReferralLoadAdd_(load, item.scheduled, item.company, item.priority);
  });
  return load;
}

/**
 * A stable 10–20 minute jitter for the Priority fast lane.
 *
 * Math.random is wrong here: re-planning must reproduce an already visible
 * timetable unless the queue itself changed. This small string hash looks varied
 * to recipients while remaining reproducible for the same company and position.
 */
function outreachReferralPriorityGapMinutes_(company, position) {
  var text = outreachNameKey_(company) + '|' + position;
  var hash = 0;
  for (var i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) % 2147483647;
  var width = REFERRAL_PRIORITY_GAP_MINUTES_MAX - REFERRAL_PRIORITY_GAP_MINUTES_MIN + 1;
  return REFERRAL_PRIORITY_GAP_MINUTES_MIN + (hash % width);
}

/**
 * The short, deliberately human-paced lane for a role applied to today or yesterday.
 *
 * The daily and mailbox caps are checked by outreachReferralSlot_ before this
 * runs. Here the only extra rule is spacing: every new Priority ask is 10–20
 * minutes from its neighbours, including an ordinary Referral already booked in
 * the next two hours. A company can therefore get all six asks out inside two
 * hours without a burst that looks like a mail merge.
 */
function outreachReferralPrioritySlot_(company, today, used) {
  var deadline = new Date(today.getTime() + REFERRAL_PRIORITY_WINDOW_MINUTES * 60000);
  var priorityTimes = (used.priorityTimes || []).filter(function (time) {
    return time >= today.getTime() && time <= deadline.getTime();
  }).sort(function (left, right) { return left - right; });
  var position = priorityTimes.length;
  var anchor = priorityTimes.length ? priorityTimes[priorityTimes.length - 1] : today.getTime();
  var candidate = new Date(anchor
    + outreachReferralPriorityGapMinutes_(company, position) * 60000);
  candidate.setSeconds(0, 0);
  var times = used.times || [];

  for (var attempt = 0; attempt < 20 && candidate <= deadline; attempt++) {
    var clear = times.every(function (time) {
      return Math.abs(time - candidate.getTime())
        >= REFERRAL_PRIORITY_GAP_MINUTES_MIN * 60000;
    });
    if (clear) return candidate;
    candidate = new Date(candidate.getTime()
      + outreachReferralPriorityGapMinutes_(company, position + attempt + 1) * 60000);
  }
  return null;
}


/**
 * The first slot this person can have.
 *
 * Two caps, and they are different kinds of limit. The daily one is about the
 * sending account: twenty referral notes a day out of one mailbox, on top of
 * the cold path's own volume. The per-employer one is about how the queue is
 * spent — one person per company per day, so a day of sending reaches twenty
 * employers rather than two, and the second ask at a company is still unwritten
 * when the first one is read.
 *
 * `priority` raises the per-employer cap to REFERRAL_PRIORITY_COMPANY_CAP, and
 * raises is the word: it used to remove it. A ticked box is somebody saying they
 * want this company worked today rather than a fortnight from now, and holding the
 * group to one a day would make the tick nothing but a reordering — but removing
 * the cap let two ticked employers take twelve of a day's twenty slots and leave
 * eight other companies sharing eight, which is the clustering the breadth-first
 * planner exists to prevent, reintroduced through a side door.
 *
 * The account's own cap is never lifted either way, because the mailbox does not
 * care whose idea the day was.
 *
 * Walks forward a day at a time from today and takes the first slot that clears
 * both. There is no ceiling: unlike a follow up, a referral ask has no window it
 * can miss, so a backlog is spread rather than dropped.
 */
function outreachReferralSlot_(company, today, load, roomOn, priority, fastPriority, latestDay) {
  var hours = outreachSpaceHours_(REFERRAL_DAILY_CAP, REFERRAL_HOUR_FIRST, REFERRAL_HOUR_LAST);
  var name = outreachNameKey_(company);
  for (var ahead = 0; ahead < 180; ahead++) {
    var day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + ahead);
    if (latestDay && day > outreachMidnight_(latestDay)) break;
    var key = outreachDayKey_(day);
    // Saturday and Sunday are skipped whole. A first message to a stranger asking
    // for a favour, arriving on a Saturday morning, says the sender either did not
    // notice or did not mind; it is the same message on Monday and reads better.
    var fastLane = fastPriority && ahead === 0;
    if (!fastLane && !REFERRAL_WEEKENDS && (day.getDay() === 0 || day.getDay() === 6)) continue;
    var used = load[key] || { total: 0, companies: {}, hours: {}, times: [], priorityTimes: [] };
    // Three limits, and the third is the one that knows about the rest of the
    // system. roomOn asks what the whole mailbox has left on that day once the
    // cold path and the follow-ups have taken their share, so a day this queue
    // could fill on its own is still refused when the account cannot afford it.
    // Optional, because the planner is also called from places holding no view
    // of the other two paths, and an unknown budget must not read as no budget.
    var cap = roomOn ? Math.min(REFERRAL_DAILY_CAP, roomOn(day)) : REFERRAL_DAILY_CAP;
    if (used.total >= cap) continue;
    var perCompany = priority ? REFERRAL_PRIORITY_COMPANY_CAP : REFERRAL_COMPANY_DAILY_CAP;
    if ((used.companies[name] || 0) >= perCompany) continue;
    // Today-only, including after the ordinary 19:00 cutoff or on a weekend:
    // Priority means the fresh application is acted on while the application is
    // still at the top of its recipient's queue. If a congested two-hour lane has
    // no valid gap, keep the row Priority and let the normal capped queue find its
    // next safe time rather than dropping an ask.
    if (fastLane) {
      var rapid = outreachReferralPrioritySlot_(company, today, used);
      if (rapid) return rapid;
    }
    if (!REFERRAL_WEEKENDS && (day.getDay() === 0 || day.getDay() === 6)) continue;
    // Where in the day's list to start. Nought on any day still ahead; on today it
    // is the first hour that has not already gone, because a slot in the past
    // would be sent by the next firing whatever hour it claims.
    //
    // Only the hours that have gone are skipped, not the whole day. An earlier
    // version stepped to the next day here, which wrote off eleven usable hours
    // every time the queue was rebuilt mid-morning.
    var first = 0;
    if (ahead === 0) {
      while (first < hours.length
             && new Date(day.getFullYear(), day.getMonth(), day.getDate(),
                         hours[first], 0, 0) <= today) {
        first++;
      }
    }
    // A booking is a particular hour, not just a number. `first + total` skips a
    // free hour whenever one of the day's bookings was in the past (or there is a
    // protected draft later in the day): at 14:21, a sent 14:00 ask and a 15:00
    // draft made the next ask 16:00 under the old arithmetic, and repeated
    // replans could strand every remaining usable hour. Live loads retain their
    // occupied hours, so take the first actual capacity slot. At a cap of twenty
    // the fourteen-hour window intentionally repeats six hours; their quota is
    // two, while every other hour remains one. The count-only fallback keeps this
    // helper compatible with callers holding the old minimal load shape.
    if (used.hours) {
      var hourCapacity = {};
      hours.forEach(function (hour) {
        hourCapacity[hour] = (hourCapacity[hour] || 0) + 1;
      });
      for (var candidate = first; candidate < hours.length; candidate++) {
        if ((used.hours[hours[candidate]] || 0) < hourCapacity[hours[candidate]]) {
          return new Date(day.getFullYear(), day.getMonth(), day.getDate(),
                          hours[candidate], 0, 0);
        }
      }
      continue;
    }
    var index = first + used.total;
    if (index >= hours.length) continue;
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(),
                    hours[index], 0, 0);
  }
  return null;
}

/**
 * Which rows to add to the Referral tab.
 *
 * Every row here is an application already made, which is a reversal of what this
 * used to read from. Asking before applying is the better ordering in the
 * abstract, and it is what the Jobs tab offered; what it also offered was six
 * hundred postings nobody had chosen, of which two were at a company this project
 * has engineers for. An application is a decision, and a referral is worth asking
 * for where a decision has already been made. Thirty nine employers clear that
 * bar on the live tab against two under the old rule.
 *
 * New rows have a short admission window instead of an unbounded backlog: an
 * application at a non-Target, non-quant employer is eligible only on the day it
 * was made or the following calendar day. Both ages are Priority, because the
 * referral has to be acted on while the application is still fresh.
 */
function outreachReferralPlan_(appRows, referralRows, employees, today, roomOn, targetCompanies) {
  if (!targetCompanies) return { booked: [], skipped: 0, ready: false };
  var asked = outreachReferralAsked_(referralRows);
  var load = outreachReferralLoad_(referralRows, null);
  // Body templates are balanced independently per seniority tier. A template
  // already shown in the tab is never reassigned; only new asks fill the least
  // used slot, with the stable company sequence breaking ties.
  var templateLoad = outreachReferralTemplateLoad_(referralRows);
  var booked = [], skipped = 0;

  // Grouped by employer, because the representative posting is chosen per company
  // and the three-person limit is counted per company.
  var byCompany = {}, order = [];
  appRows.forEach(function (one) {
    if (!one.company) return;
    var key = outreachNameKey_(one.company);
    if (!byCompany[key]) { byCompany[key] = []; order.push(key); }
    byCompany[key].push(one);
  });

  // A company that has been started is finished before a new one is opened.
  //
  // Without this the order is whatever order the App tab happened to be in, and
  // an employer whose first person was written to in August can sit at two of
  // three for weeks while the queue works through companies nobody has touched.
  // That is the worst arrangement available: the two who were written to are
  // spent, and the third ask, which is the one that would have arrived while the
  // first two were still recent, never goes. Finishing what is open costs nothing
  // and is not a change to how many are sent, only to which of them go first.
  //
  // Stable within each group, so among started companies and among untouched ones
  // the App tab's own order still decides, and a run books the same rows a second
  // time rather than reshuffling them.
  var started = {};
  referralRows.forEach(function (row) {
    if (row.company) started[outreachNameKey_(row.company)] = true;
  });
  var openFirst = order.filter(function (key) {
    return started[outreachNameKey_(byCompany[key][0].company)];
  }).concat(order.filter(function (key) {
    return !started[outreachNameKey_(byCompany[key][0].company)];
  }));

  // A company and role where somebody has already answered is not asked again.
  // The gate is here as well as in outreachReferralReconcile_ because the two
  // answer different questions: reconcile closes rows that already exist, and
  // this refuses to create the next one. Without both, a reply would call off
  // Monday's remaining rows and the planner would book them again on Tuesday.
  var replied = outreachReferralRepliedGroups_(referralRows);

  var plans = [];
  openFirst.forEach(function (key) {
    // The admission gate comes before choosing a role. If an employer has one
    // fresh app and one stale low-priority app, the stale one must not win merely
    // because it happens to be newer than another row in the group.
    var admitted = byCompany[key].filter(function (one) {
      return outreachReferralAdmission_(one, today, targetCompanies).eligible;
    });
    var job = outreachPickReferralRole_(admitted);
    if (!job) return;
    if (replied[outreachReferralGroupKey_(job.company, job.role, -1)]) return;

    var people = outreachEmployeesFor_(employees, job.company);
    if (!people.length) return;

    var spent = outreachReferralSpent_(referralRows, job.company);
    if (REFERRAL_PER_COMPANY - spent <= 0) return;

    var admission = outreachReferralAdmission_(job, today, targetCompanies);
    plans.push({ job: job, people: people, at: 0, taken: 0,
                 spent: spent, room: REFERRAL_PER_COMPANY - spent,
                 priority: admission.priority, days: admission.days,
                 property: job.property, order: plans.length });
  });

  // An application submitted today or yesterday is automatically the same class
  // of urgent ask as a person ticking Priority on the Referral tab. Everything
  // else keeps its established open-first/App-tab order, rather than a policy
  // addition silently reshuffling a long-standing pipeline.
  plans.sort(function (left, right) {
    var lifted = (right.priority ? 1 : 0) - (left.priority ? 1 : 0);
    if (lifted) return lifted;
    // Freshness is the next decision: an application made today must be offered
    // before one made yesterday. Both are Priority, but treating them as one
    // bucket lets the order of the App tab decide which fresh application gets
    // the first slot. Older applications keep the established queue order.
    if (left.priority && right.priority && left.days !== right.days) {
      return left.days - right.days;
    }
    return left.order - right.order;
  });

  // Work one company cluster at a time. This keeps the six contacts for one
  // application together in the schedule, while the 15-message daily cap still
  // limits the total cluster size that can be sent on any day.
  plans.forEach(function (plan) {
    while (plan.room > 0) {
      // The next person here nobody has been written to. Walking the skips rather
      // than filtering them up front keeps the count honest.
      while (plan.at < plan.people.length && asked[plan.people[plan.at].email]) {
        skipped++;
        plan.at++;
      }
      if (plan.at >= plan.people.length) { plan.room = 0; break; }
      var person = plan.people[plan.at];

      var slot = outreachReferralSlot_(plan.job.company, today, load, roomOn,
                                       plan.priority, plan.priority,
                                       new Date(today.getFullYear(), today.getMonth(),
                                                today.getDate() + (plan.days === 0 ? 1 : 0)));
      if (!slot) break;

      var attempt = plan.spent + plan.taken + 1;
      var tier = outreachReferralTier_(person.title, person.seniority);
      var template = outreachBalancedReferralTemplateFor_(
        tier, plan.job.company, attempt, templateLoad);
      booked.push({
        company: plan.job.company,
        role: plan.job.role,
        jobLink: plan.job.link,
        person: person,
        tier: tier,
        template: template,
        // The Referral sheet persists its body-template number. Recover the
        // corresponding stable attempt so the subject and resume-bullet pair
        // remain reproducible when a queued row is drafted later.
        attempt: outreachReferralAttemptForTemplate_(plan.job.company, template),
        scheduled: slot,
        priority: plan.priority
      });
      asked[person.email] = true;
      plan.at++;
      plan.taken++;
      plan.room--;

      outreachReferralLoadAdd_(load, slot, plan.job.company);
    }
  });

  return { booked: booked, skipped: skipped };
}

/**
 * Rows whose hour has come, in the order they were booked.
 *
 * Compared on the whole timestamp rather than the day. A referral tab holding six
 * rows dated today is six people spread across eleven hours, and a day comparison
 * would send all six at whichever firing first noticed the date.
 */
function outreachReferralDueNow_(referralRows, now, queueRows, priorityDaysByIndex) {
  // First in EMAIL_PATH_ORDER, so nothing is held back ahead of this one and the
  // only limit is the budget itself. It is still checked: three paths sharing one
  // mailbox means even the path that goes first can find the day already spent,
  // on a morning the cold path was catching up from downtime.
  var room = outreachBudgetRoom_(queueRows, referralRows, now, 'referral');
  if (room <= 0) return [];
  priorityDaysByIndex = priorityDaysByIndex || {};
  return referralRows.filter(function (row) {
    // Drafted, not Queued. A row waiting to be sent has already been written and
    // has sat its hour in Drafts; Queued is the state before any of that. This
    // said Queued while the path went straight from booked to sent, and kept
    // saying it after the drafting step landed, at which point it matched nothing.
    return row.status === STATUS_DRAFTED && row.scheduled && row.scheduled <= now
        && row.email && row.jobLink;
  }).sort(function (left, right) {
    // Priority ahead of the clock. Within automatic Priority, today then
    // yesterday still wins when both rows are overdue and the budget cannot send
    // them all in one firing. A manually ticked row keeps the original first
    // position, just as it does during re-planning.
    var leftOrder = priorityDaysByIndex[left.index] !== undefined
      ? priorityDaysByIndex[left.index] : (left.priority ? -1 : Infinity);
    var rightOrder = priorityDaysByIndex[right.index] !== undefined
      ? priorityDaysByIndex[right.index] : (right.priority ? -1 : Infinity);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.scheduled - right.scheduled;
  }).slice(0, room);
}


/**
 * How many referral asks a given day can still afford across the whole mailbox.
 *
 * Returned as a function rather than a table because the planner asks about days
 * it has not thought of yet: it walks forward until it finds room, and how far it
 * walks depends on what it has already placed.
 *
 * This is where the three paths meet. Referral gets its own twenty-message
 * allowance first. The lower paths receive only the remaining mailbox room after
 * these rows are booked, so a cold-email trigger cannot consume Referral's slots
 * just because it happened to run first. If fewer than twenty Referral rows exist,
 * the unused room remains available to Email and Reply.
 */
function outreachReferralRoomOn_(queueRows, referralRows) {
  return function (day) {
    return outreachBudgetRoom_(queueRows, referralRows, day, 'referral');
  };
}

/**
 * A cancelled row's slot handed back to the rows behind it.
 *
 * The queue is a line, and calling somebody off should move the line up rather
 * than leave a hole in it. Without this, cancelling six rows on one day means six
 * unused hours and everything behind them still waiting a week.
 *
 * Only Queued rows are re-timed, and that restriction is the whole safety of this
 * function. A Drafted row has a message written, addressed and sitting in Gmail
 * against a particular hour; moving its hour earlier would have it sent before the
 * hour it was supposed to be readable in, which is the one guarantee the drafting
 * step exists to give. Sent rows are history. Both still occupy their day, so the
 * caps continue to count them.
 *
 * Order is preserved: rows are re-placed in the order they were already going out,
 * so a re-plan tightens the queue without reshuffling who is next.
 */
function outreachReferralReplan_(referralRows, today, roomOn, fastPriorityIndexes,
                                 priorityDaysByIndex) {
  fastPriorityIndexes = fastPriorityIndexes || {};
  priorityDaysByIndex = priorityDaysByIndex || {};
  var fixed = {};
  // A row whose drafting window has opened is no longer merely a booking to move
  // around. The draft step later in this same cycle must get to act on it first.
  // Otherwise a transient Gmail/Drive failure leaves it Queued, and the next
  // replan sees its hour as past and moves it forward again before drafting can
  // retry. That turns one failed dependency into a queue that slips by an hour
  // forever and never reaches Gmail.
  var draftDueBy = new Date(today.getTime() + DRAFT_LEAD_HOURS * 3600000);
  var add = function (when, company, priority) {
    outreachReferralLoadAdd_(fixed, when, company, priority);
  };

  var movable = [];
  referralRows.forEach(function (row) {
    if (row.status === STATUS_QUEUED && !row.cancel) {
      if (row.scheduled && row.scheduled <= draftDueBy) {
        add(row.scheduled, row.company, row.priority);
      } else {
        movable.push(row);
      }
      return;
    }
    // Cancelled rows hold nothing. That is the point of cancelling one.
    if (row.status === STATUS_CANCELLED || row.cancel) return;
    add(row.scheduled, row.company, row.priority);
  });

  // Priority first, then the order they were already going out in. Ticking the box
  // has to move the row to the front of the queue rather than merely to the front
  // of whatever happens to be due at the same minute, or a row marked urgent on
  // Monday and booked for Friday is still going on Friday.
  //
  // It moves the whole ask with it. Six people at one company are one decision,
  // and lifting one of them above the other five would send the ask twice over,
  // days apart, to colleagues who can see each other's mail.
  var urgent = {};
  var automaticPriorityDays = {};
  referralRows.forEach(function (row) {
    if (priorityDaysByIndex[row.index] !== undefined) {
      automaticPriorityDays[row.index] = priorityDaysByIndex[row.index];
    }
    if (!row.priority) return;
    outreachReferralGroupOf_(referralRows, row).forEach(function (member) {
      urgent[member.index] = true;
      if (priorityDaysByIndex[row.index] !== undefined) {
        automaticPriorityDays[member.index] = priorityDaysByIndex[row.index];
      }
    });
  });
  // Two lines, not one, and the ticked one is served whole before the other is
  // looked at. A tick that only lifted a row above the rows due at the same minute
  // would mean "slightly sooner"; ahead of everything unticked is what it was
  // asked to mean. Within either line, preserve company clusters so a fresh
  // application is handled as one coherent referral ask.
  var byTime = function (left, right) {
    var a = left.scheduled ? left.scheduled.getTime() : Infinity;
    var b = right.scheduled ? right.scheduled.getTime() : Infinity;
    return a === b ? left.index - right.index : a - b;
  };
  var priorityOrder = function (row) {
    // A manually ticked row keeps the original Priority meaning and remains
    // ahead of the automatic fresh-application lane. Within that lane, today
    // must precede yesterday regardless of the hours the rows had before this
    // re-plan.
    if (automaticPriorityDays[row.index] !== undefined) {
      return automaticPriorityDays[row.index];
    }
    return row.priority ? -1 : Infinity;
  };
  var byPriorityThenTime = function (left, right) {
    var a = priorityOrder(left), b = priorityOrder(right);
    return a === b ? byTime(left, right) : a - b;
  };
  var ticked = movable.filter(function (row) { return urgent[row.index]; })
    .sort(byPriorityThenTime);
  var rest = movable.filter(function (row) { return !urgent[row.index]; }).sort(byTime);
  var clusterRows = function (rows) {
    var groups = {}, order = [];
    rows.forEach(function (row) {
      var key = outreachNameKey_(row.company);
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(row);
    });
    return order.reduce(function (all, key) { return all.concat(groups[key]); }, []);
  };
  movable = clusterRows(ticked).concat(clusterRows(rest));

  var moved = [];
  movable.forEach(function (row) {
    var age = priorityDaysByIndex[row.index];
    var latestDay = new Date(today.getFullYear(), today.getMonth(),
                             today.getDate() + (age === 0 ? 1 : 0));
    var slot = outreachReferralSlot_(row.company, today, fixed, roomOn,
                                     urgent[row.index], fastPriorityIndexes[row.index] === true,
                                     latestDay);
    // A row with nowhere to go keeps the hour it already had, so the hour has to
    // go on being counted. Returning without it let the next row be placed on top
    // of an hour the tab still shows as taken — the day's arithmetic quietly
    // diverging from the day's rows, which is the one thing this function exists
    // to keep in step.
    if (!slot) { add(row.scheduled, row.company, urgent[row.index]); return; }
    add(slot, row.company, urgent[row.index]);
    // Only a real change is reported. A re-plan that rewrites every row to the
    // value it already held would touch the whole tab every hour, and the version
    // history would stop being a record of anything.
    //
    // A missing draft hour counts as a change even when the send hour has not
    // moved. Rows booked before that column was filled in would otherwise never
    // get one: they sit at exactly the hour the planner would give them, so the
    // comparison above passes them over every hour for ever, and the column stays
    // half empty with no way to tell which half is waiting for what.
    var stale = !row.scheduled || row.scheduled.getTime() !== slot.getTime();
    if (stale || !row.draftedAt) {
      moved.push({ index: row.index, scheduled: slot });
    }
  });
  return moved;
}

/**
 * The rows whose Gmail draft is now pointing at a message nobody wants sent.
 *
 * Cancelling on the sheet has to reach the mailbox, or the draft sits there and
 * the next person to open Drafts finds a message the tab says was called off. The
 * bound script cannot do this itself: it runs as the tracker's account and the
 * drafts belong to the sender's.
 */
function outreachReferralAbandoned_(referralRows) {
  return referralRows.filter(function (row) {
    return (row.status === STATUS_CANCELLED || row.cancel) && row.draftId;
  });
}


/**
 * The ask a row belongs to: one employer, one posting.
 *
 * The planner picks a single representative application per employer and asks up
 * to six people about it, so six rows routinely carry the same company and role.
 * They are not six decisions. Calling the ask off should be one action, and the
 * group is what "the ask" means.
 *
 * A row missing either field belongs to no group and is returned as itself. That
 * is deliberate rather than defensive: an empty company would otherwise collide
 * with every other empty company on the tab, and one tick on a half-written row
 * would cancel every other half-written row with it.
 */
function outreachReferralGroupKey_(company, role, index) {
  var left = outreachNameKey_(company);
  var right = outreachNameKey_(role);
  if (!left || !right) return 'row:' + index;
  return left + '\u0000' + right;
}

/**
 * The hour a referral row is filed under.
 *
 * Scheduled At first, because that is the promise the row is making. Drafted At
 * and Sent At are fallbacks for rows that lost their schedule — a sent row keeps
 * its Scheduled At, so this only reaches past the first column for a row somebody
 * has edited by hand.
 */
function outreachReferralRowTime_(row) {
  var columns = [R_SCHEDULED, R_DRAFTED_AT, R_SENT_AT];
  for (var i = 0; i < columns.length; i++) {
    var value = row[columns[i] - 1];
    if (value && typeof value.getTime === 'function') {
      var time = value.getTime();
      if (!isNaN(time)) return time;
    }
    if (typeof value === 'number' && value) return value;
  }
  return null;
}

/**
 * The rows in the order a person reads them: earliest first, called-off last.
 *
 * The tab used to be in the order the planner appended, which grouped an
 * employer's six people together because that is how they were booked. It was
 * readable as a record of decisions and unreadable as a queue: the next thing due
 * could be anywhere, and after the planner became breadth-first the clusters
 * stopped even being contiguous.
 *
 * In time order the tab answers the question it is actually opened with — what has
 * gone, and what is next. Sent rows sit above Queued ones because the past is
 * above the future, which is the same shape the Email tab has.
 *
 * Cancelled sinks. Its time is not a fact about anything: the row is not going out
 * at that hour or any other, and leaving it in line puts a dead row between two
 * live ones. This mirrors outreachTimeOrder_ on the cold path deliberately — two
 * tabs side by side have to be read the same way.
 *
 * Pure, and returns the same row objects rearranged, so the caller can tell
 * whether anything moved before writing the table back.
 */
function outreachReferralTimeOrder_(values) {
  return values.map(function (row, index) {
    return {
      row: row,
      index: index,
      when: outreachReferralRowTime_(row),
      calledOff: outreachCell_(row, R_STATUS) === STATUS_CANCELLED ? 1 : 0
    };
  }).sort(function (a, b) {
    if (a.calledOff !== b.calledOff) return a.calledOff - b.calledOff;
    if (a.when === null || b.when === null) {
      if (a.when === b.when) return a.index - b.index;
      return a.when === null ? 1 : -1;
    }
    return a.when === b.when ? a.index - b.index : a.when - b.when;
  }).map(function (entry) { return entry.row; });
}

/**
 * What the tab actually says, day by day, and whether it obeys its own rules.
 *
 * Written because three separate conversations about "why is it still clustered"
 * were argued from screenshots. A screenshot shows an arrangement; it does not say
 * whether the arrangement is what the caps allow, and the two questions have
 * different answers when the tab is a snapshot from before a fix.
 *
 * Reports per day: how many asks, how many employers, and every employer over its
 * cap — the ticked ones measured against REFERRAL_PRIORITY_COMPANY_CAP and the
 * rest against REFERRAL_COMPANY_DAILY_CAP. A day with no offenders is a day the
 * planner and the tab agree about.
 *
 * Reads only. It decides nothing and writes nothing.
 */
function outreachReferralAudit_(referralRows) {
  var days = {}, order = [];
  (referralRows || []).forEach(function (row) {
    if (row.status === STATUS_CANCELLED || !row.scheduled) return;
    var key = outreachDayKey_(row.scheduled);
    if (!days[key]) { days[key] = { total: 0, companies: {}, ticked: {} }; order.push(key); }
    var day = days[key];
    day.total++;
    var name = outreachNameKey_(row.company);
    day.companies[name] = (day.companies[name] || 0) + 1;
    if (row.priority) day.ticked[name] = true;
  });

  // Numeric sort. outreachDayKey_ is a timestamp, and Array#sort compares as text
  // by default, which would file the day the millisecond count gains a digit in
  // the wrong place.
  order.sort(function (a, b) { return a - b; });
  return order.map(function (key) {
    var day = days[key];
    var over = [];
    Object.keys(day.companies).forEach(function (name) {
      var cap = day.ticked[name] ? REFERRAL_PRIORITY_COMPANY_CAP : REFERRAL_COMPANY_DAILY_CAP;
      if (day.companies[name] > cap) {
        over.push(name + ' ' + day.companies[name] + '/' + cap);
      }
    });
    return {
      // The timestamp is the key the counting needs; a person reading the log
      // needs the date. Both, rather than making the caller convert one back.
      day: new Date(key).toDateString(),
      at: key,
      total: day.total,
      companies: Object.keys(day.companies).length,
      over: over
    };
  });
}

/**
 * Run by hand: say what the tab looks like and whether it breaks its own rules.
 *
 * The answer to "is this clustered because the code is wrong, or because the tab
 * has not been re-planned since the code changed". Offenders mean the first;
 * a clean report on a tab that still looks clustered means the second, and
 * replanReferralAsks is the cure.
 */
function auditReferralTab() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var referral = tracker.getSheetByName(TAB_REFERRAL);
  if (!referral) { Logger.log(outreachReferralNotSetUp_()); return []; }
  var report = outreachReferralAudit_(outreachReadReferralRows_(referral));
  var bad = 0;
  report.forEach(function (day) {
    if (day.over.length) bad++;
    Logger.log(day.day + '  ' + day.total + ' asks across ' + day.companies
             + ' employers' + (day.over.length ? '   OVER CAP: ' + day.over.join(', ') : ''));
  });
  Logger.log(bad ? bad + ' day(s) break the per-employer cap — the tab disagrees with the planner.'
                 : 'Every day is within its per-employer cap.');
  return report;
}

/**
 * Put the Referral tab in time order, writing only if it is not already there.
 *
 * Sorting values rather than calling Range.sort is what makes it testable, and it
 * is safe for the same reason it is cheap: every data row on this tab carries
 * identical dressing, the colours are keyed off the values themselves, and the
 * dropdowns and formats are applied by column to every row alike. Nothing travels
 * with a row that needs to.
 *
 * Row numbers are read fresh on every pass and never stored between runs, so a row
 * changing places is invisible to everything except somebody looking at the tab.
 *
 * **The rule, so it stays true rather than happening to be true.** Whatever changes
 * a sort key on this tab is responsible for calling this before it returns. The
 * keys are Scheduled At and whether the row is Cancelled — nothing else moves a
 * row. That gives three groups:
 *
 *   owns the sort    planReferralAsks, replanReferralAsks, settleReferralTab_,
 *                    repairMisreadReferralBounces, sortReferralTab. Each can be
 *                    run on its own and leaves a table somebody can read.
 *   cannot move a row  draftReferralAsks and scanReferralReplies. Drafted, Replied
 *                    and Bounced are not Cancelled and none of them touches
 *                    Scheduled At, so the row stays where it is.
 *   covered by the cycle  sendReferralAsks, which is Sent — harmless — except on
 *                    the branch where a deleted draft makes a row Cancelled. It
 *                    only ever runs inside runOutreachCycle, whose last step
 *                    refiles the tab, so the sinking happens in the same firing.
 *
 * The cycle's own referralSorted step is the backstop for that third group, and it
 * is why the group is allowed to exist. Add a fourth caller that writes a status
 * or an hour outside the cycle and it belongs in the first group, not the third.
 */
function outreachSortReferralByTime_(referral) {
  if (!referral) return 0;
  var last = referral.getLastRow();
  if (last < 3) return 0;
  var range = referral.getRange(2, 1, last - 1, R_WIDTH);
  var values = range.getValues();
  var sorted = outreachReferralTimeOrder_(values);

  var moved = 0;
  for (var i = 0; i < values.length; i++) if (sorted[i] !== values[i]) moved++;
  if (!moved) return 0;
  range.setValues(sorted);
  return moved;
}

/**
 * The company-and-role groups somebody has already answered from.
 *
 * The unit is the group rather than the row, and rather than the company, because
 * that is the unit a reply actually settles. One engineer answering about the
 * summer intake says nothing about a different req at the same employer, and it
 * says everything about the five colleagues who were going to be asked about that
 * one. It is the same key Priority and Cancel expand a tick over, for the same
 * reason: six people at one company and one role are one decision.
 *
 * Only STATUS_REPLIED counts. Bounced is the address failing, not the person
 * declining, and the colleague behind them is still worth asking.
 */
function outreachReferralRepliedGroups_(referralRows) {
  var replied = {};
  (referralRows || []).forEach(function (row) {
    if (row.status !== STATUS_REPLIED) return;
    replied[outreachReferralGroupKey_(row.company, row.role, row.index)] = true;
  });
  return replied;
}

/**
 * Every row the tick on one row should take with it.
 *
 * Read off the tab rather than trusted to be adjacent. The rows of a group
 * usually are, because they were written together and the sort keeps them so,
 * but "usually" is not a rule and a group split by a hand-moved row would
 * otherwise be half cancelled and half live.
 *
 * A Sent row inside the group is never included. That message has gone, and
 * marking it Cancelled would be the tab claiming something untrue about a mailbox
 * it no longer controls.
 */
function outreachReferralGroupOf_(referralRows, row) {
  var key = outreachReferralGroupKey_(row.company, row.role, row.index);
  return referralRows.filter(function (other) {
    if (other.status === STATUS_SENT) return false;
    return outreachReferralGroupKey_(other.company, other.role, other.index) === key;
  });
}

/**
 * The rows a run has to write Cancelled onto, ticks expanded to whole asks.
 *
 * The tick is the record, not whether onEdit saw it: a box filled by a paste, a
 * fill-down or an undo never fires a simple trigger at all, and the sheet is
 * still what the next run reads.
 */
function outreachReferralToCancel_(referralRows) {
  var wanted = {};
  referralRows.forEach(function (row) {
    if (!row.cancel) return;
    outreachReferralGroupOf_(referralRows, row).forEach(function (member) {
      wanted[member.index] = member;
    });
  });
  // A row whose Status was set to Cancelled by hand is already where it should be
  // and is left alone. That is the escape hatch for dropping one person out of an
  // ask without dropping the ask: the checkbox is the group switch, the Status
  // dropdown is the single-row one.
  return Object.keys(wanted).map(function (index) { return wanted[index]; })
    .filter(function (row) { return row.status !== STATUS_CANCELLED; })
    .sort(function (left, right) { return left.index - right.index; });
}


/**
 * The Referral tab reconciled against the App tab, which is the only place the
 * truth about an application lives.
 *
 * Two answers, because a row can be wrong in two directions and only one of them
 * used to be handled.
 *
 * `repoint` is a row pointing at an older application than the one now worth
 * asking about. Intuit had one software role and gained a newer one; the ask that
 * has not gone should be about the application still moving, whose posting is
 * likeliest still open.
 *
 * `retire` is a row whose reason for existing has gone: the company has no
 * qualifying application any more. That happens when the last one is rejected,
 * when it is edited into a role this path does not send about, and it happened to
 * every row on the tab the day the intake rule was turned back on. The old version
 * of this function returned nothing in that case and the row simply stayed, still
 * booked, still due, still about to go out asking a stranger for a favour over an
 * application that no longer qualifies. Silence was the wrong answer: a row this
 * cannot justify is a row it should close.
 *
 * Only rows that have not been sent are touched either way. A sent message named a
 * role and a link, and rewriting or closing the row afterwards would leave the tab
 * describing a message that was never written. Drafted rows are handled and their
 * draft goes with them, because a draft naming a posting the writer has moved on
 * from is worse than no draft at all.
 */
function outreachReferralReconcile_(referralRows, applications, targetCompanies) {
  var best = {}, byCompany = {};
  applications.forEach(function (one) {
    if (!one.company) return;
    var key = outreachNameKey_(one.company);
    if (!byCompany[key]) byCompany[key] = [];
    byCompany[key].push(one);
  });
  Object.keys(byCompany).forEach(function (key) {
    var current = byCompany[key].filter(function (application) {
      return outreachReferralAdmission_(application, new Date(), targetCompanies).eligible;
    });
    var pick = outreachPickReferralRole_(current);
    if (pick) best[key] = pick;
  });

  // Replied and Bounced join Sent and Cancelled as states this leaves alone. All
  // four are history: the message went, and something came back or nothing did.
  // Retiring a Replied row would have the reply gate below close the very row that
  // proves the reply, and repointing a Bounced one would rewrite a record of an
  // address that is already out of circulation. outreachAttemptsWanted_ draws the
  // same line on the cold path, and the two tabs have to mean the same thing.
  var open = referralRows.filter(function (row) {
    if (row.status === STATUS_SENT || row.status === STATUS_CANCELLED) return false;
    if (row.status === STATUS_REPLIED || row.status === STATUS_BOUNCED) return false;
    return !row.cancel;
  });

  // Checked before the application is, because it is the more specific reason and
  // the one somebody will want to read off Last Error. A group whose company has
  // also stopped qualifying would otherwise be closed with the vaguer sentence.
  var replied = outreachReferralRepliedGroups_(referralRows);

  var repoint = [], retire = [];
  open.forEach(function (row) {
    if (replied[outreachReferralGroupKey_(row.company, row.role, row.index)]) {
      retire.push({
        index: row.index, draftId: row.draftId,
        reason: 'Somebody at ' + row.company + ' replied about this role, so the '
              + 'rest of the ask was called off rather than sent.'
      });
      return;
    }
    var pick = best[outreachNameKey_(row.company)];
    if (!pick) {
      retire.push({
        index: row.index, draftId: row.draftId,
        // Written into Last Error rather than left blank, because a row that went
        // Cancelled on its own is the first thing somebody will ask about.
        reason: 'No application at ' + row.company + ' qualifies any more, so this '
              + 'ask was closed rather than sent.'
      });
      return;
    }
    if (outreachNameKey_(pick.role) !== outreachNameKey_(row.role)
        || pick.link !== row.jobLink) {
      repoint.push({ index: row.index, role: pick.role, jobLink: pick.link,
                     draftId: row.draftId });
    }
  });
  return { repoint: repoint, retire: retire };
}

/**
 * The wreckage left by reading blank rows as asks, cleared off the tab.
 *
 * outreachReadReferralRows_ used to hand every row between row 2 and getLastRow to
 * the reconciler, blank ones included. A blank row has no company, so no
 * application could match it, so it was retired: Cancelled written into its Status
 * and a sentence into its Last Error. That raised getLastRow by one, and the next
 * firing found one more blank row to retire. The tab grew from 173 rows to 500 that
 * way, and every one of them was read, sorted and written back every hour.
 *
 * The reader now filters those rows out, so this is a one-off — kept as a function
 * rather than done by hand because the same wreckage is worth being able to clear
 * again without anybody having to work out which rows are safe to touch.
 *
 * Only rows strictly below the last real ask are cleared, which is what makes this
 * safe to run at any time. A blank row sitting between two real ones is left alone:
 * the reader already ignores it, and closing the gap would renumber every row below
 * it, while a Gmail draft is pinned to the row number it was written against.
 */
function repairReferralBlankRows() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var referral = tracker.getSheetByName(TAB_REFERRAL);
  if (!referral) { Logger.log(outreachReferralNotSetUp_()); return { cleared: 0 }; }

  var last = referral.getLastRow();
  if (last < 2) return { cleared: 0 };
  var values = referral.getRange(2, 1, last - 1, R_WIDTH).getValues();

  var lastReal = 1;
  values.forEach(function (row, i) {
    if (String(row[R_COMPANY - 1] || '').trim() || String(row[R_EMAIL - 1] || '').trim()) {
      lastReal = i + 2;
    }
  });

  if (lastReal >= last) {
    Logger.log('Referral tab: nothing below the last real ask at row ' + lastReal + '.');
    return { cleared: 0, lastRealRow: lastReal, lastRow: last };
  }

  var count = last - lastReal;
  referral.getRange(lastReal + 1, 1, count, R_WIDTH).clearContent();
  Logger.log('Referral tab: cleared ' + count + ' empty row(s) below row ' + lastReal + '.');
  return { cleared: count, lastRealRow: lastReal, wasLastRow: last };
}
