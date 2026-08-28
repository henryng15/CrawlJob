/**
 * Tests for the outreach project's decision logic.
 *
 * Every rule that decides something — what qualifies, what order, how many, and
 * which words — is a pure function taking rows and a date. This file loads the
 * three .gs files into one context with just enough of Apps Script stubbed to
 * run them, so the rules can be argued with on a laptop with no Google account
 * and no risk of sending anything.
 *
 * Run: node apps_script/outreach/harness.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

let passed = 0;
const failures = [];
function run(name, body) {
  try { body(); passed++; console.log('  ok   ' + name); }
  catch (error) { failures.push([name, error]); console.log('  FAIL ' + name + ' — ' + error.message); }
}

function load() {
  const context = {
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    // Gmail is the advanced service, and it is stubbed rather than implemented for
    // the same reason GmailApp is: nothing in this file may be able to send.
    GmailApp: {}, Gmail: {}, DriveApp: {}, ScriptApp: {}, SpreadsheetApp: {},
    LockService: {},
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => 'test-salt', setProperty() {} })
    },
    Utilities: {
      // Not a real HMAC — the tests only need it to be stable and collision-free
      // across the handful of addresses they use.
      computeHmacSha256Signature(text, key) {
        const seed = String(key) + '|' + String(text);
        const out = [];
        for (let i = 0; i < 16; i++) {
          let h = 7;
          for (let j = 0; j < seed.length; j++) h = (h * 31 + seed.charCodeAt(j) + i) % 251;
          out.push(h);
        }
        return out;
      },
      formatDate: (d) => ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getDate()
    }
  };
  vm.createContext(context);
  ['outreach_config.gs', 'outreach_budget.gs', 'outreach_contacts.gs', 'outreach_compose.gs', 'outreach_queue.gs',
   'outreach_send.gs', 'outreach_rejections.gs', 'outreach_followup.gs',
   'outreach_referral.gs', 'outreach_referral_queue.gs', 'outreach_referral_send.gs']
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context));
  return context;
}

const S = load();
const SALT = 'test-salt';
const day = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0);

function contact(company, name, email, extra) {
  return Object.assign({
    company, name, email,
    tokens: S.outreachCompanyTokens_(company),
    role: '', focus: '', hook: '', angle: '', source: 'seed'
  }, extra || {});
}
function app(property, company, role, dateApplied, process) {
  return { rowNumber: 2, property, company, role, dateApplied, process: process || 'Applied' };
}
function qrow(over) {
  return Object.assign({
    rowNumber: 2, property: '1', company: 'Acme', role: 'SWE Intern', dateApplied: day(2026, 7, 21),
    attempt: 1, status: 'Sent', fingerprint: '', eligibleAt: null, sentAt: null
  }, over);
}

console.log('company matching — the tracker and the contact list must agree what one employer is');
{
  run('legal form and filler are dropped', () => {
    assert.strictEqual(S.outreachCompanyTokens_('Acme Technologies, Inc.').join(','), 'acme');
  });
  run('a longer name containing the shorter one still matches', () => {
    assert.ok(S.outreachSameEmployer_(
      S.outreachCompanyTokens_('Google'), S.outreachCompanyTokens_('Google Cloud')));
  });
  run('containment is over whole words, so Dice does not match Dicerna', () => {
    assert.ok(!S.outreachSameEmployer_(
      S.outreachCompanyTokens_('Dice'), S.outreachCompanyTokens_('Dicerna')));
  });
  run('an empty name matches nothing', () => {
    assert.ok(!S.outreachSameEmployer_([], S.outreachCompanyTokens_('Google')));
  });
}

console.log('ordering — oldest application first, because the email decays with the application');
{
  const ranked = S.outreachRankApplications_([
    app('3', 'C', 'r', day(2026, 8, 19)),
    app('1', 'A', 'r', day(2026, 7, 21)),
    app('2', 'B', 'r', day(2026, 8, 2))
  ]);
  run('the oldest application leads', () => {
    assert.strictEqual(ranked.map((a) => a.property).join(','), '1,2,3');
  });
  run('an application with no date sinks rather than jumping the queue', () => {
    const withBlank = S.outreachRankApplications_([
      app('9', 'Z', 'r', null), app('1', 'A', 'r', day(2026, 7, 21))
    ]);
    assert.strictEqual(withBlank[0].property, '1');
  });
}

console.log('eligibility — how many people this application earns');
{
  const today = day(2026, 8, 21);
  const none = [];
  const want = (a, existing, available, headroom, when) =>
    S.outreachAttemptsWanted_(a, existing || none, available === undefined ? 3 : available,
                              available === undefined ? 3 : available,
                              headroom === undefined ? 5 : headroom, when || today);

  run('only Applied qualifies; Rejected is over', () => {
    const out = want(app('1', 'A', 'r', day(2026, 8, 1), 'Rejected'));
    assert.strictEqual(out.count, 0);
    assert.match(out.why, /process is Rejected/);
  });
  run('a stage past Applied means a human contact already exists', () => {
    assert.strictEqual(want(app('1', 'A', 'r', day(2026, 8, 1), 'Interview')).count, 0);
  });
  run('Completed OA qualifies — finished work, nobody assigned to it', () => {
    assert.strictEqual(want(app('1', 'A', 'r', day(2026, 8, 1), 'Completed OA'), none, 5, 5).count, 3);
  });
  run('OA itself does not: the assessment is still owed', () => {
    const out = want(app('1', 'A', 'r', day(2026, 8, 1), 'OA'));
    assert.strictEqual(out.count, 0);
    assert.match(out.why, /process is OA/);
  });
  run('moving Applied to Completed OA continues the wave, it does not restart it', () => {
    // Two people already written to under Applied. The stage changing is the same
    // application further along, so the third is attempt 3 — not a fresh attempt 1
    // that would put a second first email in front of someone already contacted.
    const spent = [
      { property: '1', status: 'Sent', sentAt: day(2026, 8, 10), fingerprint: 'x' },
      { property: '1', status: 'Sent', sentAt: day(2026, 8, 11), fingerprint: 'y' }
    ];
    const out = want(app('1', 'A', 'r', day(2026, 8, 1), 'Completed OA'), spent, 5, 5);
    assert.strictEqual(out.from, 3);
  });
  run('a blank Role cannot be written into a sentence', () => {
    assert.strictEqual(want(app('1', 'A', '', day(2026, 8, 1))).count, 0);
  });
  run('a blank Date Applied cannot be ordered, so it waits', () => {
    assert.match(want(app('1', 'A', 'r', null)).why, /Date Applied/);
  });
  run('a fresh application takes everyone available, up to three', () => {
    assert.strictEqual(want(app('1', 'A', 'r', day(2026, 8, 1)), none, 5, 5).count, 3);
    assert.strictEqual(want(app('1', 'A', 'r', day(2026, 8, 1)), none, 2, 5).count, 2);
  });
  run('the weekly company cap is the other ceiling', () => {
    assert.strictEqual(want(app('1', 'A', 'r', day(2026, 8, 1)), none, 5, 1).count, 1);
    assert.match(want(app('1', 'A', 'r', day(2026, 8, 1)), none, 5, 0).why, /weekly cap/);
  });
  run('within a wave a reply changes nothing — the others are committed', () => {
    const out = want(app('1', 'A', 'r', day(2026, 8, 1)),
      [qrow({ attempt: 1, status: 'Replied', sentAt: day(2026, 8, 5) })]);
    assert.strictEqual(out.count, 2);
  });
  run('rows already out are counted, and the rest are still wanted', () => {
    const out = want(app('1', 'A', 'r', day(2026, 8, 1)), [qrow({ attempt: 1, status: 'Sent' })]);
    assert.strictEqual(out.count, 2);
    assert.strictEqual(out.from, 2);
  });
  run('three go out together and then it waits', () => {
    const out = want(app('1', 'A', 'r', day(2026, 8, 1)), [
      qrow({ attempt: 1, status: 'Sent', sentAt: day(2026, 8, 19) }),
      qrow({ attempt: 2, status: 'Sent', sentAt: day(2026, 8, 20) }),
      qrow({ attempt: 3, status: 'Sent', sentAt: day(2026, 8, 21) })
    ]);
    assert.strictEqual(out.count, 0);
    assert.match(out.why, /14-day gap/);
  });
  run('after a fortnight of silence the next three are queued', () => {
    const out = want(app('1', 'A', 'r', day(2026, 7, 1)), [
      qrow({ attempt: 1, status: 'Sent', sentAt: day(2026, 8, 5) }),
      qrow({ attempt: 2, status: 'Sent', sentAt: day(2026, 8, 6) }),
      qrow({ attempt: 3, status: 'Sent', sentAt: day(2026, 8, 6) })
    ], 5, 5);
    assert.strictEqual(out.count, 3);
    assert.strictEqual(out.from, 4);
  });
  run('a reply before the next wave calls it off', () => {
    const out = want(app('1', 'A', 'r', day(2026, 7, 1)), [
      qrow({ attempt: 1, status: 'Replied', sentAt: day(2026, 8, 5) }),
      qrow({ attempt: 2, status: 'Sent', sentAt: day(2026, 8, 6) }),
      qrow({ attempt: 3, status: 'Sent', sentAt: day(2026, 8, 6) })
    ], 5, 5);
    assert.strictEqual(out.count, 0);
    assert.match(out.why, /replied/);
  });
  run('a half-finished wave fills up without waiting — those were always together', () => {
    const out = want(app('1', 'A', 'r', day(2026, 8, 1)), [
      qrow({ attempt: 1, status: 'Sent', sentAt: day(2026, 8, 20) })
    ], 5, 5);
    assert.strictEqual(out.count, 2);
  });
  run('a Date Applied in the future is a typing slip, not a plan', () => {
    const out = want(app('1', 'A', 'r', day(2029, 8, 14)));
    assert.strictEqual(out.count, 0);
    assert.match(out.why, /future/);
  });
  run('a cancelled or failed row spends no attempt — nothing went out', () => {
    const out = want(app('1', 'A', 'r', day(2026, 8, 1)), [
      qrow({ attempt: 1, status: 'Cancelled' }), qrow({ attempt: 2, status: 'Failed' })
    ]);
    assert.strictEqual(out.count, 3);
  });
  run('nobody waits on silence any more — attempts are queued together', () => {
    const out = want(app('1', 'A', 'r', day(2026, 8, 1)),
      [qrow({ attempt: 1, status: 'Sent', sentAt: day(2026, 8, 20) })]);
    assert.strictEqual(out.count, 2);
  });

  run('the three go out one day apart, starting two days after applying', () => {
    const applied = day(2026, 8, 1);
    assert.strictEqual(S.outreachDaysBetween_(applied, S.outreachEligibleDay_(applied, 1)), 2);
    assert.strictEqual(S.outreachDaysBetween_(applied, S.outreachEligibleDay_(applied, 2)), 3);
    assert.strictEqual(S.outreachDaysBetween_(applied, S.outreachEligibleDay_(applied, 3)), 4);
  });
}

console.log('caps — one company must not absorb the whole week');
{
  const today = day(2026, 8, 21);
  const sends = [
    qrow({ company: 'Meta Platforms', sentAt: day(2026, 8, 18) }),
    qrow({ company: 'Meta', sentAt: day(2026, 8, 19) }),
    qrow({ company: 'Meta', sentAt: day(2026, 8, 1) })
  ];
  run('sends are counted across name variants of one employer', () => {
    assert.strictEqual(S.outreachCompanySendsThisWeek_(sends, 'Meta', today), 2);
  });
  run('a send eight days ago has rolled out of the window', () => {
    assert.strictEqual(S.outreachCompanySendsThisWeek_(
      [qrow({ company: 'Meta', sentAt: day(2026, 8, 13) })], 'Meta', today), 0);
  });
  run('another employer is unaffected', () => {
    assert.strictEqual(S.outreachCompanySendsThisWeek_(sends, 'Stripe', today), 0);
  });
}

console.log('the company cap holds on a first run, when nothing has been sent yet');
{
  const today = day(2026, 8, 21);
  const people = [];
  for (let i = 0; i < 10; i++) people.push(contact('Bigco', 'P ' + i, 'p' + i + '@bigco.com'));

  run('three applications to one employer share the weekly allowance', () => {
    const plan = S.outreachPlanEnqueue_([
      app('1', 'Bigco', 'SWE Intern', day(2026, 7, 21)),
      app('2', 'Bigco', 'Data Intern', day(2026, 7, 25)),
      app('3', 'Bigco', 'ML Intern', day(2026, 8, 1))
    ], [], people, today, SALT);
    // Without the fix this was nine: 3 applications x 3 attempts, every one told
    // the company had its whole allowance free because nothing had been sent.
    assert.strictEqual(plan.planned.length, 5);
  });
  run('rows already queued count against it on the next run too', () => {
    const already = [];
    for (let i = 0; i < 5; i++) {
      already.push(qrow({ rowNumber: i + 2, property: '1', company: 'Bigco', status: 'Queued', sentAt: null }));
    }
    const plan = S.outreachPlanEnqueue_(
      [app('2', 'Bigco', 'Data Intern', day(2026, 7, 25))], already, people, today, SALT);
    assert.strictEqual(plan.planned.length, 0);
    assert.match(plan.skipped[0].why, /weekly cap/);
  });
  run('a cancelled row does not hold a slot — nothing is going to arrive', () => {
    const dead = [];
    for (let i = 0; i < 5; i++) {
      dead.push(qrow({ rowNumber: i + 2, property: '1', company: 'Bigco', status: 'Cancelled', sentAt: null }));
    }
    const plan = S.outreachPlanEnqueue_(
      [app('2', 'Bigco', 'Data Intern', day(2026, 7, 25))], dead, people, today, SALT);
    assert.strictEqual(plan.planned.length, 3);
  });
  run('another employer keeps its own allowance', () => {
    const mixed = people.concat([contact('Smallco', 'S One', 's@smallco.com')]);
    const busy = [];
    for (let i = 0; i < 5; i++) {
      busy.push(qrow({ rowNumber: i + 2, property: '1', company: 'Bigco', status: 'Queued', sentAt: null }));
    }
    const plan = S.outreachPlanEnqueue_(
      [app('2', 'Smallco', 'SWE Intern', day(2026, 7, 25))], busy, mixed, today, SALT);
    assert.strictEqual(plan.planned.length, 1);
  });
}

console.log('contact choice — nobody hears from us twice');
{
  const people = [contact('Acme', 'A One', 'a@acme.com'), contact('Acme', 'B Two', 'b@acme.com')];
  const SUMMER = S.SEASON_SUMMER;
  const OFFCYCLE = S.SEASON_OFFCYCLE;
  const sent = (d) => ({ sentAt: d || null });
  const first = S.outreachPickContact_(people, {}, SALT, SUMMER, day(2026, 8, 27));
  run('the first unused contact is chosen', () => {
    assert.strictEqual(first.contact.email, 'a@acme.com');
  });
  run('a fingerprint already in the queue is skipped, even from another application', () => {
    const used = {}; used[first.fingerprint] = sent(day(2026, 8, 1));
    assert.strictEqual(
      S.outreachPickContact_(people, used, SALT, SUMMER, day(2026, 8, 27)).contact.email,
      'b@acme.com');
  });
  run('when everyone has been written to, there is no pick', () => {
    const used = {};
    people.forEach((p) => { used[S.outreachFingerprint_(p.email, SALT, SUMMER)] = sent(); });
    assert.strictEqual(
      S.outreachPickContact_(people, used, SALT, SUMMER, day(2026, 8, 27)), null);
  });
  run('the fingerprint does not contain the address', () => {
    assert.ok(first.fingerprint.indexOf('acme') === -1);
    assert.ok(first.fingerprint.indexOf('@') === -1);
  });
}

console.log('the contact list — two tabs, and why they are two');
{
  function make(rows) {
    return {
      getLastRow: () => rows.length + 1,
      getRange: (row, col, numRows, numCols) => ({
        getValues: () => rows.slice(row - 2, row - 2 + numRows)
          .map((r) => { const out = r.slice(0, numCols); while (out.length < numCols) out.push(''); return out; })
      })
    };
  }
  function book(seedRows, manualRows) {
    const tabs = { 'Contacts (seed)': make(seedRows), 'Contacts (manual)': make(manualRows) };
    return { getSheetByName: (name) => tabs[name] || null };
  }
  // Company, Name, Email, Role, Focus, Hook, Angle, Verify
  const seed = [
    ['Acme', 'A One', 'a@acme.com', 'Recruiter', 'university', 'hook a', 'angle acme', 'debounce:Safe to Send'],
    ['Acme', 'B Two', 'B@ACME.COM', 'Recruiter', 'technical', 'hook b', 'angle acme', 'anymail_verify'],
    ['Shady', 'C Three', 'c@shady.com', '', '', '', 'angle shady', 'local:Unknown']
  ];
  const manual = [
    ['Nowhere', 'N Four', 'n@nowhere.com', '', '', '', '', ''],
    ['Acme', 'A One again', 'a@acme.com', '', '', '', '', ''],
    ['Campus Co', 'C Five', 'c5@campus.com', 'Campus Recruiter', '', '', '', ''],
    ['Talent Co', 'T Six', 't6@talent.com', 'Early Talent Partner', '', '', '', ''],
    ['Internal Co', 'I Seven', 'i7@internal.com', 'Internal Recruiter', '', '', '', ''],
    ['Override Co', 'O Eight', 'o8@override.com', 'Campus Recruiter', 'technical', '', '', '']
  ];
  const contacts = S.outreachReadContacts_(book(seed, manual));

  run('an unverified address never reaches the list', () => {
    assert.ok(!contacts.some((c) => c.email === 'c@shady.com'));
  });
  run('addresses are lowercased, so two spellings are one person', () => {
    assert.ok(contacts.some((c) => c.email === 'b@acme.com'));
  });
  run('a hand-typed duplicate loses to the seed row that carries the angle', () => {
    const acme = contacts.filter((c) => c.email === 'a@acme.com');
    assert.strictEqual(acme.length, 1);
    assert.strictEqual(acme[0].source, 'seed');
    assert.strictEqual(acme[0].angle, 'angle acme');
  });
  run('a hand-typed contact needs only company, name and address', () => {
    const n = contacts.filter((c) => c.email === 'n@nowhere.com')[0];
    assert.strictEqual(n.source, 'manual');
    assert.strictEqual(n.angle, '');
  });
  run('a missing manual tab is not an error — it may not exist yet', () => {
    const only = S.outreachReadContacts_({
      getSheetByName: (n) => (n === 'Contacts (seed)' ? make(seed) : null)
    });
    assert.strictEqual(only.length, 2);
  });
  const focusOf = (email) => contacts.filter((c) => c.email === email)[0].focus;

  run('a hand-typed campus recruiter is read as university from their title alone', () => {
    assert.strictEqual(focusOf('c5@campus.com'), 'university');
  });
  run('early talent is the same team under another name', () => {
    assert.strictEqual(focusOf('t6@talent.com'), 'university');
  });
  run('an internal recruiter is not a campus recruiter', () => {
    assert.strictEqual(focusOf('i7@internal.com'), '');
  });
  run('a Focus that was typed in is never overwritten by the title', () => {
    assert.strictEqual(focusOf('o8@override.com'), 'technical');
  });
  run('a title that says nothing about campus leaves focus empty', () => {
    assert.strictEqual(focusOf('n@nowhere.com'), '');
  });
  run('the derived focus is what moves the campus subject to the front', () => {
    assert.strictEqual(S.outreachVariantFor_(1, focusOf('c5@campus.com'), 'fintech'), 'campus');
    assert.strictEqual(S.outreachVariantFor_(1, focusOf('i7@internal.com'), 'fintech'), 'fintech');
  });
  run('a hand-typed contact borrows its company angle from the seed rows', () => {
    const acme = S.outreachContactsFor_(contacts, 'Acme, Inc.');
    assert.strictEqual(S.outreachAngleFor_(acme), 'angle acme');
  });
  run('a company nobody has written for has no angle to borrow', () => {
    assert.strictEqual(S.outreachAngleFor_(S.outreachContactsFor_(contacts, 'Nowhere')), '');
  });
}

console.log('one posting, one wave — however many times it was applied to');
{
  const AMEX = [
    'Campus Undergraduate Summer Internship Program - 2027 Software Engineer, Enterprise Technology Services- Charlotte, NC',
    'Campus Undergraduate Summer Internship Program - 2027 Software Engineer, Technology - New York, NY',
    'Campus Undergraduate Summer Internship Program - 2027 Software Engineer I, Enterprise Technology Services- Phoenix, AZ'
  ];
  const alike = (a, b) => S.outreachSameRole_(S.outreachRoleTokens_(a), S.outreachRoleTokens_(b));

  run('the city and state are not part of what the job is', () => {
    assert.ok(S.outreachRoleTokens_(AMEX[0]).indexOf('charlotte') === -1);
    assert.ok(S.outreachRoleTokens_(AMEX[2]).indexOf('az') === -1);
  });
  run('one programme posted in three cities is one posting', () => {
    assert.ok(alike(AMEX[0], AMEX[1]));
    assert.ok(alike(AMEX[0], AMEX[2]));
    assert.ok(alike(AMEX[1], AMEX[2]));
  });
  run('two spellings of one role are one posting', () => {
    assert.ok(alike('Software Engineering Intern', 'Software Engineer Internship'));
    assert.ok(alike('NHRC Software Engineering Internship - Summer 2027',
                    'Software Engineer Intern - NHRC'));
  });
  run("one IBM programme's vendor practices are one posting", () => {
    assert.ok(alike('Intern Application Developer - Adobe - 2027',
                    'Intern Application Developer 2027-ServiceNow'));
  });
  run("IBM's other programmes are not that posting", () => {
    assert.ok(!alike('Intern Application Developer - Adobe - 2027',
                     'Software Developer Intern 2027'));
    assert.ok(!alike('Intern Application Developer - Adobe - 2027',
                     'Software Engineer Intern - Entry Level Sales Program 2027'));
  });
  run('a named team is not the general posting', () => {
    assert.ok(!alike('Software Engineering Intern, Dynamo - Fall 2026',
                     'Software Engineering Intern'));
  });
  run('a blank role is never the same posting as anything, including another blank', () => {
    assert.ok(!alike('', ''));
    assert.ok(!alike('', 'Software Engineer Intern'));
  });

  const contacts = [
    contact('American Express', 'R One', 'r1@amex.com', { angle: 'a' }),
    contact('American Express', 'R Two', 'r2@amex.com', { angle: 'a' }),
    contact('American Express', 'R Three', 'r3@amex.com', { angle: 'a' }),
    contact('American Express', 'R Four', 'r4@amex.com', { angle: 'a' }),
    contact('American Express', 'R Five', 'r5@amex.com', { angle: 'a' })
  ];
  const apps = AMEX.map((role, i) => app(String(i + 1), 'American Express', role, day(2026, 8, 1)));
  const plan = S.outreachPlanEnqueue_(apps, [], contacts, day(2026, 8, 20), SALT);

  run('three applications to one programme queue one wave, not three', () => {
    assert.strictEqual(plan.planned.length, 3);
    assert.ok(plan.planned.every((row) => row.property === '1'));
  });
  run('the siblings are skipped by name, not silently dropped', () => {
    assert.strictEqual(plan.skipped.length, 2);
    assert.ok(plan.skipped.every((row) => /already being written about on P1/.test(row.why)));
  });
  run('two recruiters are left for the next American Express posting', () => {
    const spent = {};
    plan.planned.forEach((row) => { spent[row.contact.email] = true; });
    assert.strictEqual(Object.keys(spent).length, 3);
  });
  run('a genuinely different role at the same employer still gets its own wave', () => {
    const mixed = S.outreachPlanEnqueue_(
      apps.concat([app('9', 'American Express', 'Quantitative Developer Intern', day(2026, 8, 2))]),
      [], contacts, day(2026, 8, 20), SALT);
    assert.ok(mixed.planned.some((row) => row.property === '9'));
  });
  run('a refusal from one city does not silence the other two', () => {
    // The Charlotte posting is turned down: its rows are cancelled and its App row
    // leaves Applied. New York should pick the wave up rather than the programme
    // going quiet because one of three locations said no.
    const dead = plan.planned.map((row) => ({
      rowNumber: 2, property: '1', company: 'American Express', role: AMEX[0],
      status: 'Cancelled', fingerprint: row.fingerprint, sentAt: null
    }));
    const after = [app('1', 'American Express', AMEX[0], day(2026, 8, 1), 'Rejected')]
      .concat(apps.slice(1));
    const again = S.outreachPlanEnqueue_(after, dead, contacts, day(2026, 8, 20), SALT);
    assert.ok(again.planned.some((row) => row.property === '2'));
    assert.ok(!again.planned.some((row) => row.property === '3'));
  });
}

console.log('planning — the whole decision, end to end');
{
  const today = day(2026, 8, 21);
  const contacts = [
    contact('Acme', 'A One', 'a@acme.com', { angle: 'Acme runs unattended systems.', hook: 'You own intern hiring.' }),
    contact('Acme', 'A Two', 'a2@acme.com', { angle: 'Acme runs unattended systems.' }),
    contact('Nowhere', 'N Two', 'n@nowhere.com', { source: 'manual' })
  ];
  const plan = S.outreachPlanEnqueue_([
    app('1', 'Acme', 'SWE Intern', day(2026, 7, 21)),
    app('2', 'Nowhere', 'SWE Intern', day(2026, 8, 2)),
    app('3', 'Ghost Co', 'SWE Intern', day(2026, 8, 3))
  ], [], contacts, today, SALT);

  run('only the applications with someone to write to are queued', () => {
    assert.strictEqual(new Set(plan.planned.map((p) => p.property)).size, 2);
  });
  run('a company with two contacts is queued to both at once', () => {
    const acme = plan.planned.filter((p) => p.property === '1');
    assert.strictEqual(acme.length, 2);
    assert.strictEqual(acme.map((r) => r.attempt).join(','), '1,2');
  });
  run('the second person is queued for the day after the first, not four days later', () => {
    const acme = plan.planned.filter((p) => p.property === '1');
    assert.strictEqual(S.outreachDaysBetween_(acme[0].eligibleAt, acme[1].eligibleAt), 1);
  });
  run('no two rows point at the same person', () => {
    const prints = plan.planned.map((p) => p.fingerprint).filter((f) => f);
    assert.strictEqual(new Set(prints).size, prints.length);
  });
  run('an application with nobody to write to gets no row, only a named skip', () => {
    const ghost = plan.skipped.filter((r) => r.company === 'Ghost Co')[0];
    assert.ok(ghost);
    assert.ok(!plan.planned.some((r) => r.property === '3'));
  });
  run('a queued row carries how many people are at that company', () => {
    assert.strictEqual(plan.planned[0].recruiters, 2);
  });
  run('the older application is planned first', () => {
    assert.strictEqual(plan.planned[0].property, '1');
  });
  run('a company with an angle is allowed to send unattended', () => {
    assert.strictEqual(plan.planned[0].mode, 'Send');
  });
  run('a hand-typed contact with no company angle waits as a draft', () => {
    assert.strictEqual(plan.planned.filter((p) => p.property === '2')[0].mode, 'Draft');
  });
  run('an application with nobody to write to gets no row, only a named skip', () => {
    const ghost = plan.skipped.filter((r) => r.company === 'Ghost Co')[0];
    assert.ok(ghost);
    assert.match(ghost.why, /no usable contact/);
    assert.ok(!plan.planned.some((r) => r.property === '3'));
  });
  run('a queue row carries no name and no address', () => {
    const row = S.outreachQueueRowValues_(plan.planned[0]).join(' ');
    assert.ok(row.indexOf('a@acme.com') === -1);
    assert.ok(row.indexOf('A One') === -1);
  });
  run('the queue id is stable and readable', () => {
    const row = S.outreachQueueRowValues_(plan.planned[0]);
    assert.strictEqual(row[S.Q_ID - 1], 'P1-A1');
  });
  run('the three columns a human reads lead the row', () => {
    const row = S.outreachQueueRowValues_(plan.planned[0]);
    assert.strictEqual(row[S.Q_COMPANY - 1], 'Acme');
    assert.strictEqual(row[S.Q_ROLE - 1], 'SWE Intern');
    assert.ok(row[S.Q_DATE_APPLIED - 1] instanceof Date);
  });
}

console.log('the tab says which template is coming, and at what hour');
{
  const today = day(2026, 8, 21);
  const people = [
    contact('Stripe', 'A One', 'a@stripe.com', { angle: 'x', bucket: 'fintech' }),
    contact('Stripe', 'B Two', 'b@stripe.com', { angle: 'x', bucket: 'fintech' })
  ];
  const plan = S.outreachPlanEnqueue_(
    [app('1', 'Stripe', 'SWE Intern', day(2026, 8, 1))], [], people, today, SALT);

  run('the row names its template before it is sent, not after', () => {
    assert.strictEqual(plan.planned[0].template, 'fintech');
    assert.strictEqual(S.outreachQueueRowValues_(plan.planned[0])[S.Q_TEMPLATE - 1], 'fintech');
  });
  run('two people at one company get two different templates', () => {
    assert.notStrictEqual(plan.planned[0].template, plan.planned[1].template);
  });

  run('a day of fifteen is spread over eight firings, not written at nine', () => {
    const hours = Array.from(S.outreachDraftHoursForDay_(15));
    assert.strictEqual(hours.length, 15);
    assert.strictEqual(hours[0], 9);
    // 16:00 is the last firing that writes: 17:00 has no hour left to wait in.
    assert.strictEqual(hours[hours.length - 1], 16);
    assert.strictEqual(new Set(hours).size, 8);
  });
  run('a small day still starts at nine and stops early', () => {
    assert.strictEqual(Array.from(S.outreachDraftHoursForDay_(3)).join(','), '9,10,11');
  });
  // Before the window opens, so the whole day is still ahead and these two say
  // what they were written to say. The hour the projection runs at is load-bearing
  // now: see "the day already under way" below.
  const dawn = (y, m, d) => new Date(y, m - 1, d, 8, 0, 0);
  run('the projection carries the hour, so no two rows read as simultaneous', () => {
    const rows = [];
    for (let i = 0; i < 6; i++) {
      rows.push(qrow({ rowNumber: i + 2, status: 'Queued', sentAt: null, dateApplied: day(2026, 7, 21) }));
    }
    // Monday 24 Aug 2026 caps at 15, so all six land that day at six different hours.
    const plan = S.outreachProjectSchedule_(rows, dawn(2026, 8, 24));
    const hours = plan.map((p) => p.sendAt.getHours());
    assert.strictEqual(new Set(hours).size, 6);
    assert.ok(Math.min.apply(null, hours) >= 10);
    assert.ok(Math.max.apply(null, hours) <= 17);
  });
  run('every projected row says when it appears in Drafts and when it leaves', () => {
    const rows = [qrow({ rowNumber: 2, status: 'Queued', sentAt: null, dateApplied: day(2026, 7, 21) })];
    const slot = S.outreachProjectSchedule_(rows, dawn(2026, 8, 24))[0];
    assert.strictEqual(slot.draftAt.getHours(), 9);
    assert.strictEqual(slot.sendAt.getHours(), 10);
    assert.strictEqual(slot.sendAt.getTime() - slot.draftAt.getTime(), 3600000);
  });
}

console.log('the day already under way — a queued row cannot be written at an hour that has gone');
{
  const at = (h) => new Date(2026, 7, 24, h, 21, 0);
  const queued = (n) => Array.from({ length: n }, (unused, i) =>
    qrow({ rowNumber: i + 2, status: 'Queued', sentAt: null, dateApplied: day(2026, 7, 21) }));

  run('an hour already gone is not offered', () => {
    // Drafting is step 6 and the projection step 7 of the same round, so a row
    // still Queued here missed this hour: the earliest left is the next one.
    const plan = S.outreachProjectSchedule_(queued(3), at(10));
    plan.forEach((p) => assert.ok(p.draftAt.getHours() >= 11,
      'drafted at ' + p.draftAt.getHours() + ', which has gone'));
  });
  run('this is what put a queued row above one already drafted', () => {
    // Datadog, 27 August 2026. Queued, stamped 09:00 by a projection that ran at
    // 10:21, filed above an Anduril row really drafted at 10:21 — the table read
    // as though the queue ran backwards.
    const slot = S.outreachProjectSchedule_(queued(1), at(10))[0];
    assert.ok(slot.draftAt.getHours() > 10);
  });
  run('before the window, the whole day is still on offer', () => {
    assert.strictEqual(S.outreachProjectSchedule_(queued(1), at(7))[0].draftAt.getHours(), 9);
  });
  run('after the last drafting hour, the rows belong to the next day', () => {
    const from = at(16);
    const slot = S.outreachProjectSchedule_(queued(1), from)[0];
    assert.ok(slot.draftAt.getDate() !== from.getDate(), 'stayed on a day with no hours left');
    assert.strictEqual(slot.draftAt.getHours(), 9);
  });
  run('the count still survives a day that starts late', () => {
    const plan = S.outreachProjectSchedule_(queued(9), at(14));
    assert.strictEqual(plan.length, 9);
    plan.forEach((p) => assert.ok(!isNaN(p.draftAt.getTime()), 'an unset hour became Invalid Date'));
  });
  run('outreachDraftHoursForDay_ still defaults to the start of the day', () => {
    assert.strictEqual(Array.from(S.outreachDraftHoursForDay_(3)).join(','), '9,10,11');
    assert.strictEqual(Array.from(S.outreachDraftHoursForDay_(3, 14)).join(','), '14,15,16');
  });
}

console.log('the message');
{
  const today = day(2026, 8, 21);
  run('attempt 1 leads with the application, which the recipient can verify', () => {
    assert.strictEqual(S.outreachVariantFor_(1, '', ''), 'application');
  });
  run('the hook matches what the company actually does', () => {
    assert.strictEqual(S.outreachVariantFor_(1, '', 'fintech'), 'fintech');
    assert.strictEqual(S.outreachVariantFor_(1, '', 'ai'), 'ai');
    assert.strictEqual(S.outreachVariantFor_(1, '', 'edtech'), 'edtech');
  });
  run('a university recruiter comes before the industry hook', () => {
    assert.strictEqual(S.outreachVariantFor_(1, 'university', 'fintech'), 'campus');
    assert.strictEqual(S.outreachVariantFor_(2, 'university', 'fintech'), 'fintech');
  });
  run('three people at one company get three different subjects', () => {
    const seen = [1, 2, 3].map((n) => S.outreachVariantFor_(n, '', 'cloud'));
    assert.strictEqual(new Set(seen).size, 3);
    assert.strictEqual(seen[0], 'cloud');
  });
  run('an unknown industry still resolves to a real variation', () => {
    assert.strictEqual(S.outreachVariantFor_(1, '', 'quantum-ferrets'), 'application');
  });
  run('there are ten subjects and none is over 60 characters', () => {
    const subjects = Object.keys(S.VARIANTS).map((k) => S.VARIANTS[k].subject);
    assert.strictEqual(subjects.length, 10);
    assert.strictEqual(new Set(subjects).size, 10);
    subjects.forEach((line) => assert.ok(line.length <= 60, line));
  });
  run('every variation names one bullet that exists', () => {
    Object.keys(S.VARIANTS).forEach((key) => {
      const v = S.VARIANTS[key];
      assert.strictEqual(typeof v.bullet, 'string');
      assert.ok(S.RESUME_BULLETS[v.bullet], key + ' -> ' + v.bullet);
    });
  });
  // The ceilings the template is documented to hold: 20 words a bullet, 25 an
  // ask. They are asserted here rather than trusted, because the whole point of
  // the rewrite was length and nothing else in the file measures it.
  run('no bullet runs past twenty words, and no ask past twenty-five', () => {
    const words = (t) => t.replace(/\*\*/g, '').split(/\s+/).filter(Boolean).length;
    Object.keys(S.VARIANTS).forEach((key) => {
      const v = S.VARIANTS[key];
      assert.ok(words(S.RESUME_BULLETS[v.bullet]) <= 20, key + ' bullet');
      assert.ok(words(v.ask) <= 25, key + ' ask');
    });
  });

  const mail = S.outreachCompose_({
    variant: 'application', role: 'Software Engineer Intern', recruiterName: 'Julie Zehnpfennig',
    dateApplied: day(2026, 8, 4), today, hook: 'Since you own intern hiring at AMD,',
    angle: 'AMD is where systems have to fail loudly.',
    formatDate: (d) => 'Aug ' + d.getDate()
  });
  run('the subject is the hook, and short enough for a phone', () => {
    assert.strictEqual(mail.subject, 'Cut a 30-minute research loop to 60 seconds');
    assert.ok(mail.subject.length < 60);
  });
  run('three labelled sections, the way a recruiter scans', () => {
    assert.ok(mail.html.indexOf('<b>Quick intro:</b>') !== -1);
    assert.ok(mail.html.indexOf('reaching out:</b>') !== -1);
    assert.ok(mail.html.indexOf('<b>The ask:</b>') !== -1);
  });
  run('the first bullet introduces a person, by name and by school', () => {
    const first = mail.plain.split('Quick intro:\n')[1].split('\n')[0];
    assert.match(first, /^ {2}- I am Henry Nguyen, a Math and Computer Science student at Kenyon College/);
    assert.match(first, /class of 2028, 4\.0 GPA/);
  });
  run('the application gets a line of its own', () => {
    const second = mail.plain.split('Quick intro:\n')[1].split('\n')[1];
    assert.strictEqual(second, '  - Applied for the Software Engineer Intern role on Aug 4.');
    assert.ok(mail.plain.indexOf('Hope you') === -1);
  });
  run('the name is bold in the intro, not only signed at the bottom', () => {
    assert.ok(mail.html.indexOf('<b>Henry Nguyen</b>') !== -1);
    assert.ok(mail.html.indexOf('<b>Kenyon College</b>') !== -1);
  });
  run('no section is longer than three bullets', () => {
    const sections = mail.plain.split(/\n\n/).filter((b) => b.indexOf('  - ') !== -1);
    sections.forEach((block) => {
      assert.ok(block.split('\n').filter((l) => l.startsWith('  - ')).length <= 4, block);
    });
  });
  run('not one dash anywhere in what the recruiter reads', () => {
    assert.ok(!/[\u2014\u2013]/.test(mail.plain), mail.plain);
    assert.ok(!/[\u2014\u2013]/.test(mail.subject));
    assert.ok(!/[\u2014\u2013]/.test(mail.html));
  });
  run('the ask carries its own bold, so the eye lands on it', () => {
    assert.ok(mail.html.split('<b>The ask:</b>')[1].indexOf('<b>take a quick look at my application</b>') !== -1);
  });
  run('an em dash in the angle becomes two sentences, not a long breath', () => {
    const split = S.outreachNoDashes_('systems fail loudly — at Vietcombank I shipped it');
    assert.strictEqual(split, 'systems fail loudly. At Vietcombank I shipped it.');
  });
  run('no dash means the sentence is left alone but still ends cleanly', () => {
    assert.strictEqual(S.outreachNoDashes_('One plain sentence.'), 'One plain sentence.');
  });
  run('the reason sits under its own heading, not inside the intro', () => {
    const why = mail.plain.split('Why I\u2019m reaching out:')[1].split('The ask:')[0];
    assert.match(why, /Since you own intern hiring at AMD/);
    assert.match(why, /fail loudly/);
  });
  run('every bullet stays short enough to be read at a glance', () => {
    mail.plain.split('\n').filter((l) => l.startsWith('  - ')).forEach((line) => {
      assert.ok(line.split(/\s+/).length <= 22, line);
    });
  });
  run('only the first name is used', () => {
    assert.match(mail.plain, /^Hi Julie,/);
  });
  run('three intro bullets: who I am, what I applied to, then one result', () => {
    const intro = mail.html.split('<b>Quick intro:</b>')[1].split('</ul>')[0];
    assert.strictEqual((intro.match(/<li>/g) || []).length, 3);
  });
  run('the reason is two bullets, not a paragraph', () => {
    const why = mail.html.split('reaching out:</b></p>')[1].split('</ul>')[0];
    assert.strictEqual((why.match(/<li>/g) || []).length, 2);
  });
  run('numbers arrive bold in HTML and clean in plain text', () => {
    assert.ok(mail.html.indexOf('<b>30 minutes to 1 minute</b>') !== -1);
    assert.ok(mail.plain.indexOf('30 minutes to 1 minute') !== -1);
    assert.ok(mail.plain.indexOf('**') === -1);
  });
  run('the resume is announced', () => {
    assert.match(mail.plain, /Resume attached\./);
  });
  run('the hook and the angle are separate bullets, each on its own line', () => {
    const why = mail.plain.split('Why I\u2019m reaching out:')[1].split('The ask:')[0];
    const lines = why.split('\n').filter((l) => l.startsWith('  - '));
    assert.strictEqual(lines.length, 2);
    assert.match(lines[0], /Since you own intern hiring at AMD/);
    assert.match(lines[1], /fail loudly/);
  });

  const stale = S.outreachCompose_({
    variant: 'application', role: 'SWE Intern', recruiterName: 'Sam',
    dateApplied: day(2026, 5, 1), today, formatDate: (d) => 'May ' + d.getDate()
  });
  run('past 45 days the date is dropped rather than volunteered', () => {
    assert.ok(stale.plain.indexOf('May 1') === -1);
    assert.match(stale.plain, /Applied for the SWE Intern role earlier this year/);
    assert.match(stale.plain, /I am Henry Nguyen/);
  });
  run('with no hook or angle the Why section is left out, not left empty', () => {
    assert.ok(stale.html.indexOf('reaching out:') === -1);
    assert.ok(stale.plain.indexOf('reaching out:') === -1);
  });

  const cleared = S.outreachCompose_({
    variant: 'application', role: 'SWE Intern', recruiterName: 'Sam',
    dateApplied: day(2026, 8, 4), today, process: 'Completed OA',
    formatDate: (d) => 'Aug ' + d.getDate()
  });
  run('an application that cleared its assessment says so, in the same bullet', () => {
    const second = cleared.plain.split('Quick intro:\n')[1].split('\n')[1];
    assert.strictEqual(
      second,
      '  - Applied for the SWE Intern role on Aug 4 and have since completed the '
        + 'online assessment.');
  });
  run('the assessment clause carries no date of its own', () => {
    // The day the OA was submitted is not in the App tab, and Date Applied is not
    // it. Naming one would mean inventing it.
    const bullet = cleared.plain.split('completed the online assessment')[1].split('\n')[0];
    assert.strictEqual(bullet, '.');
  });
  run('a stale application that cleared its assessment drops the date, not the clause', () => {
    const old = S.outreachCompose_({
      variant: 'application', role: 'SWE Intern', recruiterName: 'Sam',
      dateApplied: day(2026, 5, 1), today, process: 'Completed OA',
      formatDate: (d) => 'May ' + d.getDate()
    });
    assert.ok(old.plain.indexOf('May 1') === -1);
    assert.match(
      old.plain,
      /Applied for the SWE Intern role earlier this year and have since completed the online assessment\./);
  });
  run('an Applied row is unchanged — no assessment it has not taken', () => {
    assert.ok(mail.plain.indexOf('online assessment') === -1);
    assert.ok(stale.plain.indexOf('online assessment') === -1);
  });
  run('the clause is bold-free, so it cannot be mistaken for the role', () => {
    assert.ok(cleared.html.indexOf('<b>SWE Intern</b>') !== -1);
    assert.ok(cleared.html.indexOf('<b>online assessment</b>') === -1);
  });

  const nasty = S.outreachCompose_({
    variant: 'fintech', role: '<script>alert(1)</script>', recruiterName: 'Bo & Co',
    dateApplied: day(2026, 8, 20), today, formatDate: () => 'Aug 20'
  });
  run('a role from the sheet cannot inject markup into the email', () => {
    // A title no rule recognises reaches the reader as written, so escaping is
    // still what stands between the sheet and the message.
    assert.ok(nasty.html.indexOf('<script>') === -1);
    assert.ok(nasty.html.indexOf('&lt;script&gt;') !== -1);
  });
  run('an ampersand in a name is escaped, not swallowed', () => {
    assert.ok(nasty.html.indexOf('Bo &amp; Co') !== -1 || nasty.html.indexOf('Hi Bo,') !== -1);
  });
  run('the long role name is not repeated in the ask', () => {
    assert.ok(nasty.plain.indexOf('The ask:') !== -1);
    assert.ok(nasty.plain.split('The ask:')[1].indexOf('alert(1)') === -1);
  });
}

