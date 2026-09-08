/**
 * Outreach — asking an engineer for a referral.
 *
 * A different email from the recruiter one, because it is a different favour. A
 * recruiter is paid to read applications; an engineer is not, and what is being
 * asked of them is to spend their own credibility. The recruiter template opens
 * with a number and asks for a look. This one opens by admitting it is a cold
 * note and asks for a name in a form.
 *
 * Shape, and why it is this shape:
 *
 *   Opening      one short sentence: this is cold and we have never spoken. Said
 *                first because it is the question the reader is already asking,
 *                and said without a reason. An earlier draft explained why this
 *                person was chosen, and with two thousand recipients the only
 *                honest reasons available are generic ones. "You do the work
 *                rather than recruit for it" is true of everybody being written
 *                to, which makes it flattery reverse engineered from the ask,
 *                and it reads that way. The warmth lives in the sentences after
 *                the request instead, where it costs the reader nothing.
 *   Who and what one line of who is writing, one saying the application is
 *                already in and why the note exists anyway, and the posting link.
 *                The applied fact is stated rather than implied: a reader who
 *                assumes otherwise spends the email wondering whether they are
 *                being asked to carry a resume to something nobody has applied
 *                to, and the real ask is smaller than that. The link is not
 *                decoration either: a referral is a form with a job id in it, and
 *                an email that omits the req makes the willing reader go and find
 *                it. That errand is where most of the yes goes.
 *   Two bullets  the same resume numbers the recruiter email uses, chosen by what
 *                the company does rather than by who is reading.
 *   The ask      one bolded question and one short way out.
 *   The offer    zero cost. Resume attached, questions by email. Never a meeting:
 *                a call turns a two minute favour into a calendar item, and the
 *                safe answer to a calendar item is silence.
 *   The close    a thank you that is proportionate and then nothing else.
 *
 * Near a hundred and ten words. Longer than the recruiter email's ninety, which
 * is deliberate: the ask is bigger, so it earns a little more room to be honest
 * in. Not double, though. Seven beats at two sentences each is a page, and a page
 * to a working engineer is an archive.
 *
 * Four tiers, ten variations each. The tier is how far above the writer the
 * reader sits, and it moves exactly two things: how small the ask is, and whether
 * the note admits it is reaching. It does not move the number of apologies. Real
 * humility in a cold email is being brief, being specific, and making the no
 * easy; an extra self-deprecating sentence is not humility, it is an invitation
 * to agree that the email should not have been sent.
 *
 * Ten per tier rather than one, for the same reason the recruiter email has ten:
 * Reddit has twenty three engineers in this dataset and Goldman Sachs twenty two,
 * and a run of identical bodies out of one mailbox is a spam signal on its own.
 *
 * Nothing here uses a dash, matching outreach_compose.gs, and every string is
 * ASCII so that nothing depends on how a mail client guesses an encoding.
 */

/**
 * Which tier a person's title puts them in.
 *
 * Ordered, most senior first, and matched on the title rather than on ColdEmail's
 * seniority column: the column is empty on 361 of the 2148 confirmed rows, and a
 * blank there would silently send a Principal engineer the peer email. The column
 * is still read as a fallback, because it is right when it is filled.
 *
 * Manager and director sit with staff. They are further from the work than a
 * Principal engineer is, but they are the same distance above an intern, and it
 * is that distance the tier is measuring.
 */
var REFERRAL_TIER_TITLES = [
  { tier: 'staff', words: ['distinguished'] },
  { tier: 'staff', words: ['fellow'] },
  { tier: 'staff', words: ['principal'] },
  { tier: 'staff', words: ['staff'] },
  { tier: 'staff', words: ['director'] },
  { tier: 'staff', words: ['vp'] },
  { tier: 'staff', words: ['head'] },
  { tier: 'staff', words: ['manager'] },
  { tier: 'staff', words: ['leader'] },
  { tier: 'senior', words: ['senior'] },
  { tier: 'senior', words: ['sr'] },
  { tier: 'senior', words: ['lead'] },
  { tier: 'peer', words: ['intern'] },
  { tier: 'peer', words: ['associate'] },
  { tier: 'peer', words: ['junior'] },
  { tier: 'peer', words: ['graduate'] },
  { tier: 'peer', words: ['apprentice'] },
  // The numbered ladder, read last so that a word like "staff" or "senior" in the
  // same title still wins. It is here because ColdEmail's seniority column calls
  // "Software Engineer II" junior, and on that column alone 70 people including
  // every SWE II and III were being sent the new grad email. A II has shipped
  // things for a couple of years and is not a peer of anyone applying to intern.
  { tier: 'senior', words: ['iv', '4'] },
  { tier: 'mid', words: ['iii', '3'] },
  { tier: 'mid', words: ['ii', '2'] },
  { tier: 'peer', words: ['i', '1'] }
];

// What ColdEmail's seniority column says, for the rows where the title alone
// settled nothing. 'mid' is not listed because mid is what nothing matching means.
var REFERRAL_TIER_SENIORITY = {
  staff: 'staff', principal: 'staff', director: 'staff',
  senior: 'senior',
  junior: 'peer', new_grad: 'peer', intern: 'peer'
};

