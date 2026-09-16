/**
 * Outreach — shared configuration for the standalone sender project.
 *
 * This project is NOT the script bound to the Track App spreadsheet. It lives in
 * the Apps Script editor of hoanng15.work@gmail.com and is what actually sends,
 * because a bound script runs as whoever owns the spreadsheet — which here is a
 * different account, and the one address that must never appear as the sender.
 *
 * Install: script.google.com -> New project, signed in as the sending account,
 * paste these outreach_*.gs files in, then run setupOutreachProperties once and
 * fill in the four IDs it reports as missing.
 *
 * See ../../docs/outreach.md for the design these constants come from.
 */

// ---------------------------------------------------------------- identifiers

// Held in Script Properties rather than in the source, because two of them are
// the only thing standing between this file and someone else's mailbox, and this
// file is in a git repository.
var PROP_TRACKER_ID  = 'TRACKER_SHEET_ID';   // the Track App spreadsheet
var PROP_CONTACTS_ID = 'CONTACTS_SHEET_ID';  // the contacts spreadsheet, owned here
var PROP_RESUME_ID   = 'RESUME_FILE_ID';     // Henry_Nguyen_Resume.pdf in Drive
var PROP_SALT        = 'FINGERPRINT_SALT';   // salts the contact fingerprint
// This is the stable Drive file that Resume's GitHub workflow overwrites after
// each push of official/henryng_swe.pdf.  Its id never changes, which is what
// makes automatic resume updates compatible with a sender property.
var OFFICIAL_RESUME_FILE_ID = '1xTFdQdoVtLDwcXAnET1sWVfR8Bbw7HYy';
// Set to 'Draft' to force every row to a draft whatever its own Mode says. This
// is the rollout switch: for the first weeks nothing should leave unattended,
// and one property is easier to be sure about than a column of them.
var PROP_MODE        = 'OUTREACH_MODE';
// The same switch again, for follow-ups alone. OUTREACH_MODE holds everything
// back; this holds back only the chasing reply, which is what a rollout needs:
// the cold path has been sending unattended for weeks and should not be stopped
// to watch a new feature's first week. It can only ever be more cautious than
// OUTREACH_MODE, never less.
var PROP_FOLLOWUP_MODE = 'FOLLOWUP_MODE';

// The same switch again, for the referral path, and for a sharper reason than the
// follow-up had. A follow-up is a reply on a thread the recipient already has; a
// referral ask is a first message to somebody who has never heard from us, and the
// path goes live the moment the Referral tab exists, because runOutreachCycle has
// been firing hourly for weeks and will find it. Without a switch of its own the
// only way to look at the first batch before it leaves is to stop the cold path,
// which is a thing nobody will do, so the batch would go unlooked-at.
//
// Set REFERRAL_MODE to Draft and the messages are written, addressed and left in
// Drafts to be read. Set it to Pause to stop referral planning, drafting, sending
// and reply scanning while leaving the cold and follow-up paths alone. Clear it
// and referral asks run normally. It can only ever be more cautious than
// OUTREACH_MODE, never less.
var PROP_REFERRAL_MODE = 'REFERRAL_MODE';

// ---------------------------------------------------------------------- tabs

var TAB_APP            = 'App';
var TAB_QUEUE          = 'Email';
var TAB_CONTACTS_SEED  = 'Contacts (seed)';
var TAB_CONTACTS_MANUAL= 'Contacts (manual)';
// Written, never read back. The Season tab is a report: which employers look like
// they run two intakes, so a contact list can be spent knowing a second wave is
// coming rather than finding out afterwards.
var TAB_SEASON         = 'Season';
// The App tab again, sorted by company. Named here only so that it is written down
// somewhere that nothing in this project touches it: the tab is one array formula
// in its A1 reading App live, so a Role fixed in App is already fixed here, and a
// script that wrote the cell would drop a literal into that formula's spill range
// and collapse the tab to #REF!.
var TAB_ALPHABET       = 'Alphabet_Order';
// The referral queue, and deliberately not more rows on the Email tab. One tab
// answers "who have I written to about my application" and the other "who have I
// asked for a referral", and those are two questions a person asks separately.
// Mixed into one table neither can be scanned: the recruiter rows outnumber the
// referral rows and both would have to carry the other's columns as blanks.
var TAB_REFERRAL       = 'Referral';
// Explicit Target campaigns are kept in their own read-only mirrors. The normal
// workers deliberately read only TAB_QUEUE and TAB_REFERRAL, so these tabs can
// show the direct-send schedule without becoming a second send queue.
var TAB_EMAIL_TARGET    = 'Email_target';
var TAB_REFERRAL_TARGET = 'Referral_target';
// Where a run says it started and, if it got that far, that it finished. Its own
// tab rather than Logger, because a step that has been failing for days is only
// worth anything if it is visible where somebody actually looks. See
// outreachHealthStart_.
var TAB_HEALTH         = 'Cycle Health';
// Employees, exported by ColdEmail beside Contacts (seed). A separate tab rather
// than more rows on that one, because the two lists are different people asked
// for different things, and an export of one must never be able to erase the other.
var TAB_EMPLOYEES_SEED = 'Employees (seed)';
var TAB_REFERRAL_SEED_COUNTS = 'Referral Seed Counts';

// App tab, 1-based. Read only with two exceptions, and neither one adds a column:
// a rejection found in the mailbox writes Process and appends a line to Update,
// because an application that has been turned down must stop being worked within
// the hour; and outreach_app_worklist.gs owns the tab's row order and the yellow
// across A..Update, because "this application is waiting on a link" is a question
// only this project can answer — see the header of that file. No new column for
// either, because the tab is already dense and one more machine-written column
// would be one more thing to read past.
var APP_PROPERTY = 1, APP_COMPANY = 2, APP_LINK = 3, APP_DATE_APPLIED = 4;
var APP_PROCESS = 6, APP_ROLE = 7;
// Official, at column 9, is the one column on this tab a human fills in for this
// project's sake: the application URL a referral can actually be submitted
// against, pasted by hand when the link in column 3 is an aggregator's. Alumni,
// Recruiter and Update all moved one to the right to make room for it.
var APP_OFFICIAL = 9;
var APP_RECRUITERS = 11, APP_UPDATE = 12;
var APP_READ_WIDTH = 12;

// The stage a recognised rejection moves an application to, and the date format
// its line in Update is written in. Both mirror the bound script — STAGES and
// UPDATE_DATE_FORMAT in sync_applied_to_app.gs — and the Python audit
// (job_sync/sheet.py) reads the result, so all three have to agree.
var STAGE_REJECTED = 'Rejected';
var UPDATE_DATE_FORMAT = 'MMM d, yyyy';

