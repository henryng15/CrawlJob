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
 * The live referral copybook.
 *
 * Ten tracked forms are combined with one tier-aware ask each. The Referral tab
 * stores the resulting number (1 through 10), so a draft can always be recreated
 * without relying on which wording happened to be active on a later run.
 *
 * A referral is a request to spend somebody else's credibility. These forms make
 * the request conditional on fit and make declining effortless. They do not use
 * apologies, "long shot" language, or emotional pressure.
 */
var REFERRAL_TEMPLATE_FORMS = [
  { open: 'I found your profile while learning about {company}, and wanted to ask about the {role} role.',
    lead: 'A couple of projects that may be relevant:',
    offer: 'If you do not feel comfortable referring me, I completely understand. The resume is attached and the posting is below.',
    close: 'Thank you for considering it,' },
  { open: 'I came across your work at {company} and thought I would reach out about the {role} opening.',
    lead: 'Two examples of the engineering work I have built:',
    offer: 'There is no pressure to help if the role is not a fit. The resume is attached and the posting is below for context.',
    close: 'Thanks for taking a look,' },
  { open: 'I was looking into {company} and found your profile, so I wanted to ask one quick question about the {role} role.',
    lead: 'The projects most relevant to this role are:',
    offer: 'If a referral is not something you can offer, there is no pressure to respond. The resume is attached and the posting is below.',
    close: 'Thank you for your time,' },
  { open: 'I am reaching out about the {role} role at {company}; we have not connected before, so I will keep this brief.',
    lead: 'A short view of the work behind my application:',
    offer: 'Please feel free to pass if this is not appropriate. There is no pressure to respond. My resume is attached and the direct posting is below.',
    close: 'I appreciate your consideration,' },
  { open: 'I noticed your work at {company} while researching the {role} opening and wanted to introduce myself.',
    lead: 'Two results that give the clearest picture of my background:',
    offer: 'If you do not see a fit, I completely understand. I have kept the request to this note, with my resume attached and the posting below.',
    close: 'Thanks for reading,' },
  { open: 'I came across your profile while learning more about the team at {company}, and wanted to ask about the {role} role.',
    lead: 'For context, these are the two projects closest to the work:',
    offer: 'A referral is entirely optional. If it is not appropriate, I understand. My resume is attached and the posting is below for reference.',
    close: 'Thank you for your consideration,' },
  { open: 'I wanted to contact you after seeing the {role} opportunity at {company}. We have not spoken before, so I will be concise.',
    lead: 'Two pieces of work that may help you judge the fit:',
    offer: 'If you would rather not refer someone you do not know, I completely understand. My resume is attached and the posting is below; there is no pressure to reply.',
    close: 'Thanks for your time,' },
  { open: 'I am writing because I applied for the {role} role at {company} and thought you might know the team.',
    lead: 'The most relevant parts of my technical background are:',
    offer: 'If you are not the right person or would prefer not to help, I completely understand. My resume is attached and the direct posting is below.',
    close: 'I appreciate your time,' },
  { open: 'I found your profile while looking into the {role} team at {company}, and wanted to ask about my application.',
    lead: 'Two concise examples of work relevant to the role:',
    offer: 'Please only consider this if the background looks relevant to you. My resume is attached and the posting is below. Otherwise, I completely understand.',
    close: 'Thank you for reading,' },
  { open: 'I wanted to reach out directly about the {role} position at {company}; this is my first note to you.',
    lead: 'A quick look at the engineering work I would bring:',
    offer: 'If a referral would not be appropriate, I understand completely. The resume is attached and the posting is below.',
    close: 'Thanks for considering my request,' }
];