console.log('the job is named in three words, not in the job board\'s words');
{
  const short = (r) => S.outreachShortRole_(r);

  run('a job board title is reduced to the kind of job', () => {
    assert.strictEqual(short('Campus Undergraduate Summer Internship Program - 2027 '
      + 'Software Engineer, Enterprise Technology Services- Charlotte, NC'),
      'Software Engineer Intern');
    assert.strictEqual(short('2027 Technology, Data, AI & Ventures Summer Internship '
      + 'Program - Software Engineer Intern Job Details / New York Life Insurance Co'),
      'Software Engineer Intern');
  });
  run('a title that is already three words is left saying the same thing', () => {
    assert.strictEqual(short('Software Engineer Intern'), 'Software Engineer Intern');
    assert.strictEqual(short('Quantitative Developer Intern'), 'Quantitative Developer Intern');
  });
  run('the specific disciplines keep their own name', () => {
    assert.strictEqual(short('Intern Firmware Engineering'), 'Firmware Engineer Intern');
    assert.strictEqual(short('Spring 2027 Co-op, Embedded Software Engineer (January 2027)'),
      'Embedded Software Engineer Intern');
    assert.strictEqual(short('Fullstack Engineering Internship - Product Team'),
      'Full Stack Engineer Intern');
    assert.strictEqual(short('Web Developer/Programmer Internship'), 'Web Developer Intern');
  });
  run('software beats systems when a title claims both', () => {
    assert.strictEqual(short('Software Engineering Intern - Systems Engineering - Vancouver BC'),
      'Software Engineer Intern');
    assert.strictEqual(short('Systems Engineering Intern (New York) - Summer 2027'),
      'Systems Engineer Intern');
  });
  run('a programme that names a department, not a job, is called Technology', () => {
    assert.strictEqual(short('2027 Truist Analyst Program - Technology, Data, and Operations Track'),
      'Technology');
    assert.strictEqual(short('Deutsche Bank Internship Programme - Technology, Data and '
      + 'Innovation (TDI) - Cary 2027'), 'Technology');
    assert.strictEqual(short('College Internship Information Technology (20097565)'), 'Technology');
  });
  run('a title no rule recognises is left exactly as it was written', () => {
    assert.strictEqual(short('Ad Infra'), 'Ad Infra');
    assert.strictEqual(short('AI Builder Intern'), 'AI Builder Intern');
    assert.strictEqual(short('R&D Intern (Fall 2026)'), 'R&D Intern (Fall 2026)');
  });
  run('only an empty cell falls back, because a blank is not a sentence', () => {
    assert.strictEqual(short(''), 'Software Engineer Intern');
    assert.strictEqual(short('   '), 'Software Engineer Intern');
  });
  run('a recognised title is still cut down, not left long', () => {
    assert.ok(short('Campus Undergraduate Summer Internship Program - 2027 Software '
      + 'Engineer, Enterprise Technology Services- Charlotte, NC').length < 30);
  });
  run('the name is still the bold half of the bullet', () => {
    const mail = S.outreachCompose_({
      variant: 'application', role: 'Campus Undergraduate Summer Internship Program - 2027 '
        + 'Software Engineer, Enterprise Technology Services- Charlotte, NC',
      recruiterName: 'Ada L', dateApplied: day(2026, 8, 20),
      today: day(2026, 8, 21), formatDate: () => 'Aug 20'
    });
    assert.ok(mail.html.indexOf('<b>Software Engineer Intern</b>') !== -1);
    assert.ok(mail.html.indexOf('Charlotte') === -1);
    assert.ok(mail.html.indexOf('Campus Undergraduate') === -1);
  });
}

console.log('reading a rejection out of the mailbox');
{
  const msg = (from, subject, body) => ({ from, subject, body: body || '' });
  const opening = (property, company, role) => ({
    rowNumber: 2, property, company, role, process: 'Applied', dateApplied: day(2026, 8, 1)
  });

  // Every body below is the real sentence from a real message in this account.
  run('the plain refusals are all recognised', () => {
    [
      ['Rivian', "Unfortunately, we've decided to move forward with other candidates whose qualifications more closely align to this role."],
      ['Valeo', 'After careful consideration of your application, we regret to inform you that we will not be proceeding with your application for this position.'],
      ['SAP', 'After carefully reviewing your application, we regret to inform you that we have chosen to pursue other applicants.'],
      ['Schweitzer', 'We wanted to inform you that we have decided to continue our search for other candidates.'],
      ['Schneider', 'Your application was impressive; however, you were not selected to continue forward in the process.'],
      ['Salesforce', 'The Software Engineering Intern position has been filled and is now closed.'],
      ['RTX', 'Unfortunately, the position of Software Engineering Intern has been canceled by our hiring team.'],
      ['Melaleuca', 'We are sorry to inform you that you do not meet the minimum qualifications for this position.'],
      ['Appian', "The hiring team has reviewed your resume and unfortunately your application wasn't selected for the next round of interviews."],
      ['Apprenticely', 'Unfortunately, we are unable to proceed with your application at this time.']
    ].forEach(([who, body]) => assert.ok(S.outreachIsRejection_('Update on your application', body), who));
  });
  run('an apostrophe in any of its three spellings still matches', () => {
    ['wasn\u2019t selected', "wasn't selected", 'wasnt selected'].forEach((spelling) => {
      assert.ok(S.outreachIsRejection_('Update', 'Your application ' + spelling + ' for the role.'), spelling);
    });
  });
  // The seven Microsoft acknowledgements in this account all carry this line, and
  // it was seven false positives before the conditional guard existed.
  run('a hypothetical refusal in an acknowledgement is not a refusal', () => {
    assert.ok(!S.outreachIsRejection_('Thank you for your application!',
      'If you see the job moved to an inactive state, that means the position is either no longer '
      + 'open, you withdrew from consideration, or you were not selected for the role.'));
  });
  run('a pre-declared refusal is still hypothetical', () => {
    // impact.com: a rejection that has not happened yet is not a rejection.
    assert.ok(!S.outreachIsRejection_('Thank you for applying',
      'If you have not heard back from us within four weeks, we regret to inform you that your '
      + 'application has not been successful on this occasion.'));
  });
  run('an invitation that comes first outranks anything after it', () => {
    assert.ok(!S.outreachIsRejection_('Next steps',
      "You're invited to complete an assessment. Others were not selected for this round."));
  });
  run('a polite closing does not undo a refusal already stated', () => {
    // Real rejections routinely end this way, and an unordered blocker threw them out.
    assert.ok(S.outreachIsRejection_('Update',
      'We regret to inform you that we have chosen to pursue other applicants. '
      + 'We invite you to apply for other openings.'));
  });
  run('an ordinary email is not a rejection', () => {
    assert.ok(!S.outreachIsRejection_('Your receipt', 'Thanks for your order.'));
  });
  run('an acknowledgement that only promises to review is not a rejection', () => {
    assert.ok(!S.outreachIsRejection_('Thank you for your application to Figma',
      'We received your application for Software Engineer Intern, and we are delighted that you '
      + 'would consider joining our team. Our team will review your application.'));
  });
  run('"unfortunately" on its own is not enough to close an application', () => {
    assert.ok(!S.outreachIsRejection_('Update', 'Unfortunately the req is delayed.'));
  });
  run('a cancelled subscription is not a cancelled req', () => {
    // Real: an Overleaf receipt scored as a refusal on the bare phrase "has been
    // canceled", and only escaped closing an application because no open row
    // matched the sender.
    assert.ok(!S.outreachIsRejection_(
      'Digital Science & Research Solutions Inc. subscription cancellation confirmation '
      + '- we\u2019re sorry to see you go.',
      'Your subscription has been canceled. This email confirms that your Digital Science & '
      + 'Research Solutions Inc. subscription for Standard monthly has been canceled. '
      + 'You won\u2019t be charged again.'));
  });
  run('a cancelled req still closes the application', () => {
    assert.ok(S.outreachIsRejection_('Update on your application',
      'We are sorry to say the position has been canceled for this cycle.'));
  });
  run('a closed application closes the application', () => {
    assert.ok(S.outreachIsRejection_('Update',
      'Your application has been closed.'));
  });
  run('a filled req needs to say what was filled', () => {
    assert.ok(S.outreachIsRejection_('Update', 'The opening has been filled.'));
    assert.ok(!S.outreachIsRejection_('Your table is ready',
      'The last seating has been filled.'));
  });
  run('a closed account is not a closed application', () => {
    assert.ok(!S.outreachIsRejection_('Account notice',
      'Your account has been closed at your request.'));
  });

  run('the employer is read out of the sender, not the ATS around it', () => {
    assert.strictEqual(
      S.outreachSenderTokens_('"Stripe Recruiting" <no-reply@us.greenhouse-mail.io>').join(','),
      'stripe');
    assert.strictEqual(
      S.outreachSenderTokens_('Databricks <databricks@myworkday.com>').join(','), 'databricks');
    // Real senders from this account, each of which used to read as an ATS vendor.
    assert.strictEqual(
      Array.from(S.outreachSenderTokens_('Textron Recruiting <recruiting-noreply@hrtextron.textron.com>'))
        .sort().join(','), 'hrtextron,textron');
    assert.strictEqual(
      Array.from(S.outreachSenderTokens_('RTX Workday Notifications <globalhr@myworkday.com>'))
        .sort().join(','), 'globalhr,rtx');
  });

  run('a rejection from one open application is pinned to it', () => {
    const target = S.outreachRejectionTarget_(
      msg('Stripe <no-reply@greenhouse.io>', 'Your application to Stripe'),
      [opening('1', 'Stripe', 'SWE Intern')]);
    assert.strictEqual(target.app.property, '1');
  });
  run('an application already past Applied is not rejected twice', () => {
    const row = opening('1', 'Stripe', 'SWE Intern');
    row.process = 'Rejected';
    const target = S.outreachRejectionTarget_(
      msg('Stripe <no-reply@greenhouse.io>', 'Your application to Stripe'), [row]);
    assert.strictEqual(target.app, null);
  });
  run('a rejection after a finished assessment still finds its row', () => {
    // The stage that most often gets a rejection is the one just after an OA.
    // Miss it here and the queue keeps writing to a company that has said no.
    const row = opening('1', 'Stripe', 'SWE Intern');
    row.process = 'Completed OA';
    const target = S.outreachRejectionTarget_(
      msg('Stripe <no-reply@greenhouse.io>', 'Your application to Stripe'), [row]);
    assert.strictEqual(target.app.property, '1');
  });
  run('a company nobody applied to is left alone', () => {
    const target = S.outreachRejectionTarget_(
      msg('Notion <no-reply@greenhouse.io>', 'Your application to Notion'),
      [opening('1', 'Stripe', 'SWE Intern')]);
    assert.strictEqual(target.app, null);
    assert.match(target.why, /matches the sender/);
  });
  run('the body never names the employer, so a footer cannot close an application', () => {
    const target = S.outreachRejectionTarget_(
      msg('Careers <no-reply@jobboard.example>', 'An update on your application',
          'We regret to inform you. Powered by Stripe.'),
      [opening('1', 'Stripe', 'SWE Intern')]);
    assert.strictEqual(target.app, null);
  });
  run('two employers matching one sender stops the write', () => {
    const target = S.outreachRejectionTarget_(
      msg('Careers <no-reply@x.com>', 'Your application to Stripe and Notion'),
      [opening('1', 'Stripe', 'SWE Intern'), opening('2', 'Notion', 'SWE Intern')]);
    assert.strictEqual(target.app, null);
    assert.match(target.why, /different employers/);
  });

  run('two roles at one employer, and the email names one of them', () => {
    const rows = [
      opening('1', 'Stripe', 'Software Engineering Intern, Summer 2027'),
      opening('2', 'Stripe', 'Data Science Intern, Summer 2027')
    ];
    rows[1].rowNumber = 3;
    const target = S.outreachRejectionTarget_(
      msg('Stripe <no-reply@greenhouse.io>',
          'Your application for Data Science Intern, Summer 2027'), rows);
    assert.strictEqual(target.app.property, '2');
  });
  run('two roles at one employer and the email names neither: nothing is touched', () => {
    const rows = [
      opening('1', 'Stripe', 'Software Engineering Intern, Summer 2027'),
      opening('2', 'Stripe', 'Data Science Intern, Summer 2027')
    ];
    rows[1].rowNumber = 3;
    const target = S.outreachRejectionTarget_(
      msg('Stripe <no-reply@greenhouse.io>', 'An update on your application'), rows);
    assert.strictEqual(target.app, null);
    assert.match(target.why, /names none/);
  });

  run('a rejection is dated the day it was sent, not the day it was found', () => {
    const sent = day(2026, 7, 30), now = day(2026, 8, 24);
    assert.strictEqual(S.outreachRejectedOn_(sent, now).getTime(), sent.getTime());
  });
  run('a missing or unreadable date falls back to the hour we are sure of', () => {
    const now = day(2026, 8, 24);
    assert.strictEqual(S.outreachRejectedOn_(null, now).getTime(), now.getTime());
    assert.strictEqual(S.outreachRejectedOn_(undefined, now).getTime(), now.getTime());
    assert.strictEqual(S.outreachRejectedOn_(new Date('nonsense'), now).getTime(), now.getTime());
  });
  run('a date in the future is not believed', () => {
    // A header can say anything; a rejection cannot have arrived tomorrow.
    const now = day(2026, 8, 24);
    assert.strictEqual(S.outreachRejectedOn_(day(2027, 1, 1), now).getTime(), now.getTime());
  });
  run('the Update line goes on last, which is where the Python audit reads it', () => {
    assert.strictEqual(S.outreachLastStage_('Applied: Aug 1, 2026'), 'Applied');
    assert.strictEqual(
      S.outreachLastStage_('Applied: Aug 1, 2026\nRejected: Aug 24, 2026'), 'Rejected');
    assert.strictEqual(S.outreachLastStage_(''), '');
  });
  run('the ordinary search excludes every label it can apply', () => {
    const query = S.outreachRejectionQuery_(false);
    [S.LABEL_REJECTED, S.LABEL_CHECK, S.LABEL_IGNORED].forEach((label) => {
      assert.ok(query.indexOf('-label:"' + label + '"') !== -1, label);
    });
  });
  run('a reopen re-reads the two piles the old rules could have got wrong', () => {
    const query = S.outreachRejectionQuery_(true);
    assert.ok(query.indexOf('-label:"' + S.LABEL_CHECK + '"') === -1);
    assert.ok(query.indexOf('-label:"' + S.LABEL_IGNORED + '"') === -1);
  });
  run('a reopen excludes what it has already re-read, or it never finishes', () => {
    // Without this the verdict it just wrote puts the thread straight back in the
    // result set: the same first forty for ever, and the rest never reached.
    assert.ok(S.outreachRejectionQuery_(true).indexOf('-label:"' + S.LABEL_REJUDGED + '"') !== -1);
    assert.ok(S.outreachRejectionQuery_(false).indexOf(S.LABEL_REJUDGED) === -1);
  });
  run('a reopen never re-reads a closure, which it could only spoil', () => {
    // Those applications are already Rejected, so re-judging finds no open row
    // and would move a correct closure into the review pile.
    assert.ok(S.outreachRejectionQuery_(true).indexOf('-label:"' + S.LABEL_REJECTED + '"') !== -1);
  });
}

console.log('the sending window');
{
  const queued = (n, dateApplied) => qrow({
    rowNumber: n, status: 'Queued', eligibleAt: day(2026, 8, 1), sentAt: null, dateApplied
  });
  run('nothing goes out at the weekend', () => {
    assert.strictEqual(S.outreachDueNow_([queued(2, day(2026, 7, 21))], new Date(2026, 7, 22, 10)).length, 0);
  });
  run('nothing goes out before the window opens', () => {
    assert.strictEqual(S.outreachDueNow_([queued(2, day(2026, 7, 21))], new Date(2026, 7, 21, 7)).length, 0);
  });
  run('a row not yet eligible waits', () => {
    const later = qrow({ rowNumber: 2, status: 'Queued', eligibleAt: day(2026, 9, 1), sentAt: null });
    assert.strictEqual(S.outreachDueNow_([later], new Date(2026, 7, 21, 10)).length, 0);
  });
  run('the day is spread across the firings left, not burned at 09:00', () => {
    const rows = [];
    for (let i = 0; i < 30; i++) rows.push(queued(i + 2, day(2026, 7, 21)));
    // Friday 21 Aug 2026 caps at 10, nine firings from 09:00 -> ceil(10/9) = 2
    assert.strictEqual(S.outreachDueNow_(rows, new Date(2026, 7, 21, 9)).length, 2);
  });
  run('a missed firing is absorbed by the ones after it', () => {
    const rows = [];
    for (let i = 0; i < 30; i++) rows.push(queued(i + 2, day(2026, 7, 21)));
    // 15:00 leaves two writing firings for the whole untouched cap of 10
    assert.strictEqual(S.outreachDueNow_(rows, new Date(2026, 7, 21, 15)).length, 5);
  });
  run('the last firing of the day only sends, and writes nothing new', () => {
    const rows = [];
    for (let i = 0; i < 30; i++) rows.push(queued(i + 2, day(2026, 7, 21)));
    assert.strictEqual(S.outreachDueNow_(rows, new Date(2026, 7, 21, 16)).length, 10);
    assert.strictEqual(S.outreachDueNow_(rows, new Date(2026, 7, 21, 17)).length, 0);
  });
  run('what has already gone today comes off the cap', () => {
    const rows = [queued(2, day(2026, 7, 21))];
    for (let i = 0; i < 10; i++) rows.push(qrow({ status: 'Sent', sentAt: new Date(2026, 7, 21, 9) }));
    assert.strictEqual(S.outreachDueNow_(rows, new Date(2026, 7, 21, 15)).length, 0);
  });
  run('the oldest application goes first, whatever order the rows sit in', () => {
    const rows = [queued(2, day(2026, 8, 15)), queued(3, day(2026, 7, 21)), queued(4, day(2026, 8, 1))];
    const due = S.outreachDueNow_(rows, new Date(2026, 7, 21, 15));
    assert.strictEqual(due.map((r) => r.rowNumber).join(','), '3,4,2');
  });
}

