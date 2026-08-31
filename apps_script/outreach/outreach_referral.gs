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

  // Peer. Junior engineers, new grads and interns, close enough to this stage to
  // recognise the ask, so the note is warm and the request is direct.
  peer: [
    { open: 'We have never met, and I will keep this to a few lines.',
      lead: 'Two things I have built that are closest to the work:',
      ask: 'Would you be willing to **refer me**?',
      offer: 'If it is easier to pass my resume to whoever runs hiring there, that helps just as much. It is attached.',
      close: 'Thanks for reading this far,' },
    { open: 'A short note from a stranger, and the only one I will send.',
      lead: 'The two pieces of my own work I would point at:',
      ask: 'May I ask you for **a referral**, even though this is the first you are hearing from me?',
      offer: 'And if forwarding the attached resume to someone in recruiting is the easier favour, I would be just as grateful.',
      close: 'Have a good week,' },
    { open: 'This will take you under a minute.',
      lead: 'Two things I have shipped that are nearest to it:',
      ask: 'Would it be too forward to ask you for **a referral**, given that we have never spoken?',
      offer: 'If pointing it at whoever handles intern hiring is simpler, that helps too. Resume attached.',
      close: 'Wishing you a good one,' },
    { open: 'We have not met, so I will be brief.',
      lead: 'Two of my own projects that speak to the same problems:',
      ask: 'Would you **refer me**? Please treat it as easy to refuse.',
      offer: 'Or forward the attached resume to whoever owns this req, if that is the easier thing to do.',
      close: 'Thanks a lot,' },
    { open: 'A few lines and I will leave you to your day.',
      lead: 'Two results from my own work that seem closest:',
      ask: 'Might I ask you for **a referral**, even though we are strangers?',
      offer: 'If passing the attached resume to someone in recruiting is easier, I would be grateful for that instead.',
      close: 'Have a great week,' },
    { open: 'We have never spoken, so I will say this quickly.',
      lead: 'Two things I have built that are closest to what the team does:',
      ask: 'Would you be open to **referring me**?',
      offer: 'And if the simpler favour is forwarding my resume to hiring, please do that instead. It is attached.',
      close: 'Thank you for your time,' },
    { open: 'Short, and only this once.',
      lead: 'The two results of mine I would put forward:',
      ask: 'Would you **refer me**, knowing that I am a stranger asking?',
      offer: 'If handing the attached resume to whoever runs this hire is easier, that would help just as much.',
      close: 'Hope your week goes well,' },
    { open: 'A few sentences from somebody you have not met, and no more.',
      lead: 'Two things I have made that are near this work:',
      ask: 'May I ask you for **a referral**?',
      offer: 'Or send the attached resume on to someone in recruiting, if that costs you less.',
      close: 'All the best,' },
    { open: 'I will keep it short.',
      lead: 'Two pieces of my own work that fit closest:',
      ask: 'We have not spoken before, so a no is easy: would you consider **referring me**?',
      offer: 'If forwarding it to whoever handles intern hiring is the easier route, I would be grateful. Resume attached.',
      close: 'Thanks for your time,' },
    { open: 'Only a few lines, I promise.',
      lead: 'Two things I have built that come nearest to it:',
      ask: 'Would you be willing to **refer me**, even though we have never met?',
      offer: 'And passing the attached resume to someone in recruiting would help just as much, if that is simpler.',
      close: 'Have a lovely day,' }
  ],

  // Mid. The largest group by far.
  mid: [
    { open: 'We have never met, and I will be brief.',
      lead: 'Two things I have built that are closest to the work:',
      ask: 'Would you be open to **referring me**?',
      offer: 'If it is easier to pass my resume to whoever runs hiring there, that helps just as much. It is attached.',
      close: 'Thanks for reading,' },
    { open: 'A short note on a working day, and I will keep it that way.',
      lead: 'The two pieces of my own work I would point at:',
      ask: 'Would it be presumptuous to ask you for **a referral**, given that we have never spoken?',
      offer: 'And if forwarding the attached resume to someone in recruiting is the easier favour, I would be just as grateful.',
      close: 'Have a good week,' },
    { open: 'This will take a minute at most.',
      lead: 'Two results from my own projects that seem nearest:',
      ask: 'May I ask you for **a referral**, even though this is the first you are hearing from me?',
      offer: 'If pointing it at whoever handles intern hiring is simpler, that helps too. Resume attached.',
      close: 'Wishing you a good week,' },
    { open: 'We have not met, and I will not take much of your day.',
      lead: 'Two things I have shipped that are closest to it:',
      ask: 'Would you **refer me**? Please say no freely.',
      offer: 'Or forward the attached resume to whoever owns this req, if that is the easier thing to do.',
      close: 'Thank you for your time,' },
    { open: 'A few lines, and an easy one to ignore.',
      lead: 'Two of my own results that speak to the same problems:',
      ask: 'Might I ask a stranger for **a referral**? That is what this is, and I would be grateful.',
      offer: 'If passing the attached resume to someone in recruiting is easier, I would be grateful for that instead.',
      close: 'Have a great week,' },
    { open: 'We have never spoken. Short and to the point, then.',
      lead: 'Two things I have built that are nearest to the work of your team:',
      ask: 'Would you consider **referring me**?',
      offer: 'And if the simpler favour is forwarding my resume to hiring, please do that instead. It is attached.',
      close: 'Thanks either way,' },
    { open: 'I will keep this out of your way.',
      lead: 'The two pieces of work of mine I would put forward:',
      ask: 'Would you be willing to **refer me**, knowing that we have never met?',
      offer: 'If handing the attached resume to whoever runs this hire is easier, that would help just as much.',
      close: 'Hope the week treats you well,' },
    { open: 'A short one from a stranger, and the only one.',
      lead: 'Two things I have made that fit closest:',
      ask: 'May I ask you for **a referral**?',
      offer: 'Or send the attached resume on to someone in recruiting, if that costs you less.',
      close: 'All the best,' },
    { open: 'This is short.',
      lead: 'Two results of my own that come nearest to it:',
      ask: 'We have not met, so a no costs me nothing: would you consider **referring me**?',
      offer: 'If forwarding it to whoever handles intern hiring is the easier route, I would be grateful. Resume attached.',
      close: 'Thanks for your time,' },
    { open: 'We have never met, and I will be quick.',
      lead: 'Two things I have built that are closest to what you work on:',
      ask: 'Would it be too much to ask you for **a referral**?',
      offer: 'And passing the attached resume to someone in recruiting would help just as much, if that is simpler.',
      close: 'Have a good one,' }
  ],

  // Senior. The ask carries a condition rather than only a softener.
  senior: [
    { open: 'I know an unexpected email is a claim on a busy day, so I will be brief.',
      lead: 'Two things I have built that are closest to the work:',
      ask: 'We have never met, so please refuse freely: would you consider **referring me**?',
      offer: 'If it is easier to pass my resume to whoever runs hiring there, that helps just as much. It is attached.',
      close: 'Thank you for your time,' },
    { open: 'A few lines from somebody you have not heard of.',
      lead: 'The two pieces of my own work I would point at:',
      ask: 'Might I ask you for **a referral**?',
      offer: 'And if forwarding the attached resume to someone in recruiting is the easier favour, I would be just as grateful.',
      close: 'Have a good week,' },
    { open: 'I appreciate that your inbox does not need one more stranger in it.',
      lead: 'Two results of mine that seem nearest to it:',
      ask: 'If it is something you ever do, may I ask you for **a referral**?',
      offer: 'If pointing it at whoever handles intern hiring is simpler, that helps too. Resume attached.',
      close: 'Wishing you a good week,' },
    { open: 'Your time is the scarce thing here, so this is short.',
      lead: 'Two things I have shipped that are closest to the same problems:',
      ask: 'We have not met, which makes this presumptuous, but would you be willing to **refer me**?',
      offer: 'Or forward the attached resume to whoever owns this req, if that is the easier thing to do.',
      close: 'Thank you sincerely,' },
    { open: 'A short note from a stranger, and I will not send a second.',
      lead: 'Two pieces of my own work that fit closest:',
      ask: 'May I ask you for **a referral**?',
      offer: 'If passing the attached resume to someone in recruiting is easier, I would be grateful for that instead.',
      close: 'Thanks for reading this far,' },
    { open: 'I know this is the least welcome kind of email.',
      lead: 'Two things I have built that come nearest to the work:',
      ask: 'Would it be too much to ask you for **a referral**, given that we are strangers?',
      offer: 'And if the simpler favour is forwarding my resume to hiring, please do that instead. It is attached.',
      close: 'Have a great week,' },
    { open: 'We have never spoken, so I will keep the ask small and the note shorter.',
      lead: 'The two results of mine I would put forward:',
      ask: 'Would you **refer me**? Please ignore this freely if not.',
      offer: 'If handing the attached resume to whoever runs this hire is easier, that would help just as much.',
      close: 'Thank you for reading,' },
    { open: 'This costs you a moment you did not plan to spend, and I am sorry for it.',
      lead: 'Two things I have made that speak to the same work:',
      ask: 'Might I ask a stranger\'s favour and put my name to you for **a referral**?',
      offer: 'Or send the attached resume on to someone in recruiting, if that costs you less.',
      close: 'All the best,' },
    { open: 'A cold note from a student, made plainly rather than dressed up.',
      lead: 'Two pieces of my own work that seem closest:',
      ask: 'We have never met, so a no is an easy answer: would you consider **referring me**?',
      offer: 'If forwarding it to whoever handles intern hiring is the easier route, I would be grateful. Resume attached.',
      close: 'Thanks very much,' },
    { open: 'I know a senior inbox gets a lot of these, so here is mine in three lines.',
      lead: 'Two things I have built that are nearest to it:',
      ask: 'May I ask you for **a referral**, even though this is the first you are hearing from me?',
      offer: 'And passing the attached resume to someone in recruiting would help just as much, if that is simpler.',
      close: 'Thank you for the time,' }
  ],

  // Staff and above, plus managers and directors. Each opening names the reach
  // in half a sentence, once, and then stops.
  staff: [
    { open: 'We have never met, and writing to somebody at your level is a reach on my part.',
      lead: 'Two things I have built that are closest to the work:',
      ask: 'I ask this knowing it is a lot: would you consider **referring me**?',
      offer: 'If it is easier to pass my resume to whoever runs hiring there, that helps just as much. It is attached.',
      close: 'Thank you for the time either way,' },
    { open: 'This is aimed well above the level I am applying at, which I know is presumptuous.',
      lead: 'The two pieces of my own work I would point at:',
      ask: 'May I presume on somebody I have never met and ask for **a referral**?',
      offer: 'And if forwarding the attached resume to someone in recruiting is the easier favour, I would be just as grateful.',
      close: 'Thank you sincerely,' },
    { open: 'Reaching this far up for an internship is a long shot and I am aware of it.',
      lead: 'Two results of mine that seem nearest to it:',
      ask: 'If it is something you ever do, and knowing we have never spoken, may I ask for **a referral**?',
      offer: 'If pointing it at whoever handles intern hiring is simpler, that helps too. Resume attached.',
      close: 'Thanks very much for reading,' },
    { open: 'I am a little out of my depth writing this, and would rather say so.',
      lead: 'Two things I have shipped that are closest to the same problems:',
      ask: 'We have never met, so please refuse without a thought: would you be willing to **refer me**?',
      offer: 'Or forward the attached resume to whoever owns this req, if that is the easier thing to do.',
      close: 'Thank you for your time,' },
    { open: 'You are several levels past where I am starting, so this is a bold note to send.',
      lead: 'Two pieces of my own work that fit closest:',
      ask: 'Might I ask you for **a referral**, knowing that we are strangers and that I am asking a lot?',
      offer: 'If passing the attached resume to someone in recruiting is easier, I would be grateful for that instead.',
      close: 'All the best, and thank you,' },
    { open: 'A slightly nervy note, given the distance between your role and the one I want.',
      lead: 'Two things I have built that come nearest to the work:',
      ask: 'We have never spoken, which makes this presumptuous, but would you consider **referring me**?',
      offer: 'And if the simpler favour is forwarding my resume to hiring, please do that instead. It is attached.',
      close: 'Thank you for the moment this took,' },
    { open: 'Writing to somebody this senior about an internship feels like a stretch.',
      lead: 'The two results of mine I would put forward:',
      ask: 'May I ask a stranger\'s favour of you and request **a referral**?',
      offer: 'If handing the attached resume to whoever runs this hire is easier, that would help just as much.',
      close: 'Thanks very much,' },
    { open: 'This is aimed higher than it probably should be, and I sent it anyway.',
      lead: 'Two things I have made that speak to the same work:',
      ask: 'We have never met, so ignore this freely: would you be open to **referring me**?',
      offer: 'Or send the attached resume on to someone in recruiting, if that costs you less.',
      close: 'With thanks for the read,' },
    { open: 'I know an intern application is well below what usually reaches you.',
      lead: 'Two pieces of my own work that seem closest:',
      ask: 'Knowing that we have never spoken, may I still ask you for **a referral**?',
      offer: 'If forwarding it to whoever handles intern hiring is the easier route, I would be grateful. Resume attached.',
      close: 'Thank you sincerely for reading,' },
    { open: 'Writing to somebody a long way ahead of me, which I recognise is a liberty.',
      lead: 'Two things I have built that are nearest to it:',
      ask: 'We have never met and I am asking a great deal, but would you be willing to **refer me**?',
      offer: 'And passing the attached resume to someone in recruiting would help just as much, if that is simpler.',
      close: 'Thanks for the time,' }
  ]
};