var REFERRAL_TIER_ASKS = {
  peer: [
    'If the resume looks relevant, would you feel comfortable **referring me**?',
    'Would you be open to **referring me** if you think the role is a fit?',
    'If you see a fit, may I ask whether you would consider **referring me**?',
    'Would you consider **referring me** if the background seems relevant?',
    'If this looks aligned, would you be comfortable **referring me**?',
    'May I ask whether you would consider **referring me** if you see a fit?',
    'If the role and my background line up, would you be willing to **refer me**?',
    'Would you feel comfortable **referring me** if the application looks promising?',
    'If you think I could be a fit, would you consider **referring me**?',
    'Would you be open to **referring me** after a quick look at the resume?'
  ],
  mid: [
    'If my background seems relevant, would you consider **referring me**?',
    'Would you be comfortable reviewing the resume and, if you see a fit, **referring me**?',
    'If the experience aligns with the role, may I ask whether you would consider **referring me**?',
    'Would you consider **referring me** if the application seems like a good match?',
    'If you see a reasonable fit, would you feel comfortable **referring me**?',
    'May I ask whether you would consider **referring me** if the role aligns with my background?',
    'If the resume supports the fit, would you be willing to **refer me**?',
    'Would you be open to **referring me** if the experience looks relevant?',
    'If you believe I could contribute, would you consider **referring me**?',
    'Would you feel comfortable **referring me** if the resume gives you confidence in the fit?'
  ],
  senior: [
    'If you happen to see a fit after reviewing my resume, would you feel comfortable **referring me**?',
    'Would you be willing to review my resume and, if appropriate, consider **referring me**?',
    'If my experience seems relevant to the team, may I ask whether you would consider **referring me**?',
    'Would you consider **referring me** if you believe the background fits the role?',
    'If the application looks relevant after a quick review, would you be comfortable **referring me**?',
    'May I ask whether you would consider **referring me** if you see a genuine fit?',
    'If you think my experience could be useful to the team, would you be willing to **refer me**?',
    'Would you be open to **referring me** if the resume aligns with what the team needs?',
    'If the role seems like a match for my background, would you consider **referring me**?',
    'Would you feel comfortable **referring me** only if you believe the fit is there?'
  ],
  staff: [
    'If you see a fit after reviewing my resume, would you feel comfortable **referring me**?',
    'Would you be willing to review my resume and, only if appropriate, consider **referring me**?',
    'If my background seems relevant to the team, may I ask whether you would consider **referring me**?',
    'Would you consider **referring me** if you believe the role and my experience align?',
    'If the application looks relevant, would you be comfortable **referring me**?',
    'May I ask whether you would consider **referring me** if you see a strong enough fit?',
    'If you think my experience could be useful, would you be willing to **refer me**?',
    "Would you be open to **referring me** if the resume aligns with the team's needs?",
    'If you believe the role is a match for my background, would you consider **referring me**?',
    'Would you feel comfortable **referring me** only if your own judgment says it is appropriate?'
  ]
};

function outreachReferralBuildTemplates_() {
  var templates = {};
  REFERRAL_TIERS.forEach(function (tier) {
    templates[tier] = REFERRAL_TEMPLATE_FORMS.map(function (form, index) {
      return {
        id: tier + ':' + (index + 1),
        open: form.open,
        lead: form.lead,
        ask: REFERRAL_TIER_ASKS[tier][index],
        offer: form.offer,
        close: form.close
      };
    });
  });
  return templates;
}

var REFERRAL_TEMPLATES = outreachReferralBuildTemplates_();

function outreachReferralTemplateLoad_(referralRows) {
  var load = {};
  REFERRAL_TIERS.forEach(function (tier) {
    load[tier] = [];
    for (var index = 0; index < REFERRAL_TEMPLATES[tier].length; index++) load[tier][index] = 0;
  });
  (referralRows || []).forEach(function (row) {
    if (!row || row.status === STATUS_CANCELLED || !row.template) return;
    var tier = REFERRAL_TEMPLATES[row.tier] ? row.tier : REFERRAL_DEFAULT_TIER;
    var index = Number(row.template) - 1;
    if (index >= 0 && index < load[tier].length) load[tier][index]++;
  });
  return load;
}


