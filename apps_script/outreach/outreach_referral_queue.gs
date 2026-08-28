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
  if (!REFERRAL_REQUIRE_SEASON) return true;
  return new RegExp('\\b' + REFERRAL_SEASON_WORD + '\\b', 'i')
    .test(String(role == null ? '' : role));
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
    sentAt: outreachDate_(row[R_SENT_AT - 1]),
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
 * sending account: six referral notes a day out of one mailbox, on top of the
 * cold path's own volume. The per-employer one is about the reader: never two
 * people at one company on one day, because colleagues talk and two near
 * identical notes arriving at one company inside a day is the thing that gets
 * reported rather than deleted.
 *
 * Walks forward a day at a time from today and takes the first slot that clears
 * both. There is no ceiling: unlike a follow up, a referral ask has no window it
 * can miss, so a backlog is spread rather than dropped.
 */
function outreachReferralSlot_(company, today, load, roomOn) {
  var hours = outreachSpaceHours_(REFERRAL_DAILY_CAP, REFERRAL_HOUR_FIRST, REFERRAL_HOUR_LAST);
  var name = outreachNameKey_(company);
  for (var ahead = 0; ahead < 180; ahead++) {
    var day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + ahead);
    var key = outreachDayKey_(day);
    var used = load[key] || { total: 0, companies: {} };
    // Three limits, and the third is the one that knows about the rest of the
    // system. roomOn asks what the whole mailbox has left on that day once the
    // cold path and the follow-ups have taken their share, so a day this queue
    // could fill on its own is still refused when the account cannot afford it.
    // Optional, because the planner is also called from places holding no view
    // of the other two paths, and an unknown budget must not read as no budget.
    var cap = roomOn ? Math.min(REFERRAL_DAILY_CAP, roomOn(day)) : REFERRAL_DAILY_CAP;
    if (used.total >= cap) continue;
    if ((used.companies[name] || 0) >= REFERRAL_COMPANY_DAILY_CAP) continue;
    // The hour is chosen from how full the day is, not from the cap: a day the
    // budget has narrowed still spreads its few across the same eleven hours
    // rather than bunching them at the front.
    var hour = hours[Math.min(used.total, hours.length - 1)];
    var slot = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0);
    // Today's earlier hours are gone. A slot in the past would be sent by the
    // next firing regardless of the hour it claims, which quietly defeats the
    // spreading this function exists to do.
    //
    // Only this hour is skipped, not the whole day. An earlier version stepped to
    // the next day here, which meant that after 08:00 the day was written off
    // entirely and eleven usable hours went unused every time the queue was
    // rebuilt in the morning.
    if (ahead === 0 && slot <= today) {
      var later = null;
      for (var i = used.total; i < hours.length; i++) {
        var candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(),
                                 hours[i], 0, 0);
        if (candidate > today) { later = candidate; break; }
      }
      if (!later) continue;
      slot = later;
    }
    return slot;
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

  openFirst.forEach(function (key) {
    var applications = byCompany[key];
    var job = outreachPickReferralRole_(applications);
    if (!job) return;

    var people = outreachEmployeesFor_(employees, job.company);
    if (!people.length) return;

    var room = REFERRAL_PER_COMPANY - outreachReferralSpent_(referralRows, job.company);
    if (room <= 0) return;

    people.forEach(function (person) {
      if (room <= 0) return;
      if (asked[person.email]) { skipped++; return; }
      var slot = outreachReferralSlot_(job.company, today, load, roomOn);
      if (!slot) return;
      var tier = outreachReferralTier_(person.title, person.seniority);
      booked.push({
        company: job.company,
        role: job.role,
        jobLink: job.link,
        person: person,
        tier: tier,
        template: outreachReferralIndex_(job.company, REFERRAL_PER_COMPANY - room + 1) + 1,
        attempt: REFERRAL_PER_COMPANY - room + 1,
        scheduled: slot
      });
      asked[person.email] = true;
      room--;
      var dayKey = outreachDayKey_(slot);
      if (!load[dayKey]) load[dayKey] = { total: 0, companies: {} };
      load[dayKey].total++;
      var name = outreachNameKey_(job.company);
      load[dayKey].companies[name] = (load[dayKey].companies[name] || 0) + 1;
    });
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

  movable.sort(function (left, right) {
    var a = left.scheduled ? left.scheduled.getTime() : Infinity;
    var b = right.scheduled ? right.scheduled.getTime() : Infinity;
    return a === b ? left.index - right.index : a - b;
  });

  var moved = [];
  movable.forEach(function (row) {
    var slot = outreachReferralSlot_(row.company, today, fixed, roomOn);
    if (!slot) return;
    add(slot, row.company);
    // Only a real change is reported. A re-plan that rewrites every row to the
    // value it already held would touch the whole tab every hour, and the version
    // history would stop being a record of anything.
    if (!row.scheduled || row.scheduled.getTime() !== slot.getTime()) {
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
