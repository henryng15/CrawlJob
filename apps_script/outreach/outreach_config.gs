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
// Set to 'Draft' to force every row to a draft whatever its own Mode says. This
// is the rollout switch: for the first weeks nothing should leave unattended,
// and one property is easier to be sure about than a column of them.
var PROP_MODE        = 'OUTREACH_MODE';

// ---------------------------------------------------------------------- tabs

var TAB_APP            = 'App';
var TAB_QUEUE          = 'Email';
var TAB_CONTACTS_SEED  = 'Contacts (seed)';
var TAB_CONTACTS_MANUAL= 'Contacts (manual)';
// Written, never read back. The Season tab is a report: which employers look like
// they run two intakes, so a contact list can be spent knowing a second wave is
// coming rather than finding out afterwards.
var TAB_SEASON         = 'Season';
// The App tab again, sorted by company. A view, kept by hand, that nothing used to
// write to — which is why a Role fixed in App used to sit wrong here until the next
// time it was rebuilt.
var TAB_ALPHABET       = 'Alphabet_Order';

// App tab, 1-based. Read only with one exception: a rejection found in the
// mailbox writes Process and appends a line to Update, because an application
// that has been turned down must stop being worked within the hour. Nothing else
// here writes to App — the tab is already dense, and one more machine-written
// column would be one more thing to read past.
var APP_PROPERTY = 1, APP_COMPANY = 2, APP_DATE_APPLIED = 4;
var APP_PROCESS = 6, APP_ROLE = 7, APP_RECRUITERS = 10, APP_UPDATE = 11;

// The stage a recognised rejection moves an application to, and the date format
// its line in Update is written in. Both mirror the bound script — STAGES and
// UPDATE_DATE_FORMAT in sync_applied_to_app.gs — and the Python audit
// (job_sync/sheet.py) reads the result, so all three have to agree.
var STAGE_REJECTED = 'Rejected';
var UPDATE_DATE_FORMAT = 'MMM d, yyyy';

// The Email tab, 1-based. The three columns copied from App lead it.
//
// Drafted At and Scheduled At sit together and in that order because they are one
// fact read left to right: written at 09:07, goes at 10:00. While a row is Queued
// both are the projection; once it is written both are what happened.
var Q_COMPANY = 1, Q_ROLE = 2, Q_DATE_APPLIED = 3, Q_PROPERTY = 4, Q_RECRUITERS = 5;
var Q_ATTEMPT = 6, Q_TEMPLATE = 7, Q_DRAFTED_AT = 8, Q_SCHEDULED = 9;
var Q_PRIORITY = 10, Q_STATUS = 11, Q_MODE = 12, Q_FINGERPRINT = 13;
var Q_DRAFT_ID = 14, Q_MESSAGE_ID = 15, Q_SENT_AT = 16, Q_RESULT = 17;
var Q_ERROR = 18, Q_ID = 19, Q_VERSION = 20;
var Q_WIDTH = 20;

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
var DAILY_CAP = [0, 15, 25, 22, 18, 10, 0];

var SEND_HOUR_FIRST = 9;    // inclusive, in the project's timezone
var SEND_HOUR_LAST  = 17;   // inclusive: nine firings a day

// How long a finished message sits in Drafts before it goes.
//
// Every email is written one firing before it leaves, so there is always an hour
// in which it exists, addressed and complete, and can be read. Deleting the draft
// in Gmail is what cancels it: the send finds nothing to send and marks the row
// Cancelled. That makes the review a thing you do when you feel like it rather
// than a mode you have to remember to be in.
var DRAFT_LEAD_HOURS = 1;

// The last firing that writes anything. Writing at 17:00 would produce a message
// with no hour left to wait in, so the day's writing stops one firing before the
// day's sending does: drafts are made 09:00-16:00 and go out 10:00-17:00.
var DRAFT_HOUR_LAST = SEND_HOUR_LAST - DRAFT_LEAD_HOURS;

var ELIGIBLE_AFTER_DAYS = 2;   // after Date Applied, before anything may go
var COMPANY_WEEKLY_CAP  = 5;   // emails per company per rolling 7 days

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
var WAVE_GAP_DAYS  = 14;

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

// Unverified addresses were never actually checked, and bounce rate — not
// volume — is what gets a sending account penalised.
var UNSENDABLE_VERIFY = 'local:Unknown';

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
var MODE_DRAFT = 'Draft', MODE_SEND = 'Send';

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
 * These are drafting hours, not sending hours. Add DRAFT_LEAD_HOURS for the hour
 * a row actually leaves at.
 *
 * `firstHour` is the earliest hour still available. It defaults to the start of
 * the day, which is right for every day but today: an hour that has already gone
 * cannot be the hour a row is written in, and numbering today's rows from 09:00
 * at half past ten stamped them with a time in the past. A queued row then sorted
 * above the rows drafted an hour ago, which read as the queue running backwards —
 * Datadog sat at 09:00 above an Anduril row really written at 10:21.
 */
function outreachDraftHoursForDay_(count, firstHour) {
  var hours = [];
  var remaining = count;
  var first = firstHour === undefined ? SEND_HOUR_FIRST
                                      : Math.max(SEND_HOUR_FIRST, firstHour);
  for (var hour = first; hour <= DRAFT_HOUR_LAST && remaining > 0; hour++) {
    var slots = Math.min(remaining, Math.ceil(remaining / (DRAFT_HOUR_LAST - hour + 1)));
    for (var i = 0; i < slots; i++) hours.push(hour);
    remaining -= slots;
  }
  return hours;
}