/**
 * Which two resume numbers a company earns.
 *
 * Chosen by what the company does, not by who is reading: a Staff engineer at
 * Stripe and a new grad at Stripe both care about the payments number, and the
 * tier is already doing its own job on the wording. The bucket is ColdEmail's,
 * so this is the same judgement that wrote the company angle.
 *
 * Twelve keys per bucket, read as six pairs, one per person a company is allowed.
 * It was six keys and three pairs while three people were the limit, and raising
 * the limit to six without this would have had the fourth, fifth and sixth person
 * repeat the first three lists. That mattered little while the six were spread
 * over six days and matters a great deal now they can arrive on one morning:
 * whether six notes read as six people being written to or as one mailing shot is
 * decided by whether they are actually different, and the bullets are the part of
 * the message carrying the numbers somebody might quote to a colleague.
 */
var REFERRAL_BULLET_ORDER = {
  ai:       ['rag', 'mcp', 'freshness', 'coverage', 'polars', 'locks',
             'calibration', 'webhooks', 'cves', 'lambda', 'menulens', 'integrity'],
  data:     ['polars', 'mcp', 'freshness', 'calibration', 'rag', 'lambda',
             'coverage', 'locks', 'webhooks', 'cves', 'integrity', 'menulens'],
  fintech:  ['webhooks', 'locks', 'lambda', 'cves', 'coverage', 'mcp',
             'freshness', 'polars', 'rag', 'integrity', 'calibration', 'menulens'],
  cloud:    ['locks', 'freshness', 'webhooks', 'coverage', 'mcp', 'rag',
             'lambda', 'polars', 'cves', 'calibration', 'integrity', 'workspaces'],
  security: ['cves', 'integrity', 'coverage', 'webhooks', 'locks', 'mcp',
             'freshness', 'rag', 'lambda', 'polars', 'calibration', 'menulens'],
  hardware: ['freshness', 'locks', 'polars', 'lambda', 'coverage', 'mcp',
             'calibration', 'webhooks', 'cves', 'rag', 'integrity', 'menulens'],
  consumer: ['menulens', 'coverage', 'locks', 'webhooks', 'rag', 'polars',
             'mcp', 'freshness', 'calibration', 'lambda', 'cves', 'workspaces'],
  edtech:   ['workspaces', 'coverage', 'mcp', 'menulens', 'locks', 'polars',
             'rag', 'freshness', 'calibration', 'webhooks', 'lambda', 'integrity']
};

// What a company with no bucket gets. The first pair is the strongest two numbers
// on the resume that are true of any employer.
var REFERRAL_BULLET_DEFAULT = ['mcp', 'polars', 'locks', 'coverage', 'rag', 'webhooks',
                               'freshness', 'calibration', 'cves', 'lambda',
                               'menulens', 'integrity'];

function outreachReferralBullets_(bucket, attempt) {
  var order = REFERRAL_BULLET_ORDER[String(bucket || '').toLowerCase()]
           || REFERRAL_BULLET_DEFAULT;
  var pair = (Math.max(Number(attempt) || 1, 1) - 1) % Math.floor(order.length / 2);
  return [RESUME_BULLETS[order[pair * 2]], RESUME_BULLETS[order[pair * 2 + 1]]];
}


/**
 * The subject lines.
 *
 * Plain, and deliberately not the recruiter email's trick. That subject is a bare
 * number written so it is not yet explained, because a recruiter's inbox is a
 * competition for the open. This one goes to an engineer who is not expecting
 * mail about hiring at all, and a teaser subject on an unexpected favour reads as
 * marketing. Saying what the email is buys the open here.
 *
 * Almost all of them say "referral", and that is the hook rather than a label. A
 * subject that names the ask lets the reader decide in the preview pane whether
 * to open it, which is the respectful version of the transaction: the reader who
 * would say no spends two seconds instead of ninety, and the one who opens it has
 * already agreed to hear the question.
 *
 * The register is the honest one. The subject names the request plainly and lets
 * the reader decide whether to open it, without asking them to absorb the
 * sender's insecurity before seeing the actual question.
 *
 * Thirty six, because two thousand of these leave one mailbox and a repeated
 * subject across two people at one company is the pattern a spam filter is
 * actually built to notice. Every one stays under sixty six characters with the
 * longest company and the longest role in the dataset substituted in, because
 * what is past that is not read on a phone.
 *
 * None of them is clever. A joke in the subject of a request for a favour asks
 * the reader to be amused before they have agreed to be interested.
 */