// The Email tab, 1-based. The three columns copied from App lead it.
//
// Drafted At and Scheduled At sit together and in that order because they are one
// fact read left to right: written at 08:07, goes at 09:00. While a row is Queued
// both are the projection; once it is written both are what happened.
var Q_COMPANY = 1, Q_ROLE = 2, Q_DATE_APPLIED = 3, Q_PROPERTY = 4, Q_RECRUITERS = 5;
var Q_ATTEMPT = 6, Q_TEMPLATE = 7, Q_DRAFTED_AT = 8, Q_SCHEDULED = 9;
var Q_PRIORITY = 10, Q_STATUS = 11, Q_MODE = 12;
// The three follow-up columns sit immediately after Mode, and that position is
// the point of them. Everything to their left is the first email: which contact,
// which words, which hour, and where it got to. These three are the same four
// questions asked a second time about the reply that chases it, and reading them
// next to Status is how you see at a glance that a row was sent, went quiet, and
// has a nudge booked for Tuesday.
//
// Put out past the audit references instead, they would have been three columns
// nobody scrolls to — which is exactly what happened to Priority before it moved.
var Q_FOLLOWUP_AT = 13, Q_FOLLOWUP_TEMPLATE = 14, Q_FOLLOWUP_STATUS = 15;
var Q_FINGERPRINT = 16;
var Q_DRAFT_ID = 17, Q_MESSAGE_ID = 18, Q_SENT_AT = 19, Q_RESULT = 20;
var Q_ERROR = 21, Q_ID = 22, Q_VERSION = 23;
var Q_WIDTH = 23;

// Priority leads Status because the two are read as one answer: whether this row
// was asked for, and where it has got to. It is the only column here a person
// writes to, and putting it out past the audit references would have made the one
// column with a job for the reader the one they have to scroll to find.
//
// Adding it moved ten columns right, which is why migrateOutreachPriorityColumn
// exists and why the sender must be stopped while it runs — see the note there.


// Contacts tabs, 1-based. The manual tab stops at Email: everything past it is
// derived, and asking for it by hand is what stops the tab being used.
var C_COMPANY = 1, C_NAME = 2, C_EMAIL = 3;
var C_ROLE = 4, C_FOCUS = 5, C_HOOK = 6, C_ANGLE = 7, C_VERIFY = 8, C_BUCKET = 9;
var C_SENT = 10;
var C_FROM = 11;
var C_WIDTH = 11;

// Employees (seed), 1-based, written by ColdEmail's export. Domain is carried
// because it is what lets a link on a company's own careers site be told apart
// from an aggregator republishing the same posting.
var E_COMPANY = 1, E_NAME = 2, E_EMAIL = 3, E_TITLE = 4, E_DOMAIN = 5;
var E_SENIORITY = 6, E_LINKEDIN = 7, E_ANGLE = 8, E_BUCKET = 9, E_VERIFY = 10;
var E_SENT = 11;
var E_FROM = 12;
var E_WIDTH = 12;

// `Sent` is a tick that means this person has been written to and must not be
// written to again, ever, on either path.
//
// The system already had an answer to that question and it lived on the two
// queue tabs: a salted fingerprint on Email, an address on Referral. Both are
// records of what was planned, and they were emptied when the pipeline was
// rebuilt -- which would have re-opened every one of the 176 people already
// written to. This column is the durable answer. It sits beside the person on
// the contacts tab rather than on a queue, so clearing a queue cannot lose it.
//
// The two mechanisms coexist rather than replace one another, and deliberately:
// the fingerprint still stops a second send inside one season, and this stops
// one across a rebuild. A row is skipped if either says so.
//
// Owned by the outreach script: the planners read it and the senders set it.
// Nothing else may write it -- see the tab-ownership table in
// docs/components/README.md.
var SENT_TICK = true;

// `From` says which sourcing pass found this person: 1 the original ColdEmail
// pipeline, 2 the treg run. Nothing in this project reads it -- it is written by
// the export and kept so the tab can answer "where did this row come from?"
// without anyone having to diff two CSVs.
//
// It sits after Sent rather than before it, deliberately: Sent was already
// deployed and already held 314 ticks, and inserting a column ahead of it would
// have moved every one of them by one position.
var FROM_SEED = 1;
var FROM_TREG = 2;

/** Whether a Sent cell means "already written to". People type all of these. */
function outreachSentTicked_(value) {
  if (value === true) return true;
  var text = String(value == null ? '' : value).trim().toLowerCase();
  return text === 'true' || text === 'yes' || text === 'y' || text === 'x'
    || text === 'sent' || text === '1';
}

// Referral tab, 1-based. Unlike the Email tab this one does hold the recipient's
// name and address: the Email tab's rule exists because nobody needs to read a
// recruiter's address off the tracker, and here the whole purpose of the tab is
// to be able to see who has already been asked at a company before asking again.
var R_COMPANY = 1, R_ROLE = 2, R_PERSON = 3, R_EMAIL = 4, R_TITLE = 5;
var R_TIER = 6, R_TEMPLATE = 7, R_DRAFTED_AT = 8, R_SCHEDULED = 9;
// Priority leads Status because the two read as one answer: whether this row was
// asked for by hand, and where it has got to. The Email tab orders them the same
// way for the same reason.
var R_PRIORITY = 10;
var R_STATUS = 11, R_MODE = 12;
// Cancel sits beside Status and Mode because those three are the only columns on
// this tab a person touches. An audit reference further right would be read past;
// a switch that calls off a message has to be next to the state it changes.
var R_CANCEL = 13;
// The link moved out of third place. A posting URL is the longest value on the
// row and the one nobody reads by eye, and sitting third it crushed Person, Email
// and Title, which are what the tab is opened to look at.
var R_JOB_LINK = 14;
var R_DRAFT_ID = 15;
var R_SENT_AT = 16, R_RESULT = 17, R_ERROR = 18;
var R_ID = 19, R_VERSION = 20;
var R_WIDTH = 20;

// How Drafted At, Scheduled At and Sent At are written. The same string as
// OUTREACH_TIMESTAMP_FORMAT in the bound script, and it has to stay the same: a
// row whose format was never applied falls back to a bare date, which drops the
// hour — and the hour is the whole point of those three columns.
var QUEUE_TIMESTAMP_FORMAT = 'mmm d, yyyy h:mm AM/PM';
// Date Applied is a date and not a timestamp, and it has to be dressed for the
// same reason the three timestamps are: the table is sorted by moving values
// between cells, so a column where the format is not uniform shows a different
// date style every time a row changes places.
var QUEUE_DATE_FORMAT = 'mmmm d, yyyy';

// ------------------------------------------------------------------- policy

// Sunday through Saturday. Fixed rather than random: there is nothing to debug
// when the number looks wrong, and a fixed shape reads as more human than
// randomness does. Tue/Wed are high because that is when a recruiter reads
// carefully; Friday is low because Friday afternoon email dies.
//
// Flat twenty on every weekday, by instruction, replacing the shaped week
// [0, 17, 27, 24, 20, 12, 0] that leaned on Tuesday and tapered into Friday.
// The shape was a guess about when a recruiter reads carefully; twenty is a
// budget decision, and a budget decision outranks a guess.
//
// Saturday and Sunday stay zero. That is not part of the flattening: a cold
// email read on a Saturday is read badly, and the first impression is worth
// waiting a day for. Twenty on five days is a hundred a week.
var DAILY_CAP = [0, 20, 20, 20, 20, 20, 0];

var SEND_HOUR_FIRST = 9;    // inclusive, in the project's timezone
var SEND_HOUR_LAST  = 17;   // inclusive: nine sending hours a day

// Referral keeps a one-hour review window. Cold email has its own shorter
// lead time because the minute sender can prepare it close to departure.
//
// Every email is written one firing before it leaves, so there is always an hour
// in which it exists, addressed and complete, and can be read. Deleting the draft
// in Gmail is what cancels it: the send finds nothing to send and marks the row
// Cancelled. That makes the review a thing you do when you feel like it rather
// than a mode you have to remember to be in.
var DRAFT_LEAD_HOURS = 1;
var COLD_DRAFT_LEAD_MINUTES = 20;

