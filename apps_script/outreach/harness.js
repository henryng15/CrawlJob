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
    GmailApp: {}, DriveApp: {}, ScriptApp: {}, SpreadsheetApp: {}, LockService: {},
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
  ['outreach_config.gs', 'outreach_contacts.gs', 'outreach_compose.gs', 'outreach_queue.gs',
   'outreach_send.gs', 'outreach_rejections.gs']
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
  const first = S.outreachPickContact_(people, {}, SALT);
  run('the first unused contact is chosen', () => {
    assert.strictEqual(first.contact.email, 'a@acme.com');
  });
  run('a fingerprint already in the queue is skipped, even from another application', () => {
    const used = {}; used[first.fingerprint] = true;
    assert.strictEqual(S.outreachPickContact_(people, used, SALT).contact.email, 'b@acme.com');
  });
  run('when everyone has been written to, there is no pick', () => {
    const used = {};
    people.forEach((p) => { used[S.outreachFingerprint_(p.email, SALT)] = true; });
    assert.strictEqual(S.outreachPickContact_(people, used, SALT), null);
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
  run('the projection carries the hour, so no two rows read as simultaneous', () => {
    const rows = [];
    for (let i = 0; i < 6; i++) {
      rows.push(qrow({ rowNumber: i + 2, status: 'Queued', sentAt: null, dateApplied: day(2026, 7, 21) }));
    }
    // Monday 24 Aug 2026 caps at 15, so all six land that day at six different hours.
    const plan = S.outreachProjectSchedule_(rows, day(2026, 8, 24));
    const hours = plan.map((p) => p.sendAt.getHours());
    assert.strictEqual(new Set(hours).size, 6);
    assert.ok(Math.min.apply(null, hours) >= 10);
    assert.ok(Math.max.apply(null, hours) <= 17);
  });
  run('every projected row says when it appears in Drafts and when it leaves', () => {
    const rows = [qrow({ rowNumber: 2, status: 'Queued', sentAt: null, dateApplied: day(2026, 7, 21) })];
    const slot = S.outreachProjectSchedule_(rows, day(2026, 8, 24))[0];
    assert.strictEqual(slot.draftAt.getHours(), 9);
    assert.strictEqual(slot.sendAt.getHours(), 10);
    assert.strictEqual(slot.sendAt.getTime() - slot.draftAt.getTime(), 3600000);
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
    assert.strictEqual(S.Q_WIDTH, 20);
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
    const calls = { deleted: [], formatted: [], validated: 0 };
    const sheet = {
      getLastRow: () => rows.length,
      getRange(r, c, nr) {
        return {
          getValues: () => rows.slice(r - 1, r - 1 + nr),
          setDataValidation() { calls.validated += nr; return this; },
          setNumberFormat(f) { calls.formatted.push([c, nr, f]); return this; }
        };
      },
      deleteRows(start, count) {
        calls.deleted.push([start, count]);
        rows.splice(start - 1, count);
      }
    };
    return { sheet, calls, rows };
  };
  S.SpreadsheetApp.newDataValidation = () => {
    const b = {
      requireCheckbox: () => b, setAllowInvalid: () => b, build: () => ({})
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
    assert.deepStrictEqual(columns, [S.Q_DRAFTED_AT, S.Q_SCHEDULED, S.Q_SENT_AT]);
    q.calls.formatted.forEach((f) => assert.strictEqual(f[2], S.QUEUE_TIMESTAMP_FORMAT));
    assert.ok(q.calls.validated > 0);
  });
  run('an appended row is dressed on the very next cycle', () => {
    const q = fakeQueue([H, full('Acme')]);
    S.outreachRepairQueueLayout_(q.sheet);
    q.rows.push(full('Goldman Sachs'));
    q.calls.formatted.length = 0;
    S.outreachRepairQueueLayout_(q.sheet);
    // Two data rows now, so the dressed range has to have grown to cover both.
    assert.deepStrictEqual(q.calls.formatted.map((f) => f[1]), [2, 2, 2]);
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
      [qrow({ attempt: 1, status: 'Replied', sentAt: day(2026, 8, 5) })], 3, 5, today);
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

console.log('');
if (failures.length) {
  console.log(passed + ' ok, ' + failures.length + ' FAILED');
  failures.forEach(([name, error]) => console.log('  ' + name + '\n    ' + error.stack.split('\n')[0]));
  process.exit(1);
}
console.log(passed + ' ok, 0 failures');