// Humility here means being clear and considerate, not describing the sender as
// a long shot or apologising for the request. These ten variants preserve the
// per-company variety the queue needs while keeping every actual message serious.
var REFERRAL_SERIOUS_OPENINGS = [
  'I am reaching out respectfully about the software engineering opening at your company.',
  'I wanted to contact you about the software engineering role currently open at your company.',
  'I am writing about the open software engineering opportunity at your company.',
  'I hope it is all right to contact you regarding the software engineering role now open there.',
  'I wanted to reach out about the software engineering position currently available at your company.',
  'I am writing to ask about the open software engineering role at your company.',
  'I wanted to introduce myself in connection with the software engineering opening at your company.',
  'I am contacting you about the software engineering opportunity that is currently open there.',
  'I hope you do not mind a brief note regarding the open software engineering role at your company.',
  'I am reaching out because I noticed the software engineering position open at your company.'
];
var REFERRAL_SERIOUS_LEADS = [
  'For context, two engineering projects most relevant to the role:',
  'For a concise view of my technical background:',
  'Two projects that best represent my software engineering experience:',
  'For additional context on the work I have built:',
  'Two examples of engineering work relevant to this role:',
  'The two technical projects I would most value your reviewing:',
  'For a brief view of my recent engineering work:',
  'Two projects that best show the background I would bring:',
  'For context on my software engineering experience:',
  'Two examples that may help you assess my technical fit:'
];
var REFERRAL_SERIOUS_ASKS = [
  'If you have a moment to review my resume and feel I could be a fit, would you consider **referring me** for the role?',
  'Would you be willing to review my resume and, if my background seems suitable, consider **referring me** for this role?',
  'If my experience looks relevant after reviewing my resume, may I ask whether you would consider **referring me**?',
  'I would be grateful if you could review my resume and, if you see a fit, consider **referring me** for the position.',
  'After reviewing my resume, if you believe I could contribute to the team, would you consider **referring me**?',
  'If you feel my background is a match after looking over my resume, would you consider **referring me** for the role?',
  'May I ask you to review my resume and, only if you feel it is appropriate, consider **referring me**?',
  'If you have time to review my resume and think I may be a fit, would you consider **referring me**?',
  'Would you consider reviewing my resume and, if my experience aligns with the role, **referring me**?',
  'If my resume gives you confidence in the fit, may I ask whether you would consider **referring me** for this opportunity?'
];
var REFERRAL_SERIOUS_OFFERS = [
  'I would appreciate any opportunity to move forward in the process. My resume is attached and the posting link is below. I completely understand if a referral is not something you can offer.',
  'I would be grateful for the chance to continue in the process. I have attached my resume and included the posting below, and I understand completely if you cannot offer a referral.',
  'I appreciate your consideration of any next step. My resume is attached and the direct posting is below. Please feel no obligation if a referral is not appropriate.',
  'I would value the opportunity to move forward. My resume is attached and the application link is below. I understand if you are not comfortable providing a referral.',
  'I would appreciate the opportunity to continue in the process. The resume is attached and the posting is below. I completely understand if you prefer not to refer someone you do not know.',
  'Any opportunity to move forward would mean a great deal to me. My resume is attached and the posting link is below. I understand if a referral is outside what you can offer.',
  'I would be thankful for any consideration in the next stage. I have attached my resume and included the posting below. I understand completely if a referral is not possible.',
  'I appreciate your time and any opportunity to proceed. My resume is attached and the direct link is below. Please feel no pressure to provide a referral.',
  'I would welcome the opportunity to be considered further. The resume is attached and the posting link is below. I understand if you cannot offer a referral.',
  'I would appreciate any chance to continue in the process. I have attached my resume and included the posting below. I completely understand if you would rather not refer me.'
];
var REFERRAL_SERIOUS_CLOSES = [
  'Thank you for your time and consideration,', 'Thank you very much for considering my request,',
  'Thank you for taking the time to review this,', 'With appreciation for your consideration,',
  'Thank you for your time,', 'Thank you for considering my request,',
  'With sincere thanks for your consideration,', 'Thank you for reading and considering this,',
  'I appreciate your time and consideration,', 'Thank you again for your consideration,'
];

