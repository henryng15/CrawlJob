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
 *   Who and what one line of who is writing, one of what was applied to, and the
 *                posting link. The link is not decoration: a referral is a form
 *                with a job id in it, and an email that omits the req makes the
 *                willing reader go and find it. That errand is where most of the
 *                yes goes.
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
 * The forty messages.
 *
 * Every entry is four short strings. `open` is the cold contact admission and
 * nothing else; `ask` is the one bolded request and its way out;
 * `offer` is what the writer will do so the reader does not have to; `close` is
 * the sign off. Nothing else changes between variations, because format is what
 * makes an email skimmable and only the words should be moving.
 *
 * Read the four tiers next to each other and the ask shrinks as the reader gets
 * more senior: "put a referral in for me" at peer, "if you ever refer interns,
 * would you consider doing it for me" at staff. That is the whole gradient. The
 * staff openings are also the only ones that name the reach, in half a sentence,
 * once. Everything above the ask stays the same length in all four tiers, because
 * seniority is not a reason to write more.
 */
var REFERRAL_TEMPLATES = {

  // Peer. Junior engineers, new grads and interns. They were at this stage
  // recently enough to recognise the ask, so the note is warm and the request is
  // direct: softening it here would only sound evasive.
  peer: [
    { open: 'We have not spoken before, so I will keep this short.',
      ask: 'Would you be willing to **put a referral in for me**?',
      offer: 'Resume is attached, and I am happy to answer anything by email.',
      close: 'Thanks for reading this far,' },
    { open: 'This is a cold note, and we have never met.',
      ask: 'Would you be open to **referring me for it**? A no is completely fine.',
      offer: 'Everything you would need is attached.',
      close: 'Have a good week,' },
    { open: 'We have not talked before, and I know an unexpected email is a small imposition.',
      ask: 'Could I ask you to **refer me**? It would genuinely help.',
      offer: 'Resume attached, and I will reply the same day to anything you ask.',
      close: 'Wishing you a good one,' },
    { open: 'Writing cold, and I will not take much of your time.',
      ask: 'Would you consider **submitting a referral for me**?',
      offer: 'The resume is attached if you want to look first.',
      close: 'Thanks a lot,' },
    { open: 'We have never spoken, so I will get straight to it.',
      ask: 'Would you be willing to **refer me for the role**? No pressure at all.',
      offer: 'Happy to send anything else you need, or nothing at all.',
      close: 'Have a great week,' },
    { open: 'A cold email, and I am sorry to arrive uninvited.',
      ask: 'Would you be open to **putting my name in as a referral**?',
      offer: 'Resume attached, and I can answer anything by email.',
      close: 'Thank you for your time,' },
    { open: 'We have not met, so I will be quick.',
      ask: 'Could you **refer me for this one**? Only if it feels reasonable to you.',
      offer: 'Everything is in the attachment.',
      close: 'Hope your week goes well,' },
    { open: 'This arrives with no introduction, which I know is a lot to ask of an inbox.',
      ask: 'Would you be willing to **send in a referral**?',
      offer: 'Resume attached, and questions by email are welcome.',
      close: 'All the best,' },
    { open: 'We have never spoken and this is a cold note.',
      ask: 'Would you consider **referring me**? A short no is a perfectly good answer.',
      offer: 'The attachment has everything.',
      close: 'Thanks for your time,' },
    { open: 'Writing to you out of the blue, and only for a few lines.',
      ask: 'Would you be open to **referring me for the internship**?',
      offer: 'Resume attached, and I am glad to answer anything by email.',
      close: 'Have a lovely day,' }
  ],

  // Mid. The largest group by far, and the one where the reason for writing to an
  // engineer instead of a recruiter has to carry the note: they are neither a peer
  // nor an authority, so the only honest hook is that they do the actual work.
  mid: [
    { open: 'We have not spoken before, so I will be brief.',
      ask: 'Would you be open to **referring me for it**?',
      offer: 'Resume is attached, and I can answer anything by email.',
      close: 'Thanks for reading,' },
    { open: 'This is a cold email and we have never met, which I know is a small imposition on a working day.',
      ask: 'Would you consider **putting a referral in**? Completely understand if not.',
      offer: 'Everything you would need is attached.',
      close: 'Have a good week,' },
    { open: 'We have not talked before, and I will keep this to a few lines.',
      ask: 'Would you be willing to **refer me**?',
      offer: 'Resume attached, and I will answer anything the same day.',
      close: 'Wishing you a good week,' },
    { open: 'Writing cold, and I will not take more than a minute of your day.',
      ask: 'Could I ask you to **submit a referral for me**?',
      offer: 'The resume is attached if you would rather look before deciding.',
      close: 'Thank you for your time,' },
    { open: 'We have never spoken, so an unexpected message from me is a fair thing to ignore.',
      ask: 'Would you be open to **referring me for the role**? A no costs me nothing.',
      offer: 'Happy to send anything else, or nothing at all.',
      close: 'Have a great week,' },
    { open: 'A cold note, with no introduction behind it.',
      ask: 'Would you consider **referring me**?',
      offer: 'Resume attached, and I am happy to answer anything by email.',
      close: 'Thanks either way,' },
    { open: 'We have not met, and I will keep this short out of respect for your day.',
      ask: 'Would you be willing to **put my name forward as a referral**?',
      offer: 'Everything is in the attachment.',
      close: 'Hope the week treats you well,' },
    { open: 'This arrives unannounced, which I know is not ideal.',
      ask: 'Would you be open to **sending in a referral**? Only if it seems reasonable.',
      offer: 'Resume attached, and questions by email are welcome.',
      close: 'All the best,' },
    { open: 'We have never spoken and this is entirely cold.',
      ask: 'Could you **refer me for this one**?',
      offer: 'The attachment covers everything.',
      close: 'Thanks for your time,' },
    { open: 'Writing out of the blue, and I will be quick about it.',
      ask: 'Would you consider **referring me for the internship**? Fine either way.',
      offer: 'Resume attached, and I can answer anything by email.',
      close: 'Have a good one,' }
  ],

  // Senior. The ask starts carrying a condition rather than just a softener: "if
  // it is something you do" gives an out that costs the reader nothing to take,
  // which is what makes the direct question askable at all.
  senior: [
    { open: 'We have not spoken before, and I know a cold email is a claim on a busy day.',
      ask: 'If it is something you do, would you consider **referring me**? A no is a completely fine answer.',
      offer: 'Resume attached, and I am happy to answer anything by email.',
      close: 'Thank you for your time,' },
    { open: 'This arrives with no introduction, from someone you have never met.',
      ask: 'Would you be open to **putting a referral in**? Only if it is easy for you.',
      offer: 'Everything you would need is in the attachment.',
      close: 'Have a good week,' },
    { open: 'We have never spoken, and I appreciate that your inbox does not need one more stranger in it.',
      ask: 'If you ever refer interns, would you consider **doing it for me**?',
      offer: 'Resume attached, and no reply is needed if the answer is no.',
      close: 'Wishing you a good week,' },
    { open: 'Writing cold, and I know your time is the scarce thing here.',
      ask: 'Would you be willing to **refer me**? I would be grateful, and completely fine if not.',
      offer: 'The attachment has everything, and I can answer anything by email.',
      close: 'Thank you sincerely,' },
    { open: 'We have not met, and I will say this plainly rather than dress it up.',
      ask: 'Would you consider **referring me for it**? A short no is a perfectly good reply.',
      offer: 'Resume attached if you would rather look before deciding.',
      close: 'Thanks for reading this far,' },
    { open: 'A cold note, which I know is the least welcome kind.',
      ask: 'If it is not too much, would you **refer me**?',
      offer: 'Everything is attached, and questions by email are welcome.',
      close: 'Have a great week,' },
    { open: 'We have never spoken, and I will not pretend otherwise.',
      ask: 'Would you be open to **submitting a referral**? Please ignore this if the timing is wrong.',
      offer: 'Resume attached, and I can send anything else you need.',
      close: 'Thank you for reading,' },
    { open: 'Writing unannounced, which costs you a moment you did not plan to spend.',
      ask: 'Would you consider **putting my name in**? I would be genuinely grateful.',
      offer: 'The attachment covers it, and I am happy to answer anything.',
      close: 'All the best,' },
    { open: 'We have not met, and this is a cold ask from a student.',
      ask: 'If you refer people, would you be willing to **refer me**? No is an easy answer here.',
      offer: 'Resume attached, and nothing else is needed from you.',
      close: 'Thanks very much,' },
    { open: 'This is out of the blue, and I know a senior inbox gets a lot of these.',
      ask: 'Would you be open to **referring me for the internship**? Completely fine either way.',
      offer: 'The attachment has what you would need, and nothing more.',
      close: 'Thank you for the time,' }
  ],

  // Staff and above, plus managers and directors. Each opening names the reach in
  // half a sentence, once, and then stops: a full sentence of apology asks the
  // reader to agree the email was a mistake, and some of them will.
  staff: [
    { open: 'We have never spoken, and writing to someone at your level is a reach on my part. I decided to try anyway.',
      ask: 'If you ever refer interns, would you consider **doing it for me**? A no costs me nothing.',
      offer: 'Resume attached, and no reply is needed if the answer is no.',
      close: 'Thank you for the time either way,' },
    { open: 'This is a cold email, and aimed well above the level I am applying at, which I know is presumptuous.',
      ask: 'Would you be open to **putting a referral in**? Only if it takes you nothing.',
      offer: 'Everything is in the attachment.',
      close: 'Thank you sincerely,' },
    { open: 'We have not met, and I am aware that reaching this far up for an internship is a long shot.',
      ask: 'If it is something you do, would you consider **referring me**?',
      offer: 'Resume attached, and no answer is needed if this is not for you.',
      close: 'Thanks very much for reading,' },
    { open: 'Writing cold, and honestly a little out of my depth in doing so.',
      ask: 'Would you be willing to **refer me**? I would be grateful, and I understand if not.',
      offer: 'The attachment has everything, and I can answer anything by email.',
      close: 'Thank you for your time,' },
    { open: 'We have never spoken, and you are several levels past where I am starting, so I know this is a bold note to send.',
      ask: 'Would you consider **putting my name forward**? A short no is a perfectly good reply.',
      offer: 'Resume attached, and nothing else is needed from you.',
      close: 'All the best, and thank you,' },
    { open: 'A cold email, and a slightly nervy one given the distance between your role and the one I am applying for.',
      ask: 'If you refer people, would you be open to **referring me**?',
      offer: 'Everything you would need is attached.',
      close: 'Thank you for the moment this took,' },
    { open: 'We have not met, and writing to someone this senior about an internship feels like a stretch.',
      ask: 'Would you consider **submitting a referral for me**? Genuinely fine if not.',
      offer: 'Resume attached, and I am happy to answer anything by email.',
      close: 'Thanks very much,' },
    { open: 'This arrives unannounced and aimed higher than it probably should be.',
      ask: 'Would you be open to **referring me**? Please ignore this if it is not something you do.',
      offer: 'The attachment covers everything.',
      close: 'With thanks for the read,' },
    { open: 'We have never spoken, and I know an intern application is well below what usually reaches you.',
      ask: 'If you ever put names in, would you consider **putting mine in**?',
      offer: 'Resume attached, and no reply is needed either way.',
      close: 'Thank you sincerely for reading,' },
    { open: 'Writing out of the blue to someone a long way ahead of me, which I recognise is a liberty.',
      ask: 'Would you be willing to **refer me for the internship**? A no is completely fine.',
      offer: 'The resume is attached, and I need nothing else from you.',
      close: 'Thanks for the time,' }
  ]
};


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
 * The register is the honest one. A student at a college nobody recruits at,
 * asking a stranger at a company he would like to work at, is a long shot, and
 * the subjects say so. Naming it costs nothing that pretending would not cost
 * more, and it is the only thing here that no other applicant's subject line can
 * also say.
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
var REFERRAL_SUBJECTS = [
  'A non target student asking about a referral',
  'Referral ask from a school you have not heard of',
  'Non target student, big dream, small ask',
  'A referral ask I know is a long shot',
  'Referral ask: no network, a few real numbers',
  'One referral ask from a Kenyon College student',
  'A small referral ask with a big dream behind it',
  'Non target, class of 2028, asking about a referral',
  'Referral ask for {role}',
  'A long shot referral ask about {company}',
  'Would you consider a referral at {company}?',
  'Referral ask from a liberal arts CS student',
  'A referral ask, and no reply needed if not',
  'Non target student hoping for a referral',
  'A referral ask, honestly a long shot',
  'One quiet referral ask from a 2028 student',
  'A big dream and a two minute referral ask',
  'Referral ask from outside the usual pipeline',
  'A referral ask that should take you two minutes',
  'Asking a stranger for a referral, briefly',
  'Referral ask, and I know how it sounds',
  'A student with no connections asking for a referral',
  'Referral ask for a summer role at {company}',
  'Long shot referral ask, short email',
  'A referral ask from someone starting from zero',
  'Non target student, one referral ask',
  'A hopeful referral ask about {company}',
  'Small referral ask from a Kenyon student',
  'A referral ask, respectfully and briefly',
  'Asking about a referral, with no claim on your time',
  'Referral ask from a student who admires the work',
  'A referral ask from someone who follows {company}',
  'Referral ask: small school, serious about this',
  'One referral ask, and I will not write again',
  'A referral ask from far outside your usual pool',
  'Referral ask: 2028 graduate, summer internship'
];

