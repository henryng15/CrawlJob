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
 *   Subject       a short, human question or interruption. It earns the open by
 *                 creating curiosity around the application, not by dangling a
 *                 resume statistic that makes the note feel like an ad.
 *   A quick       two short sentences: who is writing, which role they applied
 *   introduction  for, and that they genuinely hope to move to the next stage.
 *   Why I'm       a natural reason for choosing this recruiter, followed by one
 *   reaching out  concrete company or resume detail. The hook must explain why
 *                 this person is receiving the note, not merely label their job.
 *   A quick       one bolded question and one short way out, so the easiest reply
 *   question      is still a useful one.
 *
 * Three labelled sections and short paragraphs make the note skimmable without
 * making it look like a generated record. Each section does exactly one job: who
 * is writing, why this person, and what is being asked. The body stays near ninety
 * words; anything a recruiter wants past that is in the attachment.
 *
 * Nothing here uses a dash. Text arriving from ColdEmail does, and outreachNoDashes_
 * turns each one into a full stop on the way in: two short sentences carry the same
 * meaning without the line reading as one long breath.
 *
 * Three labelled sections, not two. The labels provide scan points, while the
 * prose underneath keeps the note sounding like one person wrote to another.
 */

var SENDER_NAME  = 'Henry Nguyen';
var SENDER_LINKS = 'hoanng15.work@gmail.com · linkedin.com/in/hoanng15 · github.com/henryng15';
// Bold on the name and the school, and nowhere else in this line. Keep the
// introduction human and relevant to the application rather than turning it into
// a transcript or graduation-status line.
var SENDER_STUDY = 'a Math and Computer Science student at **Kenyon College**';

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
 * The three sections stay stable, but the subject and ask move. Subjects are
 * short curiosity hooks rather than generic statistics. Three people at one
 * company must not receive three copies, and a run of identical bodies is a spam
 * signal in its own right.
 *
 * Every subject is under 60 characters after `{role}` is filled, because a
 * recruiter reads it on a phone. The subject may create a small pattern break,
 * but it never pretends to be urgent or hides what the email is about.
 *
 * One result proof point, not two. It belongs in the introduction with context;
 * the subject earns the open through curiosity rather than repeating the number.
 *
 * Every ask is one sentence under twenty-five words: the bolded request, then one
 * short way out. The way out is worded differently in each, because it is the
 * clause a recruiter forwarding to a colleague actually quotes.
 */