// Compatibility bounds for the cold writer's fallback pacing. Projected cold
// drafts are actually placed twenty minutes before their send-hour slot.
//
// The first hour is derived rather than typed, because the two ends answer the
// same question from opposite sides. Writing at 17:00 would produce a message
// with no hour left to wait in; writing no earlier than 09:00 means the first
// email of the day cannot leave until 10:00, and 09:00 is the hour a recruiter
// actually opens their mail. The window used to start at SEND_HOUR_FIRST, which
// spent the best slot of the day waiting.
//
// This also gives the day a ninth drafting hour, which is where the two extra
// rows in DAILY_CAP go.
var DRAFT_HOUR_FIRST = SEND_HOUR_FIRST - 1;
var DRAFT_HOUR_LAST  = SEND_HOUR_LAST - 1;

var ELIGIBLE_AFTER_DAYS = 2;   // after Date Applied, before anything may go
var COMPANY_WEEKLY_CAP  = 5;   // emails per company per rolling 7 days

// --------------------------------------------------- the mailbox budget

// Everything this project sends in one day, every path counted together.
//
// Thirty, and for the first time it is not a ceiling that binds: cold is capped
// at twenty a weekday, referral at ten, follow-up at zero, so the path caps sum
// to exactly thirty. Nothing can displace anything else, and EMAIL_PATH_ORDER
// decides nothing until one of those numbers changes.
//
// That is a deliberate loss of a safety property, so it is worth naming. This
// number exists because the three paths were once each given a cap and never
// measured against one another, and the only thing bounding a day's total was
// arithmetic nobody had done. It is a limit on the account, not on any path:
// what penalises a sending address is the volume leaving one mailbox in a day,
// and the mailbox neither knows nor cares which feature asked. Raise a path cap
// without raising this and the paths start competing again, which is the
// intended behaviour -- the budget is the reputation limit and it wins.
//
// It was forty seven, over caps of [0,17,27,24,20,12,0] cold, fifteen referral
// and six follow-up, which together overbooked it on purpose.
//
// Two ceilings sit above this one and neither binds. Apps Script allows a consumer
// gmail.com account 100 recipients a day, so this is well under what the platform
// permits. The real ceiling is reputation: this is cold mail from a free Gmail
// address with no domain and no dedicated IP, and what penalises such an account
// is bounce rate and complaint rate rather than volume. Bounces are dealt with
// upstream -- every address on both contact tabs now carries a DeBounce verdict,
// and the recruiter tab drops UNSENDABLE_VERIFY on the way in.
var DAILY_EMAIL_BUDGET = 30;

// Who gets the budget when it runs short, most important first.
//
// Referral leads because it is the scarcest thing here. Three people per employer
// and no second attempt ever, so a referral ask displaced today is not delayed,
// it is one of three chances at that company spent on nothing.
//
// Cold email next. It has by far the most rows, but a row it cannot send today is
// a row that still goes tomorrow with nothing lost, because what it is asking
// about is an application that will still be there.
//
// Follow up last, and it is the right last. It is the only one of the three that
// loses nothing by slipping a day: the message it chases has already landed, and
// the window it may land in is five to ten days wide. Being late is what it is
// designed to be.
var EMAIL_PATH_ORDER = ['referral', 'cold'];

// ------------------------------------------------- referral policy

// A referral is timely only while the application is still recognisably fresh.
// `Property` is the user's existing company-priority rank on App: the first
// seventy are strategic enough to remain eligible after that seven-day window.
var REFERRAL_RECENT_APPLICATION_DAYS = 1;
// Retained for diagnostics compatibility; Target membership is now the company gate.
var REFERRAL_TOP_COMPANY_PROPERTY_MAX = 0;
// An application is hottest on the day it was submitted and the following
// calendar day. Those rows use the Priority fast lane; older applications remain
// eligible for seven days but take the ordinary Referral schedule.
var REFERRAL_PRIORITY_APPLICATION_DAYS = 1;
// Priority asks leave within this window after the planner sees them. Their gaps
// are deterministic jitter rather than Math.random, so an hourly replan cannot
// keep moving an already-visible schedule just by drawing a new number.
var REFERRAL_PRIORITY_WINDOW_MINUTES = 120;
var REFERRAL_PRIORITY_GAP_MINUTES_MIN = 10;
var REFERRAL_PRIORITY_GAP_MINUTES_MAX = 20;

// Quant firms are deliberately outside this referral campaign, including when a
// recent application would otherwise qualify. The names use the shared company
// normaliser, so punctuation and common short-name variants do not evade it.
var REFERRAL_QUANT_COMPANIES = [
  'Chicago Trading Company', 'Virtu Financial', 'Old Mission Capital',
  'Akuna Capital', 'PDT Partners', 'DRW', 'Hudson River Trading',
  'Susquehanna International Group', 'D. E. Shaw', 'Jane Street', 'Optiver',
  'PEAK6', 'DV Trading', 'Quadrillion Labs', 'Quantbot Technologies',
  'Balyasny Asset Management', 'Belvedere Trading', 'TransMarket Group',
  'Hypercubic', 'Point72', 'Xantium', 'Verition', 'Garda Capital Partners',
  'The Voleon Group', 'Castleton Commodities International', 'InfiniteQuant',
  'Schonfeld', 'Two Sigma'
];

// How many people at one employer are ever asked for a referral.
//
// Six. Still far short of the twenty three engineers the dataset holds at Reddit,
// because asking all of them is not outreach, it is a mailing list that happens to
// be about one person. Six is the number that makes a company a real attempt
// rather than a gesture: at three, two ignored messages were the whole of it.
var REFERRAL_PER_COMPANY = 6;

// One a day, and the reversal back to it is the whole shape of this path.
//
// This was one, then six, and is one again. The argument for six was that what
// makes six notes read as a mailing shot is six *identical* notes, and the tier,
// the template, the subject and the bullet pair all differ per person — so the
// calendar was buying distance between messages nobody can see side by side.
// That argument is still correct and it is still not the reason this is one.
//
// The reason is what a day of sending is *for*. There are 221 employers in the
// dataset and six people at most of them: 1,326 messages, which at twenty a day
// is about sixty seven working days whichever order they go in. The order is therefore
// the only decision available, and it decides which asks happen while the
// application is still recent. Six a day spends a day on two employers; one a day
// spends it on twenty. The first ask at an employer is the one that has to land
// near the date applied — the sixth is a message about an application the reader
// will have to look up either way.
//
// It is also what makes a reply worth anything. Six on one day are all committed
// before anybody could have answered, so a reply cancels nothing; one a day means
// the second ask at a company is still unwritten when the first is read, which is
// what outreachReferralRepliedGroups_ needs in order to have something to stop.
//
// Ticking Priority lifts this cap for that one company and role — see
// outreachReferralSlot_. Breadth is the default because it is right most of the
// time; depth is a decision somebody makes about one employer on one day.
var REFERRAL_COMPANY_DAILY_CAP = REFERRAL_PER_COMPANY;