/**
 * Which subject a person gets.
 *
 * Its own index rather than the template's. The templates run to ten and the
 * subjects to thirty six, and reusing the template index would leave twenty six
 * of them unreachable while every eleventh reader saw a repeat.
 */
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


/**
 * The line that makes the referral submittable.
 *
 * A referral is a form with a job id in it. Naming the role and the date is what
 * the recruiter email does, and it is enough for a recruiter because the req is
 * already theirs. It is not enough for an engineer, who has to find the posting
 * before they can do anything at all, and that errand is where a willing reader
 * quietly becomes a reader who meant to get to it.
 *
 * The link is therefore required, and the sender refuses the row without one
 * rather than sending a referral ask that cannot be acted on.
 */
function outreachReferralApplied_(company, role, dateApplied, today, formatDate, link) {
  // Present tense when there is no application. That was the ordinary case while
  // this path read the crawler's postings and the uncommon one now that it reads
  // applications, but the rule is the same either way and is the point: this is
  // the one sentence in the message the reader can check, in an email whose whole
  // argument is that it is honest, so it says whichever of the two is true rather
  // than whichever is more flattering.
  if (!dateApplied) {
    return 'I am applying for the ' + role + ' role at ' + company + ': ' + link;
  }
  var line = 'I applied for the ' + role + ' role at ' + company;
  if (!today || (today - dateApplied) / 86400000 <= STALE_APPLICATION_DAYS) {
    line += ' on ' + formatDate(dateApplied);
  }
  return line + ': ' + link;
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
  var index = outreachReferralIndex_(options.company, options.attempt);
  var template = REFERRAL_TEMPLATES[tier][index];
  var role = outreachShortRole_(options.role);
  var formatDate = options.formatDate || function (d) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM d');
  };

  var greeting = 'Hi ' + outreachFirstName_(options.personName) + ',';
  var opening = [template.open]
    .concat(options.angle ? [outreachNoDashes_(options.angle)] : []);
  var applied = 'I am ' + SENDER_NAME + ', ' + SENDER_STUDY + '. '
              + outreachReferralApplied_(options.company, role, options.dateApplied,
                                         options.today, formatDate, options.jobLink);
  var bullets = outreachReferralBullets_(options.bucket, options.attempt);
  var ask = template.ask + ' ' + template.offer;

  var list = function (lines) {
    return '<ul>' + lines.map(function (line) {
      return '<li>' + outreachBoldHtml_(line) + '</li>';
    }).join('') + '</ul>';
  };

  var html = [
    '<p>' + outreachEscape_(greeting) + '</p>',
    opening.map(function (line) {
      return '<p>' + outreachBoldHtml_(line) + '</p>';
    }).join(''),
    '<p>' + outreachBoldHtml_(applied) + '</p>',
    list(bullets),
    '<p>' + outreachBoldHtml_(ask) + '</p>',
    '<p>' + outreachEscape_(template.close) + '<br>' + outreachEscape_(SENDER_NAME) + '<br>'
      + '<span style="color:#666">' + outreachEscape_(SENDER_LINKS) + '</span></p>'
  ].join('');

  var plain = [greeting, '']
    .concat([opening.map(outreachBoldPlain_).join('\n\n')])
    .concat(['', outreachBoldPlain_(applied), ''])
    .concat(bullets.map(function (line) { return '  - ' + outreachBoldPlain_(line); }))
    .concat(['', outreachBoldPlain_(ask), '',
             template.close, SENDER_NAME, SENDER_LINKS])
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