console.log('the Priority tick — asked for by hand goes first');
{
  const queued = (n, company, role, applied, over) => qrow(Object.assign({
    rowNumber: n, status: 'Queued', company, role, sentAt: null,
    dateApplied: applied, eligibleAt: day(2026, 8, 1), priority: false
  }, over || {}));
  const monday = day(2026, 8, 24);
  const friday3pm = new Date(2026, 7, 21, 15);   // Friday caps at 10

  run('a tick moves its own row past an older application', () => {
    const rows = [
      queued(2, 'Stripe', 'SWE Intern', day(2026, 8, 15), { priority: true }),
      queued(3, 'Acme', 'SWE Intern', day(2026, 6, 1))
    ];
    assert.strictEqual(
      S.outreachDueNow_(rows, friday3pm).map((r) => r.rowNumber).join(','), '2,3');
  });
  run('with nothing ticked the order is unchanged — oldest application first', () => {
    const rows = [
      queued(2, 'Stripe', 'SWE Intern', day(2026, 8, 15)),
      queued(3, 'Acme', 'SWE Intern', day(2026, 6, 1))
    ];
    assert.strictEqual(
      S.outreachDueNow_(rows, friday3pm).map((r) => r.rowNumber).join(','), '3,2');
  });
  run('one tick lifts the other attempts at the same company and role', () => {
    const rows = [
      queued(2, 'Acme', 'SWE Intern', day(2026, 6, 1)),
      queued(3, 'Stripe', 'Software Engineer Intern', day(2026, 8, 15), { priority: true }),
      queued(4, 'Stripe', 'Software Engineering Internship', day(2026, 8, 16)),
      queued(5, 'Stripe Inc.', 'Software Engineer, Intern - Seattle, WA', day(2026, 8, 17))
    ];
    // 3 is ticked; 4 and 5 ride on it through the same employer and role tests the
    // one-posting-one-wave rule uses — the legal form and the location are dropped
    // before either is compared — and only then does the old Acme row follow.
    assert.strictEqual(
      S.outreachDueNow_(rows, friday3pm).map((r) => r.rowNumber).join(','), '3,4,5,2');
  });
  run('a tick does not reach an abbreviation the role matcher has never folded', () => {
    // "SWE Intern" and "Software Engineer Intern" share only the word intern, which
    // is a quarter of their words against a ROLE_MATCH of 0.6. This is not new here:
    // the one-posting-one-wave rule has always read them as two postings, and a tick
    // grouping them would be a second, looser idea of what one job is. Worth pinning
    // so it is a decision rather than a surprise the day somebody ticks the wrong one.
    const rows = [
      queued(2, 'Stripe', 'SWE Intern', day(2026, 8, 20)),
      queued(3, 'Stripe', 'Software Engineer Intern', day(2026, 8, 15), { priority: true })
    ];
    assert.strictEqual(
      S.outreachDueNow_(rows, friday3pm).map((r) => r.rowNumber).join(','), '3,2');
  });
  run('a tick does not lift a different role at the same company', () => {
    const rows = [
      queued(2, 'Acme', 'SWE Intern', day(2026, 6, 1)),
      queued(3, 'Stripe', 'Data Scientist Intern', day(2026, 8, 15)),
      queued(4, 'Stripe', 'SWE Intern', day(2026, 8, 16), { priority: true })
    ];
    assert.strictEqual(
      S.outreachDueNow_(rows, friday3pm).map((r) => r.rowNumber).join(','), '4,2,3');
  });
  run('a tick on a row that has already gone still lifts the ones behind it', () => {
    const rows = [
      qrow({ rowNumber: 2, company: 'Stripe', role: 'SWE Intern', status: 'Sent',
             sentAt: day(2026, 8, 3), priority: true }),
      queued(3, 'Acme', 'SWE Intern', day(2026, 6, 1)),
      queued(4, 'Stripe', 'SWE Intern', day(2026, 8, 20))
    ];
    assert.strictEqual(
      S.outreachDueNow_(rows, friday3pm).map((r) => r.rowNumber).join(','), '4,3');
  });
  run('within one tick group the oldest application still leads', () => {
    const rows = [
      queued(2, 'Stripe', 'SWE Intern', day(2026, 8, 20), { priority: true }),
      queued(3, 'Stripe', 'SWE Intern', day(2026, 7, 2))
    ];
    assert.strictEqual(
      S.outreachDueNow_(rows, friday3pm).map((r) => r.rowNumber).join(','), '3,2');
  });

  run('a tick does not make a row eligible before its wait is over', () => {
    const early = queued(2, 'Stripe', 'SWE Intern', day(2026, 8, 20), {
      priority: true, eligibleAt: day(2026, 9, 30)
    });
    assert.strictEqual(S.outreachDueNow_([early], friday3pm).length, 0);
  });
  run('a tick does not raise the day cap — it decides who gets the slots', () => {
    const rows = [];
    for (let i = 0; i < 30; i++) {
      rows.push(queued(i + 2, 'Stripe', 'SWE Intern', day(2026, 7, 21), { priority: true }));
    }
    // Friday caps at 10, and 15:00 leaves two writing firings: five, ticked or not.
    assert.strictEqual(S.outreachDueNow_(rows, friday3pm).length, 5);
  });
  run('a tick cannot send at the weekend', () => {
    const row = queued(2, 'Stripe', 'SWE Intern', day(2026, 7, 21), { priority: true });
    assert.strictEqual(S.outreachDueNow_([row], new Date(2026, 7, 22, 10)).length, 0);
  });

  run('the projection shows the tick, so the date on the row is the date it lands on', () => {
    const rows = [];
    for (let i = 0; i < 20; i++) rows.push(queued(i + 2, 'Acme', 'SWE Intern', day(2026, 6, 1)));
    rows.push(queued(30, 'Stripe', 'SWE Intern', day(2026, 8, 20), { priority: true }));
    const plan = S.outreachProjectSchedule_(rows, monday);
    // Twenty older rows against a Monday cap of 15 would have put Stripe on Tuesday.
    assert.strictEqual(plan[0].rowNumber, 30);
    assert.strictEqual(S.outreachDaysBetween_(monday, plan[0].sendAt), 0);
  });
  run('a ticked row that is not yet eligible is still projected for its own day', () => {
    const rows = [
      queued(2, 'Acme', 'SWE Intern', day(2026, 6, 1)),
      queued(3, 'Stripe', 'SWE Intern', day(2026, 8, 20),
             { priority: true, eligibleAt: day(2026, 8, 27) })
    ];
    const plan = S.outreachProjectSchedule_(rows, monday);
    const stripe = plan.filter((p) => p.rowNumber === 3)[0];
    assert.strictEqual(S.outreachDaysBetween_(day(2026, 8, 27), stripe.sendAt), 0);
  });

  run('TRUE, yes and x all count as ticked, because people type them', () => {
    ['TRUE', 'true', 'yes', 'Y', 'x', '1', true].forEach((value) => {
      assert.ok(S.outreachTicked_(value), JSON.stringify(value));
    });
  });
  run('an empty box, FALSE and stray text are not a tick', () => {
    ['', '  ', 'FALSE', 'false', 'no', 'later', null, undefined, false, 0].forEach((value) => {
      assert.ok(!S.outreachTicked_(value), JSON.stringify(value));
    });
  });
  run('Done reads as a tick, because a retired one still has to lift the queue', () => {
    ['Done', 'done', '  Done  '].forEach((v) => assert.ok(S.outreachTicked_(v), JSON.stringify(v)));
  });
  run('parsing keeps both the reading and the raw word', () => {
    const raw = new Array(S.Q_WIDTH).fill('');
    raw[S.Q_PRIORITY - 1] = 'Done';
    const parsed = S.outreachParseQueue_(raw, 0);
    assert.strictEqual(parsed.priority, true);
    assert.strictEqual(parsed.priorityText, 'Done');
  });
  run('a retired tick lifts the ones behind it exactly as the tick it replaced did', () => {
    // The same arrangement as the sent-tick test above, with the tick already
    // retired. This is the regression the word is capable of causing: read as
    // false, Stripe row 4 would fall behind the older Acme application.
    const rows = [
      qrow({ rowNumber: 2, company: 'Stripe', role: 'SWE Intern', status: 'Sent',
             sentAt: day(2026, 8, 3), priority: true, priorityText: 'Done' }),
      queued(3, 'Acme', 'SWE Intern', day(2026, 6, 1)),
      queued(4, 'Stripe', 'SWE Intern', day(2026, 8, 20))
    ];
    assert.strictEqual(
      S.outreachDueNow_(rows, friday3pm).map((r) => r.rowNumber).join(','), '4,3');
  });

  const gone = (over) => qrow(Object.assign({
    rowNumber: 2, company: 'Stripe', role: 'SWE Intern', status: 'Sent',
    sentAt: day(2026, 8, 3), priority: true, priorityText: 'TRUE'
  }, over || {}));

  run('a tick whose email has gone is retired to Done', () => {
    assert.strictEqual(S.outreachPrioritiesToRetire_([gone()]).length, 1);
  });
  run('Done is not written over Done on every firing', () => {
    assert.strictEqual(
      S.outreachPrioritiesToRetire_([gone({ priorityText: 'Done' })]).length, 0);
    assert.strictEqual(
      S.outreachPrioritiesToRetire_([gone({ priorityText: '  Done  ' })]).length, 0);
  });
  run('a tick still waiting to go stays a tick', () => {
    // Nothing has left a Queued or Drafted row, so the request is still live.
    ['Queued', 'Drafted'].forEach((status) => {
      assert.strictEqual(
        S.outreachPrioritiesToRetire_([gone({ status: status, sentAt: null })]).length, 0, status);
    });
  });
  run('a row nobody ticked is never marked Done', () => {
    // Done reads as ticked, so writing it here would enrol every sent row in the
    // priority groups — the feature inverted rather than extended.
    assert.strictEqual(
      S.outreachPrioritiesToRetire_([gone({ priority: false, priorityText: 'FALSE' })]).length, 0);
  });

  run('the tick is read off the last column of the row', () => {
    const row = new Array(S.Q_WIDTH).fill('');
    row[S.Q_PRIORITY - 1] = true;
    assert.strictEqual(S.outreachParseQueue_(row, 0).priority, true);
  });
  run('a row appended by the worker is unticked, not blank', () => {
    const values = S.outreachQueueRowValues_({
      id: 'P1-A1', property: '1', company: 'Acme', role: 'SWE Intern',
      dateApplied: day(2026, 8, 1), attempt: 1, status: 'Queued', mode: 'Send',
      fingerprint: 'abc', recruiters: 3
    });
    assert.strictEqual(values.length, S.Q_WIDTH);
    assert.strictEqual(values[S.Q_PRIORITY - 1], false);
  });
}

console.log('the Priority column opens itself, because the schema and the code move together');
{
  const header = (at10) => {
    const row = new Array(S.Q_WIDTH).fill('');
    row[9] = at10;
    return row;
  };
  run('a tab that already has the column is left alone', () => {
    assert.strictEqual(S.outreachPriorityColumnAction_(header('Priority')), 'ready');
  });
  run('a tab still on the old layout is migrated', () => {
    assert.strictEqual(S.outreachPriorityColumnAction_(header('Status')), 'insert');
  });
  run('a header nobody recognises is refused rather than shifted blind', () => {
    // Shifting a rearranged tab would put every row under the wrong name, and the
    // sender would then read Status out of whatever landed in column 11.
    assert.throws(() => S.outreachPriorityColumnAction_(header('Mode')), /"Mode"/);
    assert.throws(() => S.outreachPriorityColumnAction_(header('')), /""/);
    assert.throws(() => S.outreachPriorityColumnAction_([]), /""/);
  });
  run('surrounding whitespace in a header is not a different tab', () => {
    assert.strictEqual(S.outreachPriorityColumnAction_(header('  Priority ')), 'ready');
    assert.strictEqual(S.outreachPriorityColumnAction_(header(' Status')), 'insert');
  });
  run('the column it guards is the one left of Status', () => {
    assert.strictEqual(S.Q_PRIORITY, 10);
    assert.strictEqual(S.Q_STATUS, 11);
    // Priority and Status did not move when the follow-up columns were added;
    // everything to their right did, which is what Q_WIDTH is reporting here.
    assert.strictEqual(S.Q_WIDTH, 23);
  });
}

console.log('the table reads in the order things go out');
{
  const at = (y, m, d, h) => new Date(y, m - 1, d, h, 0, 0);
  const timed = (company, sched, drafted) => {
    const r = new Array(S.Q_WIDTH).fill('');
    r[0] = company;
    if (sched !== undefined) r[S.Q_SCHEDULED - 1] = sched;
    if (drafted !== undefined) r[S.Q_DRAFTED_AT - 1] = drafted;
    return r;
  };
  const order = (rows) => S.outreachTimeOrder_(rows).map((r) => r[0]);
  const called = (company, sched) => {
    const r = timed(company, sched);
    r[S.Q_STATUS - 1] = 'Cancelled';
    return r;
  };
  const withStatus = (company, sched, status) => {
    const r = timed(company, sched);
    r[S.Q_STATUS - 1] = status;
    return r;
  };

  run('a cancelled row sinks below the live ones, whatever hour it holds', () => {
    // Belvedere was cancelled holding noon, between two rows that still go out.
    assert.deepStrictEqual(order([
      timed('Optiver', at(2026, 8, 27, 13)),
      called('Belvedere', at(2026, 8, 27, 12)),
      timed('Citadel', at(2026, 8, 27, 11))
    ]), ['Citadel', 'Optiver', 'Belvedere']);
  });
  run('cancelled rows keep time order among themselves', () => {
    assert.deepStrictEqual(order([
      called('B', at(2026, 8, 27, 14)),
      timed('Live', at(2026, 8, 27, 15)),
      called('A', at(2026, 8, 27, 9))
    ]), ['Live', 'A', 'B']);
  });
  run('Sent stays on the timeline — its hour is a thing that happened', () => {
    assert.deepStrictEqual(order([
      withStatus('Later', at(2026, 8, 27, 16), 'Queued'),
      withStatus('Sent', at(2026, 8, 27, 9), 'Sent')
    ]), ['Sent', 'Later']);
  });
  run('Failed stays on the timeline too — it was really attempted then', () => {
    assert.deepStrictEqual(order([
      withStatus('Later', at(2026, 8, 27, 16), 'Queued'),
      withStatus('Failed', at(2026, 8, 27, 9), 'Failed')
    ]), ['Failed', 'Later']);
  });
  run('a cancelled row with no hour sits at the very bottom', () => {
    assert.deepStrictEqual(order([
      called('Cancelled', undefined),
      timed('Untimed', undefined),
      timed('Live', at(2026, 8, 27, 10))
    ]), ['Live', 'Untimed', 'Cancelled']);
  });
  run('the block is a permutation — nothing is dropped or invented', () => {
    const rows = [
      timed('A', at(2026, 8, 27, 13)),
      called('B', at(2026, 8, 27, 12)),
      timed('C', at(2026, 8, 27, 11))
    ];
    const out = S.outreachTimeOrder_(rows);
    assert.strictEqual(out.length, rows.length);
    rows.forEach((r) => assert.ok(out.indexOf(r) !== -1));
  });
  const header = new Array(S.Q_WIDTH).fill('h');
  // Only what the sorter touches: the block below owns the fuller stub.
  const sheetOf = (rows) => {
    const seen = { written: null, writes: 0 };
    return {
      seen,
      getLastRow: () => rows.length,
      getRange: (r, c, nr) => ({
        getValues: () => rows.slice(r - 1, r - 1 + nr),
        setValues: (v) => { seen.written = v; seen.writes++; }
      })
    };
  };

  run('rows are filed by the hour they go out', () => {
    assert.deepStrictEqual(
      order([timed('C', at(2026, 9, 2, 15)), timed('A', at(2026, 8, 25, 10)),
             timed('B', at(2026, 8, 27, 9))]),
      ['A', 'B', 'C']);
  });
  run('an already sent row sits at its own hour, not where it was queued', () => {
    // Capital One went on the 25th but was appended after everything else.
    assert.deepStrictEqual(
      order([timed('Humana', at(2026, 9, 2, 9)), timed('Capital One', at(2026, 8, 25, 10))]),
      ['Capital One', 'Humana']);
  });
  run('Drafted At carries a row that has no Scheduled At yet', () => {
    assert.deepStrictEqual(
      order([timed('later', at(2026, 9, 2, 9)),
             timed('earlier', undefined, at(2026, 8, 25, 9))]),
      ['earlier', 'later']);
  });
  run('a row with no time at all sinks, and keeps its neighbours in order', () => {
    assert.deepStrictEqual(
      order([timed('cancelled'), timed('also cancelled'), timed('real', at(2026, 9, 2, 9))]),
      ['real', 'cancelled', 'also cancelled']);
  });
  run('rows sharing an hour keep the order they arrived in', () => {
    const h = at(2026, 9, 2, 9);
    assert.deepStrictEqual(
      order([timed('one', h), timed('two', h), timed('three', h)]),
      ['one', 'two', 'three']);
  });
  run('a table already in order is left exactly as it is', () => {
    const rows = [timed('A', at(2026, 8, 25, 9)), timed('B', at(2026, 8, 26, 9))];
    const out = S.outreachTimeOrder_(rows);
    assert.strictEqual(out[0], rows[0]);
    assert.strictEqual(out[1], rows[1]);
  });
  run('nothing is written when nothing moved', () => {
    const sheet = sheetOf([header, timed('A', at(2026, 8, 25, 9)),
                           timed('B', at(2026, 8, 26, 9))]);
    assert.strictEqual(S.outreachSortQueueByTime_(sheet), 0);
    assert.strictEqual(sheet.seen.writes, 0);
  });
  run('an out-of-order table is rewritten once, in order', () => {
    const sheet = sheetOf([header, timed('late', at(2026, 9, 2, 9)),
                           timed('early', at(2026, 8, 25, 9))]);
    assert.strictEqual(S.outreachSortQueueByTime_(sheet), 2);
    assert.strictEqual(sheet.seen.writes, 1);
    assert.deepStrictEqual(sheet.seen.written.map((r) => r[0]), ['early', 'late']);
  });
  run('a table too short to have an order is left alone', () => {
    const sheet = sheetOf([header, timed('only', at(2026, 8, 25, 9))]);
    assert.strictEqual(S.outreachSortQueueByTime_(sheet), 0);
    assert.strictEqual(sheet.seen.writes, 0);
  });
}

console.log('a tick is answered when it is made, not an hour later');
{
  // getColumn is the first column of the edited block and getLastColumn the last,
  // which is how paste and fill-down arrive.
  const edit = (col, lastCol, row, lastRow) => ({
    getColumn: () => col,
    getLastColumn: () => lastCol === undefined ? col : lastCol,
    getLastRow: () => lastRow === undefined ? row : lastRow
  });
  const touches = (tab, range) => S.outreachEditTouchesPriority_(tab, range);

  run('ticking a Priority cell on a data row is worth reprojecting', () => {
    assert.ok(touches('Email', edit(S.Q_PRIORITY, S.Q_PRIORITY, 5)));
  });
  run('an edit one column either side of Priority is not', () => {
    assert.ok(!touches('Email', edit(S.Q_STATUS, S.Q_STATUS, 5)));
    assert.ok(!touches('Email', edit(S.Q_PRIORITY - 1, S.Q_PRIORITY - 1, 5)));
  });
  run('the same cell on another tab is not', () => {
    assert.ok(!touches('App', edit(S.Q_PRIORITY, S.Q_PRIORITY, 5)));
    assert.ok(!touches('Jobs', edit(S.Q_PRIORITY, S.Q_PRIORITY, 5)));
  });
  run('the header is not a data row, so renaming the column reprojects nothing', () => {
    assert.ok(!touches('Email', edit(S.Q_PRIORITY, S.Q_PRIORITY, 1, 1)));
  });
  // A paste across the row covers Priority without starting or ending on it, which
  // an equality test would miss.
  run('a paste spanning the row counts, because it covers Priority', () => {
    assert.ok(touches('Email', edit(1, S.Q_WIDTH, 2, 40)));
  });
  run('a paste that stops short of Priority does not', () => {
    assert.ok(!touches('Email', edit(1, S.Q_PRIORITY - 1, 2, 40)));
  });
  // Fill-down from the header downwards still reaches data rows.
  run('a block starting at the header but reaching data rows counts', () => {
    assert.ok(touches('Email', edit(S.Q_PRIORITY, S.Q_PRIORITY, 1, 9)));
  });
}

console.log('the table stays one block — no gap between the rows and the new ones');
{
  const H = new Array(S.Q_WIDTH).fill('h');
  const full = (company) => { const r = new Array(S.Q_WIDTH).fill(''); r[0] = company; return r; };
  // A blank row wearing checkbox validation: Sheets counts it as content for
  // getLastRow, which is the whole bug, but the cells themselves are empty.
  const blank = () => new Array(S.Q_WIDTH).fill('');
  // The result objects carry the vm realm's prototype, so compare shape as text.
  const gaps = (rows) => JSON.stringify(S.outreachQueueGaps_(rows));

  run('a table with no gap is left alone', () => {
    assert.strictEqual(gaps([H, full('Acme'), full('Stripe')]), '[]');
  });
  run('the block between the old rows and the appended ones is found, as sheet rows', () => {
    // header, Acme(2), Stripe(3), blank(4), blank(5), Capital One(6)
    assert.strictEqual(
      gaps([H, full('Acme'), full('Stripe'), blank(), blank(), full('Capital One')]),
      '[{"start":4,"count":2}]');
  });
  run('blank rows below the last real row are not touched — the sheet may keep spares', () => {
    assert.strictEqual(gaps([H, full('Acme'), blank(), blank()]), '[]');
  });
  run('several gaps come back bottom-up, so deleting them in order stays correct', () => {
    assert.strictEqual(
      gaps([H, full('A'), blank(), full('B'), blank(), blank(), full('C')]),
      '[{"start":5,"count":2},{"start":3,"count":1}]');
  });
  run('an unticked box is not content — it is what a blank row wearing one reads as', () => {
    // Sheets returns false, not '', for a checkbox cell nobody has touched. Reading
    // that as content is what made the first version of this find no gap and do
    // nothing at all, so it is pinned here rather than left to be rediscovered.
    const box = new Array(S.Q_WIDTH).fill('');
    box[S.Q_PRIORITY - 1] = false;
    assert.ok(!S.outreachRowHasContent_(box));
    assert.ok(!S.outreachRowHasContent_(blank()));
  });
  run('a ticked box is content, so a row somebody marked is never deleted', () => {
    const box = new Array(S.Q_WIDTH).fill('');
    box[S.Q_PRIORITY - 1] = true;
    assert.ok(S.outreachRowHasContent_(box));
  });
  run('the gap is found even when every blank row wears an unticked box', () => {
    const boxed = () => { const r = new Array(S.Q_WIDTH).fill(''); r[S.Q_PRIORITY - 1] = false; return r; };
    assert.strictEqual(
      gaps([H, full('Acme'), boxed(), boxed(), full('Capital One')]),
      '[{"start":3,"count":2}]');
  });
  run('an empty table has no gaps rather than one enormous one', () => {
    assert.strictEqual(gaps([H]), '[]');
    assert.strictEqual(gaps([H, blank(), blank()]), '[]');
  });
  // The live Email tab sat like this for days. refreshOutreachSchedule rewrites
  // Recruiters across every row getLastRow admits to, so each blank row in the gap
  // carried a literal 0. 0 === false is false, so the emptiness test read all eight
  // hundred and seventy of them as occupied and the repair found nothing to do.
  run('a zero left by the recruiter count is not content', () => {
    const zeroed = new Array(S.Q_WIDTH).fill('');
    zeroed[S.Q_RECRUITERS - 1] = 0;
    assert.ok(!S.outreachRowHasContent_(zeroed));
  });
  run('the gap is found when every blank row carries a zero and an unticked box', () => {
    const stamped = () => {
      const r = new Array(S.Q_WIDTH).fill('');
      r[S.Q_RECRUITERS - 1] = 0;
      r[S.Q_PRIORITY - 1] = false;
      return r;
    };
    assert.strictEqual(
      gaps([H, full('Acme'), stamped(), stamped(), stamped(), full('Goldman Sachs')]),
      '[{"start":3,"count":3}]');
  });
  // A sheet stub thin enough to be obviously right: it records what was deleted
  // and what was dressed, and splices its own rows so a deletion is visible to the
  // call that follows it.
  const fakeQueue = (rows) => {
    const calls = { deleted: [], formatted: [], validated: [], rules: [] };
    const sheet = {
      getLastRow: () => rows.length,
      getRange(r, c, nr) {
        return {
          getColumn: () => c,
          getValues: () => rows.slice(r - 1, r - 1 + nr),
          setDataValidation(v) { calls.validated.push([c, nr, v]); return this; },
          setNumberFormat(f) { calls.formatted.push([c, nr, f]); return this; }
        };
      },
      deleteRows(start, count) {
        calls.deleted.push([start, count]);
        rows.splice(start - 1, count);
      },
      getConditionalFormatRules: () => calls.rules,
      setConditionalFormatRules(next) { calls.rules = next; }
    };
    return { sheet, calls, rows };
  };
  S.SpreadsheetApp.newDataValidation = () => {
    const spec = { kind: null, list: null };
    const b = {
      requireCheckbox() { spec.kind = 'checkbox'; return b; },
      requireValueInList(list) { spec.kind = 'list'; spec.list = list; return b; },
      setAllowInvalid(v) { spec.allowInvalid = v; return b; },
      build: () => spec
    };
    return b;
  };
  S.SpreadsheetApp.newConditionalFormatRule = () => {
    const spec = { ranges: [] };
    const b = {
      whenTextEqualTo(t) { spec.text = t; return b; },
      setBackground(c) { spec.bg = c; return b; },
      setFontColor(c) { spec.fg = c; return b; },
      setRanges(r) { spec.ranges = r; return b; },
      build: () => ({ spec, getRanges: () => spec.ranges })
    };
    return b;
  };
  const stampedRow = () => {
    const r = new Array(S.Q_WIDTH).fill('');
    r[S.Q_RECRUITERS - 1] = 0;
    r[S.Q_PRIORITY - 1] = false;
    return r;
  };

  run('the gap is closed and what is left is dressed', () => {
    const q = fakeQueue([H, full('Acme'), stampedRow(), stampedRow(), full('Capital One')]);
    const removed = S.outreachRepairQueueLayout_(q.sheet);
    assert.strictEqual(removed, 2);
    assert.deepStrictEqual(q.calls.deleted, [[3, 2]]);
    assert.strictEqual(q.rows.length, 3);
    assert.strictEqual(q.rows[2][0], 'Capital One');
  });
  // Capital One and Goldman Sachs showed a date and no hour for days because the
  // only path that set the format was the one behind a deletion, and no deletion
  // was ever found. Dressing has to happen on a clean table too.
  run('rows are dressed even when there is no gap to close', () => {
    const q = fakeQueue([H, full('Acme'), full('Goldman Sachs')]);
    assert.strictEqual(S.outreachRepairQueueLayout_(q.sheet), 0);
    assert.deepStrictEqual(q.calls.deleted, []);
    const columns = q.calls.formatted.map((f) => f[0]).sort((a, b) => a - b);
    assert.strictEqual(columns.join(','), [S.Q_DATE_APPLIED, S.Q_DRAFTED_AT,
      S.Q_SCHEDULED, S.Q_FOLLOWUP_AT, S.Q_SENT_AT].sort((a, b) => a - b).join(','));
    const format = {};
    q.calls.formatted.forEach((f) => { format[f[0]] = f[2]; });
    // Four timestamps, Follow Up among them: the hour a reply is booked for is as
    // much a fact about it as the hour a cold email leaves at, and a bare date on
    // six rows reads as six replies at once.
    [S.Q_DRAFTED_AT, S.Q_SCHEDULED, S.Q_SENT_AT, S.Q_FOLLOWUP_AT].forEach((c) =>
      assert.strictEqual(format[c], S.QUEUE_TIMESTAMP_FORMAT));
    // A date, not a timestamp — but dressed all the same, because the sort moves
    // values between cells and the format stays behind with the cell.
    assert.strictEqual(format[S.Q_DATE_APPLIED], S.QUEUE_DATE_FORMAT);
    assert.ok(q.calls.validated.length > 0);
  });
  run('an appended row is dressed on the very next cycle', () => {
    const q = fakeQueue([H, full('Acme')]);
    S.outreachRepairQueueLayout_(q.sheet);
    q.rows.push(full('Goldman Sachs'));
    q.calls.formatted.length = 0;
    S.outreachRepairQueueLayout_(q.sheet);
    // Two data rows now, so every dressed range has to have grown to cover both.
    const heights = q.calls.formatted.map((f) => f[1]);
    assert.strictEqual(heights.length, 5);
    heights.forEach((h) => assert.strictEqual(h, 2));
  });

  run('Status and Mode are dressed as dropdowns, not left as bare text', () => {
    const q = fakeQueue([H, full('Acme'), full('Capital One')]);
    S.outreachRepairQueueLayout_(q.sheet);
    const byColumn = {};
    q.calls.validated.forEach(([c, nr, v]) => { byColumn[c] = [nr, v]; });
    assert.deepStrictEqual(byColumn[S.Q_STATUS][1].list, S.QUEUE_STATUSES);
    assert.deepStrictEqual(byColumn[S.Q_MODE][1].list, S.QUEUE_MODES);
    assert.deepStrictEqual(byColumn[S.Q_FOLLOWUP_STATUS][1].list, S.QUEUE_FOLLOWUP_STATUSES);
    // Two data rows, so the dropdown has to reach both of them.
    assert.strictEqual(byColumn[S.Q_STATUS][0], 2);
    assert.strictEqual(byColumn[S.Q_MODE][0], 2);
    assert.strictEqual(byColumn[S.Q_PRIORITY][1].kind, 'checkbox');
  });
  run('the dropdown offers exactly the statuses the sender can write', () => {
    // Compared as text: arrays built inside the vm carry that realm's prototype.
    assert.strictEqual(JSON.stringify(S.QUEUE_STATUSES), JSON.stringify([
      S.STATUS_QUEUED, S.STATUS_DRAFTED, S.STATUS_SENT, S.STATUS_REPLIED,
      S.STATUS_BOUNCED, S.STATUS_CANCELLED, S.STATUS_FAILED]));
    assert.strictEqual(JSON.stringify(S.QUEUE_MODES),
                       JSON.stringify([S.MODE_DRAFT, S.MODE_SEND]));
    assert.strictEqual(JSON.stringify(S.QUEUE_FOLLOWUP_STATUSES), JSON.stringify([
      S.FOLLOWUP_QUEUED, S.FOLLOWUP_DRAFTED, S.FOLLOWUP_SENT,
      S.FOLLOWUP_SKIPPED, S.FOLLOWUP_STOPPED, S.FOLLOWUP_FAILED]));
    const offered = S.QUEUE_STATUSES.concat(S.QUEUE_MODES)
                                    .concat(S.QUEUE_FOLLOWUP_STATUSES);
    S.QUEUE_STATUS_COLOURS.concat(S.QUEUE_MODE_COLOURS)
                          .concat(S.QUEUE_FOLLOWUP_COLOURS).forEach((entry) => {
      assert.ok(offered.indexOf(entry.name) !== -1,
        entry.name + ' is painted but is not a value the dropdown offers');
    });
  });
  run('the colour rules are rebuilt over the rows that exist', () => {
    const q = fakeQueue([H, full('Acme'), full('Capital One')]);
    S.outreachRepairQueueLayout_(q.sheet);
    const columns = q.calls.rules.map((r) => r.getRanges()[0].getColumn());
    assert.strictEqual(columns.filter((c) => c === S.Q_STATUS).length,
                       S.QUEUE_STATUS_COLOURS.length);
    assert.strictEqual(columns.filter((c) => c === S.Q_MODE).length,
                       S.QUEUE_MODE_COLOURS.length);
    assert.strictEqual(columns.filter((c) => c === S.Q_FOLLOWUP_STATUS).length,
                       S.QUEUE_FOLLOWUP_COLOURS.length);
    // Run twice: the rules are replaced, never stacked.
    S.outreachRepairQueueLayout_(q.sheet);
    assert.strictEqual(q.calls.rules.length, S.QUEUE_STATUS_COLOURS.length
      + S.QUEUE_MODE_COLOURS.length + S.QUEUE_FOLLOWUP_COLOURS.length);
  });
  run('a real row whose company has zero recruiters is still a real row', () => {
    const r = full('Acme');
    r[S.Q_RECRUITERS - 1] = 0;
    r[S.Q_PRIORITY - 1] = false;
    assert.ok(S.outreachRowHasContent_(r));
  });
}

