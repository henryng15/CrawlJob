/**
 * Outreach — building one email.
 *
 * The template lives here rather than being generated into a CSV by ColdEmail,
 * so that changing a sentence is an edit to one file instead of a pipeline run
 * and a re-export of two thousand rows. ColdEmail supplies only the two things
 * that genuinely vary per row: the company angle and the per-person hook.
 *
 * Shape, and why it is this shape:
 *
 *   Subject       a true number, stated so it is not yet explained. The subject's
 *                 only job is the open; an unopened email has no other qualities.
 *   Quick intro   four bullets: the name and the school, the application and its
 *                 date, then two results with the numbers in bold.
 *   Why I'm       two bullets: what this person recruits for, and what is worth
 *   reaching out  saying about this company. Never a paragraph: the two arrive as
 *                 whole sentences from two different files and run together into
 *                 the block a recruiter skips.
 *   The ask       one bolded question and one short way out, so the easiest reply
 *                 is still a useful one.
 *
 * Nothing here uses a dash. Text arriving from ColdEmail does, and outreachNoDashes_
 * turns each one into a full stop on the way in: two short sentences carry the same
 * meaning without the line reading as one long breath.
 *
 * Three labelled sections, not two. An earlier version folded the introduction
 * and the reason into one unlabelled paragraph of ninety words, and it read as a
 * wall: the recruiter has nothing to scan by, and the application — the strongest
 * fact in the message — is buried in the middle of it. Labels are what make an
 * email skimmable, and a skimmable email is the only kind that gets answered.
 */

var SENDER_NAME  = 'Henry Nguyen';
var SENDER_LINKS = 'hoanng15.work@gmail.com · linkedin.com/in/hoanng15 · github.com/henryng15';
// Bold on the name and the school, and nowhere else in this line. The year and
// the GPA are worth stating and not worth shouting; bold on a fourth thing in one
// sentence is bold on nothing.
var SENDER_STUDY = 'a Math and Computer Science student at **Kenyon College** '
                 + '(class of 2028, 4.0 GPA)';

// Every number below is taken verbatim from henryng_swe.tex. Nothing here is
// rounded up, and nothing is a claim the resume does not already make — a
// recruiter who checks must find the two documents saying one thing.
var RESUME_BULLETS = {
  mcp: 'Cut analyst research from **30 minutes to 1 minute** with a Python MCP server '
     + 'over validated DuckDB data.',
  polars: 'Removed **340K** malformed records from a **2.1M**-record dataset that were '
     + 'inflating severity rates by **8%**.',
  locks: 'Held seat limits across **500 concurrent requests** on EKS with PostgreSQL row '
     + 'locks. No overbooking got through.',
  webhooks: 'Made repeat Stripe webhooks safe in one PostgreSQL transaction. **50 concurrent '
     + 'webhooks**, exactly **one** order.',
  calibration: 'Fixed a crash model that ignored location, raising the share of groups '
     + 'reflecting it from **0% to 24.7%**.',
  coverage: 'Raised checkout test coverage from **34% to 82%** with a Vitest pipeline that '
     + 'blocks failing pull requests.',
  rag: 'Cut repeat claim checks from **4s to 400ms** by caching embeddings in Redis over '
     + '**120** SEC filings.',
  freshness: 'Caught a silent Lambda failure after a report ran **3 days** stale, by emitting '
     + 'freshness metrics to Prometheus.',
  cves: 'Removed **4 high-severity CVEs** from customer-data exports by swapping xlsx for '
     + 'ExcelJS, with **11** tests behind it.',
  lambda: 'Automated a daily collateral report across **120 branches** with scheduled AWS '
     + 'Lambda jobs, saving **30 minutes** a run.',
  menulens: 'Matched a **480**-dish catalog to calorie, protein and budget targets, returning '
     + 'the top **5** in under **300ms**.',
  workspaces: 'Built browser coding workspaces for **90** students a semester with Skulpt and '
     + 'WebSockets. No local setup.',
  integrity: 'Detected edits to legal-evidence files by storing each keccak256 hash in a '
     + 'Solidity contract on Polygon.'
};

