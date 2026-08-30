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
 * Nothing is gated on this list: the allowlist above already refuses everything
 * it does not recognise, and a second list that could also refuse would be a
 * second place to be wrong. This exists so the App tab can say which kind of
 * wrong a link is, because "that is a Jobright redirect, paste the real one" and
 * "I do not recognise this host" ask a person to do different things.
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
 * Whether this link can be put in front of somebody being asked for a referral.
 *
 * Two ways to pass. Either the host is an applicant tracking system, or it is the
 * employer's own domain: jobs.apple.com and careers.google.com receive their own
 * applications and are the best possible link, but there is no list of them and
 * there never will be, so the company's domain out of the ColdEmail dataset is
 * what recognises them.
 *
 * An http link is refused. Everything here is a form that will be typed into.
 */
function outreachReferralLinkOk_(url, companyDomain) {
  var text = String(url == null ? '' : url).trim();
  if (!/^https:\/\//i.test(text)) return false;
  var host = outreachReferralHost_(text);
  if (!host) return false;
  if (outreachReferralUnder_(host, String(companyDomain || '').toLowerCase().replace(/^www\./, ''))) {
    return true;
  }
  return REFERRAL_ATS_DOMAINS.some(function (domain) {
    return outreachReferralUnder_(host, domain);
  });
}

/**
 * Why a link was refused, for the person who has to fix it.
 *
 * Returned rather than logged, because where this ends up is next to the row on
 * the App tab that it is about. '' means the link was accepted.
 */
function outreachReferralLinkProblem_(url, companyDomain) {
  var text = String(url == null ? '' : url).trim();
  if (!text) return 'no link';
  if (outreachReferralLinkOk_(text, companyDomain)) return '';
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
  sheet.getRange(2, 1, last - 1, E_WIDTH).getValues().forEach(function (row) {
    var email = outreachCell_(row, E_EMAIL).toLowerCase();
    var company = outreachCell_(row, E_COMPANY);
    if (!email || email.indexOf('@') === -1 || !company) return;
    // The same gate outreachReadContacts_ puts on the recruiter tab, and it is
    // here for the day the export changes rather than for today: every row this
    // tab currently holds passed an anymail "valid" check in export_referrals.py
    // before it was written, so this line drops nothing right now. That is both
    // why it was missing and why it is worth having — the filter it duplicates
    // lives in another repository, this path's cap is the one being raised, and
    // bounce rate rather than volume is what gets a sending account penalised.
    if (outreachCell_(row, E_VERIFY) === UNSENDABLE_VERIFY) return;
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
      bucket: outreachCell_(row, E_BUCKET)
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
  var link = outreachReferralLinkOk_(official, domain) ? official
           : (outreachReferralLinkOk_(applied, domain) ? applied : '');
  return {
    index: index,
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
 * Which of a company's applications is the one to ask about.
 *
 * Four applications at one employer is not four referrals. Asking six people at
 * one company about six different requisitions reads, if any two of them compare
 * notes, as somebody applying to everything rather than to something. One
 * application is chosen and everybody there is asked about that one.
 *
 * Ordered, and every tie broken so the answer does not move between runs: a role
 * the shortener recognises as a software engineering internship first, because
 * that is the job actually wanted and the rest are near misses; then the most
 * recently applied to, because that is the one still moving and the one the
 * writer can speak about; then the role text, which settles whatever is left.
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
    return outreachShortRole_(one.role) === DEFAULT_SHORT_ROLE ? 0 : 1;
  };
  usable.sort(function (left, right) {
    // The most recent application first, and this is the ordering that was wrong.
    // It used to rank by how squarely the title read as a software engineering
    // internship and only then by date, which meant a company that gained a newer
    // application kept being asked about the older one: Intuit's "Intern, Software
    // Engineering" outranked its "Summer 2027: Software Engineering Intern - Full
    // Stack" purely because the shortener recognised the first heading and not the
    // second. The newer application is the one still moving, the one the writer
    // can speak to, and the one whose posting is likeliest still open.
    var leftAt = left.dateApplied ? left.dateApplied.getTime() : 0;
    var rightAt = right.dateApplied ? right.dateApplied.getTime() : 0;
    if (leftAt !== rightAt) return rightAt - leftAt;
    // Only then how well the title reads, for two applications made the same day.
    if (rank(left) !== rank(right)) return rank(left) - rank(right);
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
      reason: outreachReferralLinkProblem_(one.officialLink || one.appliedLink, one.domain)
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
 * Cancelled rows count as written to. The row was made, the person was chosen,
 * and somebody decided against it; putting them back in the queue on the next
 * run would undo that decision every hour.
 */
function outreachReferralAsked_(referralRows) {
  var asked = {};
  referralRows.forEach(function (row) {
    if (row.email) asked[row.email] = true;
  });
  return asked;
}

/**
 * How many people at one employer already have a row, whatever became of it.
 *
 * Failed rows are counted. A message that could not be sent still consumed one
 * of the three people at that company, because the reason it failed is almost
 * never the person: retrying by choosing somebody else spends the employer's
 * remaining names on one broken run.
 */
function outreachReferralSpent_(referralRows, company) {
  var tokens = outreachCompanyTokens_(company);
  if (!tokens.length) return 0;
  return referralRows.filter(function (row) {
    return outreachSameEmployer_(tokens, row.tokens);
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
function outreachReferralLoad_(referralRows, booked) {
  var load = {};
  var add = function (when, company) {
    if (!when) return;
    var key = outreachDayKey_(when);
    if (!load[key]) load[key] = { total: 0, companies: {} };
    load[key].total++;
    var name = outreachNameKey_(company);
    load[key].companies[name] = (load[key].companies[name] || 0) + 1;
  };
  referralRows.forEach(function (row) {
    if (row.status !== STATUS_CANCELLED) add(row.scheduled, row.company);
  });
  (booked || []).forEach(function (item) { add(item.scheduled, item.company); });
  return load;
}


/**
 * The first slot this person can have.
 *
 * Two caps, and they are different kinds of limit. The daily one is about the
 * sending account: fourteen referral notes a day out of one mailbox, on top of
 * the cold path's own volume. The per-employer one is about how the queue is
 * spent — one person per company per day, so a day of sending reaches fourteen
 * employers rather than two, and the second ask at a company is still unwritten
 * when the first one is read.
 *
 * `priority` raises the per-employer cap to REFERRAL_PRIORITY_COMPANY_CAP, and
 * raises is the word: it used to remove it. A ticked box is somebody saying they
 * want this company worked today rather than a fortnight from now, and holding the
 * group to one a day would make the tick nothing but a reordering — but removing
 * the cap let two ticked employers take twelve of a day's fourteen slots and leave
 * eight other companies sharing two, which is the clustering the breadth-first
 * planner exists to prevent, reintroduced through a side door.
 *
 * The account's own cap is never lifted either way, because the mailbox does not
 * care whose idea the day was.
 *
 * Walks forward a day at a time from today and takes the first slot that clears
 * both. There is no ceiling: unlike a follow up, a referral ask has no window it
 * can miss, so a backlog is spread rather than dropped.
 */
function outreachReferralSlot_(company, today, load, roomOn, priority) {
  var hours = outreachSpaceHours_(REFERRAL_DAILY_CAP, REFERRAL_HOUR_FIRST, REFERRAL_HOUR_LAST);
  var name = outreachNameKey_(company);
  for (var ahead = 0; ahead < 180; ahead++) {
    var day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + ahead);
    var key = outreachDayKey_(day);
    // Saturday and Sunday are skipped whole. A first message to a stranger asking
    // for a favour, arriving on a Saturday morning, says the sender either did not
    // notice or did not mind; it is the same message on Monday and reads better.
    if (!REFERRAL_WEEKENDS && (day.getDay() === 0 || day.getDay() === 6)) continue;
    var used = load[key] || { total: 0, companies: {} };
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
    // The day's own bookings then push past that. Adding them to the offset rather
    // than indexing by them alone is what stops two rows landing on one hour: on a
    // day already half gone, indexing by the count alone kept returning the first
    // hour still in the future for every row in turn.
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
 * There is still no waiting period. A referral attached the day after applying is
 * worth more than one attached a fortnight later, because the file is still near
 * the top of somebody's queue.
 */
function outreachReferralPlan_(appRows, referralRows, employees, today, roomOn) {
  var asked = outreachReferralAsked_(referralRows);
  var load = outreachReferralLoad_(referralRows, null);
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
    var job = outreachPickReferralRole_(byCompany[key]);
    if (!job) return;
    if (replied[outreachReferralGroupKey_(job.company, job.role, -1)]) return;

    var people = outreachEmployeesFor_(employees, job.company);
    if (!people.length) return;

    var spent = outreachReferralSpent_(referralRows, job.company);
    if (REFERRAL_PER_COMPANY - spent <= 0) return;

    plans.push({ job: job, people: people, at: 0, taken: 0,
                 spent: spent, room: REFERRAL_PER_COMPANY - spent });
  });

  // Round by round rather than company by company, and this is the change that
  // makes REFERRAL_COMPANY_DAILY_CAP mean what it says.
  //
  // The loop used to take one employer and book all six of its people before
  // looking at the next. Capping the day at one person per company spread those
  // six across six days, which is what the cap is for — but it did nothing about
  // the order of the companies, so the first fourteen employers filled the first
  // six days between them and the two hundredth waited a quarter of a year to hear
  // anything at all. The cap spread the six; it did not spread the 221.
  //
  // Inverted, the outer loop is the attempt number and the inner one is the
  // companies, so every employer gets its first ask before any employer gets its
  // second. A full pass over the live dataset is about three weeks rather than
  // five months, and the first ask is the one that has to land near the date
  // applied — the sixth is a message about an application the reader will have to
  // look up either way.
  //
  // It costs nothing in volume. 221 employers at six people is the same 1,326
  // messages in either order, over the same ninety five working days; what changes
  // is which of them go first. 221 employers heard from once beats 37 worked to
  // exhaustion, because the five extra notes at a company that was never going to
  // answer are the cheapest thing on the tab to give up.
  //
  // openFirst still orders the companies inside each round, so an employer already
  // part-way through is served before one nobody has opened. That rule was written
  // against the old loop and survives the inversion unchanged: it decides who goes
  // first within a round, where it used to decide who was finished first.
  for (var round = 0; round < REFERRAL_PER_COMPANY; round++) {
    var placed = 0;
    plans.forEach(function (plan) {
      if (plan.room <= 0) return;

      // The next person here nobody has been written to. Walking the skips rather
      // than filtering them up front keeps the count honest: an address is counted
      // once, on the round that first steps over it.
      while (plan.at < plan.people.length && asked[plan.people[plan.at].email]) {
        skipped++;
        plan.at++;
      }
      if (plan.at >= plan.people.length) { plan.room = 0; return; }
      var person = plan.people[plan.at];

      var slot = outreachReferralSlot_(plan.job.company, today, load, roomOn);
      if (!slot) return;

      var attempt = plan.spent + plan.taken + 1;
      booked.push({
        company: plan.job.company,
        role: plan.job.role,
        jobLink: plan.job.link,
        person: person,
        tier: outreachReferralTier_(person.title, person.seniority),
        template: outreachReferralIndex_(plan.job.company, attempt) + 1,
        attempt: attempt,
        scheduled: slot
      });
      asked[person.email] = true;
      plan.at++;
      plan.taken++;
      plan.room--;
      placed++;

      var dayKey = outreachDayKey_(slot);
      if (!load[dayKey]) load[dayKey] = { total: 0, companies: {} };
      load[dayKey].total++;
      var name = outreachNameKey_(plan.job.company);
      load[dayKey].companies[name] = (load[dayKey].companies[name] || 0) + 1;
    });
    // Nothing placed anywhere means no later round will place anything either:
    // every company is either finished or out of people, and the days ahead are
    // not going to get emptier by being asked about again.
    if (!placed) break;
  }

  return { booked: booked, skipped: skipped };
}

/**
 * Rows whose hour has come, in the order they were booked.
 *
 * Compared on the whole timestamp rather than the day. A referral tab holding six
 * rows dated today is six people spread across eleven hours, and a day comparison
 * would send all six at whichever firing first noticed the date.
 */
function outreachReferralDueNow_(referralRows, now, queueRows) {
  // First in EMAIL_PATH_ORDER, so nothing is held back ahead of this one and the
  // only limit is the budget itself. It is still checked: three paths sharing one
  // mailbox means even the path that goes first can find the day already spent,
  // on a morning the cold path was catching up from downtime.
  var room = outreachBudgetRoom_(queueRows, referralRows, now, 'referral');
  if (room <= 0) return [];
  return referralRows.filter(function (row) {
    // Drafted, not Queued. A row waiting to be sent has already been written and
    // has sat its hour in Drafts; Queued is the state before any of that. This
    // said Queued while the path went straight from booked to sent, and kept
    // saying it after the drafting step landed, at which point it matched nothing.
    return row.status === STATUS_DRAFTED && row.scheduled && row.scheduled <= now
        && row.email && row.jobLink;
  }).sort(function (left, right) {
    // Priority ahead of the clock. Two rows both overdue after a quiet weekend go
    // in the order somebody asked for, not the order they happened to be booked.
    var lifted = (right.priority ? 1 : 0) - (left.priority ? 1 : 0);
    if (lifted) return lifted;
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
 * This is where the three paths meet. outreachBudgetRoom_ subtracts what the cold
 * path and the follow-ups have already spent on that day and holds back nothing
 * for them, because referral leads EMAIL_PATH_ORDER — but it does subtract, so a
 * day the cold path has filled is a day this queue is told to skip rather than a
 * day it books into and discovers at sending time.
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
function outreachReferralReplan_(referralRows, today, roomOn) {
  var fixed = {};
  var add = function (when, company) {
    if (!when) return;
    var key = outreachDayKey_(when);
    if (!fixed[key]) fixed[key] = { total: 0, companies: {} };
    fixed[key].total++;
    var name = outreachNameKey_(company);
    fixed[key].companies[name] = (fixed[key].companies[name] || 0) + 1;
  };

  var movable = [];
  referralRows.forEach(function (row) {
    if (row.status === STATUS_QUEUED && !row.cancel) { movable.push(row); return; }
    // Cancelled rows hold nothing. That is the point of cancelling one.
    if (row.status === STATUS_CANCELLED || row.cancel) return;
    add(row.scheduled, row.company);
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
  referralRows.forEach(function (row) {
    if (!row.priority) return;
    outreachReferralGroupOf_(referralRows, row).forEach(function (member) {
      urgent[member.index] = true;
    });
  });
  // Two lines, not one, and the ticked one is served whole before the other is
  // looked at. A tick that only lifted a row above the rows due at the same minute
  // would mean "slightly sooner"; ahead of everything unticked is what it was
  // asked to mean.
  //
  // Each line is then interleaved so employers take turns within it. Sorting by
  // hour alone kept a company's rows adjacent — they were booked together — and
  // for ordinary rows the per-employer daily cap breaks that up anyway, so nobody
  // noticed. A ticked company raises that cap, so its six rows took the first six
  // hours in a row: the group arrived at the front, which was right, and arrived
  // as a block, which was not.
  var byTime = function (left, right) {
    var a = left.scheduled ? left.scheduled.getTime() : Infinity;
    var b = right.scheduled ? right.scheduled.getTime() : Infinity;
    return a === b ? left.index - right.index : a - b;
  };
  var ticked = movable.filter(function (row) { return urgent[row.index]; }).sort(byTime);
  var rest = movable.filter(function (row) { return !urgent[row.index]; }).sort(byTime);
  movable = outreachInterleaveByCompany_(ticked)
    .concat(outreachInterleaveByCompany_(rest));

  var moved = [];
  movable.forEach(function (row) {
    var slot = outreachReferralSlot_(row.company, today, fixed, roomOn,
                                     urgent[row.index]);
    // A row with nowhere to go keeps the hour it already had, so the hour has to
    // go on being counted. Returning without it let the next row be placed on top
    // of an hour the tab still shows as taken — the day's arithmetic quietly
    // diverging from the day's rows, which is the one thing this function exists
    // to keep in step.
    if (!slot) { add(row.scheduled, row.company); return; }
    add(slot, row.company);
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
function outreachReferralReconcile_(referralRows, applications) {
  var best = {}, byCompany = {};
  applications.forEach(function (one) {
    if (!one.company) return;
    var key = outreachNameKey_(one.company);
    if (!byCompany[key]) byCompany[key] = [];
    byCompany[key].push(one);
  });
  Object.keys(byCompany).forEach(function (key) {
    var pick = outreachPickReferralRole_(byCompany[key]);
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