/**
 * Which subject a person gets.
 *
 * Its own index rather than the template's. The templates run to ten and the
 * subjects to thirty six, and reusing the template index would leave twenty six
 * of them unreachable while every eleventh reader saw a repeat.
 */
// The subject names the request plainly, without asking the recipient to absorb
// the sender's insecurity in the preview pane. Indexing still produces distinct
// wording for the people at one employer.
var REFERRAL_SUBJECTS = [
  'Referral request for {role}', 'Referral for {role}',
  'A quick referral question', 'Would you consider a referral?',
  'Referral request about {company}', 'Could I ask about a referral?',
  'Referral request from Henry Nguyen', 'Referral question about the open role',
  'Would you feel comfortable with a referral?', 'Referral request for your team',
  'A question about a referral', 'Could you help with a referral?',
  'Request to consider a referral', 'Referral request for an engineering role',
  'Could you review my resume for a referral?', 'Referral request from a Kenyon student',
  'Referral consideration for an internship', 'Could I ask you to consider a referral?',
  'Referral request for the open position', 'Resume review before a referral',
  'Referral request for the internship role', 'Referral consideration for this role',
  'Referral request for the software role', 'A brief resume and referral request',
  'Referral request for the current opening', 'Could you point me toward a referral?',
  'Referral consideration for the SWE role', 'A quick review before a referral',
  'Referral request for the engineering internship', 'Referral consideration if it is a fit',
  'Referral request and resume review', 'Could you consider a referral to your team?',
  'Referral request for the current engineering role', 'Would you review my resume for a referral?',
  'Referral request for the software opportunity', 'Referral consideration after a resume review'
];

function outreachReferralSubjectIndex_(company, attempt) {
  var seed = 0, name = String(company || '');
  for (var i = 0; i < name.length; i++) {
    seed = (seed * 31 + name.charCodeAt(i)) % REFERRAL_SUBJECTS.length;
  }
  return (seed + Math.max(Number(attempt) || 1, 1) - 1) % REFERRAL_SUBJECTS.length;
}

function outreachReferralSubject_(index, company, role) {
  return REFERRAL_SUBJECTS[((index % REFERRAL_SUBJECTS.length) + REFERRAL_SUBJECTS.length)
                           % REFERRAL_SUBJECTS.length]
    .replace(/\{company\}/g, company || 'your team')
    .replace(/\{role\}/g, role || DEFAULT_SHORT_ROLE);
}


/**
 * Which of the ten a person gets.
 *
 * Seeded on the company so that the first person at an employer does not always
 * receive template one, and offset by the attempt so the second and third people
 * there take the next ones down. Ten templates and at most a handful of contacts
 * per company means a repeat inside one employer is not reachable in practice.
 */
function outreachReferralIndex_(company, attempt) {
  var seed = 0, name = String(company || '');
  for (var i = 0; i < name.length; i++) seed = (seed * 31 + name.charCodeAt(i)) % 10;
  return (seed + Math.max(Number(attempt) || 1, 1) - 1) % 10;
}

function outreachReferralAttemptForTemplate_(company, template) {
  var wanted = (Number(template) || 1) - 1;
  for (var attempt = 1; attempt <= 10; attempt++) {
    if (outreachReferralIndex_(company, attempt) === wanted) return attempt;
  }
  return 1;
}

function outreachBalancedReferralTemplateFor_(tier, company, attempt, load) {
  var counts = load[tier] || [];
  var minimum = Math.min.apply(null, counts);
  var start = outreachReferralIndex_(company, attempt);
  for (var offset = 0; offset < counts.length; offset++) {
    var index = (start + offset) % counts.length;
    if (counts[index] !== minimum) continue;
    counts[index]++;
    return index + 1;
  }
  return 1;
}