// And what a ticked ask gets instead: the whole group in one day if the day holds
// it. REFERRAL_PER_COMPANY rather than a number of its own, because the natural
// ceiling on a ticked employer is simply everyone this project will ever ask
// there — a tick cannot conjure a seventh person.
//
// This was briefly three, on the reasoning that two ticked employers taking
// twelve of a then-fourteen-slot day was the clustering the breadth-first planner
// exists to prevent. That read the tab correctly and the request backwards. The
// clustering worth preventing is the *unasked-for* kind, where an employer nobody
// singled out quietly absorbs a day. A tick is somebody singling one out on
// purpose, and spreading it over two days then made a tick mean "slightly sooner"
// rather than "now" — which is not what it was asked to mean.
//
// The account's daily cap still binds, so ticking everything does not raise the
// volume; it only decides who goes first.
var REFERRAL_PRIORITY_COMPANY_CAP = REFERRAL_PER_COMPANY;

// The word a posting's title had to carry while this path read the crawler's Jobs
// tab, where hundreds of postings nobody had chosen sat side by side and "summer"
// was what picked out the intake worth asking about.
//
// It is off now, because the path reads the App tab and every row there is an
// application somebody deliberately made. Having applied is a far stronger
// statement about which intake matters than a word in a job board's title, and
// the two disagree constantly: of 327 rows on the live App tab only 81 say
// "summer", so leaving this on would have thrown away three quarters of the
// applications on the strength of how a title happened to be written.
//
// The word and the rule are kept rather than deleted because turning it back on
// is a one line change, and because the reasoning above is about this tab and
// would not survive the path being pointed at a different one.
var REFERRAL_SEASON_WORD = 'summer';
// Off, and the difference between this and the excludes below is the whole rule.
//
// Requiring the word threw away most of the queue for a reason that was about how
// a title happened to be written rather than about which intake it was. "Software
// Engineering Intern" at NVIDIA, "Software Engineer Intern" at Figma and "AI
// Builder Intern" at Scale AI are all the summer intake; none of them says so.
// What actually needs refusing is a title naming a DIFFERENT intake, and that is
// what REFERRAL_SEASON_EXCLUDES does. A role that names no season is the one that
// was applied to, which is a stronger statement than a word in a job board title.
var REFERRAL_REQUIRE_SEASON = false;

// And the words that disqualify a role even when it does say summer.
//
// The season word alone is not enough, because a title can name two things:
// "Summer 2026" is an intake that has already happened, and "Software Engineering
// Internship - Summer/Winter" is a posting that is not only the one being asked
// about. Asking somebody to spend their credibility on an intake that has closed
// is the same wasted message as asking about a req that rejected you.
//
// Matched as whole words, so a company called Springer is not a spring intake.
var REFERRAL_SEASON_EXCLUDES = ['2026', 'winter', 'spring', 'fall', 'autumn'];

// Weekdays only, and this is a reversal.
//
// The follow-up sends at weekends because it is a nudge on a thread the recipient
// already has, and a nudge arriving on a Sunday costs nobody anything. A referral
// ask is a first message to a stranger asking them to spend their own credibility,
// and one that turns up on a Saturday morning says the sender either did not
// notice or did not mind. It is the same message on Monday and it reads better.
var REFERRAL_WEEKENDS = false;

// Six in the morning to seven at night. Wider than the cold path's nine to five
// at one end only, and the asymmetry is the rule rather than an oversight.
// (Nine to five is when the cold path *sends*; it writes from eight.)
//
// The early end is wide because it is the best hour of the day. This lands in a
// working engineer's mailbox rather than on a recruiter's desk, and six in the
// morning is the top of the inbox for somebody who opens their mail at eight.
//
// The late end used to be nine at night, on the reasoning that it caught the read
// somebody does before bed. That reasoning was wrong in a way worth writing down
// rather than quietly deleting: a message arriving at nine in the evening is not
// read before bed, it is buried by everything that arrives overnight and is down
// page two by eight the next morning. Twenty and twenty-one hundred were the two
// worst slots in the day, not the two most patient ones.
//
// There is a second reason, and it is about the sender rather than the reader. A
// mailbox that emits a message at exactly 06:00 and again at exactly 21:00 every
// weekday is not a shape a person produces. Cutting the tail costs two sends and
// buys back the part of the day that was advertising the machine.
var REFERRAL_HOUR_FIRST = 6;
var REFERRAL_HOUR_LAST  = 19;
// Ten, by instruction, down from fifteen. The 06:00–19:00 window holds fourteen
// hours, so every referral ask now gets an hour to itself and the scheduler never
// has to double up a slot.
//
// Referral still has first claim on the shared budget, but at ten plus cold's
// twenty the two paths now sum to exactly DAILY_EMAIL_BUDGET, so neither can
// displace the other and EMAIL_PATH_ORDER no longer decides anything in practice.
var REFERRAL_DAILY_CAP  = 10;


// People written to in one go, and how long the silence has to last before the
// next three. Three was once the whole allowance per application, which left a
// company with five contacts holding two nobody ever wrote to. Three is the right
// number to send *together*; it is the wrong number to stop at.
//
// A wave is only started by silence. Within a wave a reply changes nothing — the
// others are already committed — but a reply before the next wave calls it off,
// because by then there is a person to talk to and three more cold emails to
// their colleagues would be talking past them.
var WAVE_SIZE      = 3;
var WAVE_GAP_DAYS  = 5;

// How alike two roles at one employer have to read before they are treated as one
// posting, as the share of words they have in common.
//
// A role and its locations are not one string with a city on the end. American
// Express posted the same programme three times as "Software Engineer, Enterprise
// Technology Services- Charlotte, NC", "Software Engineer, Technology - New York,
// NY" and "Software Engineer I, Enterprise Technology Services- Phoenix, AZ" —
// three different sentences, not three suffixes. Stripping the city leaves them
// still unequal, so equality is the wrong test and overlap is the right one.
//
// 0.6 was measured against the 39 duplicated applications in the sheet rather than
// guessed. It folds those three into one, and Teledyne FLIR's two spellings of
// NHRC, while leaving IBM's ten practice areas as four and NVIDIA's Dynamo team
// apart from its general posting. 0.5 also folded "Software Engineer Intern" into
// "AI Software Engineering - Edge" at Microsoft, which are not the same job.
var ROLE_MATCH = 0.6;

// ------------------------------------------------------------------- seasons

// The seasons a posting bothers to write down. Everything else is Summer.
//
// Two buckets, not four. Every named season is one off-cycle intake, because an
// employer running more than one of them is running one programme more than once,
// and a recruiter reading about each separately reads near-identical emails a
// month apart. The ceiling this sets is the point of it: **one person hears from
// us at most twice, ever** — once about Summer, once about everything else.
//
// Splitting these into their own buckets is a one-line change and should not be
// made lightly. Four buckets means four cold emails to one recruiter, and at
// SEASON_RECONTACT_DAYS apart that is all four inside a single hiring year.
var OFFCYCLE_SEASONS = ['winter', 'spring', 'fall', 'autumn'];
var SEASON_OFFCYCLE  = 'offcycle';
var SEASON_SUMMER    = 'summer';

// The smallest gap between two emails to one person about two different intakes.
//
// The fingerprint stops the same person being written to twice about one intake,
// and that is permanent. This is the other half: two intakes are two occasions,
// but only if enough time has passed that the second reads as a new one rather
// than as a follow-up to a mail already ignored. 25 days is under the four-week
// mark where an unanswered email stops being recent and over the fortnight a wave
// itself takes, so the two can never overlap.
var SEASON_RECONTACT_DAYS = 25;