var VARIANTS = {
  application: {
    subject: 'I applied. What happens next?',
    subjectForms: [
      'I applied. What happens next?',
      "I'm hoping to move forward",
      'Could I ask about my application?'
    ],
    bullet: 'mcp',
    ask: 'Would you be able to **take a quick look at my application**? If someone else '
       + 'owns the req, a pointer would help just as much.'
  },
  data: {
    subject: 'Could this application move forward?',
    subjectForms: [
      'Could this application move forward?',
      'One question about my application',
      'I applied and wanted to follow up'
    ],
    bullet: 'polars',
    ask: 'Would you be able to **take a quick look at my application**? Or point me to '
       + 'whoever is closest to this req.'
  },
  fintech: {
    subject: 'I may have the wrong person',
    subjectForms: [
      'I may have the wrong person',
      'Could you point me to the right person?',
      'Who handles this application?'
    ],
    bullet: 'webhooks',
    ask: 'Would you be able to **take a quick look at my application**? If someone else '
       + 'owns this req, I will go to them.'
  },
  cloud: {
    subject: 'Is this application still moving?',
    subjectForms: [
      'Is this application still moving?',
      'Could I ask about next steps?',
      'A quick question about the role'
    ],
    bullet: 'locks',
    ask: 'Would you be able to **take a quick look at my application**? Or tell me who '
       + 'runs intern hiring this cycle.'
  },
  ai: {
    subject: "I'd really like to continue",
    subjectForms: [
      "I'd really like to continue",
      'Could I move to the next stage?',
      'Hoping to take the next step'
    ],
    bullet: 'rag',
    ask: 'Would you be open to a **short chat about the role**? If it is not yours, a '
       + 'pointer to the closest team helps.'
  },
  security: {
    subject: 'Could you help me find the next step?',
    subjectForms: [
      'Could you help me find the next step?',
      'Is there someone I should contact?',
      "I'm reaching out about my application"
    ],
    bullet: 'cves',
    ask: 'Would you be able to **take a quick look at my application**? Or tell me who I '
       + 'should be talking to.'
  },
  hardware: {
    subject: 'Could you take a look?',
    subjectForms: [
      'Could you take a look?',
      'Would you be the right person to ask?',
      'I may be early, but I wanted to ask'
    ],
    bullet: 'freshness',
    ask: 'Would you be able to **take a quick look at my application**? If the intern '
       + 'cohort is not yours, a pointer helps.'
  },
  consumer: {
    subject: 'One honest question about the role',
    subjectForms: [
      'One honest question about the role',
      'Could I ask about the open role?',
      'Is the role still open?'
    ],
    bullet: 'menulens',
    ask: 'Would you be able to **take a quick look at my application**? Or point me at '
       + 'whoever owns intern hiring there.'
  },
  edtech: {
    subject: 'Could you point me in the right direction?',
    subjectForms: [
      'Could you point me in the right direction?',
      "I'd value a quick pointer",
      'I may have found the right person'
    ],
    bullet: 'workspaces',
    ask: 'Would you be able to **take a quick look at my application**? Or send me toward '
       + 'whoever is reading these applications.'
  },
  campus: {
    subject: 'Is Kenyon part of your campus hiring?',
    subjectForms: [
      'Is Kenyon part of your campus hiring?',
      'Could I ask about campus hiring?',
      'Hoping to move forward from Kenyon'
    ],
    bullet: 'calibration',
    ask: 'Would you be able to **take a quick look at my application**? I would also like '
       + 'to know whether Kenyon is on the campus list.'
  }
};

// Three light paraphrases of the same recruiter note. The three scan points stay
// fixed and short; only the subject wording and closing move. That keeps the
// structure recognisable without making the body read like a form.
var COLD_COPY_FORMS = [
  { intro: 'A quick introduction:', reason: 'Why I\u2019m reaching out:', ask: 'A quick question:',
    close: 'Thanks either way,' },
  { intro: 'A quick introduction:', reason: 'Why I\u2019m reaching out:', ask: 'A quick question:',
    close: 'Thanks for considering it,' },
  { intro: 'A quick introduction:', reason: 'Why I\u2019m reaching out:', ask: 'A quick question:',
    close: 'Thank you for your time,' }
];

function outreachVariantParts_(value) {
  var written = String(value || '');
  var match = written.match(/^([a-z]+):(\d+)$/i);
  var name = match ? match[1] : written;
  var form = match ? Number(match[2]) : 1;
  if (!VARIANTS[name]) name = 'application';
  if (form < 1 || form > COLD_COPY_FORMS.length) form = 1;
  return { name: name, form: form };
}

function outreachVariantKey_(name, form) {
  return name + ':' + form;
}

function outreachVariantTemplateLoad_(queueRows) {
  var bases = {}, forms = {};
  Object.keys(VARIANTS).forEach(function (name) {
    bases[name] = 0;
    for (var form = 1; form <= COLD_COPY_FORMS.length; form++) {
      forms[outreachVariantKey_(name, form)] = 0;
    }
  });
  (queueRows || []).forEach(function (row) {
    if (!row || row.status === STATUS_CANCELLED || !row.template) return;
    var parts = outreachVariantParts_(row.template);
    bases[parts.name]++;
    forms[outreachVariantKey_(parts.name, parts.form)]++;
  });
  return { bases: bases, forms: forms };
}