/**
 * Ten variations on one skeleton.
 *
 * Format, bolding and order are identical across all ten — only the subject, the
 * two bullets and the ask move. Three people at one company must not receive
 * three copies, and a run of identical bodies is a spam signal in its own right.
 *
 * Every subject is a true number from henryng_swe.tex, stated so that it is not
 * yet explained. That is the whole trick: the reader has to open it to find out
 * what happened. None is over 60 characters, because a recruiter reads them on a
 * phone. Nothing here is rounded up, because a recruiter who checks the resume
 * must find the two documents saying one thing.
 */
var VARIANTS = {
  application: {
    subject: 'Cut a 30-minute research loop to 60 seconds',
    bullets: ['mcp', 'polars'],
    ask: 'Would you be able to **take a look at my application**? If this role is not '
       + 'your team, pointing me to the right person helps just as much.'
  },
  data: {
    subject: '340K bad records were inflating severity by 8%',
    bullets: ['polars', 'calibration'],
    ask: 'Would you be able to **take a look at my application**? A pointer to whoever is '
       + 'closest to this req would help just as much.'
  },
  fintech: {
    subject: '50 duplicate webhooks, exactly one order',
    bullets: ['webhooks', 'locks'],
    ask: 'Would you be able to **take a look at my application**? If you can tell me who '
       + 'owns this req, I will go to them directly.'
  },
  cloud: {
    subject: '500 concurrent requests, zero overbookings',
    bullets: ['locks', 'lambda'],
    ask: 'Would you be able to **take a look at my application**? Or tell me who is running '
       + 'intern hiring this cycle.'
  },
  ai: {
    subject: 'Repeat checks: 4 seconds to 400 milliseconds',
    bullets: ['rag', 'mcp'],
    ask: 'Would you be open to a **short chat about the role**? If it is not yours, a pointer '
       + 'to the closest team helps just as much.'
  },
  security: {
    subject: 'Four high-severity CVEs, one export path',
    bullets: ['cves', 'coverage'],
    ask: 'Would you be able to **take a look at my application**? Or tell me who I should be '
       + 'talking to about it.'
  },
  hardware: {
    subject: 'A daily report was 3 days stale and nobody knew',
    bullets: ['freshness', 'locks'],
    ask: 'Would you be able to **take a look at my application**? If the intern cohort is not '
       + 'yours, a pointer to the right person helps just as much.'
  },
  consumer: {
    subject: '480 dishes, top 5 matches in under 300ms',
    bullets: ['menulens', 'rag'],
    ask: 'Would you be able to **take a look at my application**? Or point me at whoever owns '
       + 'intern hiring there.'
  },
  edtech: {
    subject: '90 students a semester, zero local setup',
    bullets: ['workspaces', 'mcp'],
    ask: 'Would you be able to **take a look at my application**? Or tell me who is closest to '
       + 'this req.'
  },
  campus: {
    subject: 'The model was ignoring location: 0% to 24.7%',
    bullets: ['calibration', 'mcp'],
    ask: 'Would you be able to **take a look at my application**? I would also like to know '
       + 'whether Kenyon sits on the campus list this cycle.'
  }
};

// Which subject a company's industry earns. The bucket comes from ColdEmail's
// company angle file, so it is the same judgement that wrote the opening line.
var BUCKET_VARIANT = {
  data: 'data', fintech: 'fintech', cloud: 'cloud', ai: 'ai',
  security: 'security', hardware: 'hardware', consumer: 'consumer', edtech: 'edtech'
};

/**
 * The variations this contact could receive, best first.
 *
 * A university recruiter comes before the industry match: they are usually not
 * the person who will read "50 duplicate webhooks" and feel anything. Everyone
 * else gets the hook that matches what their company actually does, because
 * that is the most specific true thing available about them.
 *
 * The list is ordered rather than picked, so attempts 2 and 3 — different people
 * at the same employer — take the next one down and never repeat a subject.
 */
function outreachVariantOrder_(bucket, focus) {
  var order = [];
  var push = function (name) {
    if (name && VARIANTS[name] && order.indexOf(name) === -1) order.push(name);
  };
  if (focus === 'university') push('campus');
  push(BUCKET_VARIANT[String(bucket || '').toLowerCase()]);
  push('application');
  Object.keys(VARIANTS).forEach(push);
  return order;
}