/**
 * Which intake a role belongs to.
 *
 * An unlabelled role is Summer, and that default is the whole rule rather than a
 * fallback. It is what lets an employer that has so far posted only a Winter
 * opening be recognised as a two-intake employer: the Summer row does not have to
 * say "Summer", it only has to not say "Winter".
 *
 * The price of defaulting rather than refusing is that a role name which lost its
 * season — truncated, or never filled in — reads as Summer and can hand back a
 * contact already written to. SEASON_RECONTACT_DAYS is what makes that survivable:
 * the worst case becomes one extra email 25 days later, not one the same week.
 */
function outreachSeason_(role) {
  var text = String(role == null ? '' : role).toLowerCase();
  for (var i = 0; i < OFFCYCLE_SEASONS.length; i++) {
    if (new RegExp('\\b' + OFFCYCLE_SEASONS[i] + '\\b').test(text)) return SEASON_OFFCYCLE;
  }
  return SEASON_SUMMER;
}

/** The bucket a person could still be written to about, given this one. */
function outreachOtherSeason_(season) {
  return season === SEASON_OFFCYCLE ? SEASON_SUMMER : SEASON_OFFCYCLE;
}

// A Date Applied in the future is a typing slip, not a plan. One row read
// "August 14, 2029" and the projection walked a year of weekday caps without
// reaching it, so it silently held no send date at all — and would have sat in
// the queue until 2029. Refuse it and say so instead.
var FUTURE_APPLICATION_GRACE_DAYS = 1;

// Everyone at a company is queued at once, one day apart.
//
// Waiting for silence before trying the next person cost four days each, so one
// employer took twelve to work through while the application aged underneath —
// which contradicts the ordering rule this whole system is built on. One day
// apart keeps the three from arriving in one morning without spending the fortnight.
var ATTEMPT_STAGGER_DAYS = 1;

/** The earliest day one attempt may go out. */
function outreachEligibleDay_(dateApplied, attempt) {
  return outreachAddDays_(
    dateApplied, ELIGIBLE_AFTER_DAYS + (Math.max(attempt, 1) - 1) * ATTEMPT_STAGGER_DAYS
  );
}

// Applied qualifies, and so does Completed OA. Rejected is over, and Interview
// and Offer mean a human contact already exists — writing cold to a recruiter
// there is the wrong message on the wrong thread.
//
// An automated assessment is not that contact. The invitation comes from Workday
// or HackerRank, no person has read the application yet, and the silence after
// submitting one is precisely when a recruiter is worth writing to: there is now
// a finished piece of work sitting in their system with nobody assigned to look
// at it.
//
// OA itself stays out, and the distinction is the whole point of splitting the
// stage in two. While the assessment is owed, the email asks for attention on a
// step the sender has not finished — the recruiter's first move would be to say
// go and do it.
var QUALIFYING_PROCESSES = ['Applied', 'Completed OA'];

// Named on its own because outreach_compose.gs changes a sentence for it: an
// application that has cleared an assessment says so.
var STAGE_COMPLETED_OA = 'Completed OA';

/**
 * Whether an application's Process still admits a cold email.
 *
 * Trimmed but not case-folded. Column F is a locked dropdown — setAllowInvalid
 * (false) in setup_process_dropdown.gs — so the spellings that reach here are the
 * ones the list holds, and a value that somehow is not should fall through to
 * "does not qualify" rather than be guessed at. Sending is the irreversible half
 * of this system; the trim is for a stray space, not for accepting new spellings.
 */
function outreachQualifies_(process) {
  var text = String(process == null ? '' : process).trim();
  for (var i = 0; i < QUALIFYING_PROCESSES.length; i++) {
    if (QUALIFYING_PROCESSES[i] === text) return true;
  }
  return false;
}

// Referral accepts every Employees (seed) row except the explicit invalid
// DeBounce verdict. Blank, risky, pattern-calibrated and other non-invalid
// values are intentionally allowed by the current policy.
var UNSENDABLE_VERIFY = 'local:Unknown';
var REFERRAL_REJECTED_VERIFY = 'debounce:invalid';
var REFERRAL_INELIGIBLE_ERROR = 'Recipient is missing from Employees (seed) or is marked debounce:invalid.';
var REFERRAL_LEGACY_INELIGIBLE_ERROR = 'Recipient is not in the verified, non-risky Employees (seed) export.';

// Past this, the email stops naming the application date. Pointing a recruiter
// at "I applied 7 months ago" volunteers the weakest fact in the message.
var STALE_APPLICATION_DAYS = 45;

var STATUS_QUEUED = 'Queued', STATUS_DRAFTED = 'Drafted', STATUS_SENT = 'Sent';
var STATUS_REPLIED = 'Replied', STATUS_BOUNCED = 'Bounced';
var STATUS_CANCELLED = 'Cancelled', STATUS_FAILED = 'Failed';

// A row here means this address is spent and must never be picked again — it was
// written to, or it is about to be. Cancelled and Failed are deliberately absent:
// nothing reached that person, so the address is still free for a later
// application. Burning a contact we never actually emailed is a bug, not caution.
//
// This is also why there is no "do not contact" state. Somebody asking not to be
// written to has replied, and Replied is already both permanent and automatic.
var STATUS_SPENDS_CONTACT = [
  STATUS_QUEUED, STATUS_DRAFTED, STATUS_SENT, STATUS_REPLIED, STATUS_BOUNCED
];
var MODE_DRAFT = 'Draft', MODE_SEND = 'Send', MODE_PAUSE = 'Pause';

function outreachReferralPaused_() {
  return outreachProperty_(PROP_REFERRAL_MODE, false) === MODE_PAUSE;
}

/** Pause only the referral path; cold email and follow-up settings are untouched. */
function pauseReferralPath() {
  PropertiesService.getScriptProperties().setProperty(PROP_REFERRAL_MODE, MODE_PAUSE);
  return {referral: MODE_PAUSE, cold: outreachProperty_(PROP_MODE, false),
          followUp: outreachProperty_(PROP_FOLLOWUP_MODE, false)};
}

/** Pause every outreach path: cold, follow-up and referral. */
function pauseAllOutreach() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(PROP_MODE, MODE_PAUSE);
  props.setProperty(PROP_FOLLOWUP_MODE, MODE_PAUSE);
  props.setProperty(PROP_REFERRAL_MODE, MODE_PAUSE);
  return {outreach: MODE_PAUSE, referral: MODE_PAUSE, followUp: MODE_PAUSE};
}

/** Resume every outreach path after a full-system pause. */
function resumeAllOutreach() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROP_MODE);
  props.deleteProperty(PROP_FOLLOWUP_MODE);
  props.deleteProperty(PROP_REFERRAL_MODE);
  return {outreach: MODE_SEND, referral: MODE_SEND, followUp: MODE_SEND};
}

/** Resume the referral path after a pause, restoring its normal Send/Draft behaviour. */
function resumeReferralPath() {
  PropertiesService.getScriptProperties().setProperty(PROP_REFERRAL_MODE, '');
  return {referral: MODE_SEND, cold: outreachProperty_(PROP_MODE, false),
          followUp: outreachProperty_(PROP_FOLLOWUP_MODE, false)};
}