function outreachBalancedVariantFor_(attempt, focus, bucket, load) {
  if (!load) return outreachVariantFor_(attempt, focus, bucket);
  var names = Object.keys(VARIANTS);
  var minimum = Math.min.apply(null, names.map(function (name) { return load[name] || 0; }));
  var order = outreachVariantOrder_(bucket, focus);
  var chosen = order.filter(function (name) { return (load[name] || 0) === minimum; })[0];
  load[chosen] = (load[chosen] || 0) + 1;
  return chosen;
}

function outreachCopyFormFor_(variant, load) {
  var forms = [];
  for (var form = 1; form <= COLD_COPY_FORMS.length; form++) forms.push(form);
  var minimum = Math.min.apply(null, forms.map(function (form) {
    return load[outreachVariantKey_(variant, form)] || 0;
  }));
  var chosen = forms.filter(function (form) {
    return (load[outreachVariantKey_(variant, form)] || 0) === minimum;
  })[0];
  var key = outreachVariantKey_(variant, chosen);
  load[key] = (load[key] || 0) + 1;
  return chosen;
}

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
 * What to call the job in the email, whatever the posting called it.
 *
 * A posting title is written for a job board, not for a sentence. "Campus
 * Undergraduate Summer Internship Program - 2027 Software Engineer, Enterprise
 * Technology Services- Charlotte, NC" is a real title out of the sheet, and
 * dropped whole into "I applied for the ... position on Aug 21" it buries the one fact
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

// What an empty cell is called. Only an empty one: a title nobody typed cannot be
// left as it was, because "I applied for the  position" is not a sentence.
var DEFAULT_SHORT_ROLE = 'Software Engineer Intern';

/**
 * A title no rule recognises is left exactly as it was written.
 *
 * Three of the 144 titles in the sheet reach this — "Ad Infra", "AI Builder
 * Intern", "R&D Intern (Fall 2026)" — and all three are already short. There is
 * nothing to shorten and nothing solid to shorten them to: calling an AI Builder
 * internship a Software Engineer internship would be answering with a guess in the
 * one bullet the recipient can check. The rules exist to cut job board padding,
 * not to relabel jobs they do not recognise.
 */
function outreachShortRole_(role) {
  var written = String(role == null ? '' : role).trim();
  if (!written) return DEFAULT_SHORT_ROLE;
  var seen = {};
  outreachRoleTokens_(written).forEach(function (word) { seen[word] = true; });
  for (var i = 0; i < SHORT_ROLES.length; i++) {
    var alternatives = SHORT_ROLES[i].any;
    for (var j = 0; j < alternatives.length; j++) {
      var every = true;
      alternatives[j].forEach(function (word) { if (!seen[word]) every = false; });
      if (every) return SHORT_ROLES[i].name;
    }
  }
  return written;
}

/**
 * The short introduction is prose rather than a bullet block: who is writing,
 * what they applied for, and that they genuinely hope to move to the next stage.
 * Past STALE_APPLICATION_DAYS the date is dropped because a date from months ago
 * invites exactly the wrong question.
 */
function outreachIntroText_(role, company, dateApplied, today, formatDate, process) {
  var who = 'I\u2019m **' + SENDER_NAME + '**, ' + SENDER_STUDY + '.';
  var stale = !dateApplied
    || outreachDaysBetween_(dateApplied, today) > STALE_APPLICATION_DAYS;
  var destination = company
    ? ' at **' + outreachNoDashes_(company).replace(/[.]$/, '') + '**'
    : '';
  var applied = stale
    ? 'I applied for the **' + role + '** position' + destination + ' earlier this year'
    : 'I applied for the **' + role + '** position' + destination + ' on ' + formatDate(dateApplied);
  // Appended rather than given a bullet of its own. It is the same fact as the
  // application — how far it has got — and split across two lines the reader has
  // to join them back up. The clause carries no date: the day the assessment was
  // submitted is not in the App tab, and Date Applied is emphatically not it.
  if (process === STAGE_COMPLETED_OA) {
    applied += ' and have since completed the online assessment';
  }
  return who + ' ' + applied + ', and I\u2019m genuinely hoping to move forward to the '
    + 'next stage of the process.';
}