function outreachVariantFor_(attempt, focus, bucket) {
  var order = outreachVariantOrder_(bucket, focus);
  var index = Math.min(Math.max(Number(attempt) || 1, 1), order.length) - 1;
  return order[index];
}

function outreachEscape_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** `**bold**` becomes <b>bold</b> once the surrounding text is already escaped. */
function outreachBoldHtml_(text) {
  return outreachEscape_(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

function outreachBoldPlain_(text) {
  return String(text).replace(/\*\*(.+?)\*\*/g, '$1');
}

/**
 * An em dash becomes a full stop and a new sentence.
 *
 * ColdEmail writes its angles with one: "systems have to fail loudly, because
 * silence looks exactly like working — at Vietcombank I made stale reports
 * visible". Two short sentences carry the same thing and stop the line reading
 * as one long breath. Nothing in this file uses a dash of its own.
 */
function outreachNoDashes_(text) {
  return String(text == null ? '' : text)
    .split(/\s*[\u2014\u2013]\s*/)
    .map(function (part) { return part.trim(); })
    .filter(function (part) { return part; })
    .map(function (part, index) {
      if (!index) return part.replace(/[.\s]+$/, '');
      return part.charAt(0).toUpperCase() + part.slice(1).replace(/[.\s]+$/, '');
    })
    .join('. ') + '.';
}

function outreachFirstName_(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}

/**
 * The two bullets that open Quick intro: who is writing, and what they applied to.
 *
 * Two bullets rather than one. An earlier version compressed both into a single
 * fragment — "Math and Computer Science at Kenyon College, class of 2028. Applied
 * for..." — which saved eight words and cost the introduction: no name, no verb,
 * and it read as the top of a CV rather than a person writing to another person.
 * The name belonged there. It was only in the sign-off, four sections below.
 *
 * The application gets a line of its own because it is the strongest fact in the
 * message: it is the one thing the reader can go and verify in their own system.
 *
 * Past STALE_APPLICATION_DAYS the date is dropped. A date from months ago is the
 * weakest fact in the email, and naming it invites exactly the wrong question.
 */
/**
 * What to call the job in the email, whatever the posting called it.
 *
 * A posting title is written for a job board, not for a sentence. "Campus
 * Undergraduate Summer Internship Program - 2027 Software Engineer, Enterprise
 * Technology Services- Charlotte, NC" is a real title out of the sheet, and
 * dropped whole into "Applied for the ... role on Aug 21" it buries the one fact
 * the line exists to carry. The recruiter owns the req; what they need from that
 * bullet is which kind of job, in three words.
 *
 * Ordered, most specific first. Every name here has to be true of every title that
 * can reach it — a short wrong answer is worse than a long right one, because this
 * is the bullet the recipient is most likely to check.
 *
 * Tokens come from outreachRoleTokens_ in outreach_queue.gs, so the city and the
 * state are already gone and the endings are already settled: one place decides
 * what a role's words are, and both the grouping and this line read it.
 */
var SHORT_ROLES = [
  { any: [['quantitative']], name: 'Quantitative Developer Intern' },
  { any: [['firmware']], name: 'Firmware Engineer Intern' },
  { any: [['embedded']], name: 'Embedded Software Engineer Intern' },
  { any: [['devops']], name: 'DevOps Engineer Intern' },
  { any: [['full', 'stack'], ['fullstack']], name: 'Full Stack Engineer Intern' },
  { any: [['frontend']], name: 'Frontend Engineer Intern' },
  { any: [['web']], name: 'Web Developer Intern' },
  // Software beats systems when a title claims both: "Software Engineering Intern
  // - Systems Engineering - Vancouver BC" is a software job on a systems team, and
  // calling it a systems internship would be answering a question nobody asked.
  { any: [['software', 'engineer']], name: 'Software Engineer Intern' },
  { any: [['software', 'developer'], ['software', 'dev']], name: 'Software Developer Intern' },
  { any: [['systems']], name: 'Systems Engineer Intern' },
  { any: [['software']], name: 'Software Engineer Intern' },
  { any: [['engineer']], name: 'Software Engineer Intern' },
  { any: [['developer'], ['programmer']], name: 'Software Developer Intern' },
  // Only reached when nothing above found a software or engineering word at all.
  // These are the bank programmes that name a whole department rather than a job:
  // "2027 Truist Analyst Program - Technology, Data, and Operations Track". They
  // are not internships in software, and saying so would be inventing a req.
  { any: [['technology'], ['it']], name: 'Technology' }
];

// What an unreadable or empty title is called. It was already the fallback here
// before anything was shortened, and it is what 91 of the 144 titles in the sheet
// resolve to anyway.
var DEFAULT_SHORT_ROLE = 'Software Engineer Intern';

function outreachShortRole_(role) {
  var seen = {};
  outreachRoleTokens_(role).forEach(function (word) { seen[word] = true; });
  for (var i = 0; i < SHORT_ROLES.length; i++) {
    var alternatives = SHORT_ROLES[i].any;
    for (var j = 0; j < alternatives.length; j++) {
      var every = true;
      alternatives[j].forEach(function (word) { if (!seen[word]) every = false; });
      if (every) return SHORT_ROLES[i].name;
    }
  }
  return DEFAULT_SHORT_ROLE;
}

function outreachIntroBullets_(role, dateApplied, today, formatDate) {
  var who = 'I am **' + SENDER_NAME + '**, ' + SENDER_STUDY + '.';
  var stale = !dateApplied
    || outreachDaysBetween_(dateApplied, today) > STALE_APPLICATION_DAYS;
  var applied = stale
    ? 'Applied for the **' + role + '** role earlier this year.'
    : 'Applied for the **' + role + '** role on ' + formatDate(dateApplied) + '.';
  return [who, applied];
}

/**
 * Build one email.
 *
 * `angle` may be empty — that is a hand-typed contact at a company ColdEmail has
 * never written for. The message still reads correctly without it, but it has
 * lost the one sentence that makes it specific, so the caller drafts it instead
 * of sending it. Nothing here decides that; see outreach_queue.gs.
 */
function outreachCompose_(options) {
  var variant = VARIANTS[options.variant] || VARIANTS.application;
  var role = outreachShortRole_(options.role);
  var formatDate = options.formatDate || function (d) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM d');
  };

  var greeting = 'Hi ' + outreachFirstName_(options.recruiterName) + ',';
  var intro = outreachIntroBullets_(role, options.dateApplied, options.today, formatDate)
    .concat(variant.bullets.map(function (key) { return RESUME_BULLETS[key]; }));
  // Two bullets rather than a paragraph. The hook and the angle arrive as whole
  // sentences from two different files, and run together they make the block a
  // recruiter skips.
  var reasons = [options.hook, options.angle]
    .filter(function (part) { return part; })
    .map(outreachNoDashes_);
  var ask = variant.ask;

  var bullets = function (lines) {
    return '<ul>' + lines.map(function (line) {
      return '<li>' + outreachBoldHtml_(line) + '</li>';
    }).join('') + '</ul>';
  };

  var html = [
    '<p>' + outreachEscape_(greeting) + '</p>',
    '<p><b>Quick intro:</b></p>', bullets(intro),
    reasons.length ? '<p><b>Why I’m reaching out:</b></p>' + bullets(reasons) : '',
    '<p><b>The ask:</b><br>' + outreachBoldHtml_(ask) + ' Resume attached.</p>',
    '<p>Thanks either way,<br>' + outreachEscape_(SENDER_NAME) + '<br>'
      + '<span style="color:#666">' + outreachEscape_(SENDER_LINKS) + '</span></p>'
  ].join('');

  var listPlain = function (lines) {
    return lines.map(function (line) { return '  - ' + outreachBoldPlain_(line); }).join('\n');
  };
  var plain = [greeting, '', 'Quick intro:', listPlain(intro)]
    .concat(reasons.length ? ['', 'Why I\u2019m reaching out:', listPlain(reasons)] : [])
    .concat(['', 'The ask:', outreachBoldPlain_(ask) + ' Resume attached.', '',
             'Thanks either way,', SENDER_NAME, SENDER_LINKS])
    .join('\n');

  return { subject: variant.subject, html: html, plain: plain, variant: options.variant };
}