// ----------------------------------------------------------------- follow-up

// A cold email that got no answer earns exactly one reply on its own thread, and
// these four numbers are the whole policy.
//
// The delay is a window rather than a number. Five days is the earliest a nudge
// reads as patience instead of pestering; ten is the point past which the first
// email is no longer recent enough for "following up" to be a true description of
// what the message is. Anywhere inside that is equally honest, and having six days
// to choose from is what lets the planner keep any one day light.
var FOLLOWUP_AFTER_DAYS  = 5;
var FOLLOWUP_WINDOW_DAYS = 10;

// Per calendar day, and counted separately from DAILY_CAP.
//
// Zero: the follow-up path is switched off, by instruction, so that the account
// sends nothing but first-contact cold email and referral asks. Zero rather than
// deleting the path, because the code that plans and sends a nudge is correct and
// the intent is to stop it running, not to lose it -- and a cap the planner
// already respects is the smallest switch that stops every one of its writes.
// Restoring the feature means putting a number back here and adding 'followup'
// to EMAIL_PATH_ORDER; both are needed, and either alone does nothing.
//
// It was six, chosen as under half the lightest sending weekday.
var FOLLOWUP_DAILY_CAP = 0;

// Past this, the first email is too old to chase and the row is passed over
// instead. Twenty-one days is inside REPLY_WINDOW_DAYS, so a reply that lands
// late still gets seen before the row is written off, and it is the age at which
// "just following up" stops being a nudge and becomes a second cold email with
// none of the first one's freshness.
//
// This is also what stops the feature's own first run dumping the backlog: every
// row sent before today is measured by the same rule as every row sent after it.
var FOLLOWUP_LATEST_DAYS = 21;

// Weekends count. DAILY_CAP zeroes Saturday and Sunday because a cold email read
// on a Saturday is read badly, and a first impression is worth waiting for a
// weekday for. A follow-up is not a first impression: it is one sentence on a
// thread the recipient already has, and the reason to allow the two extra days is
// the reason the window exists at all — seven days to spread six emails over
// keeps every one of them off a pile.
var FOLLOWUP_WEEKENDS = true;

// 08:00 to 19:00, which is three hours wider than the cold path at one end and
// two at the other. Both edges are wider for the same reason: nothing here waits
// an hour in Drafts. The cold path cannot send at its first hour because that is
// the hour it *writes* in, and cannot write in its last because there would be no
// hour left to wait; a follow-up is composed and posted in one step, so the first
// and last firings of the day are both firings it can go on.
//
// The trigger has always fired at these hours. runOutreachCycle is on everyHours
// (1) and fires around the clock — 08:00 and 19:00 were never hours nothing ran
// in, only hours nothing was allowed to leave in.
//
// Twelve hours for six emails is the point rather than a side effect. The window
// is not widened so the day can start earlier; it is widened so the six can be
// further apart. See outreachSpaceHours_.
var FOLLOWUP_HOUR_FIRST = 8;
var FOLLOWUP_HOUR_LAST  = 19;

var FOLLOWUP_QUEUED = 'Queued', FOLLOWUP_SENT = 'Sent';
var FOLLOWUP_DRAFTED = 'Drafted', FOLLOWUP_SKIPPED = 'Skipped';
var FOLLOWUP_FAILED = 'Failed', FOLLOWUP_STOPPED = 'Stopped';

/**
 * What the Follow Up Status dropdown offers.
 *
 * Six words, and the two that look alike are the two worth telling apart. Skipped
 * is a row this was never going to chase: too old, no thread to reply on, or a
 * colleague had already answered by the time it was first looked at. Stopped is a
 * row that had a date booked and lost it, because somebody at that company replied
 * in between. One is a decision made once; the other is a decision reversed, and a
 * reversed decision is the one you want to be able to find.
 */
var QUEUE_FOLLOWUP_STATUSES = [
  FOLLOWUP_QUEUED, FOLLOWUP_DRAFTED, FOLLOWUP_SENT,
  FOLLOWUP_SKIPPED, FOLLOWUP_STOPPED, FOLLOWUP_FAILED
];

// The same palette the Status column uses, for the same reasons, so the two
// columns can be read together without learning a second colour language. Queued
// stays plain here too: it is what every booked row says, and a colour on the
// ordinary case is a colour that stops meaning anything.
var QUEUE_FOLLOWUP_COLOURS = [
  { name: FOLLOWUP_DRAFTED, bg: '#FFF2CC', fg: '#BF9000' },
  { name: FOLLOWUP_SENT,    bg: '#CFE2F3', fg: '#1155CC' },
  { name: FOLLOWUP_STOPPED, bg: '#D9EAD3', fg: '#38761D' },
  { name: FOLLOWUP_FAILED,  bg: '#FCE5CD', fg: '#B45F06' },
  { name: FOLLOWUP_SKIPPED, bg: '#EFEFEF', fg: '#999999' }
];

/**
 * Whether a day may carry follow-ups at all.
 *
 * Split out rather than inlined because it is the one rule that differs from the
 * cold path, and a reader comparing the two should find one function to compare
 * rather than a condition buried in a loop.
 */
function outreachFollowUpDayAllowed_(date) {
  if (FOLLOWUP_WEEKENDS) return true;
  var weekday = date.getDay();
  return weekday !== 0 && weekday !== 6;
}

/**
 * What the Status and Mode dropdowns offer, and the colours behind them.
 *
 * Mirrors OUTREACH_STATUS, OUTREACH_MODE and their two colour tables in the bound
 * script's sync_applied_to_app.gs. Two Apps Script projects cannot share a file,
 * so the lists have to agree by hand — the same arrangement COMPANY_NOISE already
 * has with job_sync/sources.py, and a change to one has to be a change to both.
 *
 * The bound script paints rows 2..500 once, when the tab is built. That is why a
 * row appended afterwards arrived as bare text: no dropdown, no colour, nothing
 * but the string. This copy is what dresses the rows that show up later.
 *
 * Queued is deliberately absent from the colours: it is what most rows read most
 * of the time, and a colour on the ordinary case is a colour that stops meaning
 * anything.
 */
var QUEUE_STATUSES = [STATUS_QUEUED, STATUS_DRAFTED, STATUS_SENT, STATUS_REPLIED,
                      STATUS_BOUNCED, STATUS_CANCELLED, STATUS_FAILED];
var QUEUE_MODES = [MODE_DRAFT, MODE_SEND];

var QUEUE_STATUS_COLOURS = [
  { name: STATUS_DRAFTED,   bg: '#FFF2CC', fg: '#BF9000' },
  { name: STATUS_SENT,      bg: '#CFE2F3', fg: '#1155CC' },
  { name: STATUS_REPLIED,   bg: '#D9EAD3', fg: '#38761D' },
  { name: STATUS_BOUNCED,   bg: '#F4CCCC', fg: '#CC0000' },
  { name: STATUS_FAILED,    bg: '#FCE5CD', fg: '#B45F06' },
  { name: STATUS_CANCELLED, bg: '#EFEFEF', fg: '#999999' }
];
var QUEUE_MODE_COLOURS = [
  { name: MODE_DRAFT, bg: '#FFF2CC', fg: '#BF9000' },
  { name: MODE_SEND,  bg: '#CFE2F3', fg: '#1155CC' }
];