console.log('written an hour early, so there is an hour to read it in');
{
  const at = (h) => new Date(2026, 7, 24, h, 0, 0);      // Monday 24 Aug 2026
  const row = (over) => qrow(Object.assign({
    rowNumber: 2, status: 'Drafted', mode: 'Send', draftId: 'draft-1',
    scheduledAt: at(10), sentAt: null
  }, over));

  run('a draft whose hour has come is sent', () => {
    assert.strictEqual(S.outreachDraftsToSend_([row({})], at(10)).length, 1);
  });
  run('a draft whose hour has not come waits', () => {
    assert.strictEqual(S.outreachDraftsToSend_([row({})], at(9)).length, 0);
  });
  run('a row still Queued is not sent — it has not been written yet', () => {
    assert.strictEqual(S.outreachDraftsToSend_([row({ status: 'Queued' })], at(11)).length, 0);
  });
  run('a row whose Mode is Draft is written but never sent on its own', () => {
    assert.strictEqual(S.outreachDraftsToSend_([row({ mode: 'Draft' })], at(11)).length, 0);
  });
  run('a draft with no id cannot be sent, and is not guessed at', () => {
    assert.strictEqual(S.outreachDraftsToSend_([row({ draftId: '' })], at(11)).length, 0);
  });
  run('an already sent row is not sent twice', () => {
    assert.strictEqual(
      S.outreachDraftsToSend_([row({ status: 'Sent', sentAt: at(10) })], at(11)).length, 0);
  });
  run('an application closed during that hour has its draft thrown away', () => {
    // outreachDraftsToSend_ still offers it — the row says Drafted and its hour
    // has come. sendPreparedDrafts is what re-reads App and refuses, so this is
    // the check that the two halves are not the same question.
    assert.strictEqual(S.outreachDraftsToSend_([row({})], at(10)).length, 1);
    assert.ok(!S.outreachStillQualifies_(app('1', 'Acme', 'r', day(2026, 8, 1), 'Rejected')).ok);
    assert.ok(!S.outreachStillQualifies_(undefined).ok);
  });
  run('deleting the draft in Gmail is what calls a send off', () => {
    // The selector still offers it; sendPreparedDrafts finds no draft behind the
    // id and marks the row Cancelled. That is the whole review mechanism.
    assert.strictEqual(S.outreachDraftsToSend_([row({})], at(12)).length, 1);
  });

  run('the hour a draft leaves in is the top of the hour, not the minute it was written', () => {
    // The trigger fires at a minute Google picks. Scheduling for exactly one hour
    // after an 12:05 write puts the target at 13:05, which a 13:03 firing arrives
    // before — so the row waits until 14:03 with nothing on it saying why.
    const written = new Date(2026, 7, 24, 12, 5, 30);
    const goes = S.outreachSendHourAfter_(written);
    assert.strictEqual(goes.getHours(), 13);
    assert.strictEqual(goes.getMinutes(), 0);
    assert.strictEqual(goes.getSeconds(), 0);
  });
  run('a firing that arrives early in the hour still sends what that hour is for', () => {
    const goes = S.outreachSendHourAfter_(new Date(2026, 7, 24, 12, 5, 30));
    const firing = new Date(2026, 7, 24, 13, 2, 0);
    assert.strictEqual(S.outreachDraftsToSend_([row({ scheduledAt: goes })], firing).length, 1);
  });
  run('the last minute of an hour still leaves in the next one, not the one after', () => {
    const goes = S.outreachSendHourAfter_(new Date(2026, 7, 24, 12, 59, 0));
    assert.strictEqual(goes.getHours(), 13);
  });

  run('the global switch holds a row back even when its own Mode says Send', () => {
    // This is the rollout switch. It was read only where drafts were written, so
    // it changed the wording of the Result column and let every Send row go.
    assert.strictEqual(S.outreachDraftsToSend_([row({})], at(11), 'Draft').length, 0);
    assert.strictEqual(S.outreachDraftsToSend_([row({})], at(11), 'Send').length, 1);
    assert.strictEqual(S.outreachDraftsToSend_([row({})], at(11), '').length, 1);
  });
  run('the global switch can only be more cautious than the row, never less', () => {
    assert.strictEqual(S.outreachDraftsToSend_([row({ mode: 'Draft' })], at(11), 'Send').length, 0);
  });
}

console.log('a draft spends the day the same as a send');
{
  const queued = (n) => qrow({
    rowNumber: n, status: 'Queued', sentAt: null, dateApplied: day(2026, 7, 21),
    eligibleAt: day(2026, 8, 1)
  });
  const drafted = (n, when) => qrow({
    rowNumber: n, status: 'Drafted', sentAt: null, scheduledAt: when,
    dateApplied: day(2026, 7, 21)
  });
  const friday = new Date(2026, 7, 21, 16);   // caps at 10, the last writing firing

  run('drafts made today come off the day allowance', () => {
    const rows = [queued(2)];
    for (let i = 0; i < 10; i++) rows.push(drafted(i + 3, day(2026, 8, 21)));
    assert.strictEqual(S.outreachDueNow_(rows, friday).length, 0);
  });
  run('drafts from another day do not', () => {
    const rows = [queued(2)];
    for (let i = 0; i < 10; i++) rows.push(drafted(i + 3, day(2026, 8, 14)));
    assert.strictEqual(S.outreachDueNow_(rows, friday).length, 1);
  });
  run('a draft with no slot recorded cannot be counted, and is not guessed at', () => {
    const rows = [queued(2), drafted(3, null)];
    assert.strictEqual(S.outreachDueNow_(rows, friday).length, 1);
  });
}

console.log('when each queued row is expected to go out');
{
  const queued = (n, applied, eligible) => qrow({
    rowNumber: n, status: 'Queued', sentAt: null,
    dateApplied: applied, eligibleAt: eligible || applied
  });
  // Monday 24 Aug 2026. Caps run Mon 15, Tue 25, Wed 22, Thu 18, Fri 10, weekend 0.
  const monday = day(2026, 8, 24);

  run('a day of rows all land on the first day that has room', () => {
    const rows = [];
    for (let i = 0; i < 10; i++) rows.push(queued(i + 2, day(2026, 7, 21)));
    const plan = S.outreachProjectSchedule_(rows, monday);
    assert.strictEqual(plan.length, 10);
    plan.forEach((p) => assert.strictEqual(S.outreachDaysBetween_(monday, p.sendAt), 0));
  });
  run('what does not fit today spills onto the next weekday', () => {
    const rows = [];
    for (let i = 0; i < 20; i++) rows.push(queued(i + 2, day(2026, 7, 21)));
    const plan = S.outreachProjectSchedule_(rows, monday);
    const onMonday = plan.filter((p) => S.outreachDaysBetween_(monday, p.sendAt) === 0);
    assert.strictEqual(onMonday.length, 15);
    assert.strictEqual(plan.length - onMonday.length, 5);
  });
  run('the weekend is skipped rather than filled', () => {
    const rows = [];
    for (let i = 0; i < 120; i++) rows.push(queued(i + 2, day(2026, 7, 21)));
    const plan = S.outreachProjectSchedule_(rows, monday);
    plan.forEach((p) => assert.ok(p.sendAt.getDay() !== 0 && p.sendAt.getDay() !== 6));
  });
  run('a row not yet eligible is not projected before it may go', () => {
    const rows = [queued(2, day(2026, 8, 20), day(2026, 8, 27))];
    const plan = S.outreachProjectSchedule_(rows, monday);
    assert.strictEqual(S.outreachDaysBetween_(day(2026, 8, 27), plan[0].sendAt), 0);
  });
  run('a row that is eligible passes one that is not, rather than waiting behind it', () => {
    const rows = [
      queued(2, day(2026, 7, 21), day(2026, 9, 30)),
      queued(3, day(2026, 8, 10), day(2026, 8, 12))
    ];
    const plan = S.outreachProjectSchedule_(rows, monday);
    assert.strictEqual(plan[0].rowNumber, 3);
  });
  run('the oldest application is projected first', () => {
    const rows = [queued(2, day(2026, 8, 15)), queued(3, day(2026, 7, 21))];
    assert.strictEqual(S.outreachProjectSchedule_(rows, monday)[0].rowNumber, 3);
  });
  run('what has already gone today comes off the first day', () => {
    const rows = [];
    for (let i = 0; i < 20; i++) rows.push(queued(i + 2, day(2026, 7, 21)));
    for (let i = 0; i < 15; i++) rows.push(qrow({ status: 'Sent', sentAt: monday }));
    const plan = S.outreachProjectSchedule_(rows, monday);
    assert.strictEqual(plan.filter((p) => S.outreachDaysBetween_(monday, p.sendAt) === 0).length, 0);
  });
  run('rows already sent or replied are not projected at all', () => {
    const rows = [qrow({ status: 'Sent', sentAt: day(2026, 8, 1) }), qrow({ status: 'Replied' })];
    assert.strictEqual(S.outreachProjectSchedule_(rows, monday).length, 0);
  });
}

console.log('which rows spend a contact for good');
{
  const people = [contact('Acme', 'A One', 'a@acme.com')];
  const print = S.outreachFingerprint_('a@acme.com', SALT);
  const planWith = (status) => S.outreachPlanEnqueue_(
    [app('9', 'Acme', 'SWE Intern', day(2026, 8, 1))],
    [qrow({ rowNumber: 2, property: '8', company: 'Acme', status, fingerprint: print })],
    people, day(2026, 8, 21), SALT
  );

  ['Sent', 'Replied', 'Bounced', 'Queued', 'Drafted'].forEach((status) => {
    run('a ' + status + ' row means that person is never written to again', () => {
      assert.strictEqual(planWith(status).planned.length, 0);
    });
  });
  ['Cancelled', 'Failed'].forEach((status) => {
    run('a ' + status + ' row hands the address back — nothing ever reached them', () => {
      const out = planWith(status);
      assert.strictEqual(out.planned.length, 1);
      assert.strictEqual(out.planned[0].fingerprint, print);
    });
  });
}

console.log('a reply does not call off the rest');
{
  const today = day(2026, 8, 21);
  run('the other people at that company are still written to', () => {
    const out = S.outreachAttemptsWanted_(app('1', 'A', 'r', day(2026, 8, 1)),
      [qrow({ attempt: 1, status: 'Replied', sentAt: day(2026, 8, 5) })], 3, 3, 5, today);
    assert.strictEqual(out.count, 2);
    assert.strictEqual(out.from, 2);
  });
  run('but the person who replied is never written to again', () => {
    const people = [contact('Acme', 'A One', 'a@acme.com')];
    const print = S.outreachFingerprint_('a@acme.com', SALT);
    const out = S.outreachPlanEnqueue_(
      [app('9', 'Acme', 'SWE Intern', day(2026, 8, 1))],
      [qrow({ rowNumber: 2, property: '8', company: 'Acme', status: 'Replied', fingerprint: print })],
      people, today, SALT);
    assert.strictEqual(out.planned.length, 0);
  });
  run('what does stop everything is Process leaving the qualifying set', () => {
    assert.ok(!S.outreachStillQualifies_(app('1', 'A', 'r', day(2026, 8, 1), 'Rejected')).ok);
  });
}

console.log('the last check before Gmail is touched');
{
  run('an application rejected since it was queued is cancelled, not sent', () => {
    const out = S.outreachStillQualifies_(app('1', 'A', 'r', day(2026, 8, 1), 'Rejected'));
    assert.ok(!out.ok);
    assert.match(out.why, /Process is now Rejected/);
  });
  run('an application that advanced past Applied is cancelled too', () => {
    assert.ok(!S.outreachStillQualifies_(app('1', 'A', 'r', day(2026, 8, 1), 'OA')).ok);
  });
  run('a deleted App row cancels rather than throwing', () => {
    assert.match(S.outreachStillQualifies_(null).why, /has gone/);
  });
  run('an untouched application still qualifies', () => {
    assert.ok(S.outreachStillQualifies_(app('1', 'A', 'r', day(2026, 8, 1), 'Applied')).ok);
  });
  run('an application that finished its assessment while queued still goes', () => {
    // The one direction a Process change does not cancel: the row was queued under
    // Applied, and by the time it is drafted the assessment is done. Cancelling
    // there would drop exactly the email worth sending.
    assert.ok(S.outreachStillQualifies_(app('1', 'A', 'r', day(2026, 8, 1), 'Completed OA')).ok);
  });
  run('an OA still owed cancels a row queued before it arrived', () => {
    const out = S.outreachStillQualifies_(app('1', 'A', 'r', day(2026, 8, 1), 'OA'));
    assert.ok(!out.ok);
    assert.match(out.why, /Process is now OA/);
  });

  run('only the two qualifying stages qualify, and a stray space is forgiven', () => {
    assert.ok(S.outreachQualifies_('Applied'));
    assert.ok(S.outreachQualifies_('Completed OA'));
    assert.ok(S.outreachQualifies_('  Completed OA '));
    ['OA', 'Interview', 'Offer', 'Rejected', '', null, undefined].forEach((value) => {
      assert.ok(!S.outreachQualifies_(value), String(value));
    });
  });
  run('a spelling the dropdown cannot produce is not guessed at', () => {
    // Column F is locked to the list, so anything else reached the sheet by some
    // other route. Sending is the irreversible half of this system: fall through
    // to "does not qualify" rather than decide what the writer meant.
    assert.ok(!S.outreachQualifies_('completed oa'));
    assert.ok(!S.outreachQualifies_('Completed  OA'));
    assert.ok(!S.outreachQualifies_('OA Completed'));
  });

  run('the global switch can hold a Send row back to a draft', () => {
    assert.strictEqual(S.outreachModeFor_('Send', 'Draft'), 'Draft');
  });
  run('the global switch can never promote a Draft row into a send', () => {
    assert.strictEqual(S.outreachModeFor_('Draft', 'Send'), 'Draft');
    assert.strictEqual(S.outreachModeFor_('Draft', ''), 'Draft');
  });
  run('with the switch unset, the row decides', () => {
    assert.strictEqual(S.outreachModeFor_('Send', ''), 'Send');
  });

  run('the fingerprint round-trips back to the contact it came from', () => {
    const people = [contact('Acme', 'A One', 'a@acme.com'), contact('Acme', 'B Two', 'b@acme.com')];
    const print = S.outreachFingerprint_('b@acme.com', SALT);
    assert.strictEqual(S.outreachContactByFingerprint_(people, print, SALT).name, 'B Two');
  });
  run('a fingerprint whose contact has been deleted resolves to nothing', () => {
    assert.strictEqual(S.outreachContactByFingerprint_([], 'deadbeef', SALT), null);
  });
}

console.log('the two tabs are reconciled, not just the ones a rejection email closed');
{
  run('a hand-ticked Rejected cancels the rows the email scanner never saw', () => {
    // Belvedere Trading, 24 August 2026. Marked Rejected by hand because the
    // refusal went to nguyen15@kenyon.edu, which this project cannot read; three
    // days later its three rows were still Queued with a send time each.
    const apps = [app('84', 'Belvedere Trading', 'SWE Intern', day(2026, 8, 17), 'Rejected')];
    const rows = [
      qrow({ rowNumber: 10, property: '84', company: 'Belvedere Trading', status: 'Queued' }),
      qrow({ rowNumber: 11, property: '84', company: 'Belvedere Trading', status: 'Queued' }),
      qrow({ rowNumber: 12, property: '84', company: 'Belvedere Trading', status: 'Queued' })
    ];
    const stale = S.outreachStaleQueueRows_(apps, rows);
    assert.strictEqual(stale.length, 3);
    assert.strictEqual(stale[0].process, 'Rejected');
    assert.strictEqual(stale[0].company, 'Belvedere Trading');
  });
  run('a Drafted row is stale too — its message is already written', () => {
    const apps = [app('1', 'Acme', 'r', day(2026, 8, 1), 'Rejected')];
    const stale = S.outreachStaleQueueRows_(apps, [qrow({ status: 'Drafted' })]);
    assert.strictEqual(stale.length, 1);
  });
  run('an open application is left alone', () => {
    const apps = [app('1', 'Acme', 'r', day(2026, 8, 1), 'Applied')];
    assert.strictEqual(S.outreachStaleQueueRows_(apps, [qrow({ status: 'Queued' })]).length, 0);
  });
  run('Completed OA still qualifies, so its queue survives', () => {
    const apps = [app('1', 'Acme', 'r', day(2026, 8, 1), 'Completed OA')];
    assert.strictEqual(S.outreachStaleQueueRows_(apps, [qrow({ status: 'Queued' })]).length, 0);
  });
  run('a row already Sent is history and is not rewritten', () => {
    const apps = [app('1', 'Acme', 'r', day(2026, 8, 1), 'Rejected')];
    assert.strictEqual(S.outreachStaleQueueRows_(apps, [qrow({ status: 'Sent' })]).length, 0);
  });
  run('a Cancelled row is not cancelled a second time', () => {
    const apps = [app('1', 'Acme', 'r', day(2026, 8, 1), 'Rejected')];
    assert.strictEqual(S.outreachStaleQueueRows_(apps, [qrow({ status: 'Cancelled' })]).length, 0);
  });
  run('a queue row whose application has left the tab is left alone', () => {
    // It cannot send either — outreachStillQualifies_ refuses on a missing row —
    // and a row absent this minute is as easily a half-finished edit as a deletion.
    assert.strictEqual(S.outreachStaleQueueRows_([], [qrow({ status: 'Queued' })]).length, 0);
  });
  run('a blank property does not match every other blank property', () => {
    const apps = [app('', '', '', null, 'Rejected')];
    assert.strictEqual(
      S.outreachStaleQueueRows_(apps, [qrow({ property: '', status: 'Queued' })]).length, 0);
  });
  run('only the closed application loses its rows', () => {
    const apps = [
      app('84', 'Belvedere Trading', 'r', day(2026, 8, 17), 'Rejected'),
      app('85', 'Optiver', 'r', day(2026, 8, 18), 'Applied')
    ];
    const rows = [
      qrow({ rowNumber: 10, property: '84', status: 'Queued' }),
      qrow({ rowNumber: 11, property: '85', status: 'Queued' })
    ];
    const stale = S.outreachStaleQueueRows_(apps, rows);
    assert.strictEqual(stale.length, 1);
    assert.strictEqual(stale[0].property, '84');
  });
}

console.log('intakes — one recruiter, one email per season, and not in the same month');
{
  const SUMMER = S.SEASON_SUMMER, OFFCYCLE = S.SEASON_OFFCYCLE;

  run('a role naming any season but Summer is off-cycle', () => {
    ['Software Engineer Intern - Winter 2027', 'SWE Intern (Spring 2027)',
     '2027 Winter Technology Internship', 'SWE Intern - Fall 2027',
     'Autumn 2027 Engineering Intern'].forEach((role) => {
      assert.strictEqual(S.outreachSeason_(role), OFFCYCLE, role);
    });
  });
  run('every named off-season shares one bucket, so nobody hears from us three times', () => {
    const fall = S.outreachFingerprint_('a@acme.com', SALT, S.outreachSeason_('Fall 2027 Intern'));
    const winter = S.outreachFingerprint_('a@acme.com', SALT, S.outreachSeason_('Winter 2027 Intern'));
    assert.strictEqual(fall, winter);
  });
  run('every other role is Summer, including one that never names a season', () => {
    ['Software Engineer Intern', 'Software Engineer Intern - Summer 2027', '', null]
      .forEach((role) => assert.strictEqual(S.outreachSeason_(role), SUMMER, String(role)));
  });
  run('the season is matched as a whole word, so Wintergreen is not an intake', () => {
    assert.strictEqual(S.outreachSeason_('Wintergreen Labs Engineering Intern'), SUMMER);
  });

  run('Summer hashes to exactly what it did before intakes existed', () => {
    assert.strictEqual(
      S.outreachFingerprint_('a@acme.com', SALT, SUMMER),
      S.outreachFingerprint_('a@acme.com', SALT));
  });
  run('off-cycle is a different bucket for the same person', () => {
    assert.notStrictEqual(
      S.outreachFingerprint_('a@acme.com', SALT, OFFCYCLE),
      S.outreachFingerprint_('a@acme.com', SALT, SUMMER));
  });

  // The pair that used to be folded into one wave. 0.67 overlap, well past
  // ROLE_MATCH, and only the intake tells them apart.
  const winter = app('1', 'Acme', 'Software Engineer Intern - Winter 2027', day(2026, 8, 1));
  const summer = app('2', 'Acme', 'Software Engineer Intern - Summer 2027', day(2026, 8, 2));
  const people = [contact('Acme', 'A One', 'a@acme.com', { angle: 'x' })];

  run('the two intakes read as one posting by words alone', () => {
    assert.ok(S.outreachSameRole_(
      S.outreachRoleTokens_(winter.role), S.outreachRoleTokens_(summer.role)));
  });
  run('but they are planned as two waves, not one', () => {
    const four = ['a', 'b', 'c', 'd'].map(
      (n) => contact('Acme', n, n + '@acme.com', { angle: 'x' }));
    const plan = S.outreachPlanEnqueue_([winter, summer], [], four, day(2026, 8, 27), SALT);
    assert.ok(!plan.skipped.some((r) => /already being written about/.test(r.why)),
      JSON.stringify(Array.from(plan.skipped).map((r) => r.why)));
    // Winter is older, so it takes the full wave of three; Summer opens with the
    // one contact left under the weekly cap of five.
    const byProperty = Array.from(plan.planned).map((r) => r.property);
    assert.deepStrictEqual(Array.from(byProperty).sort().join(''), '1112');
  });
  run('two Summer applications to one employer are still one wave', () => {
    const other = app('3', 'Acme', 'Software Engineering Internship 2027', day(2026, 8, 3));
    const plan = S.outreachPlanEnqueue_([summer, other], [], people, day(2026, 8, 27), SALT);
    assert.strictEqual(plan.planned.length, 1);
    assert.ok(/already being written about/.test(plan.skipped[0].why), plan.skipped[0].why);
  });

  const written = (sentAt, role) => qrow({
    property: '9', role: role, status: 'Sent', sentAt: sentAt,
    fingerprint: S.outreachFingerprint_('a@acme.com', SALT, S.outreachSeason_(role))
  });

  run('the same recruiter is written to a second time for the other intake', () => {
    const plan = S.outreachPlanEnqueue_(
      [winter], [written(day(2026, 7, 1), 'SWE Intern - Summer 2027')],
      people, day(2026, 8, 27), SALT);
    assert.strictEqual(plan.planned.length, 1);
    assert.strictEqual(plan.planned[0].fingerprint,
      S.outreachFingerprint_('a@acme.com', SALT, OFFCYCLE));
  });
  run('but not inside the 25-day gap since the first one landed', () => {
    const plan = S.outreachPlanEnqueue_(
      [winter], [written(day(2026, 8, 10), 'SWE Intern - Summer 2027')],
      people, day(2026, 8, 27), SALT);
    assert.strictEqual(plan.planned.length, 0);
    assert.ok(/25-day gap/.test(plan.skipped[0].why), plan.skipped[0].why);
  });
  run('the gap is measured from the send, and 25 days exactly is enough', () => {
    const on = (d) => S.outreachPlanEnqueue_(
      [winter], [written(day(2026, 8, 2), 'SWE Intern - Summer 2027')], people, d, SALT
    ).planned.length;
    assert.strictEqual(on(day(2026, 8, 26)), 0);
    assert.strictEqual(on(day(2026, 8, 27)), 1);
  });
  run('a row that has not gone out yet blocks outright — there is no date to count from', () => {
    const queued = qrow({
      property: '9', role: 'SWE Intern - Summer 2027', status: 'Queued', sentAt: null,
      fingerprint: S.outreachFingerprint_('a@acme.com', SALT, SUMMER)
    });
    assert.strictEqual(
      S.outreachPlanEnqueue_([winter], [queued], people, day(2026, 8, 27), SALT).planned.length, 0);
  });
  run('and the same intake is still permanent, however long ago it was', () => {
    assert.strictEqual(S.outreachPlanEnqueue_(
      [summer], [written(day(2020, 1, 1), 'SWE Intern - Summer 2027')],
      people, day(2026, 8, 27), SALT).planned.length, 0);
  });

  run('a bounce in one intake closes that person in the other too', () => {
    const dead = qrow({
      property: '9', role: 'SWE Intern - Summer 2027', status: 'Bounced',
      sentAt: day(2026, 1, 1),
      fingerprint: S.outreachFingerprint_('a@acme.com', SALT, SUMMER)
    });
    const plan = S.outreachPlanEnqueue_([winter], [dead], people, day(2026, 8, 27), SALT);
    assert.strictEqual(plan.planned.length, 0);
  });
  run('and so does a reply — there is a conversation to have instead', () => {
    const answered = qrow({
      property: '9', role: 'SWE Intern - Summer 2027', status: 'Replied',
      sentAt: day(2026, 1, 1),
      fingerprint: S.outreachFingerprint_('a@acme.com', SALT, SUMMER)
    });
    assert.strictEqual(S.outreachPlanEnqueue_(
      [winter], [answered], people, day(2026, 8, 27), SALT).planned.length, 0);
  });
  run('a cancelled row hands the person back to both intakes', () => {
    const called = qrow({
      property: '9', role: 'SWE Intern - Summer 2027', status: 'Cancelled',
      sentAt: null, fingerprint: S.outreachFingerprint_('a@acme.com', SALT, SUMMER)
    });
    assert.strictEqual(S.outreachPlanEnqueue_(
      [winter], [called], people, day(2026, 8, 27), SALT).planned.length, 1);
  });

  run('a tick on Winter does not lift the employer\'s Summer rows', () => {
    const rows = [
      qrow({ rowNumber: 2, property: '1', role: 'SWE Intern - Winter 2027',
             priority: true, dateApplied: day(2026, 8, 20) }),
      qrow({ rowNumber: 3, property: '2', role: 'SWE Intern - Summer 2027',
             priority: false, dateApplied: day(2026, 8, 1) })
    ];
    assert.strictEqual(S.outreachOrderForSending_(rows, rows)[0].property, '1');
    assert.ok(!S.outreachPrioritised_(rows[1], S.outreachPriorityGroups_(rows)));
  });
}

console.log('a Role corrected by hand reaches the tabs that repeat it');
{
  const SUMMER = S.SEASON_SUMMER, OFFCYCLE = S.SEASON_OFFCYCLE;
  const range = (col, lastCol, row) => ({
    getColumn: () => col, getLastColumn: () => lastCol, getLastRow: () => row
  });

  run('an edit on the Role column of App is answered', () => {
    assert.ok(S.outreachEditTouchesRole_('App', range(7, 7, 5)));
  });
  run('a paste across the row still counts, as long as it covers Role', () => {
    assert.ok(S.outreachEditTouchesRole_('App', range(1, 11, 5)));
  });
  run('another column, another tab, or the header row is not', () => {
    assert.ok(!S.outreachEditTouchesRole_('App', range(6, 6, 5)));
    assert.ok(!S.outreachEditTouchesRole_('Email', range(7, 7, 5)));
    assert.ok(!S.outreachEditTouchesRole_('App', range(7, 7, 1)));
  });

  run('the matching Property is found in Alphabet_Order, wherever it sits', () => {
    const values = [['Property', 'Company'], ['205', 'AbbVie'], ['9', 'Akuna']];
    assert.strictEqual(S.outreachRowForProperty_(values, '9', 1), 3);
    assert.strictEqual(S.outreachRowForProperty_(values, '404', 1), 0);
    assert.strictEqual(S.outreachRowForProperty_(values, '', 1), 0);
  });

  const people = [contact('Acme', 'A One', 'a@acme.com')];
  const summerPrint = S.outreachFingerprint_('a@acme.com', SALT, SUMMER);
  const offcyclePrint = S.outreachFingerprint_('a@acme.com', SALT, OFFCYCLE);
  const plan = (rows, role) => S.outreachRolePlan_(rows, '1', role, people, SALT);

  run('the Role text is copied onto the queue row', () => {
    const out = plan([qrow({ property: '1', role: 'SWE Intern', status: 'Sent',
                            fingerprint: summerPrint })], 'SWE Intern - Winter 2027');
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].updates[S.Q_ROLE], 'SWE Intern - Winter 2027');
  });
  run('a row that has not gone out moves bucket with it', () => {
    const out = plan([qrow({ property: '1', role: 'SWE Intern', status: 'Queued',
                            fingerprint: summerPrint })], 'SWE Intern - Winter 2027');
    assert.strictEqual(out[0].updates[S.Q_FINGERPRINT], offcyclePrint);
  });
  run('a row already sent keeps its fingerprint — that is history', () => {
    const out = plan([qrow({ property: '1', role: 'SWE Intern', status: 'Sent',
                            fingerprint: summerPrint })], 'SWE Intern - Winter 2027');
    assert.strictEqual(out[0].updates[S.Q_FINGERPRINT], undefined);
  });
  run('rows of other applications are not touched', () => {
    const out = plan([qrow({ property: '2', role: 'SWE Intern', status: 'Queued',
                            fingerprint: summerPrint })], 'SWE Intern - Winter 2027');
    assert.strictEqual(out.length, 0);
  });
  run('an edit that changes nothing writes nothing', () => {
    const out = plan([qrow({ property: '1', role: 'SWE Intern - Winter 2027',
                            status: 'Queued', fingerprint: offcyclePrint })],
                     'SWE Intern - Winter 2027');
    assert.strictEqual(out.length, 0);
  });
  run('a fingerprint whose contact has gone keeps the Role change and nothing else', () => {
    const out = plan([qrow({ property: '1', role: 'SWE Intern', status: 'Queued',
                            fingerprint: 'deadbeef' })], 'SWE Intern - Winter 2027');
    assert.strictEqual(out[0].updates[S.Q_ROLE], 'SWE Intern - Winter 2027');
    assert.strictEqual(out[0].updates[S.Q_FINGERPRINT], undefined);
  });
  run('the contact lookup survives a Role edit, whichever bucket the row holds', () => {
    assert.strictEqual(
      S.outreachContactByFingerprint_(people, offcyclePrint, SALT).email, 'a@acme.com');
    assert.strictEqual(
      S.outreachContactByFingerprint_(people, summerPrint, SALT).email, 'a@acme.com');
  });
}