var REFERRAL_TIERS = ['peer', 'mid', 'senior', 'staff'];
var REFERRAL_DEFAULT_TIER = 'mid';

/**
 * The tier for one person.
 *
 * "Senior Staff Software Engineer" holds both words, and staff is the answer, so
 * the list is walked in order rather than searched. Words are matched whole:
 * 'lead' must not fire on "Lead" inside "Leadership" and must not be found inside
 * "misleading", 'sr' must not match the s and r of any longer word, and 'ii' must
 * not be found inside 'iii'.
 */
function outreachReferralTier_(title, seniority) {
  var words = String(title == null ? '' : title).toLowerCase().split(/[^a-z0-9]+/);
  var seen = {};
  words.forEach(function (word) { if (word) seen[word] = true; });
  for (var i = 0; i < REFERRAL_TIER_TITLES.length; i++) {
    var rule = REFERRAL_TIER_TITLES[i];
    for (var j = 0; j < rule.words.length; j++) {
      if (seen[rule.words[j]]) return rule.tier;
    }
  }
  var stated = String(seniority == null ? '' : seniority).toLowerCase().trim();
  return REFERRAL_TIER_SENIORITY[stated] || REFERRAL_DEFAULT_TIER;
}


/**
 * Which of the ten a new referral row gets: the least used, ties broken by a
 * per-company sequence so people at one employer walk the list in order.
 *
 * This replaced forty generated bodies -- ten reusable forms crossed with ten
 * tier-specific asks -- and with them the whole idea that the ask should soften
 * as the reader gets more senior. The ten templates ask the same thing of
 * everyone. `outreachReferralTier_` survives because the Referral tab has a
 * Tier column and the queue writes it; it no longer decides any wording.
 */
function outreachReferralTemplateLoad_(referralRows) {
  var load = {};
  for (var i = 1; i <= REFERRAL_TEMPLATES.length; i++) load[i] = 0;
  (referralRows || []).forEach(function (row) {
    if (row.status === STATUS_CANCELLED) return;
    var n = Number(row.template);
    if (load[n] !== undefined) load[n]++;
  });
  return load;
}

/**
 * A stable place in the ten for one company's nth ask.
 *
 * Seeded on the employer so the six people at one company receive six different
 * templates in a fixed order, rather than an order that depends on what else the
 * tab happened to hold when each was booked.
 */
function outreachReferralIndex_(company, attempt) {
  var seed = 0;
  var key = outreachNameKey_(company || '');
  for (var i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) % 9973;
  var n = Math.max(1, Number(attempt) || 1);
  return (seed + n - 1) % REFERRAL_TEMPLATES.length;
}

/** The attempt behind a template a row already advertises. */
function outreachReferralAttemptForTemplate_(company, template) {
  var wanted = Number(template);
  for (var attempt = 1; attempt <= REFERRAL_TEMPLATES.length; attempt++) {
    if (outreachReferralIndex_(company, attempt) + 1 === wanted) return attempt;
  }
  return 1;
}

function outreachBalancedReferralTemplateFor_(tier, company, attempt, load) {
  var counts = load || {};
  var best = null;
  // The company-seeded order is the tie-break, so a tie is resolved the same way
  // every time for one employer rather than always landing on template one.
  for (var step = 0; step < REFERRAL_TEMPLATES.length; step++) {
    var n = outreachReferralIndex_(company, (Number(attempt) || 1) + step) + 1;
    if (best === null || (counts[n] || 0) < (counts[best] || 0)) best = n;
  }
  return best || 1;
}

/**
 * One referral ask.
 *
 * `angle`, `bucket`, `seniority` and `dateApplied` are still accepted because
 * the caller has them and passing them costs nothing, but none of them reaches
 * the reader: the ten templates name the company and the role and say nothing
 * else that varies.
 *
 * The posting link is deliberately not appended. The old composer put it in a
 * grey footer; these templates instead say "I'd be happy to send over the job ID
 * afterward", and printing the link under that sentence would contradict it. The
 * Referral tab still requires a job link before a row may send -- it is the
 * evidence the ask is about a real opening -- it simply no longer appears in the
 * message.
 */
function outreachReferralCompose_(options) {
  var tier = outreachReferralTier_(options.personTitle, options.seniority);
  var n = Number(options.template);
  if (!(n >= 1 && n <= REFERRAL_TEMPLATES.length)) {
    n = outreachReferralIndex_(options.company, options.attempt) + 1;
  }
  var rendered = outreachRenderTemplate_(REFERRAL_TEMPLATES[n - 1], {
    name: outreachFirstName_(options.personName),
    company: options.company,
    role: options.role || DEFAULT_SHORT_ROLE
  });
  return {
    subject: rendered.subject,
    html: rendered.html,
    plain: rendered.plain,
    tier: tier,
    template: n
  };
}

/**
 * Log one example of each of the ten. Sends nothing.
 */
function previewReferralTemplates() {
  for (var n = 1; n <= REFERRAL_TEMPLATES.length; n++) {
    var mail = outreachReferralCompose_({
      personName: 'Alex Smith', personTitle: 'software engineer', seniority: 'mid',
      company: 'Stripe', role: 'Software Engineer Intern', template: n
    });
    Logger.log('--- template ' + n + ' ---\n' + mail.subject + '\n\n' + mail.plain);
  }
}