/**
 * Why the note exists, given that the application is already in.
 *
 * One line, and it is the line that keeps the ask honest. Every row on this tab
 * comes from an application actually made, so the email can say so; and once it
 * says so the reader's next question is immediate and fair, which is what this
 * sentence answers. The answer is not a shortcut past anything. A submitted
 * application is one of several thousand read in the order they arrived, and a
 * referral is the only part of that the writer cannot do alone.
 *
 * The temptation is to leave it implied. It was implied for a long time, by a
 * present tense that read "applying for the role", and implied is where the
 * reader supplies the worse version: that they are being asked to carry a resume
 * for somebody who has not bothered to apply. Two thousand engineers filling that
 * gap themselves is worse than sixteen words spending it.
 *
 * The register is the constraint, and it is easy to lose. Every one of these is
 * one sentence, under twenty words, and none of them argues. The two failure
 * modes are both a line longer than they need to be: defensive ("I am not trying
 * to skip the queue, but"), which makes the reader wonder who accused the writer
 * of it, and aggrieved ("I would rather not be left in the pile"), which asks a
 * stranger to fix a system on the writer's behalf. What is left when both are cut
 * is the humble version, which is also the short one: the application is in, this
 * is what a referral would do for it, and the decision is the reader's.
 *
 * Ten of them, indexed with the template, for the reason there are ten of
 * everything else in this file. Six people at one employer can be written to on
 * one morning, and a sentence identical across all six is what turns six letters
 * into one mailing.
 */
/** Who is writing, what was applied to, and why this note followed it. */
var REFERRAL_APPLIED_LINES = [
  'I have already applied through the normal process, and I am only asking whether you see a fit.',
  'The application is already in, so I am reaching out only for your judgment on whether it fits.',
  'I have taken the usual route, and I am asking only whether my background seems relevant.',
  'The application is submitted. I am only hoping you might see a fit worth considering.',
  'I have applied directly, and I am asking for your perspective rather than a shortcut.',
  'The application is already with the team, so I am only asking whether the background aligns.',
  'I have followed the normal process, and a referral is the one part I cannot do myself.',
  'I am not asking to skip the process, only to be considered if you see a genuine fit.',
  'The application is in, and I would value your judgment on whether the experience is relevant.',
  'I have applied through the normal channel, and the next step is not in my hands.'
];

function outreachReferralIntro_(company, role, index) {
  var study = SENDER_STUDY;
  var count = REFERRAL_APPLIED_LINES.length;
  var why = REFERRAL_APPLIED_LINES[(((Number(index) || 0) % count) + count) % count];
  return 'I\u2019m **' + SENDER_NAME + '**, ' + study
       + ', and I have already applied for the **' + role + '** position at **'
       + company + '**. ' + why;
}

/**
 * The posting, on a line of its own at the foot of the message.
 *
 * It used to sit inside the sentence naming the role, and a Workday URL dropped
 * into the middle of a paragraph is two lines of unreadable query string exactly
 * where the reader is trying to find out who is writing. Down here it is out of
 * the prose and easy to copy, which is the only thing anybody does with it: a
 * referral is a form, and this is the value that goes in it.
 *
 * No date. The recruiter email names the day it was applied because that is the
 * fact a recruiter can look up; the person being asked for a referral is not
 * going to check, does not care, and reads it as filler in an email that has
 * already asked them for something.
 */
function outreachReferralPosting_(link) {
  return 'The posting: ' + link;
}

/**
 * One referral email, in both halves.
 *
 * Same skeleton as outreachCompose_ and the same two renderings, so a change to
 * how bold or how bullets work is a change in one place. What differs is the
 * order: this email says why it is arriving before it says who is writing,
 * because a stranger's first question is not what you have done.
 */