console.log('the Season tab — which employers are going to want a second wave');
{
  const contacts = [contact('Acme', 'A One', 'a@acme.com'), contact('Acme', 'B Two', 'b@acme.com')];
  const rows = (apps) => S.outreachSeasonReport_(apps, contacts);

  run('an employer nobody can be written to is left out — the tab is for planning waves', () => {
    const out = S.outreachSeasonReport_(
      [app('1', 'Nowhere', 'SWE Intern - Winter 2027', day(2026, 8, 1))], contacts);
    assert.strictEqual(out.length, 0);
  });
  run('an employer with no off-cycle row is not in the report at all', () => {
    assert.strictEqual(rows([app('1', 'Acme', 'SWE Intern - Summer 2027', day(2026, 8, 1))]).length, 0);
  });
  run('one Winter row is enough, with no Summer row yet', () => {
    const out = rows([app('1', 'Acme', 'SWE Intern - Winter 2027', day(2026, 8, 1))]);
    assert.strictEqual(out.length, 1);
    assert.deepStrictEqual(Array.from(out[0]).slice(0, 3), ['Acme', 1, 0]);
    assert.ok(/still to come/.test(out[0][3]), out[0][3]);
  });
  run('both intakes present are reported as both', () => {
    const out = rows([
      app('1', 'Acme', 'SWE Intern - Winter 2027', day(2026, 8, 1)),
      app('2', 'Acme', 'SWE Intern', day(2026, 8, 2))
    ]);
    assert.deepStrictEqual(Array.from(out[0]).slice(0, 4),
      ['Acme', 1, 1, 'Both intakes applied to']);
    assert.strictEqual(out[0][4], 'P1');
    assert.strictEqual(out[0][5], 'P2');
    assert.strictEqual(out[0][6], 2);
  });
  run('two spellings of one employer are one line, under the longer name', () => {
    const out = rows([
      app('1', 'Acme', 'SWE Intern - Winter 2027', day(2026, 8, 1)),
      app('2', 'Acme Technologies, Inc.', 'SWE Intern', day(2026, 8, 2))
    ]);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0][0], 'Acme Technologies, Inc.');
  });
  run('the roles are printed as written, so a lost season is visible', () => {
    const out = rows([
      app('1', 'Acme', 'SWE Intern - Winter 2027', day(2026, 8, 1)),
      app('2', 'Acme', '', day(2026, 8, 2))
    ]);
    assert.ok(/\(blank\)/.test(out[0][7]), out[0][7]);
  });
  run('the busiest employer is first', () => {
    const out = S.outreachSeasonReport_([
      app('1', 'Acme', 'SWE Intern - Winter 2027', day(2026, 8, 1)),
      app('2', 'Globex', 'SWE Intern - Winter 2027', day(2026, 8, 1)),
      app('3', 'Globex', 'SWE Intern', day(2026, 8, 2)),
      app('4', 'Globex', 'Data Intern', day(2026, 8, 3))
    ], contacts.concat([contact('Globex', 'G One', 'g@globex.com')]));
    assert.deepStrictEqual(Array.from(out).map((r) => r[0]), ['Globex', 'Acme']);
  });
}

console.log('how much Gmail is asked on each firing');
{
  const now = day(2026, 8, 21);
  const rows = [
    qrow({ rowNumber: 2, status: 'Sent', sentAt: day(2026, 8, 20) }),
    qrow({ rowNumber: 3, status: 'Sent', sentAt: day(2026, 6, 1) }),
    qrow({ rowNumber: 4, status: 'Queued', sentAt: null }),
    qrow({ rowNumber: 5, status: 'Replied', sentAt: day(2026, 8, 19) }),
    qrow({ rowNumber: 6, status: 'Sent', sentAt: null })
  ];
  const scanned = S.outreachRowsToScan_(rows, now).map((r) => r.rowNumber);
  run('a recent send is checked for a reply', () => {
    assert.ok(scanned.indexOf(2) !== -1);
  });
  run('a send from months ago is left alone — nobody answers those', () => {
    assert.ok(scanned.indexOf(3) === -1);
  });
  run('rows that never went out, or are already settled, cost no API call', () => {
    assert.ok(scanned.indexOf(4) === -1);
    assert.ok(scanned.indexOf(5) === -1);
    assert.ok(scanned.indexOf(6) === -1);
  });
  run('the work per firing is bounded by the window, not by the queue length', () => {
    const many = [];
    for (let i = 0; i < 500; i++) many.push(qrow({ rowNumber: i + 2, status: 'Sent', sentAt: day(2026, 1, 5) }));
    assert.strictEqual(S.outreachRowsToScan_(many, now).length, 0);
  });
}

console.log('follow-up — one reply per row, and only while nobody at the company has answered');
{
  const fup = (over) => Object.assign(qrow({
    messageId: 'm1', followUpAt: null, followUpTemplate: 0, followUpStatus: ''
  }), over);

  console.log('  the twenty templates');
  run('there are twenty, which is what the column number indexes into', () => {
    assert.strictEqual(S.FOLLOWUP_TEMPLATES.length, 20);
  });
  run('no two say the same thing, on either half', () => {
    const notes = new Set(S.FOLLOWUP_TEMPLATES.map((t) => t.note));
    const closes = new Set(S.FOLLOWUP_TEMPLATES.map((t) => t.close));
    assert.strictEqual(notes.size, 20);
    assert.strictEqual(closes.size, 20);
  });
  run('every one is short, and none of them uses a dash', () => {
    S.FOLLOWUP_TEMPLATES.forEach((t, i) => {
      assert.ok(t.note.split(/\s+/).length <= 25, 'note ' + (i + 1) + ' is long');
      assert.ok(!/[\u2014\u2013]/.test(t.note + t.close), 'template ' + (i + 1) + ' has a dash');
    });
  });
  run('the body is a greeting, one note, a wish and a name', () => {
    const body = S.outreachFollowUpBody_(1, 'Marianne Fournier');
    assert.ok(body.startsWith('Hi Marianne,'));
    assert.ok(body.indexOf(S.FOLLOWUP_TEMPLATES[0].note) !== -1);
    assert.ok(body.indexOf(S.FOLLOWUP_TEMPLATES[0].close) !== -1);
    assert.ok(body.trim().endsWith('Henry Nguyen'));
  });
  run('a nameless contact is still greeted, not left with a blank', () => {
    assert.ok(S.outreachFollowUpBody_(3, '').startsWith('Hi there,'));
  });
  run('a template number nothing wrote falls back rather than throwing', () => {
    assert.ok(S.outreachFollowUpBody_(0, 'A').indexOf(S.FOLLOWUP_TEMPLATES[0].note) !== -1);
    assert.ok(S.outreachFollowUpBody_(99, 'A').indexOf(S.FOLLOWUP_TEMPLATES[0].note) !== -1);
  });
  run('the number is 1-based, because a person reads that column', () => {
    for (let i = 0; i < 25; i++) {
      const n = S.outreachFollowUpTemplateFor_('Datadog', i);
      assert.ok(n >= 1 && n <= 20, 'got ' + n);
    }
  });
  run('three people at one employer get three different sentences', () => {
    const seen = new Set([0, 1, 2].map((i) => S.outreachFollowUpTemplateFor_('Samsara', i)));
    assert.strictEqual(seen.size, 3);
  });
  run('the same company and index always hands back the same number', () => {
    assert.strictEqual(S.outreachFollowUpTemplateFor_('Samsara Inc.', 1),
                       S.outreachFollowUpTemplateFor_('Samsara Inc.', 1));
  });

  console.log('  what earns one');
  const today = day(2026, 8, 27);
  run('a sent row that went quiet earns a follow-up', () => {
    assert.ok(S.outreachFollowUpEarns_(fup({ sentAt: day(2026, 8, 20) }), today).ok);
  });
  run('a bounced row does not, and neither does a replied or cancelled one', () => {
    ['Bounced', 'Replied', 'Cancelled', 'Failed', 'Queued', 'Drafted'].forEach((status) => {
      assert.ok(!S.outreachFollowUpEarns_(
        fup({ status, sentAt: day(2026, 8, 20) }), today).ok, status + ' earned one');
    });
  });
  run('a row with no thread to reply on is passed over', () => {
    assert.ok(!S.outreachFollowUpEarns_(
      fup({ sentAt: day(2026, 8, 20), messageId: '' }), today).ok);
  });
  run('a send too old to chase is passed over rather than chased late', () => {
    assert.ok(!S.outreachFollowUpEarns_(fup({ sentAt: day(2026, 7, 1) }), today).ok);
  });
  run('a row already decided about is never decided about twice', () => {
    ['Queued', 'Sent', 'Drafted', 'Skipped', 'Stopped', 'Failed'].forEach((state) => {
      assert.ok(!S.outreachFollowUpEarns_(
        fup({ sentAt: day(2026, 8, 20), followUpStatus: state }), today).ok, state);
    });
  });

  console.log('  the company-wide silence rule');
  const samsara = [
    fup({ rowNumber: 2, company: 'Samsara', sentAt: day(2026, 8, 20) }),
    fup({ rowNumber: 3, company: 'Samsara', sentAt: day(2026, 8, 20) }),
    fup({ rowNumber: 4, company: 'Samsara Inc.', status: 'Replied', sentAt: day(2026, 8, 20) })
  ];
  run('one reply at Samsara silences all three of its rows', () => {
    const plan = S.outreachPlanFollowUps_(samsara, today);
    assert.strictEqual(plan.booked.length, 0);
    assert.strictEqual(plan.skipped.length, 2);
  });
  run('a different employer is untouched by that reply', () => {
    const mixed = samsara.concat([
      fup({ rowNumber: 5, company: 'Datadog', sentAt: day(2026, 8, 20) })
    ]);
    const plan = S.outreachPlanFollowUps_(mixed, today);
    assert.strictEqual(plan.booked.map((b) => b.rowNumber).join(','), '5');
  });
  run('a booking already made comes off when the reply lands after it', () => {
    const booked = [
      fup({ rowNumber: 2, company: 'Samsara', sentAt: day(2026, 8, 20),
            followUpAt: day(2026, 8, 29), followUpTemplate: 4, followUpStatus: 'Queued' }),
      fup({ rowNumber: 3, company: 'Samsara', status: 'Replied', sentAt: day(2026, 8, 20) })
    ];
    const plan = S.outreachPlanFollowUps_(booked, today);
    assert.strictEqual(plan.stopped.map((s) => s.rowNumber).join(','), '2');
  });
  run('a booking comes off when its own row is cancelled or rejected', () => {
    ['Cancelled', 'Bounced', 'Replied', 'Failed'].forEach((status) => {
      const rows = [fup({ rowNumber: 2, company: 'Solo', status, sentAt: day(2026, 8, 20),
                          followUpAt: day(2026, 8, 29), followUpTemplate: 4,
                          followUpStatus: 'Queued' })];
      assert.strictEqual(S.outreachPlanFollowUps_(rows, today).stopped.length, 1, status);
    });
  });
  run('a follow-up already sent is not un-sent by a later reply', () => {
    const gone = [
      fup({ rowNumber: 2, company: 'Samsara', sentAt: day(2026, 8, 20),
            followUpAt: day(2026, 8, 26), followUpTemplate: 4, followUpStatus: 'Sent' }),
      fup({ rowNumber: 3, company: 'Samsara', status: 'Replied', sentAt: day(2026, 8, 20) })
    ];
    assert.strictEqual(S.outreachPlanFollowUps_(gone, today).stopped.length, 0);
  });
  run('containment is over whole words here too, so Data does not silence Datadog', () => {
    assert.ok(!S.outreachCompanyHasReply_(
      [fup({ company: 'Datadog', status: 'Replied' })], 'Data'));
  });

  console.log('  the five to ten day window, weekends included');
  run('the ordinary window opens five days after the send and shuts at ten', () => {
    const w = S.outreachFollowUpWindow_(day(2026, 8, 26), day(2026, 8, 27));
    assert.strictEqual(w.earliest.getDate(), 31);
    assert.strictEqual(w.latest.getDate(), 5);
  });
  run('a window that has already opened starts today, not in the past', () => {
    const w = S.outreachFollowUpWindow_(day(2026, 8, 20), day(2026, 8, 27));
    assert.strictEqual(S.outreachDaysBetween_(day(2026, 8, 27), w.earliest), 0);
    assert.strictEqual(w.latest.getDate(), 30);
  });
  run('a window that has already shut is replaced by a fresh one starting today', () => {
    const w = S.outreachFollowUpWindow_(day(2026, 8, 10), day(2026, 8, 27));
    assert.strictEqual(S.outreachDaysBetween_(day(2026, 8, 27), w.earliest), 0);
    assert.strictEqual(S.outreachDaysBetween_(day(2026, 8, 27), w.latest), 5);
  });
  run('a Saturday is a day a follow-up may land on', () => {
    assert.ok(S.outreachFollowUpDayAllowed_(day(2026, 8, 29)));
    assert.strictEqual(S.outreachDailyCap_(day(2026, 8, 29)), 0);
  });

  console.log('  spreading, so no one day carries a pile');
  run('the first day with room wins, rather than the emptiest', () => {
    const w = S.outreachFollowUpWindow_(day(2026, 8, 26), day(2026, 8, 27));
    const load = {};
    load[S.outreachDayKey_(day(2026, 8, 31))] = 2;
    assert.strictEqual(S.outreachFollowUpDay_(w, load).getDate(), 31);
  });
  run('a full day is stepped over', () => {
    const w = S.outreachFollowUpWindow_(day(2026, 8, 26), day(2026, 8, 27));
    const load = {};
    load[S.outreachDayKey_(day(2026, 8, 31))] = S.FOLLOWUP_DAILY_CAP;
    assert.strictEqual(S.outreachFollowUpDay_(w, load).getDate(), 1);
  });
  run('a full window is walked past, not overloaded', () => {
    // The live tab is what taught this. Overloading the emptiest day in the window
    // put eight and nine rows on seven of the first nine days, on a feature whose
    // whole point is that no day carries a pile.
    const w = S.outreachFollowUpWindow_(day(2026, 8, 26), day(2026, 8, 27));
    const load = {};
    load[S.outreachDayKey_(day(2026, 8, 31))] = S.FOLLOWUP_DAILY_CAP;
    for (let d = 1; d <= 5; d++) load[S.outreachDayKey_(day(2026, 9, d))] = S.FOLLOWUP_DAILY_CAP;
    const picked = S.outreachFollowUpDay_(w, load);
    assert.strictEqual(picked.getDate(), 6);
    // Past `latest`, but inside the 21-day ceiling, which is where past ends.
    assert.ok(picked.getTime() > w.latest.getTime());
    assert.ok(picked.getTime() <= w.ceiling.getTime());
  });
  run('the walk stops at the 21-day ceiling, and then the emptiest day takes it', () => {
    const w = S.outreachFollowUpWindow_(day(2026, 8, 26), day(2026, 8, 27));
    const load = {};
    for (let i = 0; i <= 30; i++) {
      load[S.outreachDayKey_(S.outreachAddDays_(day(2026, 8, 27), i))] = 99;
    }
    load[S.outreachDayKey_(day(2026, 9, 3))] = 7;
    const picked = S.outreachFollowUpDay_(w, load);
    assert.strictEqual(picked.getDate(), 3);
    assert.ok(picked.getTime() <= w.ceiling.getTime());
  });
  run('the ceiling is never behind the window it bounds', () => {
    // The replaced-window branch can put sent + 21 days in the past, and a ceiling
    // behind `latest` would leave the picker nowhere to walk.
    const w = S.outreachFollowUpWindow_(day(2026, 8, 10), day(2026, 8, 27));
    assert.ok(w.ceiling.getTime() >= w.latest.getTime());
  });
  run('seventy rows sent the same day never put more than the cap on one date', () => {
    // The size the live backlog actually was, and the case the first version of
    // the day picker got wrong: seventy rows into a nine-day horizon that holds
    // fifty-four. They have to spill forward, not upward.
    const rows = [];
    for (let i = 0; i < 70; i++) {
      rows.push(fup({ rowNumber: i + 2, company: 'Co' + i, sentAt: day(2026, 8, 26) }));
    }
    const plan = S.outreachPlanFollowUps_(rows, day(2026, 8, 27));
    assert.strictEqual(plan.booked.length, 70);
    const perDay = {};
    plan.booked.forEach((b) => {
      const key = S.outreachDayKey_(b.day);
      perDay[key] = (perDay[key] || 0) + 1;
    });
    Object.keys(perDay).forEach((key) => {
      assert.ok(perDay[key] <= S.FOLLOWUP_DAILY_CAP, 'one day got ' + perDay[key]);
    });
  });
  run('days already booked are counted, so a second run does not double up on them', () => {
    const rows = [
      fup({ rowNumber: 2, company: 'A', sentAt: day(2026, 8, 26),
            followUpAt: day(2026, 8, 31), followUpTemplate: 1, followUpStatus: 'Queued' }),
      fup({ rowNumber: 3, company: 'B', sentAt: day(2026, 8, 26) })
    ];
    const plan = S.outreachPlanFollowUps_(rows, day(2026, 8, 27));
    assert.strictEqual(plan.booked.length, 1);
    assert.strictEqual(plan.booked[0].rowNumber, 3);
  });
  run('two rows at one company booked together get two different templates', () => {
    const rows = [
      fup({ rowNumber: 2, company: 'Samsara', sentAt: day(2026, 8, 26) }),
      fup({ rowNumber: 3, company: 'Samsara', sentAt: day(2026, 8, 26) })
    ];
    const plan = S.outreachPlanFollowUps_(rows, day(2026, 8, 27));
    assert.notStrictEqual(plan.booked[0].template, plan.booked[1].template);
  });
  run('the oldest send takes the earliest day left', () => {
    const rows = [
      fup({ rowNumber: 2, company: 'New', sentAt: day(2026, 8, 24) }),
      fup({ rowNumber: 3, company: 'Old', sentAt: day(2026, 8, 18) })
    ];
    const plan = S.outreachPlanFollowUps_(rows, day(2026, 8, 27));
    assert.strictEqual(plan.booked[0].rowNumber, 3);
  });
  run('a row nothing has sent yet is not stamped with a word about follow-ups', () => {
    const plan = S.outreachPlanFollowUps_(
      [fup({ rowNumber: 2, status: 'Queued', sentAt: null })], today);
    assert.strictEqual(plan.skipped.length, 0);
    assert.strictEqual(plan.booked.length, 0);
  });
  run('planning twice changes nothing the second time', () => {
    const rows = [fup({ rowNumber: 2, company: 'A', sentAt: day(2026, 8, 26) })];
    const first = S.outreachPlanFollowUps_(rows, day(2026, 8, 27));
    rows[0].followUpAt = first.booked[0].day;
    rows[0].followUpTemplate = first.booked[0].template;
    rows[0].followUpStatus = 'Queued';
    const second = S.outreachPlanFollowUps_(rows, day(2026, 8, 27));
    assert.strictEqual(second.booked.length, 0);
    assert.strictEqual(second.stopped.length, 0);
    assert.strictEqual(second.skipped.length, 0);
  });

  console.log('  which of them go out on this firing');
  // A booked row now carries the hour as well as the day, so the fixtures do too.
  const slot = (y, m, d, h) => new Date(y, m - 1, d, h === undefined ? 9 : h, 0, 0);
  const booked = (n, when) => fup({
    rowNumber: n, company: 'C' + n, sentAt: day(2026, 8, 20),
    followUpAt: when, followUpTemplate: 1, followUpStatus: 'Queued'
  });
  const at = (h) => new Date(2026, 7, 27, h, 20, 0);
  run('nothing goes before the window opens or after it shuts', () => {
    const rows = [booked(2, slot(2026, 8, 27, S.FOLLOWUP_HOUR_FIRST))];
    assert.strictEqual(
      S.outreachFollowUpsDueNow_(rows, at(S.FOLLOWUP_HOUR_FIRST - 1)).length, 0);
    assert.strictEqual(
      S.outreachFollowUpsDueNow_(rows, at(S.FOLLOWUP_HOUR_LAST + 1)).length, 0);
  });
  run('the window is wider than the cold path at both ends', () => {
    // 08:00-19:00 against 10:00-17:00. Nothing waits an hour in Drafts here, so
    // the first and last firings are both firings a reply can leave on.
    assert.strictEqual(S.FOLLOWUP_HOUR_FIRST, 8);
    assert.strictEqual(S.FOLLOWUP_HOUR_LAST, 19);
    assert.ok(S.FOLLOWUP_HOUR_FIRST < S.SEND_HOUR_FIRST);
    assert.ok(S.FOLLOWUP_HOUR_LAST > S.SEND_HOUR_LAST);
  });
  run('the eight and the seven both send, where the cold path has neither', () => {
    [S.FOLLOWUP_HOUR_FIRST, S.FOLLOWUP_HOUR_LAST].forEach((h) => {
      const rows = [booked(2, slot(2026, 8, 27, h))];
      assert.strictEqual(S.outreachFollowUpsDueNow_(rows, at(h)).length, 1, 'hour ' + h);
    });
  });
  run('an hour still ahead is not due, even on the right day', () => {
    // This is the whole point of booking the hour: a row set for 14:00 is not a
    // row the 09:20 firing may send.
    const rows = [booked(2, slot(2026, 8, 27, 14))];
    assert.strictEqual(S.outreachFollowUpsDueNow_(rows, at(9)).length, 0);
    assert.strictEqual(S.outreachFollowUpsDueNow_(rows, at(14))[0].rowNumber, 2);
  });
  run('a missed day catches up one firing at a time, not all at once', () => {
    const rows = [];
    for (let i = 0; i < 6; i++) rows.push(booked(i + 2, slot(2026, 8, 26, 8 + i)));
    assert.ok(S.outreachFollowUpsDueNow_(rows, at(8)).length < 6);
  });
  run('a day already at its cap sends no more', () => {
    const rows = [];
    for (let i = 0; i < S.FOLLOWUP_DAILY_CAP; i++) {
      rows.push(Object.assign(booked(i + 2, slot(2026, 8, 27, 9)), { followUpStatus: 'Sent' }));
    }
    rows.push(booked(99, slot(2026, 8, 27, 9)));
    assert.strictEqual(S.outreachFollowUpsDueNow_(rows, at(15)).length, 0);
  });
  run('a day that was missed catches up rather than being dropped', () => {
    const rows = [booked(2, slot(2026, 8, 22, 9))];
    assert.strictEqual(S.outreachFollowUpsDueNow_(rows, at(11))[0].rowNumber, 2);
  });
  run('a day still ahead is left alone', () => {
    assert.strictEqual(
      S.outreachFollowUpsDueNow_([booked(2, slot(2026, 8, 30, 9))], at(11)).length, 0);
  });
  run('only Queued rows go; Sent, Stopped and Skipped are settled', () => {
    ['Sent', 'Stopped', 'Skipped', 'Failed', 'Drafted'].forEach((state) => {
      const row = Object.assign(booked(2, slot(2026, 8, 27, 9)), { followUpStatus: state });
      assert.strictEqual(S.outreachFollowUpsDueNow_([row], at(15)).length, 0, state);
    });
  });

  console.log('  the hour, booked with the day');
  run('a full day reaches both ends of the window, not just the morning', () => {
    // The failure this guards is the one that would come back if the follow-up
    // hours were ever switched to outreachSpreadHours_: six across twelve hours
    // filled from the front is 8,9,10,11,12,13 and an empty afternoon.
    const hours = S.outreachFollowUpHoursForDay_();
    assert.strictEqual(hours.length, S.FOLLOWUP_DAILY_CAP);
    assert.strictEqual(hours[0], S.FOLLOWUP_HOUR_FIRST);
    assert.strictEqual(hours[hours.length - 1], S.FOLLOWUP_HOUR_LAST);
  });
  run('the gaps between them are even, give or take the rounding', () => {
    const hours = S.outreachFollowUpHoursForDay_();
    const gaps = hours.slice(1).map((h, i) => h - hours[i]);
    assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, hours.join(','));
    assert.ok(Math.min(...gaps) >= 2, hours.join(','));
  });
  run('spacing one item puts it at the front, and never divides by zero', () => {
    assert.strictEqual(S.outreachSpaceHours_(1, 8, 19).join(','), '8');
    assert.strictEqual(S.outreachSpaceHours_(0, 8, 19).length, 0);
  });
  run('the cold path keeps its own distribution, which fills from the front', () => {
    // Fifteen across eight hours as 2,2,2,2,2,2,2,1 — the shape the comment in
    // outreachDraftHoursForDay_ promises, and not the one above.
    assert.strictEqual(S.outreachSpreadHours_(15, 9, 16).join(','),
                       '9,9,10,10,11,11,12,12,13,13,14,14,15,15,16');
  });
  run('no two rows on one day share an hour while the day is under its cap', () => {
    const hours = S.outreachFollowUpHoursForDay_();
    assert.strictEqual(new Set(hours).size, hours.length);
  });
  run('a saturated day puts the overflow on the last firing, not on a made-up hour', () => {
    const over = S.outreachFollowUpAt_(day(2026, 8, 27), S.FOLLOWUP_DAILY_CAP + 3);
    assert.strictEqual(over.getHours(), S.FOLLOWUP_HOUR_LAST);
  });
  run('six rows on one day get six different hours, in order', () => {
    const rows = [];
    for (let i = 0; i < S.FOLLOWUP_DAILY_CAP; i++) {
      rows.push(fup({ rowNumber: i + 2, company: 'Co' + i, sentAt: day(2026, 8, 24) }));
    }
    const plan = S.outreachPlanFollowUps_(rows, day(2026, 8, 27));
    const hours = plan.booked.map((b) => b.day.getHours());
    assert.strictEqual(new Set(hours).size, S.FOLLOWUP_DAILY_CAP);
    assert.strictEqual(hours.join(','), hours.slice().sort((a, b) => a - b).join(','));
  });
  run('a booking made before the hour existed is given one, and keeps its day', () => {
    const midnight = new Date(2026, 7, 29, 0, 0, 0);
    const rows = [];
    for (let i = 0; i < S.FOLLOWUP_DAILY_CAP; i++) {
      rows.push(fup({ rowNumber: i + 2, company: 'Co' + i, sentAt: day(2026, 8, 24),
                      followUpAt: midnight, followUpTemplate: 1, followUpStatus: 'Queued' }));
    }
    const plan = S.outreachPlanFollowUps_(rows, day(2026, 8, 27));
    assert.strictEqual(plan.rehoured.length, S.FOLLOWUP_DAILY_CAP);
    const hours = plan.rehoured.map((r) => r.day.getHours());
    assert.strictEqual(new Set(hours).size, S.FOLLOWUP_DAILY_CAP);
    hours.forEach((h) =>
      assert.ok(h >= S.FOLLOWUP_HOUR_FIRST && h <= S.FOLLOWUP_HOUR_LAST));
    // The day is what was decided; only the hour was missing.
    plan.rehoured.forEach((r) => assert.strictEqual(r.day.getDate(), 29));
  });
  run('a booking that already has an hour is left completely alone', () => {
    const rows = [fup({ rowNumber: 2, company: 'A', sentAt: day(2026, 8, 24),
                        followUpAt: slot(2026, 8, 29, 11), followUpTemplate: 1,
                        followUpStatus: 'Queued' })];
    assert.strictEqual(S.outreachPlanFollowUps_(rows, day(2026, 8, 27)).rehoured.length, 0);
  });
  run('a row the reply rule just called off is not given an hour on the way out', () => {
    const rows = [
      fup({ rowNumber: 2, company: 'Samsara', sentAt: day(2026, 8, 24),
            followUpAt: new Date(2026, 7, 29, 0, 0, 0), followUpTemplate: 1,
            followUpStatus: 'Queued' }),
      fup({ rowNumber: 3, company: 'Samsara', status: 'Replied', sentAt: day(2026, 8, 24) })
    ];
    const plan = S.outreachPlanFollowUps_(rows, day(2026, 8, 27));
    assert.strictEqual(plan.stopped.length, 1);
    assert.strictEqual(plan.rehoured.length, 0);
  });
  run('an hourless row shares its day with an houred one without colliding', () => {
    const rows = [
      fup({ rowNumber: 2, company: 'A', sentAt: day(2026, 8, 24),
            followUpAt: slot(2026, 8, 29, 9), followUpTemplate: 1, followUpStatus: 'Queued' }),
      fup({ rowNumber: 3, company: 'B', sentAt: day(2026, 8, 24),
            followUpAt: new Date(2026, 7, 29, 0, 0, 0), followUpTemplate: 2,
            followUpStatus: 'Queued' })
    ];
    const plan = S.outreachPlanFollowUps_(rows, day(2026, 8, 27));
    assert.strictEqual(plan.rehoured.length, 1);
    assert.notStrictEqual(plan.rehoured[0].day.getHours(), 9);
  });
  run('an hour already booked on a day is counted, so the next row takes the next one', () => {
    const rows = [
      fup({ rowNumber: 2, company: 'A', sentAt: day(2026, 8, 24),
            followUpAt: slot(2026, 8, 29, 9), followUpTemplate: 1, followUpStatus: 'Queued' }),
      fup({ rowNumber: 3, company: 'B', sentAt: day(2026, 8, 24) })
    ];
    const plan = S.outreachPlanFollowUps_(rows, day(2026, 8, 27));
    assert.strictEqual(plan.booked.length, 1);
    assert.notStrictEqual(plan.booked[0].day.getHours(), 9);
  });
}

console.log('the Email tab layout — where the three new columns sit, and how a tab reaches them');
{
  run('the follow-up columns sit immediately after Mode', () => {
    assert.strictEqual(S.Q_FOLLOWUP_AT, S.Q_MODE + 1);
    assert.strictEqual(S.Q_FOLLOWUP_TEMPLATE, S.Q_MODE + 2);
    assert.strictEqual(S.Q_FOLLOWUP_STATUS, S.Q_MODE + 3);
  });
  run('everything that used to follow Mode moved three to the right', () => {
    assert.strictEqual(S.Q_FINGERPRINT, 16);
    assert.strictEqual(S.Q_MESSAGE_ID, 18);
    assert.strictEqual(S.Q_VERSION, 23);
    assert.strictEqual(S.Q_WIDTH, 23);
  });
  const header = (at13) => {
    const row = new Array(S.Q_WIDTH).fill('');
    row[S.Q_FOLLOWUP_AT - 1] = at13;
    return row;
  };
  run('a tab that already has them is left alone', () => {
    assert.strictEqual(S.outreachFollowUpColumnsAction_(header('Follow Up')), 'ready');
  });
  run('a tab on the previous layout is migrated', () => {
    assert.strictEqual(S.outreachFollowUpColumnsAction_(header('Contact Fingerprint')), 'insert');
  });
  run('a header nobody recognises stops the run rather than shifting rows blind', () => {
    assert.throws(() => S.outreachFollowUpColumnsAction_(header('Something Else')));
    assert.throws(() => S.outreachFollowUpColumnsAction_(header('')));
  });
}