/**
 * What a tick becomes once the row it is on has gone.
 *
 * A checkbox that stays ticked forever cannot say whether it still means
 * anything, so the word replaces it the run after the email leaves. It is the
 * same column because it is the same fact — this row was asked for — read at a
 * later point in its life: blank is nobody asked, ticked is asked and waiting,
 * Done is asked and gone.
 *
 * It must keep counting as ticked, and that is not cosmetic. outreachPriority-
 * Groups_ reads the tick from the whole queue precisely so that a tick on a row
 * that has already gone still lifts the ones behind it at the same posting —
 * which is the normal case, because by the time a company is worth chasing its
 * first attempt has usually left. Retiring the tick to a word that read as
 * false would silently drop that lift, and nothing downstream would report it.
 */
var PRIORITY_DONE = 'Done';

/**
 * Draft or send, for one row.
 *
 * The global switch can only ever be more cautious than the row: it can hold a
 * row back to a draft, never push one out. A rollout switch that could promote
 * a row nobody meant to send would be worse than no switch.
 */
function outreachModeFor_(rowMode, globalMode) {
  if (globalMode === MODE_DRAFT) return MODE_DRAFT;
  return rowMode === MODE_DRAFT ? MODE_DRAFT : MODE_SEND;
}

// ------------------------------------------------------------------ helpers

function outreachProperty_(key, required) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value && required) {
    throw new Error(
      'Script Property ' + key + ' is not set. Run setupOutreachProperties and '
      + 'fill it in under Project Settings -> Script Properties.'
    );
  }
  return value || '';
}

/**
 * Report which of the four properties are still missing.
 *
 * It deliberately does not create them with placeholder values: a property
 * holding "TODO" reads as configured to every other function in this project.
 */
function setupOutreachProperties() {
  var wanted = [
    [PROP_TRACKER_ID,  'ID of the Track App spreadsheet (from its URL)'],
    [PROP_CONTACTS_ID, 'ID of the contacts spreadsheet owned by this account'],
    [PROP_REFERRAL_MODE, 'Pause to stop referral work, Draft to hold asks in Drafts, blank to send'],
    [PROP_RESUME_ID,   'Drive file ID of Henry_Nguyen_Resume.pdf'],
    [PROP_SALT,        'any long random string; changing it re-opens every past contact']
  ];
  var props = PropertiesService.getScriptProperties();
  var missing = wanted.filter(function (w) { return !props.getProperty(w[0]); });
  if (!missing.length) {
    Logger.log('All four script properties are set. Nothing to do.');
    return;
  }
  Logger.log('Set these under Project Settings -> Script Properties:');
  missing.forEach(function (w) { Logger.log('  ' + w[0] + ' — ' + w[1]); });
}

/**
 * Identify the exact resume bytes the sender will attach, without exposing its
 * Drive id.  The local PDF can be checked against `sha256` before a send; a
 * title or a Drive modified time alone is not evidence that its contents match.
 */
function diagnoseOutreachResume() {
  var file = DriveApp.getFileById(outreachProperty_(PROP_RESUME_ID, true));
  var blob = file.getBlob();
  var bytes = blob.getBytes();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  var sha256 = digest.map(function (byte) {
    return ('0' + (byte & 0xff).toString(16)).slice(-2);
  }).join('');
  return {
    name: file.getName(),
    mimeType: blob.getContentType(),
    sizeBytes: bytes.length,
    lastUpdated: file.getLastUpdated().toISOString(),
    sha256: sha256
  };
}

/**
 * Point the sender at Resume's stable, automatically synchronised Drive file.
 * Open and validate the PDF first: a typo in this id must not leave future
 * emails attaching an arbitrary Drive file.
 */
function useOfficialResumeAttachment() {
  var file = DriveApp.getFileById(OFFICIAL_RESUME_FILE_ID);
  var blob = file.getBlob();
  if (blob.getContentType() !== 'application/pdf') {
    throw new Error('The official resume attachment is not a PDF.');
  }
  PropertiesService.getScriptProperties()
    .setProperty(PROP_RESUME_ID, OFFICIAL_RESUME_FILE_ID);
  return diagnoseOutreachResume();
}

/**
 * Whether a hand-ticked cell counts as ticked.
 *
 * A checkbox hands back a real boolean, but the column is editable by a person in
 * a hurry, and "TRUE", "yes" and "x" are all things a person types into a box they
 * mean to tick. Reading only `=== true` would silently ignore every one of them,
 * on the one column whose entire purpose is to be obeyed.
 */
function outreachTicked_(value) {
  if (value === true) return true;
  var text = String(value == null ? '' : value).trim().toLowerCase();
  return text === 'true' || text === 'yes' || text === 'y' || text === 'x' || text === '1'
      || text === PRIORITY_DONE.toLowerCase();
}