/**
 * Turn a profile-derived hook into a sentence that explains the contact.
 *
 * ColdEmail sometimes supplies a useful fact as "Since you own..." or "I saw
 * that you...". Those are true, but they sound like profile labels when dropped
 * into an email. This keeps the fact, removes headline spillover after the first
 * sentence, and adds the missing reason for writing.
 */
function outreachNaturalHook_(hook, role) {
  var text = String(hook == null ? '' : hook).trim().replace(/\s+/g, ' ');
  if (!text) return '';
  text = text.split(/[.!?]/)[0].replace(/[,:;]+$/, '').trim();
  text = text.replace(/^Since\s+/i, 'I noticed ')
    .replace(/^I saw that\s+/i, 'I noticed ')
    .replace(/^I saw your\s+/i, 'I noticed your ')
    .replace(/^You\s+/i, 'I noticed you ');
  if (!/^I noticed\b/i.test(text)) text = 'I noticed ' + text;
  return text + ', so I wanted to reach out directly about my **' + role + '** application.';
}

function outreachSubject_(template, role) {
  return String(template || '').replace(/\{role\}/g, role || DEFAULT_SHORT_ROLE);
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
  var parts = outreachVariantParts_(options.variant);
  var variant = VARIANTS[parts.name];
  var copy = COLD_COPY_FORMS[parts.form - 1];
  var role = outreachShortRole_(options.role);
  var formatDate = options.formatDate || function (d) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM d');
  };

  var greeting = 'Hi ' + outreachFirstName_(options.recruiterName) + ',';
  var intro = outreachIntroText_(
    role, options.company, options.dateApplied, options.today, formatDate, options.process)
    + ' ' + RESUME_BULLETS[variant.bullet];
  var hook = outreachNaturalHook_(options.hook, role);
  var reasons = [hook, options.angle]
    .filter(function (part) { return part; })
    .map(outreachNoDashes_);
  var ask = variant.ask;

  var paragraphs = function (lines) {
    return lines.map(function (line) { return '<p>' + outreachBoldHtml_(line) + '</p>'; }).join('');
  };

  var html = [
    '<p>' + outreachEscape_(greeting) + '</p>',
    '<p><b>' + outreachEscape_(copy.intro) + '</b></p><p>' + outreachBoldHtml_(intro) + '</p>',
    reasons.length ? '<p><b>' + outreachEscape_(copy.reason) + '</b></p>' + paragraphs(reasons) : '',
    '<p><b>' + outreachEscape_(copy.ask) + '</b><br>' + outreachBoldHtml_(ask) + ' Resume attached.</p>',
    '<p>' + outreachEscape_(copy.close) + '<br>' + outreachEscape_(SENDER_NAME) + '<br>'
      + '<span style="color:#666">' + outreachEscape_(SENDER_LINKS) + '</span></p>'
  ].join('');

  var paragraphsPlain = function (lines) {
    return lines.map(function (line) { return outreachBoldPlain_(line); }).join('\n\n');
  };
  var plain = [greeting, '', copy.intro, outreachBoldPlain_(intro)]
    .concat(reasons.length ? ['', copy.reason, paragraphsPlain(reasons)] : [])
    .concat(['', copy.ask, outreachBoldPlain_(ask) + ' Resume attached.', '',
             copy.close, SENDER_NAME, SENDER_LINKS])
    .join('\n');

  return {
    subject: outreachSubject_((variant.subjectForms || [variant.subject])[parts.form - 1] || variant.subject, role),
    html: html,
    plain: plain,
    variant: parts.name,
    form: parts.form
  };
}