{
  console.log('\nreferral templates');

  const REFERRAL_SAMPLE = {
    personName: 'Priya Raman', personTitle: 'Software Engineer', company: 'Reddit',
    bucket: 'consumer', angle: 'Reddit opened Answers to everyone on Jul 30, 2026.',
    role: 'Software Engineering Intern, Summer 2027',
    dateApplied: day(2026, 8, 21), today: day(2026, 8, 28),
    jobLink: 'https://job-boards.greenhouse.io/reddit/jobs/7123456', attempt: 1
  };
  const referral = (extra) => {
    const options = {};
    Object.keys(REFERRAL_SAMPLE).forEach((k) => { options[k] = REFERRAL_SAMPLE[k]; });
    Object.keys(extra || {}).forEach((k) => { options[k] = extra[k]; });
    return S.outreachReferralCompose_(options);
  };

  run('four tiers of ten', () => {
    assert.strictEqual(S.REFERRAL_TIERS.join(','), 'peer,mid,senior,staff');
    S.REFERRAL_TIERS.forEach((tier) => {
      assert.strictEqual(S.REFERRAL_TEMPLATES[tier].length, 10, tier);
    });
  });

  run('every ask carries exactly one bolded request', () => {
    S.REFERRAL_TIERS.forEach((tier) => S.REFERRAL_TEMPLATES[tier].forEach((entry, i) => {
      const bolds = entry.ask.match(/\*\*.+?\*\*/g) || [];
      assert.strictEqual(bolds.length, 1, tier + ' #' + (i + 1) + ': ' + entry.ask);
    }));
  });

  // The recruiter email turns every dash arriving from ColdEmail into a full stop,
  // and nothing written by hand in this project has ever used one. A template that
  // did would be the only line in a message that reads as one long breath.
  run('no template uses a dash, and every one is ASCII', () => {
    S.REFERRAL_TIERS.forEach((tier) => S.REFERRAL_TEMPLATES[tier].forEach((entry, i) => {
      ['open', 'ask', 'offer', 'close'].forEach((field) => {
        const where = tier + ' #' + (i + 1) + '.' + field;
        assert.ok(!/[–—-]/.test(entry[field].replace(/\*\*/g, '')), where);
        assert.ok(!/[^\x20-\x7e]/.test(entry[field]), where);
      });
    }));
  });

  // Two people at one company always land on different indexes of the same tier,
  // so a repeat inside one tier is a repeat someone could actually receive.
  run('no two templates in one tier share any line', () => {
    S.REFERRAL_TIERS.forEach((tier) => {
      const seen = {};
      S.REFERRAL_TEMPLATES[tier].forEach((entry, i) => {
        ['open', 'ask', 'offer', 'close'].forEach((field) => {
          const key = field + '|' + entry[field];
          assert.ok(!seen[key], tier + ' #' + (i + 1) + ' repeats ' + seen[key]);
          seen[key] = '#' + (i + 1) + '.' + field;
        });
      });
    });
  });

  run('the title decides the tier, most senior word first', () => {
    assert.strictEqual(S.outreachReferralTier_('Senior Staff Software Engineer', ''), 'staff');
    assert.strictEqual(S.outreachReferralTier_('Principal Engineer', ''), 'staff');
    assert.strictEqual(S.outreachReferralTier_('Director of Software Engineering', ''), 'staff');
    assert.strictEqual(S.outreachReferralTier_('Sr. Software Engineer', ''), 'senior');
    assert.strictEqual(S.outreachReferralTier_('Lead Software Engineer', ''), 'senior');
    assert.strictEqual(S.outreachReferralTier_('Software Engineer', ''), 'mid');
    assert.strictEqual(S.outreachReferralTier_('Associate Software Engineer', ''), 'peer');
    assert.strictEqual(S.outreachReferralTier_('SWE Intern', ''), 'peer');
  });

  // ColdEmail's seniority column calls a Software Engineer II junior. Believing it
  // sent the new grad email to every II and III in the dataset, seventy people.
  run('a numbered title beats the seniority column that mislabels it', () => {
    assert.strictEqual(S.outreachReferralTier_('Software Engineer II', 'junior'), 'mid');
    assert.strictEqual(S.outreachReferralTier_('Software Engineer III', 'junior'), 'mid');
    assert.strictEqual(S.outreachReferralTier_('Software Engineer 3', 'junior'), 'mid');
    assert.strictEqual(S.outreachReferralTier_('Software Engineer I', ''), 'peer');
    assert.strictEqual(S.outreachReferralTier_('Software Engineer IV', ''), 'senior');
    // A named level still outranks a number in the same title.
    assert.strictEqual(S.outreachReferralTier_('Senior Software Engineer II', 'junior'), 'senior');
  });

  run('the seniority column is read only when the title settles nothing', () => {
    assert.strictEqual(S.outreachReferralTier_('Engineering', 'staff'), 'staff');
    assert.strictEqual(S.outreachReferralTier_('Engineering', 'senior'), 'senior');
    assert.strictEqual(S.outreachReferralTier_('Engineering', 'new_grad'), 'peer');
    assert.strictEqual(S.outreachReferralTier_('Engineering', ''), 'mid');
    assert.strictEqual(S.outreachReferralTier_('', ''), 'mid');
  });

  run('three people at one company get three templates and three bullet pairs', () => {
    const seen = [1, 2, 3].map((attempt) => referral({ attempt: attempt }));
    const templates = seen.map((one) => one.template);
    assert.strictEqual(new Set(templates).size, 3, templates.join(','));
    const subjects = seen.map((one) => one.subject);
    assert.strictEqual(new Set(subjects).size, 3, subjects.join(','));
    const pairs = [1, 2, 3].map((attempt) =>
      S.outreachReferralBullets_('consumer', attempt).join('|'));
    assert.strictEqual(new Set(pairs).size, 3);
  });

  run('two companies do not both start at template one', () => {
    const a = S.outreachReferralIndex_('Reddit', 1);
    const b = S.outreachReferralIndex_('Stripe', 1);
    assert.notStrictEqual(a, b);
    assert.ok(a >= 0 && a < 10 && b >= 0 && b < 10);
  });

  run('a bucket nobody recognises still gets two real bullets', () => {
    const pair = S.outreachReferralBullets_('', 1);
    assert.strictEqual(pair.length, 2);
    pair.forEach((line) => assert.ok(line && line.length > 20));
  });

  // A referral is a form with a job id in it. An email that names the role but not
  // the posting sends a willing reader off to find it, and that errand is where
  // the yes goes.
  run('the posting link is in both renderings', () => {
    const one = referral({});
    assert.ok(one.plain.indexOf(REFERRAL_SAMPLE.jobLink) !== -1);
    assert.ok(one.html.indexOf(REFERRAL_SAMPLE.jobLink) !== -1);
  });

  run('the job board title is shortened the same way the recruiter email does', () => {
    assert.ok(referral({}).plain.indexOf('Software Engineer Intern role at Reddit') !== -1);
  });

  run('a stale application drops its date and keeps its link', () => {
    const stale = referral({ dateApplied: day(2026, 1, 5) });
    assert.ok(stale.plain.indexOf('on Jan 5') === -1);
    assert.ok(stale.plain.indexOf(REFERRAL_SAMPLE.jobLink) !== -1);
  });

  run('a company with no angle still composes', () => {
    const bare = referral({ angle: '' });
    assert.ok(bare.plain.indexOf('Hi Priya,') === 0);
    assert.ok(bare.plain.indexOf('undefined') === -1);
    assert.ok(bare.plain.indexOf('Henry Nguyen') !== -1);
  });

  // Subjects are read on a phone, so the longest company and the longest role in
  // the dataset are the case that has to fit, not the average one.
  run('the subject fills in the company and the shortened role', () => {
    [['Reddit', 'Software Engineer Intern'],
     ['Activision Blizzard', 'Embedded Software Engineer Intern']].forEach((pair) => {
      for (let i = 0; i < 10; i++) {
        const subject = S.outreachReferralSubject_(i, pair[0], pair[1]);
        assert.ok(subject.indexOf('{') === -1, subject);
        assert.ok(subject.length <= 66, subject.length + ': ' + subject);
      }
    });
  });

  // The gradient the tiers exist for: the ask gets smaller as the reader gets more
  // senior, and only the top tier names the reach.
  run('only the staff tier admits it is reaching', () => {
    const admits = (entry) => /reach|presumptuous|long shot|out of my depth|bold note|nervy|stretch|aimed higher|below what usually|liberty|several levels/.test(entry.open);
    assert.strictEqual(S.REFERRAL_TEMPLATES.staff.filter(admits).length, 10);
    ['peer', 'mid', 'senior'].forEach((tier) => {
      assert.strictEqual(S.REFERRAL_TEMPLATES[tier].filter(admits).length, 0, tier);
    });
  });

  // Never a meeting. A call turns a two minute favour into a calendar item, and
  // the safe answer to a calendar item is silence.
  run('no template asks for anyone time on a call', () => {
    S.REFERRAL_TIERS.forEach((tier) => S.REFERRAL_TEMPLATES[tier].forEach((entry, i) => {
      const words = (entry.ask + ' ' + entry.offer).toLowerCase();
      ['chat', 'call', 'meeting', 'coffee', 'minutes of your'].forEach((banned) => {
        assert.ok(words.indexOf(banned) === -1, tier + ' #' + (i + 1) + ': ' + banned);
      });
    }));
  });
}


{
  console.log('\nreferral: which link may be put in front of somebody');

  const ATS = [
    'https://boards.greenhouse.io/stripe/jobs/1234567',
    'https://job-boards.greenhouse.io/reddit/jobs/7123456',
    'https://jobs.lever.co/mongodb/9f2b-441',
    'https://jobs.ashbyhq.com/openai/abc-123',
    'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/JR2001',
    'https://careers.smartrecruiters.com/Company/743999',
    'https://cisco.wd1.myworkdaysite.com/en-US/careers/job/R-1',
    'https://www.workatastartup.com/jobs/77123'
  ];
  const NOT_ATS = [
    'https://jobright.ai/jobs/info/68b0c1',
    'https://simplify.jobs/p/9f2b-441',
    'https://www.linkedin.com/jobs/view/4290001',
    'https://www.indeed.com/viewjob?jk=abc',
    'https://builtin.com/job/engineer/1234',
    'https://joinhandshake.com/jobs/8881'
  ];

  run('every applicant tracking system is accepted', () => {
    ATS.forEach((url) => assert.ok(S.outreachReferralLinkOk_(url, ''), url));
  });
  run('every aggregator is refused', () => {
    NOT_ATS.forEach((url) => assert.ok(!S.outreachReferralLinkOk_(url, ''), url));
  });

  // The employer's own careers site is the best link there is and no list will
  // ever hold them all, so the company's domain is what recognises one.
  run('the employer own domain is accepted, subdomains included', () => {
    assert.ok(S.outreachReferralLinkOk_('https://jobs.apple.com/en-us/details/200', 'apple.com'));
    assert.ok(S.outreachReferralLinkOk_('https://careers.google.com/jobs/results/91', 'google.com'));
    assert.ok(S.outreachReferralLinkOk_('https://stripe.com/jobs/listing/x/61', 'www.stripe.com'));
    // Somebody else's domain is still somebody else's.
    assert.ok(!S.outreachReferralLinkOk_('https://jobs.apple.com/en-us/details/200', 'google.com'));
  });

  // Without the dot this is a substring search, and "mygreenhouse.io" passes as
  // Greenhouse.
  run('a host that merely ends in the same letters is refused', () => {
    assert.ok(!S.outreachReferralLinkOk_('https://mygreenhouse.io/jobs/1', ''));
    assert.ok(!S.outreachReferralLinkOk_('https://notlever.co/jobs/1', ''));
    assert.ok(!S.outreachReferralLinkOk_('https://fakeapple.com/jobs/1', 'apple.com'));
  });

  run('anything that is not an https link is refused', () => {
    assert.ok(!S.outreachReferralLinkOk_('http://boards.greenhouse.io/stripe/jobs/1', ''));
    assert.ok(!S.outreachReferralLinkOk_('', ''));
    assert.ok(!S.outreachReferralLinkOk_('boards.greenhouse.io/stripe/jobs/1', ''));
    assert.ok(!S.outreachReferralLinkOk_(null, ''));
  });

  // What lands on the Jobs tab beside the row, so it has to say which kind of
  // wrong the link is: a Jobright redirect and an unknown host ask a person to do
  // two different things.
  run('a refused link says why, and an accepted one says nothing', () => {
    assert.strictEqual(S.outreachReferralLinkProblem_(ATS[0], ''), '');
    assert.strictEqual(S.outreachReferralLinkProblem_('', ''), 'no link');
    assert.ok(/aggregator link \(jobright\.ai\)/.test(
      S.outreachReferralLinkProblem_(NOT_ATS[0], '')));
    assert.strictEqual(S.outreachReferralLinkProblem_('http://boards.greenhouse.io/a/1', ''),
                       'not https');
    assert.strictEqual(S.outreachReferralLinkProblem_('nonsense', ''), 'not a link');
    assert.ok(/unrecognised host \(example\.com\)/.test(
      S.outreachReferralLinkProblem_('https://example.com/jobs/1', 'stripe.com')));
  });

  // Back on, and stricter than it was. The word alone was never enough: a title
  // can name two intakes, and the wrong one disqualifies it.
  // Naming no intake is not the same as naming the wrong one. "Software
  // Engineering Intern" at NVIDIA and "AI Builder Intern" at Scale AI are the
  // summer intake and neither says so; requiring the word threw both away for a
  // reason about how a heading was written rather than about which intake it was.
  run('a role that names no intake is the one that was applied to', () => {
    assert.strictEqual(S.REFERRAL_REQUIRE_SEASON, false);
    assert.ok(S.outreachReferralSeason_('Software Engineer Intern'));
    assert.ok(S.outreachReferralSeason_('AI Builder Intern'));
    assert.ok(S.outreachReferralSeason_('Software Engineer Intern, Summer 2027'));
    assert.ok(S.outreachReferralSeason_(''));
  });

  // Summer 2026 has already happened; Summer/Winter is not only the intake being
  // asked about. Either way the message is spent on something that cannot land.
  run('a summer that is the wrong summer is refused', () => {
    assert.ok(!S.outreachReferralSeason_('Software Engineering Intern - Summer 2026'));
    assert.ok(!S.outreachReferralSeason_('Summer/Winter 2027 Software Intern'));
    assert.ok(!S.outreachReferralSeason_('Summer or Spring 2027 Intern'));
    assert.ok(!S.outreachReferralSeason_('Summer and Fall 2027 Co-op'));
  });

  // Whole words throughout, or a company called Springer is a spring intake.
  run('the excluded words are words, not fragments', () => {
    assert.ok(S.outreachReferralSeason_('Summer 2027 Intern, Springer Nature'));
    assert.ok(S.outreachReferralSeason_('Summer 2027 Intern, Winterthur Group'));
  });

}

{
  console.log('\nreferral: which application, and who at that company');

  const appRow = (company, role, link, applied, official, process) => {
    const row = new Array(S.APP_READ_WIDTH).fill('');
    row[S.APP_COMPANY - 1] = company;
    row[S.APP_ROLE - 1] = role;
    row[S.APP_LINK - 1] = link || '';
    row[S.APP_DATE_APPLIED - 1] = applied || '';
    row[S.APP_OFFICIAL - 1] = official || '';
    row[S.APP_PROCESS - 1] = process || 'Applied';
    return row;
  };
  const application = (company, role, link, applied, official, process) =>
    S.outreachParseApplication_(
      appRow(company, role, link, applied, official, process), 2, () => 'stripe.com');

  const GH = 'https://boards.greenhouse.io/stripe/jobs/';

  // Somebody typed the Official link deliberately, and the only reason to type one
  // over a link that already works is knowing something the row does not say.
  run('Official beats Application Link, and rescues an aggregator row', () => {
    assert.strictEqual(
      application('Stripe', 'SWE Intern', GH + '1', '', GH + '2').link, GH + '2');
    assert.strictEqual(
      application('Stripe', 'SWE Intern', 'https://jobright.ai/jobs/info/9', '', GH + '2').link,
      GH + '2');
    assert.strictEqual(
      application('Stripe', 'SWE Intern', 'https://jobright.ai/jobs/info/9', '', '').link, '');
  });

  // Asking somebody to spend their credibility on a req that already turned you
  // down is the one version of this email that cannot lead anywhere, and the one
  // most likely to be mentioned to the recruiter who sent the rejection.
  run('a rejected application is not one to ask a favour about', () => {
    assert.ok(S.outreachReferralLive_(application('Stripe', 'x', GH + '1', '', '', 'Applied')));
    assert.ok(S.outreachReferralLive_(application('Stripe', 'x', GH + '1', '', '', 'Interview')));
    assert.ok(!S.outreachReferralLive_(application('Stripe', 'x', GH + '1', '', '', 'Rejected')));
  });

  // Recency decides, and it used to be the other way round. Intuit kept being asked
  // about its older application because the shortener recognised that heading and
  // not the newer one's.
  run('the most recent application is the one chosen', () => {
    const rows = [
      application('Stripe', 'Data Science Intern, Summer 2027', GH + '1', new Date(2026, 7, 26)),
      application('Stripe', 'Software Engineer Intern, Summer 2027', GH + '2', new Date(2026, 7, 20)),
      application('Stripe', 'Product Design Intern, Summer 2027', GH + '3', new Date(2026, 7, 27))
    ];
    assert.strictEqual(S.outreachPickReferralRole_(rows).link, GH + '3');
  });

  // How squarely a title reads as a software engineering internship is the tie
  // break, not the first key: two applications made on one day.
  run('and the title decides only between applications made the same day', () => {
    const day = new Date(2026, 7, 27);
    const rows = [
      application('Stripe', 'Product Design Intern, Summer 2027', GH + '1', day),
      application('Stripe', 'Software Engineer Intern, Summer 2027', GH + '2', day)
    ];
    assert.strictEqual(S.outreachPickReferralRole_(rows).link, GH + '2');
  });
  run('between two software applications the most recent wins', () => {
    const rows = [
      application('Stripe', 'Software Engineer Intern, Summer 2027', GH + '1', new Date(2026, 7, 20)),
      application('Stripe', 'Software Engineering Intern, Summer 2027', GH + '2', new Date(2026, 7, 26))
    ];
    assert.strictEqual(S.outreachPickReferralRole_(rows).link, GH + '2');
  });
  run('an application with no usable link is never the one chosen', () => {
    const rows = [
      application('Stripe', 'Software Engineer Intern, Summer 2027', 'https://jobright.ai/jobs/info/9'),
      application('Stripe', 'Data Intern, Summer 2027', GH + '2')
    ];
    assert.strictEqual(S.outreachPickReferralRole_(rows).link, GH + '2');
  });
  run('a company whose only application was rejected picks nothing', () => {
    assert.strictEqual(S.outreachPickReferralRole_(
      [application('Stripe', 'SWE Intern', GH + '1', '', '', 'Rejected')]), null);
    assert.strictEqual(S.outreachPickReferralRole_([]), null);
  });

  // A colour that appears on rows needing no action is a colour people stop
  // seeing, so only a row somebody could actually act on is ever painted.
  run('yellow means a live application at a company we know, with no usable link', () => {
    const people = [{ company: 'Stripe', tokens: S.outreachCompanyTokens_('Stripe') }];
    const rows = [
      application('Stripe', 'SWE Intern, Summer 2027', 'https://jobright.ai/jobs/info/9'),
      application('Stripe', 'SWE Intern, Summer 2027', GH + '1'),
      application('Stripe', 'SWE Intern, Summer 2027', 'https://jobright.ai/jobs/info/9', '', '', 'Rejected'),
      application('Nowhere Inc', 'SWE Intern, Summer 2027', 'https://jobright.ai/jobs/info/9')
    ];
    const painted = S.outreachReferralNeedsLink_(rows, people);
    assert.strictEqual(painted.length, 1);
    assert.ok(/aggregator link/.test(painted[0].reason));
  });
}

{
  console.log('\nreferral: the queue');

  const REF_WIDTH = S.R_WIDTH;
  const person = (name, email, title, seniority) => ({
    company: 'Stripe', tokens: S.outreachCompanyTokens_('Stripe'),
    name: name, email: email, title: title || 'Software Engineer',
    domain: 'stripe.com', seniority: seniority || '', angle: '', bucket: 'fintech'
  });
  const refRow = (company, email, scheduled, status) => {
    const row = new Array(REF_WIDTH).fill('');
    row[S.R_COMPANY - 1] = company;
    row[S.R_EMAIL - 1] = email;
    row[S.R_SCHEDULED - 1] = scheduled || '';
    row[S.R_STATUS - 1] = status || 'Queued';
    return S.outreachParseReferral_(row, 2);
  };
  const GH = 'https://boards.greenhouse.io/stripe/jobs/';
  const jobRow = (company, role, link) => {
    const row = new Array(S.APP_READ_WIDTH).fill('');
    row[S.APP_COMPANY - 1] = company;
    row[S.APP_ROLE - 1] = role;
    row[S.APP_LINK - 1] = link;
    row[S.APP_PROCESS - 1] = 'Applied';
    return S.outreachParseApplication_(row, 2, () => 'stripe.com');
  };
  const TODAY = new Date(2026, 7, 28, 7, 0, 0);
  const summerJob = [jobRow('Stripe', 'Software Engineer Intern, Summer 2027', GH + '1')];

  const sixPeople = () => ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    .map((letter) => person(letter.toUpperCase(), letter + '@stripe.com'));

  run('six people at one employer, and never a seventh', () => {
    const plan = S.outreachReferralPlan_(summerJob, [], sixPeople(), TODAY);
    assert.strictEqual(plan.booked.length, S.REFERRAL_PER_COMPANY);
    assert.strictEqual(plan.booked.length, 6);
  });

  // All six may land on one day, which is the reverse of what this used to check.
  // What makes six notes read as one mailing shot is six identical notes, and the
  // next test is the one that has to hold for this to be safe.
  run('a company is finished in a day rather than spread over six', () => {
    const days = S.outreachReferralPlan_(summerJob, [], sixPeople(), TODAY)
      .booked.map((one) => one.scheduled.toDateString());
    assert.strictEqual(new Set(days).size, 1, days.join(' | '));
    // Different hours within it, so six do not leave the mailbox together.
    const hours = S.outreachReferralPlan_(summerJob, [], sixPeople(), TODAY)
      .booked.map((one) => one.scheduled.getHours());
    assert.strictEqual(new Set(hours).size, 6, hours.join(','));
  });

  // Six colleagues can compare notes over lunch. Every part of the message that
  // carries meaning has to differ, or the six are visibly one mailing shot.
  run('six at one company get six different messages, not one repeated', () => {
    const booked = S.outreachReferralPlan_(summerJob, [], sixPeople(), TODAY).booked;
    assert.strictEqual(booked.length, 6);
    const templates = booked.map((one) => one.template);
    assert.strictEqual(new Set(templates).size, 6, templates.join(','));
    const pairs = booked.map((one) =>
      S.outreachReferralBullets_('fintech', one.attempt).join('|'));
    assert.strictEqual(new Set(pairs).size, 6, 'bullet pairs repeated');
    const subjects = booked.map((one) =>
      S.outreachReferralSubject_(
        S.outreachReferralSubjectIndex_('Stripe', one.attempt), 'Stripe', 'x'));
    assert.strictEqual(new Set(subjects).size, 6, subjects.join(' | '));
  });

  run('a person already written to is never written to again', () => {
    const people = [person('A', 'a@stripe.com'), person('B', 'b@stripe.com')];
    const existing = [refRow('Stripe', 'a@stripe.com', new Date(2026, 7, 20, 9), 'Sent')];
    const plan = S.outreachReferralPlan_(summerJob, existing, people, TODAY);
    assert.strictEqual(plan.booked.length, 1);
    assert.strictEqual(plan.booked[0].person.email, 'b@stripe.com');
    assert.strictEqual(plan.skipped, 1);
  });

  // The row was made, the person was chosen, and somebody decided against it.
  // Putting them back next run would undo that decision every hour.
  run('a cancelled row still spends the person and the place', () => {
    const people = [person('A', 'a@stripe.com'), person('B', 'b@stripe.com')];
    const existing = [refRow('Stripe', 'a@stripe.com', new Date(2026, 7, 20, 9), 'Cancelled')];
    const plan = S.outreachReferralPlan_(summerJob, existing, people, TODAY);
    assert.strictEqual(plan.booked.length, 1);
    assert.strictEqual(plan.booked[0].person.email, 'b@stripe.com');
  });

  run('a company already at six gets nothing more', () => {
    const people = [person('G', 'g@stripe.com')];
    const existing = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) =>
      refRow('Stripe', n + '@stripe.com', new Date(2026, 7, 20, 9), 'Sent'));
    assert.strictEqual(
      S.outreachReferralPlan_(summerJob, existing, people, TODAY).booked.length, 0);
  });

  run('no usable link, or no employees, means no rows', () => {
    const people = [person('A', 'a@stripe.com')];
    const bad = [jobRow('Stripe', 'SWE Intern, Summer 2027', 'https://jobright.ai/jobs/info/9')];
    assert.strictEqual(S.outreachReferralPlan_(bad, [], people, TODAY).booked.length, 0);
    assert.strictEqual(S.outreachReferralPlan_(summerJob, [], [], TODAY).booked.length, 0);
    // An intake that is not the one being asked about is refused, whether it names
    // the wrong season or a year that has already gone.
    const fall = [jobRow('Stripe', 'Fall 2026 Intern', GH + '1')];
    assert.strictEqual(S.outreachReferralPlan_(fall, [], people, TODAY).booked.length, 0);
  });

  // Nothing here waits for an application. A referral submitted before the
  // application is the version of the favour that actually helps.
  run('a posting nobody has applied to still queues', () => {
    const plan = S.outreachReferralPlan_(summerJob, [], [person('A', 'a@stripe.com')], TODAY);
    assert.strictEqual(plan.booked.length, 1);
    assert.strictEqual(plan.booked[0].jobLink, GH + '1');
    assert.strictEqual(plan.booked[0].role, 'Software Engineer Intern, Summer 2027');
  });

  run('the tier travels with the person, not with the company', () => {
    const people = [person('A', 'a@stripe.com', 'Principal Software Engineer'),
                    person('B', 'b@stripe.com', 'Software Engineer II', 'junior'),
                    person('C', 'c@stripe.com', 'Associate Software Engineer')];
    const tiers = S.outreachReferralPlan_(summerJob, [], people, TODAY)
      .booked.map((one) => one.tier);
    assert.strictEqual(tiers.join(','), 'staff,mid,peer');
  });

  // Friday night: the next hour this path will use is Monday morning, because a
  // first message to a stranger asking a favour should not arrive on a Saturday.
  run('a slot is never booked in an hour that has already gone', () => {
    const late = new Date(2026, 7, 28, 23, 0, 0);
    const slot = S.outreachReferralSlot_('Stripe', late, {});
    assert.ok(slot > late);
    assert.strictEqual(slot.getDay(), 1, 'a Monday: ' + slot);
    assert.strictEqual(slot.getDate(), 31);
  });

  run('the daily cap holds across companies, not just within one', () => {
    const jobs = [], people = [];
    for (let i = 0; i < 10; i++) {
      jobs.push(jobRow('Company' + i, 'Software Engineer Intern, Summer 2027', GH + i));
      people.push({
        company: 'Company' + i, tokens: S.outreachCompanyTokens_('Company' + i),
        name: 'P' + i, email: 'p' + i + '@x.com', title: 'Software Engineer',
        domain: 'x.com', seniority: '', angle: '', bucket: ''
      });
    }
    const byDay = {};
    S.outreachReferralPlan_(jobs, [], people, TODAY).booked.forEach((one) => {
      const key = one.scheduled.toDateString();
      byDay[key] = (byDay[key] || 0) + 1;
    });
    Object.keys(byDay).forEach((key) => {
      assert.ok(byDay[key] <= S.REFERRAL_DAILY_CAP, key + ' had ' + byDay[key]);
    });
  });

  // Six rows dated today are six people spread across eleven hours, and a day
  // comparison would send all six at whichever firing first noticed the date.
  run('due now compares the whole timestamp, and only takes Drafted rows', () => {
    const at = (hour) => new Date(2026, 7, 28, hour, 0, 0);
    const row = (hour, status) => {
      const one = refRow('Stripe', 'a@stripe.com', at(hour), status);
      one.jobLink = GH + '1';
      return one;
    };
    assert.strictEqual(S.outreachReferralDueNow_([row(14, 'Drafted')], at(9)).length, 0);
    assert.strictEqual(S.outreachReferralDueNow_([row(14, 'Drafted')], at(14)).length, 1);
    // Queued is the state before the message has been written at all, so a queued
    // row is not something to send. It was what this selected on while the path
    // went straight from booked to sent, and it kept saying so after the drafting
    // step landed, at which point it matched nothing at all.
    ['Sent', 'Queued', 'Cancelled', 'Failed', 'Replied'].forEach((state) => {
      assert.strictEqual(S.outreachReferralDueNow_([row(9, state)], at(14)).length, 0, state);
    });
  });

  run('a row with no link or no address is never due, whatever its hour says', () => {
    const at = (hour) => new Date(2026, 7, 28, hour, 0, 0);
    const noLink = refRow('Stripe', 'a@stripe.com', at(9), 'Drafted');
    const noEmail = refRow('Stripe', '', at(9), 'Drafted');
    noEmail.jobLink = GH + '1';
    assert.strictEqual(S.outreachReferralDueNow_([noLink], at(14)).length, 0);
    assert.strictEqual(S.outreachReferralDueNow_([noEmail], at(14)).length, 0);
  });
}