/** Today at midnight, so day arithmetic never trips over the clock time. */
function outreachMidnight_(date) {
  var d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

function outreachDaysBetween_(from, to) {
  return Math.round(
    (outreachMidnight_(to).getTime() - outreachMidnight_(from).getTime()) / 86400000
  );
}

function outreachAddDays_(date, days) {
  var d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * A non-reversible name for an address, so the tracker can say "this person has
 * been written to" without the tracker ever holding who they are.
 *
 * Scoped by intake, so one person can be written to once about each. Summer keeps
 * the bare address and hashes to exactly what it always did — every fingerprint
 * already sitting in the Email tab still matches the one computed for that person
 * today, so no backfill is needed for the rows this system has already sent. Only
 * the off-cycle bucket is new, and it is new for everybody at once.
 *
 * Omitting the season is the same as Summer on purpose: a caller that has not been
 * taught about intakes yet gets the old behaviour rather than a third bucket.
 */
function outreachFingerprint_(email, salt, season) {
  var identity = String(email || '').trim().toLowerCase();
  if (season === SEASON_OFFCYCLE) identity += '|' + SEASON_OFFCYCLE;
  var raw = Utilities.computeHmacSha256Signature(
    identity, salt || outreachProperty_(PROP_SALT, true)
  );
  return raw.map(function (b) {
    return ('0' + (b & 0xff).toString(16)).slice(-2);
  }).join('').slice(0, 32);
}

/** How many emails today's weekday allows. */
function outreachDailyCap_(date) {
  return DAILY_CAP[date.getDay()] || 0;
}

/**
 * The hour each of a day's emails is written at.
 *
 * The same arithmetic the writer itself runs, so the projected time is the real
 * one rather than an estimate of it: each firing takes ceil(remaining / firings
 * left), which spreads fifteen emails as 2,2,2,2,2,2,2,1 across eight hours
 * instead of emptying the day's allowance at nine in the morning.
 *
 * These are sending-hour slots. Cold drafts are projected twenty minutes before
 * these slots; Referral keeps its separate one-hour draft lead.
 *
 * `firstHour` is the earliest hour still available. It defaults to the start of
 * the day, which is right for every day but today: an hour that has already gone
 * cannot be the hour a row is written in, and numbering today's rows from 08:00
 * at half past ten stamped them with a time in the past. A queued row then sorted
 * above the rows drafted an hour ago, which read as the queue running backwards —
 * Datadog sat at 09:00 above an Anduril row really written at 10:21.
 */
function outreachDraftHoursForDay_(count, firstHour) {
  var first = firstHour === undefined ? SEND_HOUR_FIRST
                                      : Math.max(SEND_HOUR_FIRST, firstHour);
  return outreachSpreadHours_(count, first, SEND_HOUR_LAST);
}

/**
 * Hand out `count` hours between two bounds, taking each firing's fair share of
 * what is left.
 *
 * Lifted out of outreachDraftHoursForDay_ when follow-ups needed the same
 * arithmetic over a different pair of bounds. There is one distribution in this
 * project and both callers use it: a second copy would have drifted, and the
 * shape it produces — no hour carrying much more than its neighbours — is the
 * whole reason either column reads as a schedule rather than a batch.
 *
 * `ceil(remaining / firings left)` rather than a flat division, because a flat
 * one leaves a remainder to dump somewhere. Fifteen across eight hours comes out
 * 2,2,2,2,2,2,2,1 instead of 1,1,1,1,1,1,1,8.
 */
/**
 * Hand out `count` hours spaced evenly across the whole span, both ends included.
 *
 * The other distribution in this file, and the two are not interchangeable
 * because the two callers want opposite things.
 *
 * outreachSpreadHours_ fills from the front, taking each firing's fair share of
 * what is left. That is right for the cold path, where the count is usually at or
 * above the number of hours — fifteen across eight comes out 2,2,2,2,2,2,2,1 —
 * and where a light day *should* finish early, because the application it is
 * about is ageing while it waits.
 *
 * It degenerates when the count is well under the hours available, and for
 * follow-ups that is not the corner case, it is every case: six across twelve
 * comes out 8,9,10,11,12,13 and leaves the whole afternoon empty. Nothing is
 * ageing here, so there is no reason to finish by lunchtime and every reason to
 * be far apart — the window was widened to buy distance between the six, not an
 * earlier start.
 *
 * Anchored at both ends, so the first goes at `firstHour` and the last at
 * `lastHour` and the rest land between: six across 08:00-19:00 becomes 08, 10,
 * 12, 15, 17, 19. A count above the span produces repeats, which is the honest
 * answer — that many in a day is more than one an hour.
 */
// Who a delivery failure comes from. Gmail sends these as mailer-daemon and some
// servers answer as postmaster; neither is a person.
var OUTREACH_BOUNCE_SENDER = /(mailer-daemon|postmaster)@/i;

/** The bare address out of a From header, which is usually "Name <a@b.com>". */
function outreachFromAddress_(from) {
  var match = String(from == null ? '' : from).toLowerCase()
    .match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0] : '';
}

/**
 * What came back on a thread: a reply, a delivery failure, or nothing yet.
 *
 * A thread holding more than one message is not a reply, and reading it as one has
 * now gone wrong twice in different ways. A bounce at Nuro was recorded as an
 * answer, which called off the five colleagues behind it. Worse and quieter: the
 * follow-up is *posted onto this very thread*, so every row that got one was
 * marked Replied on the next scan — the queue reading its own second message as
 * the recruiter's first. Counting messages cannot tell any of that apart; reading
 * who sent them can.
 *
 * **Ours is decided by address, not by id.** The id finds our first message; every
 * later message from that same address is also ours. Skipping only the id was what
 * let the follow-up count as an answer, and it is the whole reason this function
 * takes a thread rather than a number.
 *
 * Our own message is found by id rather than by position. It is usually first, but
 * a thread the recipient had already started puts it second, and counting from
 * index one would read our own email as their answer.
 *
 * A reply wins over a bounce when a thread somehow holds both. One address failing
 * does not unsay what a person wrote.
 *
 * Pure, and takes {id, from} rather than Gmail messages, so the harness can argue
 * with it without a mailbox.
 */
function outreachThreadVerdict_(messages, ourId) {
  var list = messages || [];
  var mine = '';
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].id === ourId) { mine = outreachFromAddress_(list[i].from); break; }
  }

  var bounced = false;
  for (var j = 0; j < list.length; j++) {
    var one = list[j] || {};
    if (ourId && one.id === ourId) continue;
    var from = String(one.from == null ? '' : one.from).toLowerCase();
    if (!from) continue;
    // The follow-up, and anything else this account has put on the thread.
    if (mine && outreachFromAddress_(one.from) === mine) continue;
    if (OUTREACH_BOUNCE_SENDER.test(from)) { bounced = true; continue; }
    return STATUS_REPLIED;
  }
  return bounced ? STATUS_BOUNCED : '';
}

/** Mark only previously accepted direct-campaign sends whose address later bounced. */
function targetApplyDeliveryFailures_(entries, bounced) {
  var changed = 0;
  (entries || []).forEach(function (entry) {
    var email = String(entry.email || '').trim().toLowerCase();
    if (!email || !bounced[email]) return;
    if (entry.status !== 'sent' && entry.status !== 'already-sent') return;
    entry.status = 'bounced';
    entry.bouncedAt = bounced[email];
    entry.error = 'Delivery failed; this address does not exist.';
    changed++;
  });
  return changed;
}

/**
 * Rows reordered so that employers take turns, one each per pass.
 *
 * The queue is a line, and which employer stands where in it is the only decision
 * either planner really makes. Handed a block of rows this hands back the same
 * rows with the companies interleaved: A, B, C, A, B, C rather than A, A, B, B.
 *
 * Shared by both paths because both had the same shape of bug. The referral path
 * gets turn-taking free from its per-employer daily cap, except on ticked rows
 * where that cap is raised — six ticked rows then took the first six hours in a
 * row. The cold path has no additional rolling-week company cap: wave size,
 * wave gap and the daily/mailbox caps are its limits.
 *
 * Order inside one company is preserved, so a re-plan tightens the line rather
 * than reshuffling who is next at any given employer.
 *
 * It orders; it does not schedule. Which rows a day can hold is still the caps'
 * decision, and this only changes which rows are offered to them first.
 */
function outreachInterleaveByCompany_(rows) {
  var byCompany = {}, order = [];
  (rows || []).forEach(function (row) {
    // Tokens, not outreachNameKey_. The legal form has to come off or "Stripe" and
    // "Stripe Inc." are two employers taking two turns each, and the tab would show
    // the interleaver spreading rows it thinks belong to different companies into
    // one office twice as fast. Every other rule here already reads an employer
    // through outreachCompanyTokens_.
    var key = outreachCompanyTokens_(row.company).join(' ');
    if (!byCompany[key]) { byCompany[key] = []; order.push(key); }
    byCompany[key].push(row);
  });
  var out = [];
  for (var round = 0, added = true; added; round++) {
    added = false;
    for (var i = 0; i < order.length; i++) {
      var list = byCompany[order[i]];
      if (round < list.length) { out.push(list[round]); added = true; }
    }
  }
  return out;
}

function outreachSpaceHours_(count, firstHour, lastHour) {
  if (count <= 0) return [];
  if (count === 1) return [firstHour];
  var hours = [];
  var span = lastHour - firstHour;
  for (var i = 0; i < count; i++) {
    hours.push(firstHour + Math.round((i * span) / (count - 1)));
  }
  return hours;
}

function outreachSpreadHours_(count, firstHour, lastHour) {
  var hours = [];
  var remaining = count;
  for (var hour = firstHour; hour <= lastHour && remaining > 0; hour++) {
    var slots = Math.min(remaining, Math.ceil(remaining / (lastHour - hour + 1)));
    for (var i = 0; i < slots; i++) hours.push(hour);
    remaining -= slots;
  }
  return hours;
}