function outreachReferralInstallSeriousTemplates_() {
  REFERRAL_TIERS.forEach(function (tier) {
    REFERRAL_TEMPLATES[tier] = REFERRAL_SERIOUS_OPENINGS.map(function (open, index) {
      return { open: open, lead: REFERRAL_SERIOUS_LEADS[index],
               ask: REFERRAL_SERIOUS_ASKS[index], offer: REFERRAL_SERIOUS_OFFERS[index],
               close: REFERRAL_SERIOUS_CLOSES[index] };
    });
  });
}

outreachReferralInstallSeriousTemplates_();


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
// The subject names the request plainly, without asking the recipient to absorb
// the sender's insecurity in the preview pane. Indexing still produces distinct
// wording for the people at one employer.
REFERRAL_SUBJECTS = [
  'Referral request for {role}', 'Resume review and referral request',
  'Referral consideration for {role}', 'Request for referral consideration',
  'Referral request regarding {role}', 'Resume review for a referral request',
  'Referral request from Henry Nguyen', 'Referral request for an open SWE role',
  'Referral request for a current role', 'Referral consideration for your team',
  'Resume review and referral consideration', 'Referral request regarding your team',
  'Request to consider a referral', 'Referral request for an engineering role',
  'Resume review and referral request for SWE', 'Referral request from a Kenyon CS student',
  'Referral consideration for an internship', 'Request for a software engineering referral',
  'Referral request for a software engineering role', 'Resume review request and referral',
  'Referral request for an internship role', 'Referral consideration for an open role',
  'Referral request for a software engineering internship', 'Request for resume review and referral',
  'Referral request for a current SWE opening', 'Referral request from a CS student',
  'Referral consideration for a SWE internship', 'Resume review for a SWE referral request',
  'Referral request for an engineering internship', 'Request for a referral for {role}',
  'Referral request and resume review', 'Referral consideration for your engineering team',
  'Referral request for a current engineering role', 'Request to review my resume for a referral',
  'Referral request for a software engineering opportunity', 'Referral consideration and resume review'
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
var REFERRAL_APPLIED_LINES = [
  'It is already in, and I am writing only in the hope that it reaches a person.',
  'That part is done. What I am hoping for is that it is read rather than filtered.',
  'It sits with a few thousand others, which is the only reason I am writing to you.',
  'I would not ask you to shorten any of that, only to help it be seen.',
  'It is in the system, and I am hoping a referral gives it a chance of being read.',
  'It went in a while ago, and I am writing in the hope of it reaching a person.',
  'I have taken the ordinary route, and a referral is the one part I cannot do myself.',
  'I am not asking for anything to be skipped, only for what I sent to be seen.',
  'It is in, and a referral is the one thing that might lift it out of the pile.',
  'That is the process and I have followed it. The rest is not in my hands.'
];

/**
 * Who is writing, what was applied to, and why this note followed it.
 *
 * The tense is the fact. "Applying for the role" was true while this path read the
 * crawler's Jobs tab and had a posting rather than an application behind it; every
 * row now comes from something submitted, and the present tense about an
 * application three weeks old is the same falsehood pointing the other way.
 *
 * No date, though the send path looks one up and passes it. The recruiter email
 * names the day because a recruiter can check it; the engineer being asked a
 * favour is not going to, and a date in this sentence is one more thing to read
 * before finding out who is writing.
 *
 * The graduation year is left out for the same reason. SENDER_STUDY carries
 * "class of 2028" because the recruiter email wants it: a recruiter is checking
 * eligibility for an intake and the year is the fact that decides it. The engineer
 * is checking nothing, and the room is better spent on the school and the subject.
 */
REFERRAL_APPLIED_LINES = [
  'The role aligns closely with the software engineering work I have been building.',
  'I am reaching out because the role looks closely aligned with my software engineering background.',
  'The position stood out because its technical focus fits the work I have pursued so far.',
  'I believe my experience could be relevant to the responsibilities the role describes.',
  'The opening is a strong match for the direction I have been building toward in software engineering.',
  'I am interested in the role because it aligns with the systems and products I have worked on.',
  'The position is closely related to the engineering work I hope to continue doing.',
  'I saw a genuine connection between the role and the projects I have built.',
  'The role appears well aligned with the technical foundation I have developed.',
  'I wanted to reach out because the work described is closely related to my background.'
];

function outreachReferralIntro_(company, role, index) {
  var study = SENDER_STUDY.replace(/\s*\(class of \d{4},\s*/i, ' (')
                          .replace(/\s*\(class of \d{4}\)/i, '');
  var count = REFERRAL_APPLIED_LINES.length;
  var why = REFERRAL_APPLIED_LINES[(((Number(index) || 0) % count) + count) % count];
  return 'My name is ' + SENDER_NAME + '. I am ' + study
       + ' with a background in software engineering, and I have already applied for the '
       + role + ' role at ' + company + '. ' + why;
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
  var index = outreachReferralIndex_(options.company, options.attempt);
  var template = REFERRAL_TEMPLATES[tier][index];
  var role = outreachShortRole_(options.role);
  var greeting = 'Hi ' + outreachFirstName_(options.personName) + ',';
  // One paragraph, not two. The opening and the company sentence are both a line
  // long, and stacked as separate paragraphs above a third short one the message
  // opens as three fragments rather than as somebody talking.
  var opening = ['We have not met before, but I came across your profile and saw that you work at '
                 + options.company + '.', template.open]
    .concat(options.angle ? [outreachNoDashes_(options.angle)] : []).join(' ');
  var intro = outreachReferralIntro_(options.company, role, index);
  var bullets = outreachReferralBullets_(options.bucket, options.attempt);
  var ask = template.ask + ' ' + template.offer;
  var posting = outreachReferralPosting_(options.jobLink);

  var list = function (lines) {
    return '<ul>' + lines.map(function (line) {
      return '<li>' + outreachBoldHtml_(line) + '</li>';
    }).join('') + '</ul>';
  };

  var html = [
    '<p>' + outreachEscape_(greeting) + '</p>',
    '<p>' + outreachBoldHtml_(opening) + '</p>',
    '<p>' + outreachBoldHtml_(intro) + '</p>',
    // The bullets are introduced rather than dropped. Two numbers arriving under
    // a paragraph that did not mention them read as a fragment of a CV somebody
    // pasted in; one clause turns them into the thing being offered.
    '<p>' + outreachBoldHtml_(template.lead) + '</p>',
    list(bullets),
    '<p>' + outreachBoldHtml_(ask) + '</p>',
    '<p>' + outreachEscape_(template.close) + '<br>' + outreachEscape_(SENDER_NAME) + '<br>'
      + '<span style="color:#666">' + outreachEscape_(SENDER_LINKS) + '</span></p>',
    '<p style="color:#666">' + outreachEscape_(posting) + '</p>'
  ].join('');

  var plain = [greeting, '', outreachBoldPlain_(opening), '',
               outreachBoldPlain_(intro), '', outreachBoldPlain_(template.lead), '']
    .concat(bullets.map(function (line) { return '  - ' + outreachBoldPlain_(line); }))
    .concat(['', outreachBoldPlain_(ask), '',
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