{
  console.log('\nreferral: the row, the draft, and the send');

  const GH = 'https://boards.greenhouse.io/stripe/jobs/';

  // As much of a sheet as the three entry points touch: a header row getLastRow
  // counts and getValues never returns, a block read, a block append, and the
  // single-cell writes outreachWriteRow_ makes. The rows array is the tab, so a
  // write made by one call is visible to the call after it.
  const tab = (rows, width) => ({
    rows,
    getLastRow: () => rows.length + 1,
    getRange(r, c, numRows, numCols) {
      return {
        getValues: () => {
          const out = [];
          for (let i = 0; i < numRows; i++) {
            const row = rows[r - 2 + i] || new Array(width).fill('');
            out.push(row.slice(c - 1, c - 1 + numCols));
          }
          return out;
        },
        setValues(values) { values.forEach((v, i) => { rows[r - 2 + i] = v.slice(); }); },
        setValue(v) {
          if (!rows[r - 2]) rows[r - 2] = new Array(width).fill('');
          rows[r - 2][c - 1] = v;
        }
      };
    }
  });

  // Both spreadsheet ids come out of the same stubbed property, so the tracker
  // and the contacts book are one object here. That is not a shortcut: it proves
  // the three entry points ask for their tabs by name rather than by position.
  let sheets = {};
  S.SpreadsheetApp.openById = () => ({ getSheetByName: (name) => sheets[name] || null });
  S.LockService.getScriptLock = () => ({ tryLock: () => true, releaseLock() {} });
  S.DriveApp.getFileById = () => ({ getBlob: () => 'resume.pdf' });

  // Fakes all the way down. Nothing below can reach a mailbox: createDraft only
  // remembers what it was handed, and send only renames an id it was given.
  const gmail = { drafts: {}, made: [], refuse: {} };
  S.GmailApp.createDraft = (to, subject, plain, options) => {
    if (gmail.refuse[to]) throw new Error(gmail.refuse[to]);
    const id = 'draft-' + (gmail.made.length + 1);
    gmail.made.push({ id, to, subject, plain, options });
    gmail.drafts[id] = true;
    return { getId: () => id };
  };
  S.GmailApp.getDraft = (id) => {
    if (!gmail.drafts[id]) throw new Error('Draft not found: ' + id);
    return { send: () => ({ getId: () => 'msg-' + id }) };
  };

  const employeeRow = (company, name, email, title) => {
    const row = new Array(S.E_WIDTH).fill('');
    row[S.E_COMPANY - 1] = company;
    row[S.E_NAME - 1] = name;
    row[S.E_EMAIL - 1] = email;
    row[S.E_TITLE - 1] = title || 'Software Engineer';
    row[S.E_DOMAIN - 1] = 'stripe.com';
    row[S.E_BUCKET - 1] = 'fintech';
    return row;
  };
  const jobsRow = (company, role, link) => {
    const row = new Array(S.APP_READ_WIDTH).fill('');
    row[S.APP_COMPANY - 1] = company;
    row[S.APP_ROLE - 1] = role;
    row[S.APP_LINK - 1] = link;
    row[S.APP_PROCESS - 1] = 'Applied';
    return row;
  };
  const referralRow = (email, name, scheduled, status, draftId) => {
    const row = new Array(S.R_WIDTH).fill('');
    row[S.R_COMPANY - 1] = 'Stripe';
    row[S.R_ROLE - 1] = 'Software Engineer Intern, Summer 2027';
    row[S.R_JOB_LINK - 1] = GH + '1';
    row[S.R_PERSON - 1] = name;
    row[S.R_EMAIL - 1] = email;
    row[S.R_TITLE - 1] = 'Software Engineer';
    row[S.R_TIER - 1] = 'mid';
    row[S.R_TEMPLATE - 1] = 3;
    row[S.R_SCHEDULED - 1] = scheduled;
    row[S.R_STATUS - 1] = status;
    row[S.R_DRAFT_ID - 1] = draftId || '';
    return row;
  };
  const people = [employeeRow('Stripe', 'A One', 'a@stripe.com'),
                  employeeRow('Stripe', 'B Two', 'b@stripe.com'),
                  employeeRow('Stripe', 'C Three', 'c@stripe.com')];
  const minutes = (n) => new Date(Date.now() + n * 60000);

  const booked = {
    company: 'Stripe',
    role: 'Software Engineer Intern, Summer 2027',
    jobLink: GH + '1',
    person: {
      company: 'Stripe', tokens: S.outreachCompanyTokens_('Stripe'),
      name: 'A One', email: 'a@stripe.com', title: 'Software Engineer',
      domain: 'stripe.com', seniority: '', angle: '', bucket: 'fintech'
    },
    tier: 'mid', template: 4, attempt: 1, scheduled: new Date(2026, 7, 31, 9, 0, 0)
  };

  run('a booked ask fills the whole row, Queued, with the link, person, tier and template placed', () => {
    const row = S.outreachReferralRowValues_(booked);
    assert.strictEqual(row.length, S.R_WIDTH);
    assert.strictEqual(row[S.R_STATUS - 1], S.STATUS_QUEUED);
    assert.strictEqual(row[S.R_COMPANY - 1], 'Stripe');
    assert.strictEqual(row[S.R_JOB_LINK - 1], GH + '1');
    assert.strictEqual(row[S.R_PERSON - 1], 'A One');
    assert.strictEqual(row[S.R_EMAIL - 1], 'a@stripe.com');
    assert.strictEqual(row[S.R_TITLE - 1], 'Software Engineer');
    assert.strictEqual(row[S.R_TIER - 1], 'mid');
    assert.strictEqual(row[S.R_TEMPLATE - 1], 4);
    assert.strictEqual(row[S.R_SCHEDULED - 1], booked.scheduled);
    assert.strictEqual(row[S.R_VERSION - 1], 1);
  });

  // A blank Mode is the tab's own default. A value written here would be the
  // appender overruling a person who set the column to Draft, which is the one
  // direction the mode rules never allow.
  run('Mode is left to the tab, and the id names the person rather than being drawn', () => {
    const one = S.outreachReferralRowValues_(booked);
    const again = S.outreachReferralRowValues_(booked);
    assert.strictEqual(one[S.R_MODE - 1], '');
    assert.strictEqual(one[S.R_ID - 1], again[S.R_ID - 1]);
    assert.ok(one[S.R_ID - 1].indexOf('a@stripe.com') !== -1, one[S.R_ID - 1]);
  });

  // The hourly trigger will run this again forty minutes later, and a planner
  // that had to remember what it had done would be one that failed the first
  // time somebody clicked Run out of curiosity.
  run('planning twice in a row books nothing the second time', () => {
    const rows = [];
    sheets = {
      [S.TAB_APP]: tab([jobsRow('Stripe', 'Software Engineer Intern, Summer 2027', GH + '1')],
                        S.APP_READ_WIDTH),
      [S.TAB_REFERRAL]: tab(rows, S.R_WIDTH),
      [S.TAB_EMPLOYEES_SEED]: tab(people, S.E_WIDTH)
    };
    const first = S.planReferralAsks();
    assert.strictEqual(first.booked, 3);
    assert.strictEqual(rows.length, 3);
    assert.strictEqual(rows[0][S.R_STATUS - 1], S.STATUS_QUEUED);
    assert.deepStrictEqual(rows.map((r) => r[S.R_EMAIL - 1]).sort(),
                           ['a@stripe.com', 'b@stripe.com', 'c@stripe.com']);

    const second = S.planReferralAsks();
    assert.strictEqual(second.booked, 0);
    assert.strictEqual(rows.length, 3);
    assert.deepStrictEqual(rows.map((r) => r[S.R_STATUS - 1]),
                           [S.STATUS_QUEUED, S.STATUS_QUEUED, S.STATUS_QUEUED]);
  });

  run('an empty employee export books nothing rather than reading every posting as empty', () => {
    const rows = [];
    sheets = {
      [S.TAB_APP]: tab([jobsRow('Stripe', 'Software Engineer Intern, Summer 2027', GH + '1')],
                        S.APP_READ_WIDTH),
      [S.TAB_REFERRAL]: tab(rows, S.R_WIDTH),
      [S.TAB_EMPLOYEES_SEED]: tab([], S.E_WIDTH)
    };
    assert.strictEqual(S.planReferralAsks().booked, 0);
    assert.strictEqual(rows.length, 0);
  });

  // The hour in Drafts is the entire review. A row whose slot is five hours away
  // written now would be five hours of a message sitting there looking due.
  run('only the rows inside the lead hours are written, and a missed slot catches up', () => {
    const rows = [referralRow('a@stripe.com', 'A One', minutes(30), S.STATUS_QUEUED),
                  referralRow('b@stripe.com', 'B Two', minutes(300), S.STATUS_QUEUED),
                  referralRow('c@stripe.com', 'C Three', minutes(-300), S.STATUS_QUEUED)];
    const due = S.outreachReferralToDraft_(
      rows.map((row, i) => S.outreachParseReferral_(row, i + 2)), new Date());
    assert.deepStrictEqual(due.map((row) => row.email), ['c@stripe.com', 'a@stripe.com']);
  });

  run('a row with no link or no address is never written, whatever its hour says', () => {
    const noLink = referralRow('a@stripe.com', 'A One', minutes(30), S.STATUS_QUEUED);
    noLink[S.R_JOB_LINK - 1] = '';
    const noEmail = referralRow('', 'B Two', minutes(30), S.STATUS_QUEUED);
    const parsed = [noLink, noEmail].map((row, i) => S.outreachParseReferral_(row, i + 2));
    assert.strictEqual(S.outreachReferralToDraft_(parsed, new Date()).length, 0);
  });

  // Failed is terminal and spends one of the employer's three people, so a run
  // that threw on row two would cost the two rows after it their afternoon.
  run('one address Gmail refuses is one Failed row, and the others are still written', () => {
    const rows = [referralRow('a@stripe.com', 'A One', minutes(30), S.STATUS_QUEUED),
                  referralRow('b@stripe.com', 'B Two', minutes(30), S.STATUS_QUEUED),
                  referralRow('c@stripe.com', 'C Three', minutes(30), S.STATUS_QUEUED)];
    sheets = { [S.TAB_REFERRAL]: tab(rows, S.R_WIDTH),
               [S.TAB_EMPLOYEES_SEED]: tab(people, S.E_WIDTH) };
    gmail.refuse['b@stripe.com'] = 'Invalid to header';
    const tally = S.draftReferralAsks();
    delete gmail.refuse['b@stripe.com'];

    assert.strictEqual(tally.drafted, 2);
    assert.strictEqual(tally.failed, 1);
    assert.strictEqual(rows[0][S.R_STATUS - 1], S.STATUS_DRAFTED);
    assert.strictEqual(rows[2][S.R_STATUS - 1], S.STATUS_DRAFTED);
    assert.strictEqual(rows[1][S.R_STATUS - 1], S.STATUS_FAILED);
    assert.match(String(rows[1][S.R_ERROR - 1]), /Invalid to header/);
    // Drafted At and the draft's id are what the send has to find an hour later.
    // Asked by its getTime and not by instanceof: these Dates are made inside the
    // vm the .gs files run in, and a Date from there is not this file's Date.
    assert.ok(typeof rows[0][S.R_DRAFTED_AT - 1].getTime === 'function');
    assert.ok(String(rows[2][S.R_DRAFT_ID - 1]).indexOf('draft-') === 0);
    // Result stays empty until there is a result. It is the column that says how
    // the send went, and a draft id sitting in it before the send is a value that
    // has to be read together with Status to mean anything.
    assert.strictEqual(rows[2][S.R_RESULT - 1], '');
  });

  run('the draft carries the resume and the sending name, the same two the cold path attaches', () => {
    const rows = [referralRow('a@stripe.com', 'A One', minutes(30), S.STATUS_QUEUED)];
    sheets = { [S.TAB_REFERRAL]: tab(rows, S.R_WIDTH),
               [S.TAB_EMPLOYEES_SEED]: tab(people, S.E_WIDTH) };
    gmail.made.length = 0;
    S.draftReferralAsks();
    assert.strictEqual(gmail.made.length, 1);
    assert.strictEqual(gmail.made[0].options.attachments.length, 1);
    assert.strictEqual(gmail.made[0].options.attachments[0], 'resume.pdf');
    assert.strictEqual(gmail.made[0].options.name, S.SENDER_NAME);
    assert.strictEqual(gmail.made[0].to, 'a@stripe.com');
    assert.ok(gmail.made[0].options.htmlBody.indexOf(GH + '1') !== -1);
  });

  // The tab says which of the ten is coming before it goes. Compose takes an
  // attempt and derives the template from it, so composing from a row means
  // recovering the number the planner used — and getting it wrong would hand the
  // second person at a company the first person's wording and bullets.
  run('the message made is the template the tab already promised', () => {
    [1, 2, 3].forEach((template) => {
      const attempt = S.outreachReferralAttemptFor_('Stripe', template);
      const mail = S.outreachReferralCompose_({
        personName: 'A One', personTitle: 'Software Engineer', company: 'Stripe',
        role: 'Software Engineer Intern, Summer 2027', jobLink: GH + '1',
        attempt: attempt, formatDate: () => 'Aug 3'
      });
      assert.strictEqual(mail.template, template);
    });
  });

  // Deleting the draft in Gmail is how a person calls one off, and calling that
  // Failed would fill the column people read for problems with their own
  // decisions.
  run('a draft somebody deleted is Cancelled, not Failed', () => {
    const rows = [referralRow('a@stripe.com', 'A One', minutes(-60), S.STATUS_DRAFTED, 'draft-live'),
                  referralRow('b@stripe.com', 'B Two', minutes(-60), S.STATUS_DRAFTED, 'draft-gone')];
    gmail.drafts['draft-live'] = true;
    delete gmail.drafts['draft-gone'];
    sheets = { [S.TAB_REFERRAL]: tab(rows, S.R_WIDTH) };
    const tally = S.sendReferralAsks();

    assert.strictEqual(tally.sent, 1);
    assert.strictEqual(tally.cancelled, 1);
    assert.strictEqual(tally.failed, 0);
    assert.strictEqual(rows[0][S.R_STATUS - 1], S.STATUS_SENT);
    assert.strictEqual(rows[0][S.R_RESULT - 1], 'msg-draft-live');
    assert.ok(typeof rows[0][S.R_SENT_AT - 1].getTime === 'function');
    assert.strictEqual(rows[1][S.R_STATUS - 1], S.STATUS_CANCELLED);
    assert.strictEqual(rows[1][S.R_ERROR - 1], '');
    assert.match(String(rows[1][S.R_RESULT - 1]), /deleted before its hour/);
  });

  // Nobody deleted anything here: the row lost the one reference that made it
  // sendable, and calling that a person's decision would hide a real defect.
  run('a Drafted row carrying no draft is Failed rather than called off', () => {
    const rows = [referralRow('a@stripe.com', 'A One', minutes(-60), S.STATUS_DRAFTED, '')];
    sheets = { [S.TAB_REFERRAL]: tab(rows, S.R_WIDTH) };
    const tally = S.sendReferralAsks();
    assert.strictEqual(tally.failed, 1);
    assert.strictEqual(tally.cancelled, 0);
    assert.strictEqual(rows[0][S.R_STATUS - 1], S.STATUS_FAILED);
    assert.match(String(rows[0][S.R_ERROR - 1]), /no draft to send/);
  });

  run('an hour that has not arrived sends nothing, and a row held to Draft waits for a person', () => {
    const rows = [referralRow('a@stripe.com', 'A One', minutes(120), S.STATUS_DRAFTED, 'draft-live'),
                  referralRow('b@stripe.com', 'B Two', minutes(-60), S.STATUS_DRAFTED, 'draft-live')];
    rows[1][S.R_MODE - 1] = S.MODE_DRAFT;
    gmail.drafts['draft-live'] = true;
    sheets = { [S.TAB_REFERRAL]: tab(rows, S.R_WIDTH) };
    const tally = S.sendReferralAsks();
    assert.strictEqual(tally.sent, 0);
    assert.strictEqual(rows[0][S.R_STATUS - 1], S.STATUS_DRAFTED);
    assert.strictEqual(rows[1][S.R_STATUS - 1], S.STATUS_DRAFTED);
  });

  // The whole way through, on one tab: booked, written an hour early, sent when
  // the hour came, and never asking the same person twice on the way.
  run('a row travels Queued to Drafted to Sent, and the plan does not book it again', () => {
    const rows = [];
    sheets = {
      [S.TAB_APP]: tab([jobsRow('Stripe', 'Software Engineer Intern, Summer 2027', GH + '1')],
                        S.APP_READ_WIDTH),
      [S.TAB_REFERRAL]: tab(rows, S.R_WIDTH),
      [S.TAB_EMPLOYEES_SEED]: tab([employeeRow('Stripe', 'A One', 'a@stripe.com')], S.E_WIDTH)
    };
    S.planReferralAsks();
    assert.strictEqual(rows.length, 1);
    // Bring its slot forward: the planner books days out, and the point being
    // made here is the order of the three steps rather than the calendar.
    rows[0][S.R_SCHEDULED - 1] = minutes(-30);
    S.draftReferralAsks();
    assert.strictEqual(rows[0][S.R_STATUS - 1], S.STATUS_DRAFTED);
    S.sendReferralAsks();
    assert.strictEqual(rows[0][S.R_STATUS - 1], S.STATUS_SENT);
    assert.match(String(rows[0][S.R_RESULT - 1]), /^msg-draft-/);
    assert.strictEqual(S.planReferralAsks().booked, 0);
    assert.strictEqual(rows.length, 1);
  });

  run('the probe reads, reports what is missing, and sends nothing', () => {
    sheets = { [S.TAB_REFERRAL]: tab([], S.R_WIDTH), [S.TAB_EMPLOYEES_SEED]: tab([], S.E_WIDTH) };
    assert.strictEqual(S.checkReferralService(), false);
    sheets = {
      [S.TAB_APP]: tab([], S.APP_READ_WIDTH),
      [S.TAB_REFERRAL]: tab([referralRow('a@stripe.com', 'A One', minutes(60), S.STATUS_QUEUED)],
                            S.R_WIDTH),
      [S.TAB_EMPLOYEES_SEED]: tab(people, S.E_WIDTH)
    };
    gmail.made.length = 0;
    assert.strictEqual(S.checkReferralService(), true);
    assert.strictEqual(gmail.made.length, 0);
  });
}


{
  console.log('\nreferral: subjects, honesty, and finishing what is open');

  const LONG_CO = 'Activision Blizzard';
  const LONG_ROLE = 'Embedded Software Engineer Intern';

  run('thirty six subjects, all different', () => {
    assert.strictEqual(S.REFERRAL_SUBJECTS.length, 36);
    assert.strictEqual(new Set(S.REFERRAL_SUBJECTS).size, 36);
  });

  // The longest company and the longest role in the dataset are the case that has
  // to fit, not the average one: what is past sixty six is not read on a phone.
  run('every subject fits a phone with the longest substitutions', () => {
    for (let i = 0; i < S.REFERRAL_SUBJECTS.length; i++) {
      const subject = S.outreachReferralSubject_(i, LONG_CO, LONG_ROLE);
      assert.ok(subject.indexOf('{') === -1, subject);
      assert.ok(subject.length <= 66, subject.length + ': ' + subject);
    }
  });

  run('no subject uses a dash, and every one is ASCII', () => {
    S.REFERRAL_SUBJECTS.forEach((subject) => {
      assert.ok(!/[–—-]/.test(subject), subject);
      assert.ok(!/[^\x20-\x7e]/.test(subject), subject);
    });
  });

  // Naming the ask is what lets the reader decide in the preview pane. A subject
  // that hides it spends ninety seconds of somebody who would have said no.
  run('the subject says what the email is', () => {
    const named = S.REFERRAL_SUBJECTS.filter((one) => /referral/i.test(one));
    assert.ok(named.length >= 34, named.length + ' of ' + S.REFERRAL_SUBJECTS.length);
  });

  // Reusing the template index would leave twenty six subjects unreachable and
  // show every eleventh reader a repeat.
  run('subjects reach past the tenth, and move with the attempt', () => {
    const seen = new Set();
    for (let attempt = 1; attempt <= 36; attempt++) {
      seen.add(S.outreachReferralSubjectIndex_('Reddit', attempt));
    }
    assert.strictEqual(seen.size, 36);
    assert.notStrictEqual(S.outreachReferralSubjectIndex_('Reddit', 1),
                          S.outreachReferralSubjectIndex_('Stripe', 1));
  });

  // No date, and the link at the foot rather than inside the sentence naming the
  // role. A referral is a form: the person filling it in does not care what day
  // the application went, and a Workday URL dropped mid-paragraph is two lines of
  // query string exactly where the reader is working out who is writing.
  run('the role is named in prose and the posting sits at the foot', () => {
    const base = {
      personName: 'Priya Raman', personTitle: 'Software Engineer', company: 'Stripe',
      bucket: 'fintech', angle: '', role: 'Software Engineering Intern, Summer 2027',
      today: day(2026, 8, 28), attempt: 1, dateApplied: day(2026, 8, 21),
      jobLink: 'https://boards.greenhouse.io/stripe/jobs/1'
    };
    const one = S.outreachReferralCompose_(base);
    assert.ok(one.plain.indexOf('applying for the Software Engineer Intern role at Stripe') !== -1,
              one.plain);
    // No date anywhere, whether or not one was passed.
    assert.ok(one.plain.indexOf('Aug 21') === -1);
    assert.ok(one.plain.indexOf('I applied') === -1);
    // The link is the last line, and labelled.
    const lines = one.plain.trim().split('\n');
    assert.strictEqual(lines[lines.length - 1], 'The posting: ' + base.jobLink);
    assert.ok(one.html.indexOf(base.jobLink) !== -1);
  });

  // Two numbers arriving under a paragraph that did not mention them read as a
  // fragment of a CV somebody pasted in.
  run('the bullets are introduced rather than dropped', () => {
    const one = S.outreachReferralCompose_({
      personName: 'Priya', personTitle: 'Software Engineer', company: 'Stripe',
      bucket: 'fintech', angle: '', role: 'SWE Intern', today: day(2026, 8, 28),
      attempt: 1, jobLink: 'https://boards.greenhouse.io/stripe/jobs/1'
    });
    const lines = one.plain.split('\n');
    const firstBullet = lines.findIndex((l) => l.indexOf('  - ') === 0);
    assert.ok(firstBullet > 0);
    // The line above the bullets is the lead-in, and it ends by pointing at them.
    assert.strictEqual(lines[firstBullet - 1], '');
    assert.ok(/:$/.test(lines[firstBullet - 2]), lines[firstBullet - 2]);
  });

  // A referral is the big ask; forwarding a resume is the one a stranger can say
  // yes to without spending anything of their own.
  run('every message offers the easier favour as well', () => {
    S.REFERRAL_TIERS.forEach((tier) => S.REFERRAL_TEMPLATES[tier].forEach((entry, i) => {
      assert.ok(/forward|pass|point|send|hand/i.test(entry.offer),
                tier + ' #' + (i + 1) + ' offers no second route: ' + entry.offer);
      assert.ok(/resume|it is attached|attached/i.test(entry.offer),
                tier + ' #' + (i + 1) + ' never mentions the resume');
    }));
  });

  // Saying it in the opening and again in the ask is what made the first draft
  // read as awkward, so each message says it once.
  run('never having met is said once, not twice', () => {
    S.REFERRAL_TIERS.forEach((tier) => S.REFERRAL_TEMPLATES[tier].forEach((entry, i) => {
      const met = /never (met|spoken)|not met|not spoken|stranger/i;
      const both = met.test(entry.open) && met.test(entry.ask);
      assert.ok(!both, tier + ' #' + (i + 1) + ' says it in both the open and the ask');
    }));
  });

  // Two of three spent and the third never sent is the worst arrangement there is.
  run('a company already started is finished before a new one is opened', () => {
    const GH = 'https://boards.greenhouse.io/x/jobs/';
    const jobRow = (company, link) => {
      const row = new Array(S.APP_READ_WIDTH).fill('');
      row[S.APP_COMPANY - 1] = company;
      row[S.APP_ROLE - 1] = 'Software Engineer Intern, Summer 2027';
      row[S.APP_LINK - 1] = link;
      row[S.APP_PROCESS - 1] = 'Applied';
      return S.outreachParseApplication_(row, 2, () => '');
    };
    const at = (company, email) => ({
      company: company, tokens: S.outreachCompanyTokens_(company), name: 'P',
      email: email, title: 'Software Engineer', domain: '', seniority: '',
      angle: '', bucket: ''
    });
    const refRow = (company, email) => {
      const row = new Array(17).fill('');
      row[S.R_COMPANY - 1] = company;
      row[S.R_EMAIL - 1] = email;
      row[S.R_SCHEDULED - 1] = new Date(2026, 7, 20, 9);
      row[S.R_STATUS - 1] = 'Sent';
      return S.outreachParseReferral_(row, 2);
    };
    // Untouched company first in the Jobs order, started company second.
    const jobs = [jobRow('Acme', GH + '1'), jobRow('Beta', GH + '2')];
    const people = [at('Acme', 'a@acme.com'), at('Beta', 'b@beta.com')];
    const open = [refRow('Beta', 'other@beta.com')];
    const plan = S.outreachReferralPlan_(jobs, open, people, new Date(2026, 7, 28, 7));
    assert.strictEqual(plan.booked.length, 2);
    assert.strictEqual(plan.booked[0].company, 'Beta');
    assert.strictEqual(plan.booked[1].company, 'Acme');

    // With nothing open, the Jobs tab's own order is what decides.
    const fresh = S.outreachReferralPlan_(jobs, [], people, new Date(2026, 7, 28, 7));
    assert.strictEqual(fresh.booked[0].company, 'Acme');
  });
}


{
  console.log('\none budget across all three paths');

  const TUE = day(2026, 8, 25);          // DAILY_CAP is 25 on a Tuesday
  const SAT = day(2026, 8, 29);          // and 0 on a Saturday
  const coldSent = (when, n) => {
    const rows = [];
    for (let i = 0; i < n; i++) rows.push({ status: 'Sent', sentAt: when, scheduledAt: when });
    return rows;
  };
  const followUpSent = (when, n) => {
    const rows = [];
    for (let i = 0; i < n; i++) rows.push({ followUpStatus: 'Sent', followUpAt: when });
    return rows;
  };
  const referralSent = (when, n) => {
    const rows = [];
    for (let i = 0; i < n; i++) rows.push({ status: 'Sent', scheduled: when });
    return rows;
  };

  run('the three caps are what each path may send, before the budget is asked', () => {
    assert.strictEqual(S.outreachPathCap_('cold', TUE), 25);
    assert.strictEqual(S.outreachPathCap_('cold', SAT), 0);
    assert.strictEqual(S.outreachPathCap_('followup', TUE), S.FOLLOWUP_DAILY_CAP);
    assert.strictEqual(S.outreachPathCap_('referral', TUE), S.REFERRAL_DAILY_CAP);
    // A path nobody has heard of may send nothing, rather than everything.
    assert.strictEqual(S.outreachPathCap_('whatever', TUE), 0);
  });

  run('spend is counted per path and totalled', () => {
    const queue = coldSent(TUE, 4).concat(followUpSent(TUE, 2));
    const spend = S.outreachDaySpend_(queue, referralSent(TUE, 3), TUE);
    assert.strictEqual(spend.cold, 4);
    assert.strictEqual(spend.followup, 2);
    assert.strictEqual(spend.referral, 3);
    assert.strictEqual(spend.total, 9);
  });

  // A draft is a message that exists, addressed and complete, and leaves within
  // the hour unless somebody deletes it. Not counting it lets the firing at the
  // top of the hour book against a budget the firing before it already committed.
  run('a draft is spent, not free', () => {
    const drafted = [{ status: 'Drafted', scheduledAt: TUE }];
    assert.strictEqual(S.outreachDaySpend_(drafted, [], TUE).cold, 1);
    const followUpDrafted = [{ followUpStatus: 'Drafted', followUpAt: TUE }];
    assert.strictEqual(S.outreachDaySpend_(followUpDrafted, [], TUE).followup, 1);
    const referralDrafted = [{ status: 'Drafted', scheduled: TUE }];
    assert.strictEqual(S.outreachDaySpend_([], referralDrafted, TUE).referral, 1);
  });

  run('another day is another budget', () => {
    const spend = S.outreachDaySpend_(coldSent(TUE, 5), referralSent(TUE, 2), SAT);
    assert.strictEqual(spend.total, 0);
  });

  run('a queued row has not spent anything', () => {
    const queued = [{ status: 'Queued', scheduledAt: TUE }];
    assert.strictEqual(S.outreachDaySpend_(queued, [], TUE).cold, 0);
    assert.strictEqual(S.outreachDaySpend_([], [{ status: 'Queued', scheduled: TUE }], TUE).referral, 0);
  });

  run('an untouched day gives every path its own cap', () => {
    assert.strictEqual(S.outreachBudgetRoom_([], [], TUE, 'referral'), S.REFERRAL_DAILY_CAP);
    assert.strictEqual(S.outreachBudgetRoom_([], [], TUE, 'cold'), 25);
    assert.strictEqual(S.outreachBudgetRoom_([], [], TUE, 'followup'), S.FOLLOWUP_DAILY_CAP);
  });

  // The whole point of the reservation. Without it the priority order would be
  // decided by which trigger fired first, and the cold path has been firing
  // hourly for weeks: it would take the budget every morning.
  run('the referral path keeps its share even when the cold path got there first', () => {
    const saved = S.DAILY_CAP[2];
    S.DAILY_CAP[2] = 40;
    try {
      // Cold has sent 30 of a raised cap of 40, so its own cap says ten more. The
      // twelve held back for referral say three.
      assert.strictEqual(S.outreachBudgetRoom_(coldSent(TUE, 30), [], TUE, 'cold'),
                         S.DAILY_EMAIL_BUDGET - 30 - S.REFERRAL_DAILY_CAP);
      // And the referral path finds its whole share waiting for it.
      assert.strictEqual(S.outreachBudgetRoom_(coldSent(TUE, 30), [], TUE, 'referral'),
                         S.REFERRAL_DAILY_CAP);
    } finally {
      S.DAILY_CAP[2] = saved;
    }
  });

  run('follow up is the path that gives way when the day is spent', () => {
    const saved = S.DAILY_CAP[2];
    S.DAILY_CAP[2] = 40;
    try {
      const queue = coldSent(TUE, 40);
      const referral = referralSent(TUE, S.REFERRAL_DAILY_CAP);
      assert.strictEqual(S.outreachBudgetRoom_(queue, referral, TUE, 'followup'), 0);
      // The day is over budget by what the two paths above already spent, and
      // follow up is refused rather than adding to it.
      assert.ok(S.outreachDaySpend_(queue, referral, TUE).total > S.DAILY_EMAIL_BUDGET);
    } finally {
      S.DAILY_CAP[2] = saved;
    }
  });

  run('room is never negative, whatever the day looks like', () => {
    const flooded = coldSent(TUE, 200);
    S.EMAIL_PATH_ORDER.forEach((path) => {
      assert.ok(S.outreachBudgetRoom_(flooded, referralSent(TUE, 200), TUE, path) >= 0, path);
    });
  });

  run('a path already at its own cap gets nothing more, budget or no budget', () => {
    const referral = referralSent(TUE, S.REFERRAL_DAILY_CAP);
    assert.strictEqual(S.outreachBudgetRoom_([], referral, TUE, 'referral'), 0);
  });

  // Saying so is the point rather than an admission: this is a guard rail, and a
  // guard rail you are leaning on was installed too late.
  run('the three caps sum under the budget on every day of the week', () => {
    for (let d = 23; d <= 29; d++) {
      const date = day(2026, 8, d);
      const total = S.outreachPathCap_('cold', date)
                  + S.outreachPathCap_('referral', date)
                  + S.outreachPathCap_('followup', date);
      assert.ok(total <= S.DAILY_EMAIL_BUDGET, date.toDateString() + ' reaches ' + total);
    }
  });

  run('the order is referral, then cold, then follow up', () => {
    assert.strictEqual(S.EMAIL_PATH_ORDER.join(','), 'referral,cold,followup');
    assert.strictEqual(S.DAILY_EMAIL_BUDGET, 45);
  });

  // Called from places that have no reason to have read the Referral tab. An
  // unknown path must count as having spent nothing, not as unlimited.
  run('a missing set of rows counts as nothing spent rather than as no limit', () => {
    assert.strictEqual(S.outreachDaySpend_(null, null, TUE).total, 0);
    assert.strictEqual(S.outreachBudgetRoom_(undefined, undefined, TUE, 'cold'), 25);
  });
}