function outreachReferralCompose_(options) {
  var tier = outreachReferralTier_(options.personTitle, options.seniority);
  var index = Number(options.template) - 1;
  if (!(index >= 0 && index < REFERRAL_TEMPLATES[tier].length)) {
    index = outreachReferralIndex_(options.company, options.attempt);
  }
  var template = REFERRAL_TEMPLATES[tier][index];
  var role = outreachShortRole_(options.role);
  var greeting = 'Hi ' + outreachFirstName_(options.personName) + ',';
  // One paragraph, not two. The opening and the company sentence are both a line
  // long, and stacked as separate paragraphs above a third short one the message
  // opens as three fragments rather than as somebody talking.
  var opening = template.open
    .replace(/\{company\}/g, options.company || 'your company')
    .replace(/\{role\}/g, role || DEFAULT_SHORT_ROLE);
  var intro = outreachReferralIntro_(options.company, role, index);
  if (options.angle) intro += ' ' + outreachNoDashes_(options.angle);
  var bullets = outreachReferralBullets_(options.bucket, options.attempt);
  var askText = template.ask;
  if (!/review.*resume|resume.*review/i.test(askText)) {
    askText = 'After reviewing my resume, ' + askText.charAt(0).toLowerCase() + askText.slice(1);
  }
  var ask = askText + ' ' + template.offer;
  var posting = outreachReferralPosting_(options.jobLink);

  var list = function (lines) {
    return '<ul>' + lines.map(function (line) {
      return '<li>' + outreachBoldHtml_(line) + '</li>';
    }).join('') + '</ul>';
  };

  var html = [
    '<p>' + outreachEscape_(greeting) + '</p>',
    '<p><b>Why I\u2019m reaching out:</b></p>',
    '<p>' + outreachBoldHtml_(opening + ' ' + intro) + '</p>',
    '<p><b>A quick look:</b></p>',
    // The bullets are introduced rather than dropped. Two numbers arriving under
    // a paragraph that did not mention them read as a fragment of a CV somebody
    // pasted in; one clause turns them into the thing being offered.
    '<p>' + outreachBoldHtml_(template.lead) + '</p>',
    list(bullets),
    '<p><b>The ask:</b></p>',
    '<p>' + outreachBoldHtml_(ask) + '</p>',
    '<p>' + outreachEscape_(template.close) + '<br>' + outreachEscape_(SENDER_NAME) + '<br>'
      + '<span style="color:#666">' + outreachEscape_(SENDER_LINKS) + '</span></p>',
    '<p style="color:#666">' + outreachEscape_(posting) + '</p>'
  ].join('');

  var plain = [greeting, '', 'Why I\u2019m reaching out:',
               outreachBoldPlain_(opening + ' ' + intro), '', 'A quick look:',
               outreachBoldPlain_(template.lead), '']
    .concat(bullets.map(function (line) { return '  - ' + outreachBoldPlain_(line); }))
    .concat(['', 'The ask:', outreachBoldPlain_(ask), '',
             template.close, SENDER_NAME, SENDER_LINKS, '', posting])
    .join('\n');

  return {
    subject: outreachReferralSubject_(
      outreachReferralSubjectIndex_(options.company, options.attempt),
      options.company, role),
    html: html,
    plain: plain,
    tier: tier,
    template: index + 1
  };
}


/**
 * Log one example of every tier and every template. Sends nothing.
 *
 * Forty messages is past the number anyone can hold in their head, and the thing
 * worth checking is not any single one: it is that the ask really does shrink
 * down the tiers and that no two openings have drifted into each other.
 */
function previewReferralTemplates() {
  REFERRAL_TIERS.forEach(function (tier) {
    Logger.log('===== ' + tier.toUpperCase() + ' =====');
    REFERRAL_TEMPLATES[tier].forEach(function (entry, i) {
      Logger.log((i + 1) + '. ' + entry.open);
      Logger.log('   ASK: ' + outreachBoldPlain_(entry.ask) + ' ' + entry.offer);
      Logger.log('   ' + entry.close);
    });
  });
}