{
  console.log('\nreferral: the path before anybody has switched it on');

  // runOutreachCycle calls all three of these every hour. Before setupReferralQueue
  // has been run the tab is not there, and a throw would end every cycle red for as
  // long as that lasted. A cycle that is always red is a cycle nobody reads.
  const noTab = () => ({
    getSheetByName(name) { return name === S.TAB_REFERRAL ? null : fakeSheet([]); }
  });
  const fakeSheet = (grid) => ({
    getLastRow: () => grid.length + 1,
    getLastColumn: () => 20,
    getRange: () => ({ getValues: () => grid, setValues() { return this; } }),
    appendRow() {}
  });

  run('a missing Referral tab is a quiet skip, not a failure', () => {
    const said = [];
    const logger = S.Logger.log;
    S.Logger.log = (line) => said.push(String(line));
    const opener = S.SpreadsheetApp.openById;
    S.SpreadsheetApp.openById = noTab;
    try {
      [S.draftReferralAsks, S.sendReferralAsks].forEach((entry) => {
        const out = entry();
        assert.strictEqual(out.ready, false);
        assert.strictEqual(out.sent || 0, 0);
      });
    } finally {
      S.Logger.log = logger;
      S.SpreadsheetApp.openById = opener;
    }
    assert.ok(said.length >= 2, said.join(' | '));
    said.forEach((line) => assert.ok(/setupReferralQueue/.test(line), line));
  });

  // Said in one place, so three entry points cannot drift into three wordings.
  run('and it says the one thing that fixes it', () => {
    const line = S.outreachReferralNotSetUp_();
    assert.ok(line.indexOf(S.TAB_REFERRAL) !== -1);
    assert.ok(line.indexOf('setupReferralQueue') !== -1);
    assert.strictEqual(S.outreachReferralIdle_().ready, false);
  });
}


{
  console.log('\nreferral: the switch that holds the first batch back');

  // A follow up is a reply on a thread the recipient already has. A referral ask
  // is a first message to somebody who has never heard from us, and the path goes
  // live the moment the tab exists because runOutreachCycle is already firing.
  run('REFERRAL_MODE alone holds a row, with OUTREACH_MODE wide open', () => {
    const rows = [{ index: 2, status: S.STATUS_DRAFTED, mode: '',
                    scheduled: day(2026, 8, 28), email: 'a@x.com', jobLink: 'https://x' }];
    const now = new Date(2026, 7, 28, 20, 0, 0);
    assert.strictEqual(S.outreachReferralToSend_(rows, now, S.MODE_DRAFT, []).length, 0);
    assert.strictEqual(S.outreachReferralToSend_(rows, now, '', []).length, 1);
  });

  // It can only ever be more cautious than the row's own Mode, never less: a
  // person who set that cell to Draft is not overruled by an open global switch.
  run('a row set to Draft by hand still wins over an open switch', () => {
    const rows = [{ index: 2, status: S.STATUS_DRAFTED, mode: S.MODE_DRAFT,
                    scheduled: day(2026, 8, 28), email: 'a@x.com', jobLink: 'https://x' }];
    const now = new Date(2026, 7, 28, 20, 0, 0);
    assert.strictEqual(S.outreachReferralToSend_(rows, now, '', []).length, 0);
  });

  run('the property is named and described alongside the others', () => {
    assert.strictEqual(S.PROP_REFERRAL_MODE, 'REFERRAL_MODE');
  });
}


{
  console.log('\nreferral: the date the email claims');

  // Every row on this tab now comes from an application actually made. Saying
  // "I am applying" about one submitted three weeks ago is the same falsehood the
  // present tense was introduced to avoid, pointing the other way.
  run('the applied date is looked up by company and role, earliest first', () => {
    const appRow = (company, role, when) => {
      const row = new Array(S.APP_READ_WIDTH).fill('');
      row[S.APP_COMPANY - 1] = company;
      row[S.APP_ROLE - 1] = role;
      row[S.APP_DATE_APPLIED - 1] = when;
      return row;
    };
    const grid = [
      appRow('Stripe', 'Software Engineer Intern', day(2026, 8, 21)),
      appRow('Stripe', 'software engineer intern ', day(2026, 8, 25)),
      appRow('Reddit', 'Data Intern', day(2026, 8, 10)),
      appRow('Nowhere', '', day(2026, 8, 10))
    ];
    const tracker = {
      getSheetByName(name) {
        if (name !== S.TAB_APP) return null;
        return {
          getLastRow: () => grid.length + 1,
          getRange: () => ({ getValues: () => grid })
        };
      }
    };
    const found = S.outreachReferralAppliedOn_(tracker);
    const key = S.outreachReferralAppKey_('Stripe', 'Software Engineer Intern');
    // Case and trailing space are one job, and the earlier of the two dates wins
    // because that is the one the recipient could go and verify.
    assert.strictEqual(found[key].getTime(), day(2026, 8, 21).getTime());
    assert.ok(found[S.outreachReferralAppKey_('Reddit', 'Data Intern')]);
    // A row with no role cannot be matched to anything and is not stored.
    assert.strictEqual(Object.keys(found).length, 2);
  });

  run('no App tab, or an empty one, is an empty lookup rather than a throw', () => {
    assert.deepStrictEqual(
      Object.keys(S.outreachReferralAppliedOn_({ getSheetByName: () => null })), []);
    const empty = { getSheetByName: () => ({ getLastRow: () => 1 }) };
    assert.deepStrictEqual(Object.keys(S.outreachReferralAppliedOn_(empty)), []);
  });

  run('the key matches the way the rest of the project matches employers', () => {
    assert.strictEqual(S.outreachReferralAppKey_('Stripe ', 'SWE Intern'),
                       S.outreachReferralAppKey_('stripe', 'swe  intern'));
    assert.notStrictEqual(S.outreachReferralAppKey_('Stripe', 'SWE Intern'),
                          S.outreachReferralAppKey_('Stripe', 'Data Intern'));
  });
}


{
  console.log('\nreferral: cancelling a row, and the line moving up');

  const REF = (index, company, email, scheduled, status, extra) => {
    const row = Object.assign({
      index: index, company: company, tokens: S.outreachCompanyTokens_(company),
      role: 'SWE Intern', jobLink: 'https://boards.greenhouse.io/x/jobs/1',
      person: 'P', email: email, title: 'Software Engineer', tier: 'mid', template: 1,
      draftedAt: null, scheduled: scheduled, status: status, mode: '',
      draftId: '', cancel: false, sentAt: null, id: 'R-' + email
    }, extra || {});
    return row;
  };
  const at = (d, h) => new Date(2026, 7, d, h, 0, 0);
  // Friday evening, past the last sending hour. Aug 29 and 30 are the weekend and
  // the referral path does not book them, so the first day with room is Monday the
  // 31st — which is what these assertions are about: the shape of the queue, not
  // how much of any one day happens to be left.
  const NOW = new Date(2026, 7, 28, 21, 0, 0);
  const FIRST = S.REFERRAL_HOUR_FIRST;

  // The queue is a line. Calling somebody off should move the line up rather than
  // leave a hole in it.
  run('a cancelled row hands its hour to the rows behind it', () => {
    const rows = [
      REF(2, 'A', 'a@x.com', at(29, 8), 'Cancelled'),
      REF(3, 'B', 'b@x.com', at(29, 9), 'Queued'),
      REF(4, 'C', 'c@x.com', at(29, 10), 'Queued')
    ];
    const moved = S.outreachReferralReplan_(rows, NOW, null);
    const byRow = {};
    moved.forEach((m) => { byRow[m.index] = m.scheduled.getHours(); });
    assert.strictEqual(byRow[3], FIRST, 'B should take the freed first hour');
    assert.strictEqual(byRow[4], FIRST + 1, 'C should follow it');
    assert.strictEqual(moved.find((m) => m.index === 3).scheduled.getDate(), 31);
  });

  // A Drafted row has a message written, addressed and sitting in Gmail against a
  // particular hour. Moving it earlier would send it before the hour it was
  // supposed to be readable in, which is the one guarantee drafting gives.
  run('a drafted row keeps its hour and still occupies the day', () => {
    const rows = [
      REF(2, 'A', 'a@x.com', at(31, FIRST), 'Drafted'),
      REF(3, 'B', 'b@x.com', at(31, 14), 'Queued')
    ];
    const moved = S.outreachReferralReplan_(rows, NOW, null);
    assert.ok(!moved.some((m) => m.index === 2), 'the drafted row must not move');
    const b = moved.find((m) => m.index === 3);
    assert.strictEqual(b.scheduled.getDate(), 31);
    assert.strictEqual(b.scheduled.getHours(), FIRST + 1, 'B fills in behind the drafted row');
  });

  run('a sent row is history and is never re-timed', () => {
    const rows = [REF(2, 'A', 'a@x.com', at(27, 8), 'Sent', { sentAt: at(27, 8) })];
    assert.strictEqual(S.outreachReferralReplan_(rows, NOW, null).length, 0);
  });

  // A re-plan that rewrote every row to the value it already held would touch the
  // whole tab every hour and the version history would stop being a record.
  run('a queue that is already tight reports no movement', () => {
    const rows = [
      REF(2, 'A', 'a@x.com', at(31, FIRST), 'Queued'),
      REF(3, 'B', 'b@x.com', at(31, FIRST + 1), 'Queued')
    ];
    assert.strictEqual(S.outreachReferralReplan_(rows, NOW, null).length, 0);
  });

  run('the order rows were going out in is preserved', () => {
    const rows = [
      REF(4, 'C', 'c@x.com', at(29, 14), 'Queued'),
      REF(2, 'A', 'a@x.com', at(29, 9), 'Queued'),
      REF(3, 'B', 'b@x.com', at(29, 11), 'Queued')
    ];
    const moved = S.outreachReferralReplan_(rows, NOW, null);
    const byRow = {};
    moved.forEach((m) => { byRow[m.index] = m.scheduled.getHours(); });
    assert.strictEqual(byRow[2], FIRST);
    assert.strictEqual(byRow[3], FIRST + 1);
    assert.strictEqual(byRow[4], FIRST + 2);
  });

  // A tick can arrive by paste, fill-down or undo, none of which fire a simple
  // trigger, so the box alone has to be enough to take the row out of the line.
  run('a ticked box counts as cancelled even if onEdit never saw it', () => {
    const rows = [
      REF(2, 'A', 'a@x.com', at(29, 8), 'Queued', { cancel: true }),
      REF(3, 'B', 'b@x.com', at(29, 9), 'Queued')
    ];
    const moved = S.outreachReferralReplan_(rows, NOW, null);
    assert.ok(!moved.some((m) => m.index === 2), 'a ticked row is not re-timed');
    assert.strictEqual(moved.find((m) => m.index === 3).scheduled.getHours(), FIRST);
  });

  run('a cancelled row still holding a draft is the one to discard', () => {
    const rows = [
      REF(2, 'A', 'a@x.com', at(29, 8), 'Cancelled', { draftId: 'draft-1' }),
      REF(3, 'B', 'b@x.com', at(29, 9), 'Cancelled'),
      REF(4, 'C', 'c@x.com', at(29, 10), 'Queued', { cancel: true, draftId: 'draft-2' }),
      REF(5, 'D', 'd@x.com', at(29, 11), 'Drafted', { draftId: 'draft-3' })
    ];
    const gone = S.outreachReferralAbandoned_(rows).map((r) => r.draftId);
    assert.deepStrictEqual(gone.join(','), 'draft-1,draft-2');
  });

  // Where the three paths meet: a day the cold path has filled is a day this
  // queue is told to skip, rather than one it books into and discovers at sending.
  run('the budget narrows a day rather than the queue discovering it later', () => {
    const rows = [];
    for (let i = 0; i < 8; i++) rows.push(REF(i + 2, 'C' + i, i + '@x.com', at(31, 6 + i), 'Queued'));
    const roomOn = (day) => (day.getDate() === 31 ? 3 : 12);
    const moved = S.outreachReferralReplan_(rows, NOW, roomOn);
    const byDay = {};
    // Rows that did not move kept the day they had; count the whole outcome.
    rows.forEach((r) => {
      const m = moved.find((x) => x.index === r.index);
      const when = m ? m.scheduled : r.scheduled;
      const k = when.getDate();
      byDay[k] = (byDay[k] || 0) + 1;
    });
    assert.strictEqual(byDay[31], 3, JSON.stringify(byDay));
  });

  // An earlier version stepped to the next day here, so after 08:00 the day was
  // written off entirely and eleven usable hours went unused every morning.
  run('the rest of today is used rather than written off', () => {
    const midMorning = new Date(2026, 7, 28, 10, 8, 0);   // a Friday
    const slot = S.outreachReferralSlot_('A', midMorning, {}, null);
    assert.strictEqual(slot.getDate(), 28, 'should still be today: ' + slot);
    assert.ok(slot > midMorning);
  });

  // Indexing by the day's booking count alone kept handing back the first hour
  // still in the future, so every row on a half-gone day landed on one hour.
  run('and two rows booked on a half-gone day take different hours', () => {
    const midMorning = new Date(2026, 7, 28, 10, 8, 0);
    const load = {};
    const first = S.outreachReferralSlot_('A', midMorning, load, null);
    load[S.outreachDayKey_(first)] = { total: 1, companies: {} };
    const second = S.outreachReferralSlot_('B', midMorning, load, null);
    assert.notStrictEqual(first.getHours(), second.getHours());
    assert.ok(second > first);
  });

  // A first message to a stranger asking a favour, arriving on a Saturday, says
  // the sender either did not notice or did not mind.
  run('an evening past the last hour skips the weekend to Monday', () => {
    const late = new Date(2026, 7, 28, 21, 0, 0);        // Friday night
    const slot = S.outreachReferralSlot_('A', late, {}, null);
    assert.strictEqual(slot.getDay(), 1, 'should be a Monday: ' + slot);
    assert.strictEqual(slot.getDate(), 31);
    assert.strictEqual(slot.getHours(), S.REFERRAL_HOUR_FIRST);
  });

  run('no slot ever lands on a Saturday or a Sunday', () => {
    const load = {};
    let when = new Date(2026, 7, 28, 6, 0, 0);
    for (let i = 0; i < 40; i++) {
      const slot = S.outreachReferralSlot_('C' + i, when, load, null);
      assert.ok(slot.getDay() !== 0 && slot.getDay() !== 6, slot.toDateString());
      const key = S.outreachDayKey_(slot);
      if (!load[key]) load[key] = { total: 0, companies: {} };
      load[key].total++;
    }
  });
}


{
  console.log('\nreferral: one tick calls off the whole ask');

  const ROW = (index, company, role, status, cancel) => ({
    index: index, company: company, role: role,
    tokens: S.outreachCompanyTokens_(company),
    email: 'p' + index + '@x.com', status: status, cancel: !!cancel,
    scheduled: new Date(2026, 7, 29, 8, 0, 0), draftId: ''
  });

  // Six rows sharing a company and a posting are one decision, not six.
  run('a tick on one row takes its whole ask with it', () => {
    const rows = [
      ROW(2, 'Stripe', 'SWE Intern', 'Queued', true),
      ROW(3, 'Stripe', 'SWE Intern', 'Queued'),
      ROW(4, 'Stripe', 'SWE Intern', 'Drafted'),
      ROW(5, 'Figma', 'SWE Intern', 'Queued')
    ];
    const going = S.outreachReferralToCancel_(rows).map((r) => r.index);
    assert.deepStrictEqual(going.join(','), '2,3,4');
  });

  // The rows of a group are usually adjacent because they were written together,
  // but "usually" is not a rule, and a half-cancelled ask is worse than neither.
  run('members are found wherever they sit, not only next door', () => {
    const rows = [
      ROW(2, 'Stripe', 'SWE Intern', 'Queued', true),
      ROW(3, 'Figma', 'SWE Intern', 'Queued'),
      ROW(4, 'Stripe', 'SWE Intern', 'Queued')
    ];
    assert.deepStrictEqual(
      S.outreachReferralToCancel_(rows).map((r) => r.index).join(','), '2,4');
  });

  // That message has gone. Marking it Cancelled would be the tab claiming
  // something untrue about a mailbox it no longer controls.
  run('a sent row inside the ask is never called off with it', () => {
    const rows = [
      ROW(2, 'Stripe', 'SWE Intern', 'Sent', true),
      ROW(3, 'Stripe', 'SWE Intern', 'Queued')
    ];
    assert.deepStrictEqual(
      S.outreachReferralToCancel_(rows).map((r) => r.index).join(','), '3');
  });

  // The checkbox is the group switch; the Status dropdown is the single-row one.
  run('a hand-set Cancelled status does not drag the siblings down', () => {
    const rows = [
      ROW(2, 'Stripe', 'SWE Intern', 'Cancelled'),
      ROW(3, 'Stripe', 'SWE Intern', 'Queued')
    ];
    assert.strictEqual(S.outreachReferralToCancel_(rows).length, 0);
  });

  run('nothing ticked is nothing to do, and a row already cancelled is left alone', () => {
    const rows = [ROW(2, 'Stripe', 'SWE Intern', 'Queued')];
    assert.strictEqual(S.outreachReferralToCancel_(rows).length, 0);
    const done = [ROW(3, 'Stripe', 'SWE Intern', 'Cancelled', true)];
    assert.strictEqual(S.outreachReferralToCancel_(done).length, 0);
  });

  run('the key ignores case, punctuation and repeated whitespace', () => {
    assert.strictEqual(S.outreachReferralGroupKey_('Stripe ', 'SWE Intern', 2),
                       S.outreachReferralGroupKey_('stripe', 'swe  intern', 9));
    assert.notStrictEqual(S.outreachReferralGroupKey_('Stripe', 'SWE Intern', 2),
                          S.outreachReferralGroupKey_('Stripe', 'Data Intern', 3));
  });

  // An empty company would otherwise collide with every other empty company, and
  // one tick on a half-written row would cancel every other half-written row.
  run('a row missing a company or a role is a group of one', () => {
    assert.notStrictEqual(S.outreachReferralGroupKey_('', '', 2),
                          S.outreachReferralGroupKey_('', '', 3));
    const rows = [ROW(2, '', '', 'Queued', true), ROW(3, '', '', 'Queued')];
    assert.deepStrictEqual(
      S.outreachReferralToCancel_(rows).map((r) => r.index).join(','), '2');
  });

  // A cancelled row holds no hour, so the ask's whole day comes back at once.
  run('cancelling an ask hands all of its hours back together', () => {
    const NOW = new Date(2026, 7, 28, 21, 0, 0);
    const at = (h) => new Date(2026, 7, 31, h, 0, 0);
    const rows = [
      Object.assign(ROW(2, 'Stripe', 'SWE Intern', 'Cancelled', true), { scheduled: at(8) }),
      Object.assign(ROW(3, 'Stripe', 'SWE Intern', 'Cancelled', true), { scheduled: at(9) }),
      Object.assign(ROW(4, 'Figma', 'SWE Intern', 'Queued'), { scheduled: at(10) })
    ];
    const moved = S.outreachReferralReplan_(rows, NOW, null);
    assert.strictEqual(moved.find((m) => m.index === 4).scheduled.getHours(), S.REFERRAL_HOUR_FIRST);
  });
}


{
  console.log('\nreferral: priority, and following a newer application');

  const at = (d, h) => new Date(2026, 7, d, h, 0, 0);
  const NOW = new Date(2026, 7, 28, 21, 0, 0);
  const ROW = (index, company, role, status, extra) => Object.assign({
    index: index, company: company, role: role,
    tokens: S.outreachCompanyTokens_(company), jobLink: 'https://x/1',
    email: 'p' + index + '@x.com', status: status, cancel: false, priority: false,
    scheduled: at(29, 8), draftId: ''
  }, extra || {});

  // A row marked urgent on Monday and booked for Friday is still going on Friday
  // unless the tick moves it in the queue rather than only in the day's order.
  run('a priority tick takes the earliest slot', () => {
    const rows = [
      ROW(2, 'A', 'SWE Intern, Summer 2027', 'Queued', { scheduled: at(31, 6) }),
      ROW(3, 'B', 'SWE Intern, Summer 2027', 'Queued', { scheduled: at(31, 7) }),
      ROW(4, 'C', 'SWE Intern, Summer 2027', 'Queued', { scheduled: at(31, 8), priority: true })
    ];
    const moved = S.outreachReferralReplan_(rows, NOW, null);
    assert.strictEqual(moved.find((m) => m.index === 4).scheduled.getHours(), S.REFERRAL_HOUR_FIRST);
  });

  // Six people at one company are one decision. Lifting one above the other five
  // would send the ask twice over, days apart, to colleagues who see each other.
  run('priority lifts the whole ask, not one row of it', () => {
    const rows = [
      ROW(2, 'Other', 'SWE Intern, Summer 2027', 'Queued', { scheduled: at(31, 6) }),
      ROW(3, 'Acme', 'SWE Intern, Summer 2027', 'Queued', { scheduled: at(31, 7), priority: true }),
      ROW(4, 'Acme', 'SWE Intern, Summer 2027', 'Queued', { scheduled: at(31, 8) })
    ];
    const moved = S.outreachReferralReplan_(rows, NOW, null);
    const hours = {};
    moved.forEach((m) => { hours[m.index] = m.scheduled.getHours(); });
    assert.ok(hours[3] < hours[2] || hours[4] < hours[2],
              'the Acme ask should be lifted above Other: ' + JSON.stringify(hours));
    assert.ok(Math.abs(hours[3] - hours[4]) === 1, 'and stay together');
  });

  run('among rows already due, priority goes first', () => {
    const due = (index, hour, priority) => ({
      index: index, status: S.STATUS_DRAFTED, scheduled: at(28, hour),
      email: 'p@x.com', jobLink: 'https://x/1', priority: !!priority, mode: ''
    });
    const now = at(28, 20);
    const order = S.outreachReferralDueNow_([due(2, 8), due(3, 9, true)], now, [])
      .map((r) => r.index);
    assert.strictEqual(order.join(','), '3,2');
  });

  // Intuit had one software role and now has a newer one. The ask that has not
  // gone should be about the application still moving.
  run('an unsent row follows the company to its newest application', () => {
    const appRow = (company, role, link, applied) => {
      const row = new Array(S.APP_READ_WIDTH).fill('');
      row[S.APP_COMPANY - 1] = company;
      row[S.APP_ROLE - 1] = role;
      row[S.APP_LINK - 1] = link;
      row[S.APP_DATE_APPLIED - 1] = applied;
      row[S.APP_PROCESS - 1] = 'Applied';
      return S.outreachParseApplication_(row, 2, () => '');
    };
    const GH = 'https://boards.greenhouse.io/intuit/jobs/';
    const applications = [
      appRow('Intuit', 'SWE Intern, Summer 2027', GH + '1', at(10, 9)),
      appRow('Intuit', 'Software Engineer Intern, Summer 2027', GH + '2', at(20, 9))
    ];
    const rows = [ROW(2, 'Intuit', 'SWE Intern, Summer 2027', 'Queued',
                      { jobLink: GH + '1' })];
    const changes = S.outreachReferralReconcile_(rows, applications).repoint;
    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].jobLink, GH + '2');
    assert.ok(/Software Engineer Intern/.test(changes[0].role));
  });

  // A sent message named a role and a link. Rewriting the row afterwards would
  // leave the tab describing a message that was never written.
  run('a sent or cancelled row is never re-pointed', () => {
    const appRow = (role, link, applied) => {
      const row = new Array(S.APP_READ_WIDTH).fill('');
      row[S.APP_COMPANY - 1] = 'Intuit';
      row[S.APP_ROLE - 1] = role;
      row[S.APP_LINK - 1] = link;
      row[S.APP_DATE_APPLIED - 1] = applied;
      row[S.APP_PROCESS - 1] = 'Applied';
      return S.outreachParseApplication_(row, 2, () => '');
    };
    const GH = 'https://boards.greenhouse.io/intuit/jobs/';
    const applications = [appRow('New Role, Summer 2027', GH + '2', at(20, 9))];
    ['Sent', 'Cancelled'].forEach((state) => {
      const rows = [ROW(2, 'Intuit', 'Old Role, Summer 2027', state, { jobLink: GH + '1' })];
      assert.strictEqual(S.outreachReferralReconcile_(rows, applications).repoint.length, 0, state);
    });
  });

  run('a row already on the newest application is left alone', () => {
    const appRow = (role, link) => {
      const row = new Array(S.APP_READ_WIDTH).fill('');
      row[S.APP_COMPANY - 1] = 'Intuit';
      row[S.APP_ROLE - 1] = role;
      row[S.APP_LINK - 1] = link;
      row[S.APP_DATE_APPLIED - 1] = at(20, 9);
      row[S.APP_PROCESS - 1] = 'Applied';
      return S.outreachParseApplication_(row, 2, () => '');
    };
    const GH = 'https://boards.greenhouse.io/intuit/jobs/';
    const rows = [ROW(2, 'Intuit', 'SWE Intern, Summer 2027', 'Queued', { jobLink: GH + '2' })];
    assert.strictEqual(
      S.outreachReferralReconcile_(rows, [appRow('SWE Intern, Summer 2027', GH + '2')]).repoint.length, 0);
  });

  // A draft naming the old posting is worse than no draft: it would go out with a
  // link the writer has already moved on from.
  run('a drafted row carries its draft id out so the send path can bin it', () => {
    const appRow = (role, link) => {
      const row = new Array(S.APP_READ_WIDTH).fill('');
      row[S.APP_COMPANY - 1] = 'Intuit';
      row[S.APP_ROLE - 1] = role;
      row[S.APP_LINK - 1] = link;
      row[S.APP_DATE_APPLIED - 1] = at(20, 9);
      row[S.APP_PROCESS - 1] = 'Applied';
      return S.outreachParseApplication_(row, 2, () => '');
    };
    const GH = 'https://boards.greenhouse.io/intuit/jobs/';
    const rows = [ROW(2, 'Intuit', 'Old, Summer 2027', 'Drafted',
                      { jobLink: GH + '1', draftId: 'draft-9' })];
    const changes = S.outreachReferralReconcile_(rows, [appRow('New, Summer 2027', GH + '2')]).repoint;
    assert.strictEqual(changes[0].draftId, 'draft-9');
  });

  // The recruiter email names it because a recruiter is checking eligibility. The
  // engineer being asked a favour is not checking anything.
  run('the graduation year is left out of the referral intro', () => {
    const one = S.outreachReferralCompose_({
      personName: 'Priya', personTitle: 'Software Engineer', company: 'Stripe',
      bucket: 'fintech', angle: '', role: 'SWE Intern', today: at(28, 9),
      attempt: 1, jobLink: 'https://boards.greenhouse.io/stripe/jobs/1'
    });
    assert.ok(one.plain.indexOf('class of') === -1, one.plain);
    assert.ok(one.plain.indexOf('Kenyon College') !== -1);
    assert.ok(one.plain.indexOf('4.0 GPA') !== -1);
  });
}


{
  console.log('\nreferral: a row whose application no longer qualifies');

  const at = (d, h) => new Date(2026, 7, d, h, 0, 0);
  const appRow = (company, role, link, applied, process) => {
    const row = new Array(S.APP_READ_WIDTH).fill('');
    row[S.APP_COMPANY - 1] = company;
    row[S.APP_ROLE - 1] = role;
    row[S.APP_LINK - 1] = link;
    row[S.APP_DATE_APPLIED - 1] = applied;
    row[S.APP_PROCESS - 1] = process || 'Applied';
    return S.outreachParseApplication_(row, 2, () => '');
  };
  const REF = (index, company, role, status, extra) => Object.assign({
    index: index, company: company, role: role,
    tokens: S.outreachCompanyTokens_(company), jobLink: 'https://boards.greenhouse.io/x/jobs/1',
    email: 'p@x.com', status: status, cancel: false, priority: false,
    scheduled: at(29, 8), draftId: ''
  }, extra || {});
  const GH = 'https://boards.greenhouse.io/intuit/jobs/';

  // This is what was actually on the tab: the Intuit application reads "Intern,
  // Software Engineering" and names no intake, so once the season rule came back
  // on nothing at that company qualified — and the row just sat there, booked and
  // due, about to ask a stranger for a favour over it.
  run('a company with nothing qualifying has its open rows closed', () => {
    // A title naming a different intake, which is what actually disqualifies one.
    const applications = [appRow('Intuit', 'SWE Intern, Winter 2027', GH + '1', at(18, 9))];
    const rows = [REF(2, 'Intuit', 'SWE Intern, Winter 2027', 'Queued',
                      { jobLink: GH + '1' })];
    const seen = S.outreachReferralReconcile_(rows, applications);
    assert.strictEqual(seen.repoint.length, 0);
    assert.strictEqual(seen.retire.length, 1);
    assert.strictEqual(seen.retire[0].index, 2);
    assert.ok(/Intuit/.test(seen.retire[0].reason));
  });

  run('and the same row is left alone once a qualifying application exists', () => {
    const applications = [
      appRow('Intuit', 'Intern, Software Engineering', GH + '1', at(18, 9)),
      appRow('Intuit', 'Software Engineer Intern, Summer 2027', GH + '2', at(28, 9))
    ];
    const rows = [REF(2, 'Intuit', 'Intern, Software Engineering', 'Queued',
                      { jobLink: GH + '1' })];
    const seen = S.outreachReferralReconcile_(rows, applications);
    assert.strictEqual(seen.retire.length, 0);
    assert.strictEqual(seen.repoint.length, 1);
    assert.strictEqual(seen.repoint[0].jobLink, GH + '2');
  });

  // The last application at a company being rejected is the other way this
  // happens, and it must not be different.
  run('a company whose only application was rejected is closed too', () => {
    const applications = [appRow('Intuit', 'SWE Intern, Summer 2027', GH + '1',
                                 at(18, 9), 'Rejected')];
    const rows = [REF(2, 'Intuit', 'SWE Intern, Summer 2027', 'Queued', { jobLink: GH + '1' })];
    assert.strictEqual(S.outreachReferralReconcile_(rows, applications).retire.length, 1);
  });

  // A sent message named a role and a link. Closing the row afterwards would leave
  // the tab describing something that was never written.
  run('a sent row is never retired, whatever happened to the application', () => {
    const rows = [REF(2, 'Intuit', 'SWE Intern, Summer 2027', 'Sent', { jobLink: GH + '1' })];
    assert.strictEqual(S.outreachReferralReconcile_(rows, []).retire.length, 0);
  });

  // A draft naming a posting the writer has moved on from is worse than none.
  run('a retired row carries its draft out to be binned', () => {
    const rows = [REF(2, 'Intuit', 'Old, Summer 2027', 'Drafted', { draftId: 'draft-7' })];
    const seen = S.outreachReferralReconcile_(rows, []);
    assert.strictEqual(seen.retire[0].draftId, 'draft-7');
  });

  // The example that started this: two software applications at one company, and
  // the newer one wins on recency once both clear the intake rule.
  run('between two qualifying applications the newest is the one asked about', () => {
    const applications = [
      appRow('Intuit', 'Software Engineering Intern, Summer 2027', GH + '1', at(18, 9)),
      appRow('Intuit', 'Software Engineer Intern, Summer 2027', GH + '2', at(28, 9))
    ];
    const rows = [REF(2, 'Intuit', 'Software Engineering Intern, Summer 2027', 'Queued',
                      { jobLink: GH + '1' })];
    assert.strictEqual(
      S.outreachReferralReconcile_(rows, applications).repoint[0].jobLink, GH + '2');
  });
}


console.log('');
if (failures.length) {
  console.log(passed + ' ok, ' + failures.length + ' FAILED');
  failures.forEach(([name, error]) => console.log('  ' + name + '\n    ' + error.stack.split('\n')[0]));
  process.exit(1);
}
console.log(passed + ' ok, 0 failures');
