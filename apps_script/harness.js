const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const SRC = require('path').join(__dirname, 'sync_applied_to_app.gs');

function makeSheet(name, data) {
  const grid = data.map((r) => r.slice());
  // A second grid holding only what setBackgrounds wrote, so a test can ask what
  // colour a row ended up rather than only that some call was made. null is a
  // cleared cell, which is what paintAppOfficialBlock_ writes to take yellow off.
  const colours = [];
  const sheet = {
    grid,
    colours,
    getName: () => name,
    setColumnWidth(column, pixels) { widths.push([column, pixels]); return this; },
    setFrozenRows(rows) { frozen.push([name, rows]); return this; },
    // Models the one thing the real insert does that these tests turn on: values
    // and conditional-format rules to the right of the new column move with it.
    // Without the second half a rule left behind at its old column would look
    // like colourQueueColumn_ had stacked a duplicate set, which it had not.
    insertColumnBefore(at) {
      grid.forEach((row) => row.splice(at - 1, 0, ''));
      formatRules[name] = (formatRules[name] || []).map((rule) => {
        const moved = rule.getRanges().map((r) => {
          const column = r.getColumn() >= at ? r.getColumn() + 1 : r.getColumn();
          return Object.assign({}, r, { getColumn: () => column });
        });
        return Object.assign({}, rule, { getRanges: () => moved });
      });
      return sheet;
    },
    // Models what the real moveColumns does that these tests turn on: the column
    // leaves where it was, arrives where it was sent, everything it passed over
    // closes up behind it, and the conditional-format rules follow the columns
    // they belong to rather than staying on a number. That last half is the
    // difference between a Status column that keeps its six colours and one that
    // comes up plain with six rules painting Mode.
    //
    // destinationIndex is in pre-move coordinates, which is what the real API
    // documents: the block lands in front of whatever column holds that number
    // now. Modelled by building the finished order as a list of old column
    // numbers, so the same permutation moves the values and renumbers the rules
    // and the two cannot disagree.
    //
    // Data validation and number formats are recorded rather than held by this
    // fake, so there is nothing here for them to travel in. What a test can ask is
    // that the values and the rules arrived at the right columns, and that setup
    // then lays the formats at the new numbers.
    moveColumns(spec, destinationIndex) {
      const from = spec.getColumn();
      const count = spec.getLastColumn() - from + 1;
      const width = Math.max(sheet.getMaxColumns(), destinationIndex);
      const order = [];
      for (let c = 1; c <= width; c++) if (c < from || c >= from + count) order.push(c);
      const cut = [];
      for (let c = from; c < from + count; c++) cut.push(c);
      let at = order.findIndex((c) => c >= destinationIndex);
      if (at === -1) at = order.length;
      order.splice(at, 0, ...cut);
      const landed = {};
      order.forEach((old, i) => { landed[old] = i + 1; });
      grid.forEach((row, r) => {
        grid[r] = order.map((old) => (row[old - 1] === undefined ? '' : row[old - 1]));
      });
      formatRules[name] = (formatRules[name] || []).map((rule) => {
        const shifted = rule.getRanges().map((r) => {
          const column = landed[r.getColumn()] || r.getColumn();
          return Object.assign({}, r, { getColumn: () => column });
        });
        return Object.assign({}, rule, { getRanges: () => shifted });
      });
      return sheet;
    },
    // The real sheet throws on a getRange past its last column, and the migration
    // reads the header of a tab narrower than the layout it is moving towards.
    // Modelled as the widest row, which is what an inserted column grows.
    getMaxColumns() {
      let widest = 0;
      grid.forEach((row) => { if (row.length > widest) widest = row.length; });
      return widest;
    },
    // The allocated height, which is what a whole-column clear covers. Modelled as
    // the grid's own length: the migration strips the checkbox the insert brought
    // with it over the full column, so rows added later do not arrive wearing one.
    getMaxRows() { return grid.length; },
    getConditionalFormatRules() { return formatRules[name] || []; },
    setConditionalFormatRules(rules) { formatRules[name] = rules; return this; },
    getLastRow() {
      let last = 0;
      grid.forEach((row, i) => {
        if (row.some((c) => c !== '' && c !== null && c !== undefined)) last = i + 1;
      });
      return last;
    },
    // The real sheet's last column holding anything, which is what
    // sortAppOfficialBlock_ asks for so that an operator column past Update
    // travels with its row. getMaxColumns above is the allocated width and is a
    // different question; answering this one with that would have the sort move
    // columns that hold nothing, which is harmless on a real sheet but would hide
    // a test that meant to check the block stops at the data.
    getLastColumn() {
      let last = 0;
      grid.forEach((row) => {
        row.forEach((c, i) => {
          if (c !== '' && c !== null && c !== undefined && i + 1 > last) last = i + 1;
        });
      });
      return last;
    },
    getRange(row, col, numRows, numCols) {
      numRows = numRows === undefined ? 1 : numRows;
      numCols = numCols === undefined ? 1 : numCols;
      return {
        getRow: () => row,
        getColumn: () => col,
        getLastRow: () => row + numRows - 1,
        getLastColumn: () => col + numCols - 1,
        getSheet: () => sheet,
        getValues() {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const line = [];
            for (let c = 0; c < numCols; c++) {
              const v = (grid[row - 1 + r] || [])[col - 1 + c];
              line.push(v === undefined ? '' : v);
            }
            out.push(line);
          }
          return out;
        },
        setValues(values) {
          for (let r = 0; r < numRows; r++) {
            while (grid.length < row + r) grid.push([]);
            for (let c = 0; c < numCols; c++) grid[row - 1 + r][col - 1 + c] = values[r][c];
          }
          // Recorded the same way painted is, so a test can ask how many block
          // writes happened rather than only what the grid ended up holding —
          // which is the difference between "the sort is one write" and "the sort
          // reached the right answer somehow".
          wrote.push([row, col, numRows, numCols]);
          return this;
        },
        setValue(v) {
          return this.setValues([[v]]);
        },
        getValue() {
          const v = (grid[row - 1] || [])[col - 1];
          return v === undefined ? '' : v;
        },
        clearContent() {
          for (let r = 0; r < numRows; r++) {
            for (let c = 0; c < numCols; c++) {
              if (grid[row - 1 + r]) grid[row - 1 + r][col - 1 + c] = '';
            }
          }
          return this;
        },
        // Recorded rather than simulated: what the tests need to know is that the
        // migration cleared the column the insert had just given a checkbox to.
        clearDataValidations() { cleared.push([row, col, numRows, numCols]); return this; },
        setBackground() { return this; },
        // Recorded rather than ignored, so a test can ask which columns got the
        // timestamp format. A layout change that moved Sent At and left this
        // number behind would put the format on Gmail Draft ID and leave the send
        // time rendering as a bare serial, which no assertion about the header
        // list would have caught.
        setNumberFormat(format) { formats.push([col, numCols, format]); return this; },
        setBackgrounds(values) {
          for (let r = 0; r < numRows; r++) {
            while (colours.length < row + r) colours.push([]);
            for (let c = 0; c < numCols; c++) colours[row - 1 + r][col - 1 + c] = values[r][c];
          }
          painted.push([row, col, numRows, numCols]);
          return this;
        },
        // Two records, not one. `validated` keeps the position-only tuple the tests
        // written before rules were modelled already assert on; `validatedRules`
        // carries what kind of rule landed there, which is the difference between
        // "column M was validated" and "column M got a checkbox rather than the
        // Mode dropdown the insert would have given it".
        setDataValidation(rule) {
          validated.push([row, col, numRows, numCols]);
          validatedRules.push([row, col, numRows, numCols, rule]);
          return this;
        },
        setWrapStrategy(strategy) { wrapped.push([col, strategy]); return this; },
        setFontWeight() { return this; },
        setBackground() { return this; },
        setHorizontalAlignment() { return this; },
        copyTo(dest, type) { copied.push([row, type]); copiedWidth = numCols; return this; },
      };
    },
  };
  return sheet;
}

let copied = [];
let painted = [];
let wrote = [];
let toasts = [];
let wrapped = [];
let validated = [];
let cleared = [];
let formats = [];
let validatedRules = [];
let copiedWidth = 0;
let widths = [];
let frozen = [];
let formatRules = {};
// The project's installed triggers, as ScriptApp would hand them back. Kept as
// objects rather than names because removeAppOfficialTrigger deletes by identity,
// which is the only way a remover can tell two triggers on one handler apart.
let triggers = [];
let jobs, app, outreach, referral, ss;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function load() {
  copied = [];
  painted = [];
  wrote = [];
  toasts = [];
  wrapped = [];
  validated = [];
  validatedRules = [];
  cleared = [];
  formats = [];
  copiedWidth = 0;
  widths = [];
  frozen = [];
  triggers = [];
  ss = {
    getSheetByName: (n) => (
      n === 'Jobs' ? jobs : n === 'App' ? app : n === 'Email' ? outreach
        : n === 'Referral' ? referral : null
    ),
    insertSheet(name) {
      if (name === 'Email') return (outreach = makeSheet(name, []));
      if (name === 'Referral') return (referral = makeSheet(name, []));
      throw new Error('unexpected sheet ' + name);
    },
    toast: (msg) => toasts.push(msg),
  };
  // A fresh builder per call rather than one shared object, and one that keeps
  // what it was asked for. The Cancel column is the reason: the whole risk the
  // migration guards against is column M ending up with Mode's list rule instead
  // of a checkbox, and a builder that threw its arguments away could not tell the
  // two apart. allowInvalid is left null when nothing set it, so a test can assert
  // that the checkbox rule deliberately did NOT pass setAllowInvalid(false) —
  // which would flag every hand-filled row on the tab as an error.
  const newValidation = () => {
    const rule = { kind: '', list: null, allowInvalid: null };
    const builder = {
      requireCheckbox() { rule.kind = 'checkbox'; return builder; },
      requireValueInList(list) { rule.kind = 'list'; rule.list = Array.from(list); return builder; },
      setAllowInvalid(value) { rule.allowInvalid = value; return builder; },
      setHelpText() { return builder; },
      build: () => rule,
    };
    return builder;
  };
  const sandbox = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      newDataValidation: newValidation,
      newConditionalFormatRule() {
        const rule = { ranges: [], background: '', fontColor: '', text: '' };
        const builder = {
          whenTextEqualTo(text) { rule.text = text; return builder; },
          setBackground(colour) { rule.background = colour; return builder; },
          setFontColor(colour) { rule.fontColor = colour; return builder; },
          setRanges(ranges) { rule.ranges = ranges; return builder; },
          build: () => ({
            getRanges: () => rule.ranges,
            text: rule.text, background: rule.background, fontColor: rule.fontColor
          })
        };
        return builder;
      },
      CopyPasteType: { PASTE_DATA_VALIDATION: 'PASTE_DATA_VALIDATION' },
      WrapStrategy: { WRAP: 'WRAP' },
    },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    // Enough of ScriptApp to answer the one question the tests ask of it: which
    // handler is on the clock afterwards. The builder records what it was asked
    // for rather than throwing it away, because "hourly" and "points at the new
    // entry point" are two different ways an install can be wrong.
    ScriptApp: {
      newTrigger(handler) {
        const spec = { handler, kind: '', hours: 0 };
        const builder = {
          timeBased() { spec.kind = 'timeBased'; return builder; },
          everyHours(n) { spec.hours = n; return builder; },
          create() {
            const trigger = Object.assign({}, spec,
              { getHandlerFunction: () => spec.handler });
            triggers.push(trigger);
            return trigger;
          },
        };
        return builder;
      },
      // A copy, the way the real one hands back a list: the remover iterates it
      // while deleting out of the live set, and a fake that returned the live
      // array would skip every second trigger as the indices shifted under it.
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger(trigger) { triggers = triggers.filter((t) => t !== trigger); },
    },
    Utilities: {
      // Enough for UPDATE_DATE_FORMAT, the only format the .gs file uses. Throw
      // rather than return something plausible, so that changing the format over
      // there and forgetting this turns the tests red instead of quiet.
      formatDate(date, timeZone, format) {
        if (format !== 'MMM d, yyyy') throw new Error('the harness does not understand the format ' + format);
        return MONTHS[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox);
  return sandbox;
}

const JOBS_HEADER = ['Company', 'Role', 'Link Apply', 'Date Posted', 'Source',
                    'Applied', 'Expired'];
// The checkbox columns in the grid, 0-based: Source pushed in ahead of them, so
// both shifted one to the right.
const APPLIED = 5, EXPIRED = 6;
const APP_HEADER = ['Property', 'Company', 'Application Link', 'Date Applied',
                    'Location (State)', 'Process', 'Role', 'Note'];

/** Today's date, written exactly the way stamp() in the .gs file writes it. */
function today() {
  const now = new Date();
  return MONTHS[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear();
}

function freshJobs() {
  return makeSheet('Jobs', [
    JOBS_HEADER,
    // App holds this job under a greenhouse link while Jobs holds the jobright one.
    ['IBM', 'Software Engineering Intern', 'https://jobright.ai/jobs/info/abc', '2026-08-14', 'Jobright', false, false],
    // The same link as App's, differing only by a trailing / and utm parameters.
    ['Notion', 'Software Engineer Intern',
     'https://jobs.ashbyhq.com/notion/1?utm_source=Simplify', '2026-08-15', 'Simplify', false, false],
    // Never applied to.
    ['Neuralink', 'Firmware Engineer Intern', 'https://jobright.ai/jobs/info/xyz', '2026-08-16', 'Ashby', false, false],
  ]);
}

function freshApp() {
  return makeSheet('App', [
    APP_HEADER,
    [1, 'IBM', 'https://job-boards.greenhouse.io/ibm/jobs/9', 'July 21, 2026', '', 'Applied',
     'Software Engineering  Intern', ''],
    [2, 'Notion', 'https://jobs.ashbyhq.com/notion/1/', 'July 26, 2026', '', 'OA',
     'Software Engineer Intern', ''],
    // A stray row carrying only a link, like the real ones already in App.
    ['', '', 'https://bambusdev.example/job/1', '', '', '', '', ''],
  ]);
}

let passed = 0;
let failed = 0;

function run(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL ' + name + '\n       ' + err.message);
    process.exitCode = 1;
  }
}

// Counted and printed at the bottom rather than left to be eyeballed: a test that
// stops being reached — a block that throws before its run() calls — disappears
// silently otherwise, and a shrinking suite looks exactly like a passing one.
process.on('exit', () => {
  console.log('\n' + passed + ' ok, ' + failed + ' failures');
});

console.log('normalizeLink / identity');
{
  const s = load();
  run('utm and a trailing slash do not make one link into two jobs', () => {
    assert.strictEqual(
      s.normalizeLink('https://jobs.ashbyhq.com/notion/1?utm_source=Simplify&ref=Simplify'),
      s.normalizeLink('https://JOBS.ashbyhq.com/notion/1/')
    );
  });
  run('a parameter that identifies the posting itself is kept', () => {
    assert.notStrictEqual(
      s.normalizeLink('https://boards.example/j?gh_jid=1'),
      s.normalizeLink('https://boards.example/j?gh_jid=2')
    );
  });
  run('punctuation and extra whitespace do not split one job into two', () => {
    assert.strictEqual(
      s.identity('IBM', 'Software Engineering  Intern'),
      s.identity('ibm.', 'Software-Engineering Intern')
    );
  });
  run('with no company or no role there is no identity to match on', () => {
    assert.strictEqual(s.identity('', 'SWE Intern'), '');
    assert.strictEqual(s.identity('IBM', ''), '');
  });
}

console.log('backfillTicksFromApp');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  s.backfillTicksFromApp();
  run('Notion is ticked by link, IBM by company + role', () => {
    assert.strictEqual(jobs.grid[1][APPLIED], true, 'IBM');
    assert.strictEqual(jobs.grid[2][APPLIED], true, 'Notion');
  });
  run('a job not yet applied to is left alone', () => {
    assert.strictEqual(jobs.grid[3][APPLIED], false, 'Neuralink');
  });
  run('the toast reports the two kinds of match separately', () => {
    assert.match(toasts[0], /2 rows: 1 matched by link, 1 by company \+ role/);
  });
  run('the backfill touches nothing in App', () => {
    assert.strictEqual(app.getLastRow(), 4);
  });
}

console.log('the backfill run a second time');
{
  const s = load();
  s.backfillTicksFromApp();
  run('there is nothing further to tick', () => {
    assert.match(toasts[0], /No further rows to tick/);
  });
}

console.log('onEdit');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  // onEdit runs after the cell has already changed, so it must be true before firing.
  jobs.grid[3][APPLIED] = true;
  s.onEdit({ source: ss, range: jobs.getRange(4, APPLIED + 1, 1, 1) });
  run('ticking a job not yet in App adds a row', () => {
    assert.strictEqual(app.getLastRow(), 5);
  });
  run('Property continues from the largest number, not from the row count', () => {
    assert.strictEqual(app.grid[4][0], 3);
  });
  run('Company, link, Process and Role land in the right columns', () => {
    const row = app.grid[4];
    assert.strictEqual(row[1], 'Neuralink');
    assert.strictEqual(row[2], 'https://jobright.ai/jobs/info/xyz');
    assert.strictEqual(row[5], 'Applied');
    assert.strictEqual(row[6], 'Firmware Engineer Intern');
  });
  run('Date Applied is today', () => {
    // instanceof is no use here: a Date made inside the vm is from another realm.
    const written = app.grid[4][3];
    assert.strictEqual(Object.prototype.toString.call(written), '[object Date]');
    assert.strictEqual(written.toDateString(), new Date().toDateString());
  });
  run('Location is left empty because Jobs does not carry it', () => {
    assert.strictEqual(app.grid[4][4], '');
  });
  run('validation is copied from the last entry row, not from a link-only stray row', () => {
    assert.deepStrictEqual(copied, [[3, 'PASTE_DATA_VALIDATION']]);
  });
}

console.log('onEdit — the cases where it must do nothing');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();

  s.onEdit({ source: ss, range: jobs.getRange(2, 3, 1, 1) });
  run('an edit to another column is ignored', () => assert.strictEqual(app.getLastRow(), 4));

  jobs.grid[3][APPLIED] = false;
  s.onEdit({ source: ss, range: jobs.getRange(4, APPLIED + 1, 1, 1) });
  run('unticking does nothing', () => assert.strictEqual(app.getLastRow(), 4));

  jobs.grid[2][APPLIED] = true;
  s.onEdit({ source: ss, range: jobs.getRange(3, APPLIED + 1, 1, 1) });
  run('ticking a job already in App under that link is ignored', () => {
    assert.strictEqual(app.getLastRow(), 4);
    assert.match(toasts[toasts.length - 1], /Added no rows/);
  });

  jobs.grid[1][APPLIED] = true;
  s.onEdit({ source: ss, range: jobs.getRange(2, APPLIED + 1, 1, 1) });
  run('onEdit does NOT match by name: a different link is still recorded', () => {
    assert.strictEqual(app.getLastRow(), 5);
  });
}

console.log('onEdit — filling down many rows');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  jobs.grid[1][APPLIED] = true;
  jobs.grid[2][APPLIED] = true;
  jobs.grid[3][APPLIED] = true;
  s.onEdit({ source: ss, range: jobs.getRange(2, APPLIED + 1, 3, 1) });
  run('the whole block is handled, and no two Property numbers collide', () => {
    assert.strictEqual(app.getLastRow(), 6);
    assert.strictEqual(app.grid[4][0], 3);
    assert.strictEqual(app.grid[5][0], 4);
  });
  run('a row already in App is still skipped inside the block', () => {
    assert.match(toasts[toasts.length - 1], /Added 2 rows.*Skipped 1 row/);
  });
}

console.log('onEdit — Expired stops a row reaching App');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  jobs.grid[3][APPLIED] = true;   // Applied
  jobs.grid[3][EXPIRED] = true;   // Expired
  s.onEdit({ source: ss, range: jobs.getRange(4, APPLIED + 1, 1, 1) });
  run('ticking Applied on an Expired row adds nothing', () => {
    assert.strictEqual(app.getLastRow(), 4);
  });
  run('the toast says why the row was skipped', () => {
    assert.match(toasts[toasts.length - 1], /Skipped 1 row ticked Expired/);
  });

  jobs.grid[1][APPLIED] = true;   // IBM: Applied, not Expired
  s.onEdit({ source: ss, range: jobs.getRange(2, APPLIED + 1, 3, 1) });
  run('inside one block, a row that is not Expired still goes across', () => {
    assert.strictEqual(app.getLastRow(), 5);
    assert.strictEqual(app.grid[4][1], 'IBM');
  });
  run('a mixed block counts the two reasons for skipping separately', () => {
    assert.match(toasts[toasts.length - 1], /Added 1 row.*Skipped 1 row ticked Expired/s);
  });

  jobs.grid[3][EXPIRED] = false;  // take Expired off again
  s.onEdit({ source: ss, range: jobs.getRange(4, APPLIED + 1, 1, 1) });
  run('once Expired comes off, that row can go across', () => {
    assert.strictEqual(app.getLastRow(), 6);
    assert.strictEqual(app.grid[5][1], 'Neuralink');
  });
}

console.log('setupJobsCheckboxes');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  s.setupJobsCheckboxes();
  run('it builds the header for both columns', () => {
    assert.strictEqual(jobs.grid[0][APPLIED], 'Applied');
    assert.strictEqual(jobs.grid[0][EXPIRED], 'Expired');
  });
}

console.log('setupOutreachQueue');
{
  jobs = freshJobs();
  app = freshApp();
  outreach = null;
  const s = load();
  s.setupOutreachQueue();
  run('the two timestamps sit together, so one glance says written-then-goes', () => {
    const header = Array.from(s.OUTREACH_HEADERS);
    assert.strictEqual(header[7], 'Drafted At');
    assert.strictEqual(header[8], 'Scheduled At');
  });
  run('it creates the tab with the queue header only', () => {
    assert.ok(outreach);
    // OUTREACH_HEADERS came from the vm context, so copy it into this realm
    // before comparing it with the fake sheet's normal JavaScript array.
    assert.deepStrictEqual(outreach.grid[0], Array.from(s.OUTREACH_HEADERS));
    assert.strictEqual(outreach.getLastRow(), 1);
  });
  run('it freezes the header and validates the four dropdown columns without adding rows', () => {
    assert.deepStrictEqual(frozen, [['Email', 1]]);
    // Left to right: Priority, then Status and Mode, once the six columns a human
    // reads and the two timestamps lead the table. Follow Up Status is the fourth,
    // two columns further right, with the booked day and the template between.
    assert.deepStrictEqual(validated.slice(-4),
      [[2, 10, 499, 1], [2, 11, 499, 1], [2, 12, 499, 1], [2, 15, 499, 1]]);
    assert.strictEqual(outreach.getLastRow(), 1);
  });
  run('Priority is the column left of Status, and Version is still last', () => {
    const header = Array.from(s.OUTREACH_HEADERS);
    assert.strictEqual(header[9], 'Priority');
    assert.strictEqual(header[10], 'Status');
    assert.strictEqual(header[header.length - 1], 'Version');
    assert.strictEqual(header.length, 23);
  });
  run('the three follow-up columns sit immediately after Mode', () => {
    const header = Array.from(s.OUTREACH_HEADERS);
    assert.strictEqual(header[11], 'Mode');
    assert.strictEqual(header[12], 'Follow Up');
    assert.strictEqual(header[13], 'Follow Up Template');
    assert.strictEqual(header[14], 'Follow Up Status');
    // And the audit references start straight after them, where they always were
    // relative to the machinery rather than to a fixed number.
    assert.strictEqual(header[15], 'Contact Fingerprint');
  });
  run('Follow Up Status is coloured by value, and Queued is left plain there too', () => {
    const rules = (formatRules['Email'] || [])
      .filter((r) => r.getRanges()[0].getColumn() === 15);
    assert.strictEqual(rules.length, 5);
    assert.ok(!rules.some((r) => r.text === 'Queued'));
    rules.forEach((r) => assert.ok(
      Array.from(s.OUTREACH_FOLLOWUP_STATUS).indexOf(r.text) !== -1, r.text));
  });
  run('Status and Mode are coloured by value, and Queued is left plain', () => {
    const rules = formatRules['Email'] || [];
    const status = rules.filter((r) => r.getRanges()[0].getColumn() === 11);
    const mode = rules.filter((r) => r.getRanges()[0].getColumn() === 12);
    assert.strictEqual(status.length, 6);
    assert.strictEqual(mode.length, 2);
    assert.ok(!status.some((r) => r.text === 'Queued'));
    assert.strictEqual(status.filter((r) => r.text === 'Replied')[0].background, '#D9EAD3');
    assert.strictEqual(status.filter((r) => r.text === 'Bounced')[0].fontColor, '#CC0000');
  });
  run('every colour rule names a status that really exists', () => {
    const named = (formatRules['Email'] || [])
      .filter((r) => r.getRanges()[0].getColumn() === 11).map((r) => r.text);
    named.forEach((name) => assert.ok(Array.from(s.OUTREACH_STATUS).indexOf(name) !== -1, name));
  });
  run('running it again is idempotent and does not stack a second set of rules', () => {
    const before = (formatRules['Email'] || []).length;
    s.setupOutreachQueue();
    assert.strictEqual(outreach.getLastRow(), 1);
    assert.strictEqual((formatRules['Email'] || []).length, before);
    assert.match(toasts[toasts.length - 1], /No queue items changed/);
  });
}

console.log('migrateOutreachPriorityColumn — opening a gap on a tab that is already live');
{
  // The tab exactly as it stood before Priority existed: Status at column 10.
  const OLD_HEADER = [
    'Company', 'Role', 'Date Applied', 'Property', 'Recruiters', 'Attempt',
    'Template', 'Drafted At', 'Scheduled At', 'Status', 'Mode',
    'Contact Fingerprint', 'Gmail Draft ID', 'Gmail Message ID', 'Sent At',
    'Result', 'Last Error', 'Queue ID', 'Version'
  ];
  const oldRow = (company, status) => [
    company, 'SWE Intern', 'Aug 1, 2026', '12', 3, 1, 'a', '', '', status, 'Send',
    'fp-' + company, 'draft-1', '', '', '', '', 'P12-A1', 1
  ];
  const freshOld = () => makeSheet('Email', [OLD_HEADER, oldRow('Acme', 'Sent'),
                                             oldRow('Stripe', 'Queued')]);

  {
    jobs = freshJobs(); app = freshApp();
    const s = load();
    outreach = freshOld();
    s.migrateOutreachPriorityColumn();

    run('the header ends up as the new layout, Priority ahead of Status', () => {
      assert.deepStrictEqual(outreach.grid[0], Array.from(s.OUTREACH_HEADERS));
    });
    run('every value to the right of both gaps moved with them', () => {
      // Two migrations in one call: Status was column 10 and is column 11, and
      // everything from Contact Fingerprint on moved three further right again.
      // This is the half a header rewrite over live data would have got wrong.
      assert.strictEqual(outreach.grid[1][9], '');
      assert.strictEqual(outreach.grid[1][10], 'Sent');
      assert.strictEqual(outreach.grid[1][11], 'Send');
      assert.strictEqual(outreach.grid[2][10], 'Queued');
      // The three new columns are opened empty. A migration adds a place to put
      // something; the planner is what puts anything in it.
      assert.strictEqual(outreach.grid[1][12], '');
      assert.strictEqual(outreach.grid[1][13], '');
      assert.strictEqual(outreach.grid[1][14], '');
      assert.strictEqual(outreach.grid[1][15], 'fp-Acme');
      assert.strictEqual(outreach.grid[1][16], 'draft-1');
      assert.strictEqual(outreach.grid[1][21], 'P12-A1');
      assert.strictEqual(outreach.grid[1][22], 1);
    });
    run('the rows themselves are left alone — a migration adds a column, not data', () => {
      assert.strictEqual(outreach.getLastRow(), 3);
      assert.strictEqual(outreach.grid[1][0], 'Acme');
      assert.strictEqual(outreach.grid[2][0], 'Stripe');
    });
    run('the colour rules follow Status and Mode rather than stacking at the old columns', () => {
      const rules = formatRules['Email'] || [];
      assert.strictEqual(rules.filter((r) => r.getRanges()[0].getColumn() === 10).length, 0);
      assert.strictEqual(rules.filter((r) => r.getRanges()[0].getColumn() === 11).length, 6);
      assert.strictEqual(rules.filter((r) => r.getRanges()[0].getColumn() === 12).length, 2);
    });
    run('the toast says to deploy the sender before the trigger goes back on', () => {
      assert.match(toasts[toasts.length - 1], /Deploy the sender now/);
    });
    run('running it again does not open a second gap', () => {
      const width = outreach.grid[0].length;
      s.migrateOutreachPriorityColumn();
      assert.strictEqual(outreach.grid[0].length, width);
      assert.deepStrictEqual(outreach.grid[0], Array.from(s.OUTREACH_HEADERS));
      assert.strictEqual(outreach.grid[1][10], 'Sent');
      assert.strictEqual(outreach.grid[1][15], 'fp-Acme');
      assert.match(toasts[toasts.length - 1], /already on the current layout/);
    });
  }

  {
    jobs = freshJobs(); app = freshApp();
    const s = load();
    outreach = makeSheet('Email', [OLD_HEADER.slice()]);
    outreach.grid[0][9] = 'Something Else';
    run('a tab somebody has already rearranged is refused, and named in the error', () => {
      assert.throws(() => s.migrateOutreachPriorityColumn(), /Something Else/);
    });
    run('the refusal moves nothing', () => {
      assert.strictEqual(outreach.grid[0].length, OLD_HEADER.length);
    });
  }

  {
    jobs = freshJobs(); app = freshApp();
    outreach = null;
    const s = load();
    run('with no Email tab at all it just builds the current layout', () => {
      s.migrateOutreachPriorityColumn();
      assert.deepStrictEqual(outreach.grid[0], Array.from(s.OUTREACH_HEADERS));
      assert.strictEqual(outreach.getLastRow(), 1);
    });
  }
}

console.log('stageLabel / hasStage / stamp');
{
  const s = load();
  run('any casing resolves to one stage name', () => {
    assert.strictEqual(s.stageLabel('oa'), 'OA');
    assert.strictEqual(s.stageLabel('  Rejected '), 'Rejected');
  });
  run('a value outside the pipeline is not a stage', () => {
    assert.strictEqual(s.stageLabel('Phone screen'), '');
    assert.strictEqual(s.stageLabel(''), '');
  });
  run('hasStage reads what precedes the colon', () => {
    const cell = 'Applied: Jul 21, 2026\nOA: Aug 1, 2026';
    assert.strictEqual(s.hasStage(cell, 'OA'), true);
    assert.strictEqual(s.hasStage(cell, 'Offer'), false);
  });
  run('Completed OA is its own stage, not the OA line read loosely', () => {
    // Two stage names where one is a suffix of the other. Both the label lookup
    // and the history check compare whole names, so having taken the assessment
    // and having finished it stay two separate lines.
    assert.strictEqual(s.stageLabel('completed oa'), 'Completed OA');
    const cell = 'Applied: Jul 21, 2026\nOA: Aug 1, 2026';
    assert.strictEqual(s.hasStage(cell, 'Completed OA'), false);
    assert.strictEqual(s.hasStage(cell + '\nCompleted OA: Aug 9, 2026', 'OA'), true);
    assert.strictEqual(s.hasStage(cell + '\nCompleted OA: Aug 9, 2026', 'Completed OA'), true);
  });
  run('an empty cell holds no stage yet', () => {
    assert.strictEqual(s.hasStage('', 'Applied'), false);
  });
  run('a date that cannot be read becomes ?, not an empty string', () => {
    assert.strictEqual(s.stamp(''), '?');
    assert.strictEqual(s.stamp('July 21, 2026'), 'July 21, 2026');
  });
}

console.log('Jobs → App: seeding the first Update line');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  jobs.grid[3][APPLIED] = true;   // Neuralink: Applied
  s.onEdit({ source: ss, range: jobs.getRange(4, APPLIED + 1, 1, 1) });
  run('a row that has just reached App already carries the Applied stage', () => {
    assert.strictEqual(app.grid[4][11], 'Applied: ' + today());
  });
  run('the Update column is set to WRAP, or the cell would show only its first line', () => {
    assert.ok(wrapped.some((call) => call[0] === 12 && call[1] === 'WRAP'));
  });
}

console.log('onAppEdit');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();

  s.onEdit({ source: ss, range: app.getRange(3, 6, 1, 1) });   // Notion is at OA
  run('changing Process writes one "<Stage>: <date>" line', () => {
    assert.strictEqual(app.grid[2][11], 'OA: ' + today());
  });
  run('the toast names the date it just wrote', () => {
    assert.match(toasts[toasts.length - 1], /Wrote .+ to the Update column of 1 row/);
  });

  s.onEdit({ source: ss, range: app.getRange(3, 6, 1, 1) });
  run('firing again on the stage already set writes no further line', () => {
    assert.strictEqual(app.grid[2][11], 'OA: ' + today());
  });

  app.grid[2][5] = 'Completed OA';
  s.onEdit({ source: ss, range: app.getRange(3, 6, 1, 1) });
  run('finishing the assessment appends its own line under OA', () => {
    assert.strictEqual(app.grid[2][11], 'OA: ' + today() + '\nCompleted OA: ' + today());
  });

  app.grid[2][5] = 'Interview';
  s.onEdit({ source: ss, range: app.getRange(3, 6, 1, 1) });
  run('a new stage is appended below and the old ones are left as they were', () => {
    assert.strictEqual(
      app.grid[2][11],
      'OA: ' + today() + '\nCompleted OA: ' + today() + '\nInterview: ' + today());
  });

  app.grid[2][5] = 'OA';
  s.onEdit({ source: ss, range: app.getRange(3, 6, 1, 1) });
  run('going back to a stage already passed does not write it twice', () => {
    assert.strictEqual(app.grid[2][11].split('\n').length, 3);
  });

  const kept = app.grid[2][11];
  s.onEdit({ source: ss, range: app.getRange(3, 8, 1, 1) });   // the Note column
  run('an edit to another column leaves the Update column alone', () => {
    assert.strictEqual(app.grid[2][11], kept);
  });

  app.grid[2][5] = 'Offer';
  app.grid[3][5] = 'Phone screen';
  s.onEdit({ source: ss, range: app.getRange(3, 6, 2, 1) });
  run('inside one block a valid stage is written and an unrecognised value is not', () => {
    assert.match(app.grid[2][11], /Offer: /);
    assert.ok(!app.grid[3][11]);
  });
}

console.log('setupAppColumns');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  s.setupAppColumns();
  run('it builds the header in column L', () => {
    assert.strictEqual(app.grid[0][11], 'Update');
  });
  run('a row sitting at Applied takes its date from Date Applied', () => {
    assert.strictEqual(app.grid[1][11], 'Applied: July 21, 2026');
  });
  run('a row that has gone further marks the later stage ? rather than inventing a date', () => {
    assert.strictEqual(app.grid[2][11], 'Applied: July 26, 2026\nOA: ?');
  });
  run('a row with only a link and no Process is not an entry', () => {
    assert.ok(!app.grid[3][11]);
  });
  run('the toast counts the rows still needing to be filled in by hand separately', () => {
    assert.match(toasts[toasts.length - 1], /Filled in 2 rows.*1 at a stage past Applied/s);
  });
  run('it builds the header for Official and for the two checkbox columns', () => {
    assert.strictEqual(app.grid[0][8], 'Official');
    assert.strictEqual(app.grid[0][9], 'Alumni');
    assert.strictEqual(app.grid[0][10], 'Recruiter');
  });
  run('Official is wide enough to read, the checkboxes are narrow, Update is wide', () => {
    assert.deepStrictEqual(widths, [[9, 230], [10, 70], [11, 90], [12, 300]]);
  });
  run('the checkboxes cover only as far as the real last row, not to LAST_ROW', () => {
    // Covering to 500 would make the validation physically write FALSE all the way
    // down, getLastRow() would return 500, and onEdit would append new rows at 501.
    const boxes = validated.filter((call) => call[1] === 10);
    assert.strictEqual(boxes.length, 1);
    assert.deepStrictEqual(boxes[0], [2, 10, 3, 2]);  // J2:K4, exactly the 3 rows there are
  });
  run('the checkbox validation does not spill onto Official, which is free text', () => {
    // The trap: leave the range starting at column 9 and every pasted link comes
    // back as an invalid entry against a checkbox rule.
    assert.strictEqual(validated.filter((call) => call[1] === 9).length, 0);
  });

  const kept = app.grid[1][11];
  app.grid[2][11] = 'Applied: July 26, 2026\nOA: Aug 1, 2026';
  s.setupAppColumns();
  run('running again does not overwrite a cell that already has text', () => {
    assert.strictEqual(app.grid[1][11], kept);
    assert.strictEqual(app.grid[2][11], 'Applied: July 26, 2026\nOA: Aug 1, 2026');
  });
  run('the second run has nothing left to fill in', () => {
    assert.match(toasts[toasts.length - 1], /All four columns are already right/);
  });
}

console.log('setupAppColumns — a tab still on the layout before Official');
{
  jobs = freshJobs();
  app = freshApp();
  app.grid[0][8] = 'Alumni';
  app.grid[0][9] = 'Recruiter';
  app.grid[0][10] = 'Update';
  const s = load();
  run('it refuses rather than writing Official over the Alumni header', () => {
    // Writing the four headers blind here would leave every row's ticks and
    // history one column left of the name describing them — an alumnus recorded
    // at every company that merely has a recruiter.
    assert.throws(() => s.setupAppColumns(), /App column 9 is "Alumni"/);
  });
  run('and it says which function opens the gap', () => {
    assert.throws(() => s.setupAppColumns(), /migrateAppOfficialColumn/);
  });
  run('the refusal writes nothing', () => {
    assert.strictEqual(app.grid[0][8], 'Alumni');
    assert.deepStrictEqual(widths, []);
  });
}

console.log('setupAppColumns — moving the Update column from J to Update');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  // The sheet of someone who ran yesterday's version: the history is in column J.
  app.grid[0][9] = 'Update';
  app.grid[1][9] = 'Applied: Jul 21, 2026';
  app.grid[2][9] = 'Applied: Jul 26, 2026\nOA: Aug 1, 2026';
  s.setupAppColumns();

  run('the history lands under the Update header rather than one column short', () => {
    // The destination follows UPDATE_COL, which Official pushed from K to L.
    // Pinned to K, as it was written, this would drop a year of history into
    // Recruiter's column and leave Update empty beside it.
    assert.strictEqual(app.grid[0][11], 'Update');
    assert.strictEqual(app.grid[1][11], 'Applied: Jul 21, 2026');
    assert.strictEqual(app.grid[2][11], 'Applied: Jul 26, 2026\nOA: Aug 1, 2026');
  });
  run('the source stays column J, which is where these old sheets really keep it', () => {
    // Read through the constants the source would now be K, and every one of
    // these sheets would be told it had nothing to move.
    assert.strictEqual(app.grid[0][9], 'Alumni');
    assert.strictEqual(app.grid[1][9], '');
    assert.strictEqual(app.grid[2][9], '');
  });
  run('the toast says how many rows it moved', () => {
    assert.match(toasts[toasts.length - 1], /Moved 2 rows of history from column J to L/);
  });

  const kept = app.grid[2][11];
  s.setupAppColumns();
  run('running again does not move a second time — text in Update means stand still', () => {
    assert.strictEqual(app.grid[2][11], kept);
    assert.strictEqual(app.grid[0][9], 'Alumni');
  });
}

console.log('onEdit — a new row picks up the validation of both checkboxes');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  jobs.grid[3][APPLIED] = true;
  s.onEdit({ source: ss, range: jobs.getRange(4, APPLIED + 1, 1, 1) });
  run('validation is copied out to the end of Recruiter, not stopping at APP_WIDTH', () => {
    // APP_WIDTH is the eight columns the sync writes; the two checkboxes are
    // validation too, and Official pushed them a column right. Copying to 10
    // would now stop on Alumni and leave Recruiter printing a bare FALSE.
    assert.strictEqual(copied.length, 1);
    assert.strictEqual(copied[0][1], 'PASTE_DATA_VALIDATION');
    assert.strictEqual(copiedWidth, 11);
  });
}

console.log('setupReferralQueue');
{
  jobs = freshJobs();
  app = freshApp();
  referral = null;
  const s = load();
  s.setupReferralQueue();
  run('it creates the tab with the header only', () => {
    assert.ok(referral);
    assert.deepStrictEqual(referral.grid[0], Array.from(s.REFERRAL_HEADERS));
    assert.strictEqual(referral.getLastRow(), 1);
  });
  run('twenty columns, with Priority at 10, Status at 11, Mode at 12, Cancel at 13', () => {
    const header = Array.from(s.REFERRAL_HEADERS);
    assert.strictEqual(header.length, 20);
    assert.strictEqual(header[9], 'Priority');
    assert.strictEqual(header[10], 'Status');
    assert.strictEqual(header[11], 'Mode');
    assert.strictEqual(header[12], 'Cancel');
    assert.strictEqual(header[header.length - 1], 'Version');
  });
  run('the whole twenty, in order, so a silent reshuffle cannot pass', () => {
    assert.deepStrictEqual(Array.from(s.REFERRAL_HEADERS), [
      'Company', 'Role', 'Person', 'Email', 'Title', 'Tier', 'Template', 'Drafted At',
      'Scheduled At', 'Priority', 'Status', 'Mode', 'Cancel', 'Job Link',
      'Gmail Draft ID', 'Sent At', 'Result', 'Last Error', 'Queue ID', 'Version'
    ]);
  });
  run('Job Link is out at 14, not third where it crushed the readable columns', () => {
    // A URL is the widest thing on the tab and the one nobody reads. Parked third
    // it pushed Person, Email and Title off the right-hand edge, so the tab could
    // not answer the one question it exists to answer without scrolling.
    const header = Array.from(s.REFERRAL_HEADERS);
    assert.strictEqual(header[13], 'Job Link');
    assert.strictEqual(s.REFERRAL_JOB_LINK, 14);
    assert.strictEqual(header.indexOf('Job Link'), 13);   // and nowhere else
  });
  run('Priority leads Status, the way it does on the Email tab', () => {
    // The two read as one answer: whether this row was asked for, and where it has
    // got to. Read apart they are two scrolls; read together they are one line.
    const header = Array.from(s.REFERRAL_HEADERS);
    const email = Array.from(s.OUTREACH_HEADERS);
    assert.deepStrictEqual(header.slice(9, 11), ['Priority', 'Status']);
    assert.deepStrictEqual(email.slice(9, 11), ['Priority', 'Status']);
    assert.strictEqual(s.REFERRAL_PRIORITY, 10);
  });
  run('the four columns a person touches are one contiguous run', () => {
    // The reason Cancel is at 13 and not out past the machinery: calling a row
    // off should not mean scrolling five columns of ids and error text on a tab
    // wide enough that the person's name has already left the screen. Priority
    // joins that run at its head rather than sitting out beyond Job Link.
    const header = Array.from(s.REFERRAL_HEADERS);
    assert.deepStrictEqual(header.slice(9, 13),
                           ['Priority', 'Status', 'Mode', 'Cancel']);
    assert.strictEqual(s.REFERRAL_PRIORITY, 10);
    assert.strictEqual(s.REFERRAL_STATUS, 11);
    assert.strictEqual(s.REFERRAL_MODE, 12);
    assert.strictEqual(s.REFERRAL_CANCEL, 13);
  });
  run('the column constants agree with the header list they index into', () => {
    // The two drifting apart is the silent corruption: every column involved
    // holds a plausible value for its neighbour, so a stale number clears the
    // wrong pair of timestamps on a row it has just cancelled and nothing looks
    // wrong on the tab.
    const header = Array.from(s.REFERRAL_HEADERS);
    assert.strictEqual(header[s.REFERRAL_DRAFTED_AT - 1], 'Drafted At');
    assert.strictEqual(header[s.REFERRAL_SCHEDULED_AT - 1], 'Scheduled At');
    assert.strictEqual(header[s.REFERRAL_PRIORITY - 1], 'Priority');
    assert.strictEqual(header[s.REFERRAL_STATUS - 1], 'Status');
    assert.strictEqual(header[s.REFERRAL_MODE - 1], 'Mode');
    assert.strictEqual(header[s.REFERRAL_CANCEL - 1], 'Cancel');
    // The three that were digits at their one call site until the move. A stale
    // 7 would have put the Tier dropdown on Template and a stale 15 the timestamp
    // format on Result — neither of which any assertion about the header list
    // would have caught.
    assert.strictEqual(header[s.REFERRAL_TIER_COL - 1], 'Tier');
    assert.strictEqual(header[s.REFERRAL_JOB_LINK - 1], 'Job Link');
    assert.strictEqual(header[s.REFERRAL_SENT_AT - 1], 'Sent At');
  });
  run('the two Statuses the Cancel box turns on are both in the shared list', () => {
    assert.strictEqual(s.REFERRAL_CANCELLED, 'Cancelled');
    assert.strictEqual(s.REFERRAL_SENT, 'Sent');
    assert.ok(Array.from(s.OUTREACH_STATUS).indexOf(s.REFERRAL_CANCELLED) !== -1);
    assert.ok(Array.from(s.OUTREACH_STATUS).indexOf(s.REFERRAL_SENT) !== -1);
  });
  run('the tab keeps the person, which the Email tab deliberately does not', () => {
    // And it now leads with them: Person, Email and Title are the first three
    // columns after the job, which is what the Job Link move was for.
    const header = Array.from(s.REFERRAL_HEADERS);
    assert.strictEqual(header[2], 'Person');
    assert.strictEqual(header[3], 'Email');
    assert.strictEqual(header[4], 'Title');
    assert.strictEqual(Array.from(s.OUTREACH_HEADERS).indexOf('Person'), -1);
  });
  run('the three timestamps are the pair plus the one that says it went', () => {
    const header = Array.from(s.REFERRAL_HEADERS);
    assert.strictEqual(header[7], 'Drafted At');
    assert.strictEqual(header[8], 'Scheduled At');
    assert.strictEqual(header[15], 'Sent At');   // 16 now: Job Link came in ahead of it
  });
  run('and the timestamp format lands on 8, 9 and 16 — not on the old 9, 10 and 15', () => {
    // A stale set of numbers here would format Template and Result as dates and
    // leave the send time rendering as a bare serial number, which reads as a
    // corrupted cell rather than as a bug in this file.
    const stamped = formats.filter((f) => f[2] === s.OUTREACH_TIMESTAMP_FORMAT);
    assert.deepStrictEqual(stamped.map((f) => f[0]).sort((a, b) => a - b), [8, 9, 16]);
    stamped.forEach((f) => assert.strictEqual(f[1], 1));
  });
  // Between Job Link and Sent At, because that is where it happens: the draft
  // exists under this id for an hour, and deleting it in Gmail is what calls the
  // message off. Result is left to hold one kind of thing.
  run('the draft has a column of its own rather than borrowing Result', () => {
    const header = Array.from(s.REFERRAL_HEADERS);
    assert.strictEqual(header[14], 'Gmail Draft ID');
    assert.strictEqual(header[16], 'Result');
  });
  run('it freezes the header and validates Tier, Priority, Status, Mode and Cancel '
      + 'without adding rows', () => {
    assert.deepStrictEqual(frozen, [['Referral', 1]]);
    assert.deepStrictEqual(validated,
      [[2, 6, 499, 1], [2, 10, 499, 1], [2, 11, 499, 1], [2, 12, 499, 1], [2, 13, 499, 1]]);
    assert.strictEqual(referral.getLastRow(), 1);
  });
  run('Priority and Cancel both get checkbox rules, not another dropdown', () => {
    // Priority is the one at risk: it sits between Scheduled At and Status, so an
    // insert can hand it either a date format or a seven-word list. A list rule
    // here would flag every ticked box as an invalid entry, because TRUE is not
    // one of Status's seven words.
    [s.REFERRAL_PRIORITY, s.REFERRAL_CANCEL].forEach((column) => {
      const on = validatedRules.filter((v) => v[1] === column);
      assert.strictEqual(on.length, 1, 'column ' + column);
      assert.strictEqual(on[0][4].kind, 'checkbox', 'column ' + column);
      assert.strictEqual(on[0][4].list, null, 'column ' + column);
    });
  });
  run('and neither of them passes setAllowInvalid(false)', () => {
    // With allowInvalid off a checkbox rule rejects everything that is not
    // exactly TRUE or FALSE, so every row somebody filled in by hand before the
    // column existed comes up flagged for holding nothing at all.
    [s.REFERRAL_PRIORITY, s.REFERRAL_CANCEL].forEach((column) => {
      const rule = validatedRules.filter((v) => v[1] === column)[0][4];
      assert.strictEqual(rule.allowInvalid, null, 'column ' + column);
    });
    // The contrast is the point: the three dropdowns do set it, and to false.
    [s.REFERRAL_TIER_COL, s.REFERRAL_STATUS, s.REFERRAL_MODE].forEach((column) => {
      const rule = validatedRules.filter((v) => v[1] === column)[0][4];
      assert.strictEqual(rule.kind, 'list');
      assert.strictEqual(rule.allowInvalid, false);
    });
  });
  run('every column gets a width, all twenty of them', () => {
    assert.strictEqual(widths.length, 20);
    assert.deepStrictEqual(widths.map((w) => w[0]),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });
  run('Job Link keeps the wide setting it had at column 3, now at 14', () => {
    // The move changed where the link sits, not how long a URL is. Squeezed into
    // the width of the column it displaced, two jobs at one employer would be
    // indistinguishable.
    const byColumn = (column) => widths.filter((w) => w[0] === column)[0][1];
    assert.strictEqual(byColumn(s.REFERRAL_JOB_LINK), 230);
    // And Priority takes a box's width, like Cancel, rather than a reader's.
    assert.strictEqual(byColumn(s.REFERRAL_PRIORITY), byColumn(s.REFERRAL_CANCEL));
    assert.ok(byColumn(s.REFERRAL_PRIORITY) < byColumn(3), 'Person must stay readable');
  });
  run('Status wears the Email tab colours, and Queued is left plain there too', () => {
    const rules = (formatRules['Referral'] || [])
      .filter((r) => r.getRanges()[0].getColumn() === s.REFERRAL_STATUS);
    assert.strictEqual(rules.length, 6);
    assert.ok(!rules.some((r) => r.text === 'Queued'));
    rules.forEach((r) => assert.ok(Array.from(s.OUTREACH_STATUS).indexOf(r.text) !== -1, r.text));
    assert.strictEqual(rules.filter((r) => r.text === 'Replied')[0].background, '#D9EAD3');
  });
  run('the tier list is the four rungs, in order', () => {
    assert.deepStrictEqual(Array.from(s.REFERRAL_TIER), ['peer', 'mid', 'senior', 'staff']);
  });
  run('running it again is idempotent and does not stack a second set of rules', () => {
    const before = (formatRules['Referral'] || []).length;
    s.setupReferralQueue();
    assert.strictEqual(referral.getLastRow(), 1);
    assert.strictEqual((formatRules['Referral'] || []).length, before);
    assert.match(toasts[toasts.length - 1], /No rows changed/);
  });
}

console.log('setupReferralQueue — a header that means a different table');
{
  jobs = freshJobs();
  app = freshApp();
  referral = makeSheet('Referral', [
    ['Company', 'Role', 'Referrer Notes', 'Email', 'Title', 'Tier', 'Template']
  ]);
  const s = load();
  run('it refuses rather than writing its own header over somebody else\'s', () => {
    assert.throws(() => s.setupReferralQueue(), /Referral column 3 is "Referrer Notes"/);
  });
  run('and the foreign header is still there afterwards', () => {
    assert.strictEqual(referral.grid[0][2], 'Referrer Notes');
  });
}


// The App tab exactly as it stood before Official existed: Alumni at I, and a
// column of the operator's own past Update, because a migration that only ever
// meets the columns this tool knows about has not met the real tab.
const PRE_OFFICIAL_HEADER = [
  'Property', 'Company', 'Application Link', 'Date Applied', 'Location (State)',
  'Process', 'Role', 'Note', 'Alumni', 'Recruiter', 'Update', 'Follow up'
];
const preOfficialRow = (property, company, link) => [
  property, company, link, 'July 21, 2026', 'NY', 'Applied', 'SWE Intern',
  'via the careers page', true, false, 'Applied: July 21, 2026', 'ping Dana'
];
// App column F, ahead of the gap, so a rule there is the control: it proves the
// insert moved what sits behind it and left what sits in front alone.
const PROCESS_COLUMN = 6;
// A conditional-format rule shaped the way the sheet hands them back, so that the
// insert can be asked whether the rules travelled with the columns they colour.
const ruleAt = (column, name) => ({ name, getRanges: () => [{ getColumn: () => column }] });

console.log('migrateAppOfficialColumn — opening a gap on a tab that is already live');
{
  jobs = freshJobs();
  app = makeSheet('App', [
    PRE_OFFICIAL_HEADER,
    preOfficialRow(1, 'IBM', 'https://job-boards.greenhouse.io/ibm/jobs/9'),
    preOfficialRow(2, 'Notion', 'https://jobs.ashbyhq.com/notion/1/'),
  ]);
  const s = load();
  formatRules['App'] = [ruleAt(PROCESS_COLUMN, 'Process'), ruleAt(11, 'Update')];
  s.migrateAppOfficialColumn();

  run('the header ends up as the new layout, Official between Note and Alumni', () => {
    assert.deepStrictEqual(app.grid[0].slice(7, 12),
      ['Note', 'Official', 'Alumni', 'Recruiter', 'Update']);
  });
  run('every value to the right of the gap moved with it', () => {
    // This is the half a header rewrite over live data would have got wrong: the
    // tick would stay at I under the name Official, and the row would read as an
    // application with a pasted link and no alumnus.
    assert.strictEqual(app.grid[1][8], '');          // Official, opened empty
    assert.strictEqual(app.grid[1][9], true);        // Alumni, the tick that was at I
    assert.strictEqual(app.grid[1][10], false);      // Recruiter
    assert.strictEqual(app.grid[1][11], 'Applied: July 21, 2026');
    assert.strictEqual(app.grid[2][9], true);
  });
  run("a column of the operator's own past Update moved too", () => {
    assert.strictEqual(app.grid[0][12], 'Follow up');
    assert.strictEqual(app.grid[1][12], 'ping Dana');
  });
  run('the rows themselves are left alone — a migration adds a column, not data', () => {
    assert.strictEqual(app.getLastRow(), 3);
    assert.strictEqual(app.grid[1][1], 'IBM');
    assert.strictEqual(app.grid[2][1], 'Notion');
    assert.strictEqual(app.grid[1][7], 'via the careers page');
  });
  run('the colour rules follow the columns they colour rather than staying put', () => {
    const rules = formatRules['App'] || [];
    const columnOf = (name) =>
      rules.filter((r) => r.name === name)[0].getRanges()[0].getColumn();
    assert.strictEqual(columnOf('Process'), PROCESS_COLUMN);  // ahead of the gap
    assert.strictEqual(columnOf('Update'), 12);               // behind it, moved one right
  });
  run('the checkbox validation is rebuilt where the ticks now are, not where they were', () => {
    // Left at I it would put a checkbox rule under every pasted link, and every
    // link would read back as an invalid entry.
    const boxes = validated.filter((call) => call[1] === 10);
    assert.strictEqual(boxes.length, 1);
    assert.deepStrictEqual(boxes[0], [2, 10, 2, 2]);
    assert.strictEqual(validated.filter((call) => call[1] === 9).length, 0);
  });
  run('Official gets its width at the column it was opened at', () => {
    assert.deepStrictEqual(widths, [[9, 230], [10, 70], [11, 90], [12, 300]]);
  });
  run('the toast says to deploy the Python half before the next sync', () => {
    assert.match(toasts[toasts.length - 1], /deploy the Python half/);
  });
  run('running it again does not open a second gap', () => {
    const width = app.grid[0].length;
    s.migrateAppOfficialColumn();
    assert.strictEqual(app.grid[0].length, width);
    assert.deepStrictEqual(app.grid[0].slice(7, 13),
      ['Note', 'Official', 'Alumni', 'Recruiter', 'Update', 'Follow up']);
    assert.strictEqual(app.grid[1][9], true);
    assert.strictEqual(app.grid[1][11], 'Applied: July 21, 2026');
    assert.match(toasts[toasts.length - 1], /already on the current layout/);
  });
}

console.log('migrateAppOfficialColumn — a layout it does not recognise');
{
  jobs = freshJobs();
  app = makeSheet('App', [PRE_OFFICIAL_HEADER.slice()]);
  app.grid[0][8] = 'Referral Link';
  const s = load();
  run('a tab somebody has already put a column of their own at I is refused', () => {
    assert.throws(() => s.migrateAppOfficialColumn(), /App column 9 is "Referral Link"/);
  });
  run('the error says what it expected there, so the fix does not need the source', () => {
    assert.throws(() => s.migrateAppOfficialColumn(), /"Alumni" or "Official"/);
  });
  run('the refusal moves nothing', () => {
    assert.strictEqual(app.grid[0].length, PRE_OFFICIAL_HEADER.length);
    assert.strictEqual(app.grid[0][8], 'Referral Link');
    assert.deepStrictEqual(widths, []);
  });
}

console.log('migrateAppOfficialColumn — a half-built layout is not the layout either');
{
  jobs = freshJobs();
  // Alumni is where it should be, but the two behind it are not: the shape a run
  // that died partway leaves. Inserting on the strength of column I alone would
  // shift this into something no version of the tab has ever been.
  app = makeSheet('App', [PRE_OFFICIAL_HEADER.slice()]);
  app.grid[0][9] = 'Update';
  app.grid[0][10] = '';
  const s = load();
  run('it reads the columns behind the gap before it opens one', () => {
    assert.throws(() => s.migrateAppOfficialColumn(), /App column 10 is "Update"/);
  });
  run('and nothing is inserted', () => {
    assert.strictEqual(app.grid[0].length, PRE_OFFICIAL_HEADER.length);
  });
}

console.log('migrateAppOfficialColumn — a tab that has never been set up');
{
  jobs = freshJobs();
  app = freshApp();     // A..H and nothing else
  const s = load();
  run('a blank column I is not an error: there is nothing to shift', () => {
    assert.doesNotThrow(() => s.migrateAppOfficialColumn());
    assert.deepStrictEqual(app.grid[0].slice(8, 12),
      ['Official', 'Alumni', 'Recruiter', 'Update']);
  });
  run('and no gap was opened, so column H still holds Note', () => {
    assert.strictEqual(app.grid[0][7], 'Note');
    assert.match(toasts[toasts.length - 1], /already on the current layout/);
  });
}

console.log('appOfficialNeedsLink_');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  const needs = s.appOfficialNeedsLink_;
  run('an application with neither link is the whole point of the colour', () => {
    assert.strictEqual(needs('Stripe', '', ''), true);
  });
  run('a link in Application Link is already something to send, so the row stays plain', () => {
    assert.strictEqual(needs('Stripe', 'https://boards.example/j', ''), false);
  });
  run('a link in Official answers it just as well', () => {
    assert.strictEqual(needs('Stripe', '', 'https://stripe.example/careers/1'), false);
  });
  run('a row with no company is not an application, so it is never painted', () => {
    // App really does carry rows holding nothing but a link. There is nobody to
    // ask about one, so putting it at the top of the tab is work that cannot be done.
    assert.strictEqual(needs('', 'https://bambusdev.example/job/1', ''), false);
    assert.strictEqual(needs('', '', ''), false);
    assert.strictEqual(needs(null, '', ''), false);
    assert.strictEqual(needs('   ', '', ''), false);
  });
  run('a cell holding something that is not a link does not count as one', () => {
    assert.strictEqual(needs('Stripe', 'ask Dan', ''), true);
    assert.strictEqual(needs('Stripe', '   ', '  '), true);
    assert.strictEqual(needs('Stripe', 'greenhouse.io/stripe', ''), true);
  });
  run('https counts, and so does a link with the case written oddly', () => {
    assert.strictEqual(needs('Stripe', 'https://boards.example/j', ''), false);
    assert.strictEqual(needs('Stripe', '  HTTP://boards.example/j ', ''), false);
  });
  run('the rule stops at "starts with http" — the ATS judgement is not made here', () => {
    // An aggregator link is a link as far as this file is concerned. Telling one
    // from an employer's own board is the sender project's judgement, and a second
    // copy of it here is two copies that drift with nothing to catch it.
    assert.strictEqual(needs('Stripe', 'https://jobright.ai/jobs/info/abc', ''), false);
  });
}

// The App tab on the current layout. Named row shapes rather than twelve cells
// written out each time, because what matters about each row is only whether it
// needs an official link, and spelling that out in full buries the case tested.
const APP_FULL_HEADER = [
  'Property', 'Company', 'Application Link', 'Date Applied', 'Location (State)',
  'Process', 'Role', 'Note', 'Official', 'Alumni', 'Recruiter', 'Update'
];
const appNeedsLink = (company) =>
  [1, company, '', 'July 21, 2026', 'NY', 'Applied', 'SWE Intern', '', '',
   false, false, 'Applied: July 21, 2026'];
const appHasLink = (company) =>
  [1, company, 'https://boards.example/' + company, 'July 21, 2026', 'NY', 'Applied',
   'SWE Intern', '', '', false, false, 'Applied: July 21, 2026'];
const appHasOfficial = (company) =>
  [1, company, 'https://jobright.ai/jobs/info/' + company, 'July 21, 2026', 'NY',
   'Applied', 'SWE Intern', '', 'https://' + company + '.example/careers/1',
   false, false, 'Applied: July 21, 2026'];
// What an untouched row on a set-up App tab actually reads back as: no text
// anywhere, and two unticked checkboxes that come back false rather than blank.
const blankAppRow = () => ['', '', '', '', '', '', '', '', '', false, false, ''];
const YELLOW = '#FFF2CC';
// vm.runInContext gives the .gs file a realm of its own, so an array it built
// carries that realm's Array prototype, and deepStrictEqual compares prototypes
// before it compares contents — an answer that is exactly right still fails
// against a literal written out here. These copy the answer back into this realm
// so the assertion is about the order and nothing else. Company is column B on
// App, so it is index 1 rather than the 0 the Jobs tab had.
const names = (rows) => Array.from(rows, (r) => r[1]);
const rowsOf = (rows) => Array.from(rows);

console.log('paintAppOfficialRows');
{
  jobs = freshJobs();
  app = makeSheet('App', [
    APP_FULL_HEADER,
    // No link either side: this is the row the colour exists for. Already at the
    // top, so the sort that follows the paint has nothing to do and the write
    // count is the paint's alone.
    appNeedsLink('Stripe'),
    // Application Link already goes somewhere.
    appHasLink('IBM'),
    // An aggregator link, but the employer's own has been found by hand.
    appHasOfficial('Notion'),
    // The stray row App really carries: a link and no company.
    ['', '', 'https://bambusdev.example/job/1', '', '', '', '', '', '', false, false, ''],
  ]);
  const s = load();
  s.paintAppOfficialRows();

  run('the whole block is painted in one write, not one call per row', () => {
    assert.strictEqual(painted.length, 1);
    assert.deepStrictEqual(painted[0], [2, 1, 4, 12]);
  });
  run('the application with no employer link goes yellow across A..L', () => {
    assert.deepStrictEqual(app.colours[1], new Array(12).fill(YELLOW));
  });
  run('the three rows that do not need one are cleared, not painted white', () => {
    // White is a colour, and it would paint over whatever banding or manual
    // highlight the row already had.
    [2, 3, 4].forEach((i) => assert.deepStrictEqual(app.colours[i], new Array(12).fill(null)));
  });
  run('the header row is never touched', () => {
    assert.deepStrictEqual(app.colours[0], []);
  });
  run('the paint stops at Update, where the tool stops owning the row', () => {
    assert.strictEqual(app.colours[1].length, 12);
  });
  run('a tab with no rows yet says so instead of throwing', () => {
    app = makeSheet('App', [APP_FULL_HEADER]);
    const s2 = load();
    assert.doesNotThrow(() => s2.paintAppOfficialRows());
    assert.match(toasts[toasts.length - 1], /has no rows yet/);
  });
}

console.log('orderAppOfficialRows_ — the ordering on its own, no sheet');
{
  const s = load();
  const rows = [appNeedsLink('A'), appHasLink('X'), appNeedsLink('B'),
                appHasOfficial('Y'), appNeedsLink('C')];
  const out = s.orderAppOfficialRows_(rows);

  run('the rows needing a link come first and the rest follow', () => {
    assert.deepStrictEqual(names(out), ['A', 'B', 'C', 'X', 'Y']);
  });
  run('the yellow group keeps the order it was already in', () => {
    // Identity, not equality: the point is that these are the same row objects in
    // the same sequence, so a sort that rebuilt the group from a comparator would
    // fail here even if it happened to produce equal-looking rows.
    assert.strictEqual(out[0], rows[0]);
    assert.strictEqual(out[1], rows[2]);
    assert.strictEqual(out[2], rows[4]);
  });
  run('the rest keeps the order it was already in', () => {
    assert.strictEqual(out[3], rows[1]);
    assert.strictEqual(out[4], rows[3]);
  });
  run('nothing is dropped and nothing is duplicated', () => {
    assert.strictEqual(out.length, rows.length);
    assert.deepStrictEqual(names(out).sort(), ['A', 'B', 'C', 'X', 'Y']);
  });
}

console.log('orderAppOfficialRows_ — yellow rows scattered through the middle');
{
  const s = load();
  const rows = [
    appHasLink('P'), appHasLink('Q'), appNeedsLink('A'), appHasLink('R'),
    appNeedsLink('B'), appHasLink('S'), appHasLink('T'), appNeedsLink('C'), appHasLink('U'),
  ];
  const out = s.orderAppOfficialRows_(rows);
  run('three rows pulled out of the middle arrive at the top in their old order', () => {
    assert.deepStrictEqual(names(out), ['A', 'B', 'C', 'P', 'Q', 'R', 'S', 'T', 'U']);
  });
  run('and the six left behind close up without changing places', () => {
    assert.deepStrictEqual(names(out).slice(3), ['P', 'Q', 'R', 'S', 'T', 'U']);
  });
}

console.log('orderAppOfficialRows_ — the empty tail');
{
  const s = load();
  const rows = [
    appHasLink('P'), appNeedsLink('A'), appHasLink('Q'), appNeedsLink('B'),
    blankAppRow(), blankAppRow(), blankAppRow(),
  ];
  const out = s.orderAppOfficialRows_(rows);

  run('the blank rows stay at the bottom instead of sorting in with the rest', () => {
    assert.deepStrictEqual(names(out), ['A', 'B', 'P', 'Q', '', '', '']);
  });
  run('a row that is only two unticked checkboxes still counts as blank', () => {
    // The trap this guards: false is a value, and the Python half writes FALSE
    // down both columns across every row it covers. Reading that as content would
    // make an empty row look occupied, so it would never be pinned to the bottom
    // and would sort in among the applications as though it were one.
    assert.strictEqual(s.appRowIsEmpty_(blankAppRow()), true);
    assert.strictEqual(s.appRowIsEmpty_(appHasLink('P')), false);
  });
  run('a blank row with real rows still under it keeps its place', () => {
    // Only the trailing blanks are pinned. A gap in the middle is something
    // somebody left there, and sinking it would be exactly the reshuffle the
    // stability rule exists to prevent.
    const gapped = [appHasLink('P'), blankAppRow(), appHasLink('Q'), appNeedsLink('A')];
    assert.deepStrictEqual(names(s.orderAppOfficialRows_(gapped)), ['A', 'P', '', 'Q']);
  });
  run('a tab that is nothing but blank rows is left completely alone', () => {
    const empty = [blankAppRow(), blankAppRow(), blankAppRow()];
    assert.deepStrictEqual(rowsOf(s.orderAppOfficialRows_(empty)), empty);
  });
  run('running the ordering on its own output changes nothing', () => {
    assert.deepStrictEqual(rowsOf(s.orderAppOfficialRows_(out)), rowsOf(out));
  });
}

console.log('sortAppOfficialRowsToTop');
{
  jobs = freshJobs();
  app = makeSheet('App', [
    APP_FULL_HEADER,
    appHasLink('IBM'),
    // Two applications needing a link, sitting where they are easiest to miss:
    // buried in the middle with ordinary rows above and below them.
    appNeedsLink('Stripe'),
    appHasOfficial('Neuralink'),
    appNeedsLink('Ramp'),
    appHasLink('Notion'),
    blankAppRow(),
    blankAppRow(),
  ]);
  const s = load();
  s.sortAppOfficialRowsToTop();

  run('the two rows needing a link are now the first two rows of the tab', () => {
    assert.deepStrictEqual(app.grid.slice(1, 3).map((r) => r[1]), ['Stripe', 'Ramp']);
  });
  run('the three that do not need one keep their order underneath', () => {
    assert.deepStrictEqual(app.grid.slice(3, 6).map((r) => r[1]),
      ['IBM', 'Neuralink', 'Notion']);
  });
  run('the header row is not part of the sort', () => {
    assert.deepStrictEqual(app.grid[0], APP_FULL_HEADER);
  });
  run('the whole block moves in one write, not one move per row', () => {
    // A sort that dies halfway leaves applications duplicated above and missing
    // below, and App is the source of truth for what has been applied to.
    assert.strictEqual(wrote.length, 1);
    assert.deepStrictEqual(wrote[0], [2, 1, 7, 12]);
  });
  run('the block stops at the last row, so nothing is written below the data', () => {
    // Out to LAST_ROW the way the Jobs sweep went, this would leave hundreds of
    // written-and-emptied rows and onEdit would append the next application
    // underneath all of them.
    assert.strictEqual(app.grid.length, 8);
  });
  run('the yellow lands on the rows that moved, not on the lines they left', () => {
    // The failure this catches is the one worth having the test for: sort the
    // values and leave the colours behind and the tab paints IBM and Neuralink
    // yellow while Stripe and Ramp sit at the top looking finished.
    assert.deepStrictEqual(app.colours[1], new Array(12).fill(YELLOW));
    assert.deepStrictEqual(app.colours[2], new Array(12).fill(YELLOW));
    [3, 4, 5].forEach((i) =>
      assert.deepStrictEqual(app.colours[i], new Array(12).fill(null)));
  });
  run('the blank rows are still blank and still at the bottom', () => {
    assert.strictEqual(s.appRowIsEmpty_(app.grid[6]), true);
    assert.strictEqual(s.appRowIsEmpty_(app.grid[7]), true);
  });
  run('a second run writes nothing and paints nothing', () => {
    const wroteBefore = wrote.length;
    const paintedBefore = painted.length;
    const before = app.grid.map((r) => r.slice());
    s.sortAppOfficialRowsToTop();
    assert.strictEqual(wrote.length, wroteBefore);
    assert.strictEqual(painted.length, paintedBefore);
    assert.deepStrictEqual(app.grid, before);
  });
}

console.log('sortAppOfficialRowsToTop — a column the tool does not own');
{
  jobs = freshJobs();
  app = makeSheet('App', [
    APP_FULL_HEADER.concat(['Follow up']),
    appHasLink('IBM').concat(['asked Dana in July']),
    appNeedsLink('Stripe').concat(['nobody found yet']),
  ]);
  const s = load();
  s.sortAppOfficialRowsToTop();

  run('the block widens to the real last column rather than stopping at Update', () => {
    assert.deepStrictEqual(wrote[0], [2, 1, 2, 13]);
  });
  run("an operator's note in column M travels with its own row", () => {
    // Left behind, Stripe would arrive at the top wearing IBM's note — one
    // application's notes silently reattached to another, which is worse than
    // losing them, because nothing about the tab looks wrong afterwards.
    assert.deepStrictEqual(app.grid.slice(1, 3).map((r) => [r[1], r[12]]),
      [['Stripe', 'nobody found yet'], ['IBM', 'asked Dana in July']]);
  });
  run('the history in Update travels with its row too', () => {
    assert.strictEqual(app.grid[1][11], 'Applied: July 21, 2026');
  });
  run('the paint still stops at Update, where the tool stops owning the row', () => {
    assert.strictEqual(app.colours[1].length, 12);
    assert.deepStrictEqual(app.colours[1], new Array(12).fill(YELLOW));
  });
}

console.log('onEdit — pasting an official link into column I clears the colour');
{
  jobs = freshJobs();
  app = makeSheet('App', [
    APP_FULL_HEADER,
    appNeedsLink('Stripe'),
    appNeedsLink('Ramp'),
  ]);
  const s = load();
  s.paintAppOfficialRows();
  app.grid[1][8] = 'https://stripe.example/careers/1';
  s.onEdit({ source: ss, range: app.getRange(2, 9, 1, 1) });

  run('only the edited row is repainted, and it loses its yellow', () => {
    assert.strictEqual(painted.length, 2);
    assert.deepStrictEqual(painted[1], [2, 1, 1, 12]);
    assert.deepStrictEqual(app.colours[1], new Array(12).fill(null));
  });
  run('the row nobody touched keeps its colour', () => {
    assert.deepStrictEqual(app.colours[2], new Array(12).fill(YELLOW));
  });
  run('clearing the cell again brings the colour back', () => {
    app.grid[1][8] = '';
    s.onEdit({ source: ss, range: app.getRange(2, 9, 1, 1) });
    assert.deepStrictEqual(app.colours[1], new Array(12).fill(YELLOW));
  });
  run('an edit landing in the Update column repaints nothing', () => {
    const before = painted.length;
    s.onEdit({ source: ss, range: app.getRange(3, 12, 1, 1) });
    assert.strictEqual(painted.length, before);
  });
  run('an edit in the Process column still writes its history and paints nothing', () => {
    const before = painted.length;
    app.grid[2][5] = 'OA';
    s.onEdit({ source: ss, range: app.getRange(3, 6, 1, 1) });
    assert.strictEqual(painted.length, before);
    assert.match(app.grid[2][11], /OA: /);
  });
  run('a fill-down across Official repaints those rows in one write', () => {
    const before = painted.length;
    s.onEdit({ source: ss, range: app.getRange(2, 9, 2, 1) });
    assert.strictEqual(painted.length, before + 1);
    assert.deepStrictEqual(painted[painted.length - 1], [2, 1, 2, 12]);
  });
  run('a paste across the whole row reaches Official and repaints it', () => {
    const before = painted.length;
    s.onEdit({ source: ss, range: app.getRange(2, 1, 1, 12) });
    assert.strictEqual(painted.length, before + 1);
  });
  run('an edit on the header row alone never paints row 1', () => {
    const before = painted.length;
    s.onEdit({ source: ss, range: app.getRange(1, 9, 1, 1) });
    assert.strictEqual(painted.length, before);
  });
}

console.log('paintAppOfficialRows sorts, onEdit does not');
{
  jobs = freshJobs();
  app = makeSheet('App', [
    APP_FULL_HEADER,
    appHasLink('IBM'),
    appNeedsLink('Stripe'),
  ]);
  const s = load();
  s.paintAppOfficialRows();

  run('the full repaint brings the row needing a link to the top', () => {
    assert.deepStrictEqual(app.grid.slice(1, 3).map((r) => r[1]), ['Stripe', 'IBM']);
  });
  run('and repaints once the rows have moved, so the colour follows them', () => {
    assert.strictEqual(painted.length, 2);
    assert.deepStrictEqual(app.colours[1], new Array(12).fill(YELLOW));
    assert.deepStrictEqual(app.colours[2], new Array(12).fill(null));
  });
  run('pasting a link into Official repaints the row but does not move it', () => {
    // Sorting inside onEdit would pull the row out from under the cursor while
    // the person is still typing in it, and the next paste would land on whatever
    // row slid into its place. The colour has to be immediate; the position waits
    // for the next full repaint.
    const wroteBefore = wrote.length;
    app.grid[1][8] = 'https://stripe.example/careers/1';
    s.onEdit({ source: ss, range: app.getRange(2, 9, 1, 1) });
    assert.strictEqual(wrote.length, wroteBefore);
    assert.deepStrictEqual(app.grid.slice(1, 3).map((r) => r[1]), ['Stripe', 'IBM']);
    assert.deepStrictEqual(app.colours[1], new Array(12).fill(null));
  });
  run('a row that stops needing a link keeps its place rather than being demoted', () => {
    // Stability cuts both ways. Nothing on the tab needs a link now, so the whole
    // block is one group and the order somebody was working in survives the
    // repaint — a sort asked only to bring yellow to the top has no business
    // moving a row that has merely stopped being yellow.
    s.paintAppOfficialRows();
    assert.deepStrictEqual(app.grid.slice(1, 3).map((r) => r[1]), ['Stripe', 'IBM']);
    assert.deepStrictEqual(app.colours[1], new Array(12).fill(null));
    assert.deepStrictEqual(app.colours[2], new Array(12).fill(null));
  });
  run('a new application lands at the bottom and onEdit leaves it there', () => {
    // The whole reason the repaint is on a clock: App only ever grows, so every
    // application sent puts a fresh row under the block somebody is working down.
    app.grid.push(appNeedsLink('Ramp'));
    const wroteBefore = wrote.length;
    s.onEdit({ source: ss, range: app.getRange(4, 9, 1, 1) });
    assert.strictEqual(wrote.length, wroteBefore);
    assert.deepStrictEqual(app.colours[3], new Array(12).fill(YELLOW));
    assert.deepStrictEqual(names(app.grid.slice(1, 4)), ['Stripe', 'IBM', 'Ramp']);
  });
  run('and the next full repaint is what brings it to the top', () => {
    s.paintAppOfficialRows();
    assert.deepStrictEqual(names(app.grid.slice(1, 4)), ['Ramp', 'Stripe', 'IBM']);
    assert.deepStrictEqual(app.colours[1], new Array(12).fill(YELLOW));
    assert.deepStrictEqual(app.colours[2], new Array(12).fill(null));
    assert.deepStrictEqual(app.colours[3], new Array(12).fill(null));
  });
}

console.log('migrateAppOfficialColumn — the checkbox the insert brings with it');
{
  jobs = freshJobs();
  app = makeSheet('App', [
    ['Property', 'Company', 'Application Link', 'Date Applied', 'Location (State)',
     'Process', 'Role', 'Note', 'Alumni', 'Recruiter', 'Update'],
    ['1', 'Uber', 'https://x', 'July 21, 2026', 'CA', 'Rejected', 'SWE Intern', '',
     false, true, 'Applied: Jul 21, 2026'],
    ['2', 'Figma', 'https://y', 'Aug 10, 2026', 'CA', 'Applied', 'SWE Intern', '',
     true, false, 'Applied: Aug 10, 2026']
  ]);
  const s = load();
  s.migrateAppOfficialColumn();

  // A column inserted beside a checkbox column inherits that column's data
  // validation, so every row of Official comes up holding an unticked box: three
  // hundred cells reading FALSE in the column whose whole purpose is to hold a
  // pasted URL. It looks like data, it is not, and the sender reads it as a link
  // that fails every rule, for a reason nothing on the sheet explains.
  run('the inherited checkbox is stripped from the new column', () => {
    const onOfficial = cleared.filter((c) => c[1] === s.APP_OFFICIAL);
    assert.ok(onOfficial.length >= 1, 'nothing was cleared on column ' + s.APP_OFFICIAL);
    // The whole column, not only the rows holding data today: the validation
    // covers the column, so a row added tomorrow would arrive wearing the box.
    assert.strictEqual(onOfficial[0][0], 1);
    assert.ok(onOfficial[0][2] >= app.grid.length);
  });

  run('and Official is left genuinely empty below its header', () => {
    for (let r = 1; r < app.grid.length; r++) {
      const cell = app.grid[r][s.APP_OFFICIAL - 1];
      assert.ok(cell === '' || cell === undefined || cell === null,
                'row ' + (r + 1) + ' holds ' + JSON.stringify(cell));
    }
  });

  run('the three columns behind it keep their own values', () => {
    assert.strictEqual(app.grid[1][s.ALUMNI_COL - 1], false);
    assert.strictEqual(app.grid[1][s.RECRUITER_COL - 1], true);
    assert.strictEqual(app.grid[1][s.UPDATE_COL - 1], 'Applied: Jul 21, 2026');
    assert.strictEqual(app.grid[2][s.ALUMNI_COL - 1], true);
    assert.strictEqual(app.grid[2][s.RECRUITER_COL - 1], false);
  });
}

console.log('migrateAppOfficialColumn — repairing a tab the first version left checkboxed');
{
  jobs = freshJobs();
  app = makeSheet('App', [
    ['Property', 'Company', 'Application Link', 'Date Applied', 'Location (State)',
     'Process', 'Role', 'Note', 'Official', 'Alumni', 'Recruiter', 'Update'],
    ['1', 'Uber', 'https://x', 'July 21, 2026', 'CA', 'Rejected', 'SWE Intern', '',
     false, false, true, 'Applied: Jul 21, 2026'],
    ['2', 'Figma', 'https://y', 'Aug 10, 2026', 'CA', 'Applied', 'SWE Intern', '',
     'https://boards.greenhouse.io/figma/jobs/1', true, false, 'Applied: Aug 10, 2026']
  ]);
  const s = load();
  s.migrateAppOfficialColumn();

  // The first version of this migration did not strip what the insert inherited,
  // and the insert has already happened on the tab it ran on — so the branch that
  // strips is never reached again. This branch is the only route back.
  run('a FALSE left by the old insert is cleared', () => {
    assert.strictEqual(app.grid[1][s.APP_OFFICIAL - 1], '');
  });

  // The whole point of the column is that what a person typed there survives
  // everything this file does.
  run('a link somebody pasted is not touched', () => {
    assert.strictEqual(app.grid[2][s.APP_OFFICIAL - 1],
                       'https://boards.greenhouse.io/figma/jobs/1');
  });

  run('and the columns behind it are still intact', () => {
    assert.strictEqual(app.grid[1][s.ALUMNI_COL - 1], false);
    assert.strictEqual(app.grid[1][s.RECRUITER_COL - 1], true);
    assert.strictEqual(app.grid[2][s.ALUMNI_COL - 1], true);
    assert.strictEqual(app.grid[2][s.UPDATE_COL - 1], 'Applied: Aug 10, 2026');
  });
}


// The Referral tab exactly as it stood before Cancel existed: eighteen columns,
// Gmail Draft ID at M, and real rows on it — because a migration that has only
// ever met an empty tab has not met the case that loses work.
const PRE_CANCEL_HEADER = [
  'Company', 'Role', 'Job Link', 'Person', 'Email', 'Title', 'Tier', 'Template',
  'Drafted At', 'Scheduled At', 'Status', 'Mode', 'Gmail Draft ID', 'Sent At',
  'Result', 'Last Error', 'Queue ID', 'Version'
];
// One ask, on the old eighteen-column layout. Everything from Gmail Draft ID
// rightwards is filled in, because that is the half the insert has to carry.
const preCancelRow = (company, person, status) => [
  company, 'SWE Intern', 'https://boards.example/' + company, person,
  person.toLowerCase() + '@' + company.toLowerCase() + '.example', 'Engineer',
  'senior', 'warm-intro', 'Aug 20, 2026 9:00 AM', 'Aug 20, 2026 10:00 AM',
  status, 'Draft', 'draft-' + company, '', '', '', 'q-' + company, 'v1'
];
// A Referral row on the current twenty-column layout, named by what the test
// cares about — the company, whether it has been called off, and whether somebody
// starred it. Job Link is out at 14 now and Priority is in at 10, so a row built
// by hand against the old order would put a URL where the person's name belongs.
const referralRow = (company, status, cancel, priority) => [
  company, 'SWE Intern', company + ' Person', 'p@' + company.toLowerCase() + '.example',
  'Engineer', 'senior', 'warm-intro', 'Aug 20, 2026 9:00 AM', 'Aug 20, 2026 10:00 AM',
  priority === undefined ? false : priority,
  status, 'Draft', cancel === undefined ? false : cancel,
  'https://boards.example/' + company, 'draft-' + company, '', '', '',
  'q-' + company, 'v1'
];
// The same row on the nineteen-column layout that came between Cancel and the
// Job Link move: Job Link still third, no Priority. The migration fixtures need it
// because a row built by referralRow is twenty wide and would sit a column past a
// header row that is nineteen — the tab would be a shape neither layout describes
// and the migration would be being tested against nothing real.
// A Referral tab on the current layout, with the header, ready for onEdit. The
// rows are built by referralRow so each one reads as "this company, this Status,
// this box" and the other sixteen cells stay out of the way.
const freshReferral = (rows) =>
  makeSheet('Referral', [
    ['Company', 'Role', 'Person', 'Email', 'Title', 'Tier', 'Template', 'Drafted At',
     'Scheduled At', 'Priority', 'Status', 'Mode', 'Cancel', 'Job Link',
     'Gmail Draft ID', 'Sent At', 'Result', 'Last Error', 'Queue ID', 'Version']
  ].concat(rows));
// The three cells the tick is about, read straight out of the grid: what a person
// would see on the row after clicking.
// Looked up by company rather than by position, because a cancelled row no longer
// stays where it was: onEdit sinks it to the bottom on the keystroke. Reading a
// fixed index would silently test whichever row slid up into that line.
const stateOf = (company) => {
  for (var i = 1; i < referral.grid.length; i++) {
    if (String(referral.grid[i][0]) === company) {
      return {
        drafted: referral.grid[i][7],
        scheduled: referral.grid[i][8],
        status: referral.grid[i][10],
        cancel: referral.grid[i][12],
      };
    }
  }
  return null;
};
// Where a company's first row now sits, one-based as the sheet counts.
const rowOf = (company) => {
  for (var i = 1; i < referral.grid.length; i++) {
    if (String(referral.grid[i][0]) === company) return i + 1;
  }
  return -1;
};
// One cell of a company's first row, by name rather than by line number.
const cellOf = (company, col) => referral.grid[rowOf(company) - 1][col];
const cancelState = (row) => ({
  drafted: referral.grid[row][7],
  scheduled: referral.grid[row][8],
  status: referral.grid[row][10],
  cancel: referral.grid[row][12],
});

const preLayoutRow = (company, status, cancel) => [
  company, 'SWE Intern', 'https://boards.example/' + company, company + ' Person',
  'p@' + company.toLowerCase() + '.example', 'Engineer', 'senior', 'warm-intro',
  'Aug 20, 2026 9:00 AM', 'Aug 20, 2026 10:00 AM', status, 'Draft',
  cancel === undefined ? false : cancel, 'draft-' + company, '', '', '',
  'q-' + company, 'v1'
];
// The nineteen-column header preLayoutRow belongs to: Job Link still third, no
// Priority, everything else where the Cancel migration left it.
const PRE_MOVE_HEADER = [
  'Company', 'Role', 'Job Link', 'Person', 'Email', 'Title', 'Tier', 'Template',
  'Drafted At', 'Scheduled At', 'Status', 'Mode', 'Cancel', 'Gmail Draft ID',
  'Sent At', 'Result', 'Last Error', 'Queue ID', 'Version'
];
// The shape a run that died between the two steps leaves: Job Link already moved
// in behind Cancel, Priority not yet opened. It is a real state — the migration
// makes it itself, for as long as it takes to run the second step — so resuming
// from it has to work, or a script timeout between the two would leave a tab
// nothing can repair.
const MID_MOVE_HEADER = [
  'Company', 'Role', 'Person', 'Email', 'Title', 'Tier', 'Template', 'Drafted At',
  'Scheduled At', 'Status', 'Mode', 'Cancel', 'Job Link', 'Gmail Draft ID',
  'Sent At', 'Result', 'Last Error', 'Queue ID', 'Version'
];
const midMoveRow = (company, status, cancel) => {
  const row = preLayoutRow(company, status, cancel);
  row.splice(12, 0, row.splice(2, 1)[0]);
  return row;
};
// What an untouched row on a set-up Referral tab reads back as: no text anywhere,
// and two checkboxes — Priority and Cancel — that come back false rather than
// blank. Both have to be false rather than '' or the tail test stops testing
// anything: a blank row is only interesting here because it holds values that are
// not content.
const blankReferralRow = () =>
  ['', '', '', '', '', '', '', '', '', false, '', '', false, '', '', '', '', '', '', ''];
// Company is column A on Referral, so index 0 — unlike App, where it is B.
const companies = (rows) => Array.from(rows, (r) => r[0]);

console.log('migrateReferralCancelColumn — opening a gap on a tab that is already live');
{
  jobs = freshJobs();
  app = freshApp();
  referral = makeSheet('Referral', [
    PRE_CANCEL_HEADER,
    preCancelRow('Stripe', 'Dana', 'Queued'),
    preCancelRow('Notion', 'Sam', 'Drafted'),
  ]);
  const s = load();
  // A rule each side of the gap, on columns setupReferralQueue does not recolour
  // itself — Tier at 7 ahead of it, Queue ID at 17 behind it. Status would be the
  // obvious choice and is the wrong one: colourQueueColumn_ rebuilds the Status
  // column's rules from scratch, so a rule there proves nothing about the insert.
  formatRules['Referral'] = [ruleAt(7, 'Tier'), ruleAt(17, 'Queue ID')];
  s.migrateReferralCancelColumn();

  // This tab is two layouts behind, so the run crosses both: Cancel opens at M,
  // and then migrateReferralLayout takes Job Link out to 14 and Priority in at 10.
  // A tab from before Cancel existed is exactly the one that must come out the far
  // end whole, because it is the one carrying a year of real rows.
  run('the header ends up as the new layout, Cancel between Mode and Job Link', () => {
    assert.deepStrictEqual(referral.grid[0].slice(9, 15),
      ['Priority', 'Status', 'Mode', 'Cancel', 'Job Link', 'Gmail Draft ID']);
    assert.deepStrictEqual(referral.grid[0], Array.from(s.REFERRAL_HEADERS));
  });
  run('every value from Gmail Draft ID rightwards moved with the gap', () => {
    // This is the half a header rewrite over live data would have got wrong: the
    // draft id would stay at M under the name Cancel, and every row would read as
    // a message sent at the moment its draft was made and then failed.
    assert.strictEqual(referral.grid[1][12], '');             // Cancel, opened empty
    assert.strictEqual(referral.grid[1][13], 'https://boards.example/Stripe');
    assert.strictEqual(referral.grid[1][14], 'draft-Stripe'); // the id that was at M
    assert.strictEqual(referral.grid[1][18], 'q-Stripe');     // Queue ID
    assert.strictEqual(referral.grid[1][19], 'v1');           // Version
    assert.strictEqual(referral.grid[2][14], 'draft-Notion');
  });
  run('the link travelled out of column C with its own row, not a neighbour\'s', () => {
    // The move is the step that could reattach one person's job to another's name
    // — six referrals at one employer differ only by which posting they are about.
    assert.strictEqual(referral.grid[1][13], 'https://boards.example/Stripe');
    assert.strictEqual(referral.grid[2][13], 'https://boards.example/Notion');
    assert.strictEqual(referral.grid[1][2], 'Dana');
    assert.strictEqual(referral.grid[2][2], 'Sam');
  });
  run('the columns ahead of the gap are untouched, person included', () => {
    assert.strictEqual(referral.grid[1][2], 'Dana');
    assert.strictEqual(referral.grid[1][8], 'Aug 20, 2026 10:00 AM');
    assert.strictEqual(referral.grid[1][10], 'Queued');
    assert.strictEqual(referral.grid[1][11], 'Draft');
  });
  run('the rows themselves are left alone — a migration adds a column, not data', () => {
    assert.strictEqual(referral.getLastRow(), 3);
    assert.deepStrictEqual(companies(referral.grid.slice(1)), ['Stripe', 'Notion']);
  });
  run('the colour rules follow the columns they colour rather than staying put', () => {
    // A rule left behind at its old column would colour whichever column slid
    // into that place — on this tab, Queue ID's rule landing on Last Error.
    const rules = formatRules['Referral'] || [];
    const columnOf = (name) =>
      rules.filter((r) => r.name === name)[0].getRanges()[0].getColumn();
    // Tier was at 7 and is at 6: the Cancel insert left it alone, the Job Link
    // move pulled it one to the left, and the Priority insert is behind it. Queue
    // ID was at 17 and is at 19, one from each insert with the move cancelling
    // out. Both are where their own column ended up, which is the only thing a
    // rule is allowed to follow.
    assert.strictEqual(columnOf('Tier'), s.REFERRAL_TIER_COL);
    assert.strictEqual(columnOf('Tier'), 6);
    assert.strictEqual(columnOf('Queue ID'), 19);
    assert.strictEqual(referral.grid[0][columnOf('Tier') - 1], 'Tier');
    assert.strictEqual(referral.grid[0][columnOf('Queue ID') - 1], 'Queue ID');
  });
  run('the toast says to deploy the sender project before the next run', () => {
    assert.match(toasts[toasts.length - 1], /deploy the sender project/);
  });
  run('running it again does not open a second gap', () => {
    const width = referral.grid[0].length;
    s.migrateReferralCancelColumn();
    assert.strictEqual(referral.grid[0].length, width);
    assert.deepStrictEqual(referral.grid[0], Array.from(s.REFERRAL_HEADERS));
    assert.strictEqual(referral.grid[1][14], 'draft-Stripe');
    assert.strictEqual(referral.grid[1][13], 'https://boards.example/Stripe');
    assert.strictEqual(referral.grid[1][10], 'Queued');
    assert.match(toasts[toasts.length - 1], /already on the current layout/);
  });
}

console.log('migrateReferralCancelColumn — the validation the insert brings with it');
{
  jobs = freshJobs();
  app = freshApp();
  referral = makeSheet('Referral', [
    PRE_CANCEL_HEADER,
    preCancelRow('Stripe', 'Dana', 'Queued'),
    preCancelRow('Notion', 'Sam', 'Drafted'),
  ]);
  const s = load();
  s.migrateReferralCancelColumn();

  // A column inserted next to another column inherits that column's data
  // validation, and Cancel lands right beside Mode — so every row of the new
  // column would come up wearing a two-value dropdown with allowInvalid off.
  // Tick the box and the cell holds TRUE, which is not in that list, so the whole
  // column flags red on a tab where nothing is wrong.
  run('whatever the insert brought in is stripped from the new column', () => {
    const onCancel = cleared.filter((c) => c[1] === s.REFERRAL_CANCEL);
    assert.ok(onCancel.length >= 1, 'nothing was cleared on column ' + s.REFERRAL_CANCEL);
    // The whole column, header row included, and not only the rows holding data
    // today: the validation covers the column, so a row added tomorrow would
    // otherwise arrive already wearing the inherited rule.
    assert.strictEqual(onCancel[0][0], 1);
    assert.ok(onCancel[0][2] >= referral.grid.length);
  });
  run('and the checkbox rule is then applied deliberately, at column 13', () => {
    // Stripping alone would leave Cancel as free text, where "x" and "cancel" and
    // a stray space all look like a tick to a person and none of them fire
    // onReferralEdit, which acts on true alone.
    const onCancel = validatedRules.filter((v) => v[1] === s.REFERRAL_CANCEL);
    assert.strictEqual(onCancel.length, 1);
    assert.strictEqual(onCancel[0][4].kind, 'checkbox');
    assert.strictEqual(onCancel[0][4].allowInvalid, null);
  });
  run('the strip happens before the rule, not after it', () => {
    // Order matters and is invisible in the end state: a clear that ran after the
    // rule was applied would take the checkbox straight back off again, leaving
    // the column exactly as free text as doing nothing.
    const stripped = cleared.filter((c) => c[1] === s.REFERRAL_CANCEL).length;
    const ruled = validatedRules.filter((v) => v[1] === s.REFERRAL_CANCEL).length;
    assert.ok(stripped >= 1 && ruled >= 1);
    // clearDataValidations is recorded on the whole column; the rule is recorded
    // on rows 2..500. Both happened, and the rule's row span is the setup's.
    const rule = validatedRules.filter((v) => v[1] === s.REFERRAL_CANCEL)[0];
    assert.strictEqual(rule[0], 2);
    assert.strictEqual(rule[2], 499);
  });
  run('and Cancel is left genuinely empty below its header', () => {
    // An inherited checkbox renders every empty cell as FALSE, and FALSE is a
    // value: it would make the column read as a tab of rows somebody had already
    // declined to cancel.
    for (let r = 1; r < referral.grid.length; r++) {
      const cell = referral.grid[r][s.REFERRAL_CANCEL - 1];
      assert.ok(cell === '' || cell === undefined || cell === null,
                'row ' + (r + 1) + ' holds ' + JSON.stringify(cell));
    }
  });
  run('the columns either side of it keep their own values', () => {
    // Behind Cancel is Job Link now and the draft id one further on, because this
    // run crossed the layout move as well.
    assert.strictEqual(referral.grid[1][s.REFERRAL_MODE - 1], 'Draft');
    assert.strictEqual(referral.grid[1][s.REFERRAL_JOB_LINK - 1], 'https://boards.example/Stripe');
    assert.strictEqual(referral.grid[1][s.REFERRAL_JOB_LINK], 'draft-Stripe');
    assert.strictEqual(referral.grid[2][s.REFERRAL_MODE - 1], 'Draft');
    assert.strictEqual(referral.grid[2][s.REFERRAL_JOB_LINK], 'draft-Notion');
  });
}

console.log('migrateReferralCancelColumn — repairing a tab whose Cancel kept Mode\'s dropdown');
{
  jobs = freshJobs();
  app = freshApp();
  // Already migrated in shape, but column M carries what an unstripped insert
  // leaves: a cell somebody picked out of the inherited Mode dropdown, sitting
  // beside a real tick and a real untick.
  referral = makeSheet('Referral', [
    Array.from(PRE_CANCEL_HEADER).slice(0, 12).concat(
      ['Cancel', 'Gmail Draft ID', 'Sent At', 'Result', 'Last Error', 'Queue ID', 'Version']),
    preLayoutRow('Stripe', 'Queued', 'Draft'),
    preLayoutRow('Notion', 'Queued', true),
    preLayoutRow('Ramp', 'Queued', false),
  ]);
  const s = load();
  s.migrateReferralCancelColumn();

  run('no second Cancel gap is opened — the column stays at 13', () => {
    // The tab handed in is a layout behind, so the run does move Job Link and open
    // Priority; what it must not do is insert a second Cancel, which is what a
    // migration that trusted the width instead of the name would do.
    assert.strictEqual(referral.grid[0].length, 20);
    assert.deepStrictEqual(referral.grid[0], Array.from(s.REFERRAL_HEADERS));
    assert.strictEqual(referral.grid[0][s.REFERRAL_CANCEL - 1], 'Cancel');
    assert.strictEqual(referral.grid[1][s.REFERRAL_JOB_LINK], 'draft-Stripe');
  });
  run('the Mode word the unstripped insert left behind is cleared', () => {
    // The lesson migrateAppOfficialColumn had to be patched twice to learn: the
    // insert has already happened on this tab, so the branch that strips is never
    // reached again, and this branch is the only route back.
    assert.strictEqual(referral.grid[1][s.REFERRAL_CANCEL - 1], '');
  });
  run('a real tick somebody made is not touched', () => {
    // The whole point of the column is that a decision a person made about a
    // person survives everything this file does.
    assert.strictEqual(referral.grid[2][s.REFERRAL_CANCEL - 1], true);
    assert.strictEqual(referral.grid[3][s.REFERRAL_CANCEL - 1], false);
  });
  run('the stale validation is stripped on this branch too', () => {
    const onCancel = cleared.filter((c) => c[1] === s.REFERRAL_CANCEL);
    assert.ok(onCancel.length >= 1);
    assert.strictEqual(onCancel[0][0], 2);   // below the header, where the ticks are
  });
  run('and the checkbox rule is put back', () => {
    const onCancel = validatedRules.filter((v) => v[1] === s.REFERRAL_CANCEL);
    assert.strictEqual(onCancel[onCancel.length - 1][4].kind, 'checkbox');
  });
  run('the toast counts what it healed rather than claiming nothing happened', () => {
    assert.match(toasts[toasts.length - 1], /Cleared 1 inherited dropdown cell/);
  });
  run('running it a third time is a clean no-op', () => {
    s.migrateReferralCancelColumn();
    assert.strictEqual(referral.grid[1][s.REFERRAL_CANCEL - 1], '');
    assert.strictEqual(referral.grid[2][s.REFERRAL_CANCEL - 1], true);
    assert.match(toasts[toasts.length - 1], /Nothing moved/);
  });
}

console.log('migrateReferralCancelColumn — a layout it does not recognise');
{
  jobs = freshJobs();
  app = freshApp();
  referral = makeSheet('Referral', [Array.from(PRE_CANCEL_HEADER)]);
  referral.grid[0][12] = 'Kill Switch';
  const s = load();
  run('a tab somebody has already put a column of their own at M is refused', () => {
    assert.throws(() => s.migrateReferralCancelColumn(), /Referral column 13 is "Kill Switch"/);
  });
  run('the error says what it expected there, so the fix does not need the source', () => {
    assert.throws(() => s.migrateReferralCancelColumn(),
                  /"Gmail Draft ID" or "Cancel"/);
  });
  run('the refusal moves nothing', () => {
    assert.strictEqual(referral.grid[0].length, PRE_CANCEL_HEADER.length);
    assert.strictEqual(referral.grid[0][12], 'Kill Switch');
    assert.deepStrictEqual(widths, []);
  });
}

console.log('migrateReferralCancelColumn — a half-built layout is not the layout either');
{
  jobs = freshJobs();
  app = freshApp();
  // Gmail Draft ID is where it should be, but what follows it is not: the shape a
  // run that died partway leaves. Inserting on the strength of column M alone
  // would shift this into something no version of the tab has ever been.
  referral = makeSheet('Referral', [Array.from(PRE_CANCEL_HEADER)]);
  referral.grid[0][13] = 'Result';
  referral.grid[0][14] = '';
  const s = load();
  run('it reads the columns behind the gap before it opens one', () => {
    assert.throws(() => s.migrateReferralCancelColumn(), /Referral column 14 is "Result"/);
  });
  run('and nothing is inserted', () => {
    assert.strictEqual(referral.grid[0].length, PRE_CANCEL_HEADER.length);
  });
}

console.log('migrateReferralCancelColumn — a migrated tab that lost a column behind M');
{
  jobs = freshJobs();
  app = freshApp();
  // Cancel is at M, which on its own looks migrated. It is not: a run that died
  // mid-insert leaves exactly this, and trusting column M alone would call it
  // finished and hand a half-built tab back to the sender.
  referral = makeSheet('Referral', [Array.from([
    'Company', 'Role', 'Job Link', 'Person', 'Email', 'Title', 'Tier', 'Template',
    'Drafted At', 'Scheduled At', 'Status', 'Mode', 'Cancel', 'Sent At',
    'Result', 'Last Error', 'Queue ID', 'Version', ''
  ])]);
  const s = load();
  run('a Cancel at M with the wrong column behind it is still refused', () => {
    assert.throws(() => s.migrateReferralCancelColumn(), /Referral column 14 is "Sent At"/);
    assert.throws(() => s.migrateReferralCancelColumn(), /"Gmail Draft ID"/);
  });
}

console.log('migrateReferralCancelColumn — a tab that has never been set up');
{
  jobs = freshJobs();
  app = freshApp();
  referral = makeSheet('Referral', [[]]);
  const s = load();
  run('a blank column M is not an error: there is nothing to shift', () => {
    assert.doesNotThrow(() => s.migrateReferralCancelColumn());
    assert.deepStrictEqual(referral.grid[0], Array.from(s.REFERRAL_HEADERS));
  });
  run('and no gap was opened, so the tab is simply the current layout', () => {
    assert.strictEqual(referral.getLastRow(), 1);
    assert.match(toasts[toasts.length - 1], /already on the current layout/);
  });
}


console.log('migrateReferralLayout — both moves on a tab that is already live');
{
  jobs = freshJobs();
  app = freshApp();
  referral = makeSheet('Referral', [
    PRE_MOVE_HEADER,
    preLayoutRow('Stripe', 'Queued'),
    preLayoutRow('Notion', 'Drafted'),
  ]);
  const s = load();
  // A rule each side of the ground the move covers, on columns setupReferralQueue
  // does not recolour itself — Tier at 7 ahead of the destination, Queue ID at 18
  // behind it. Status is the wrong choice for this: colourQueueColumn_ rebuilds
  // its rules from scratch, so a rule there proves nothing about the move.
  formatRules['Referral'] = [ruleAt(7, 'Tier'), ruleAt(18, 'Queue ID')];
  const moved = s.migrateReferralLayout();

  run('the header comes out as the twenty-column layout', () => {
    assert.deepStrictEqual(referral.grid[0], Array.from(s.REFERRAL_HEADERS));
    assert.strictEqual(referral.grid[0].length, 20);
  });
  run('Job Link is at 14 and Priority at 10, which is the whole point', () => {
    assert.strictEqual(referral.grid[0][s.REFERRAL_JOB_LINK - 1], 'Job Link');
    assert.strictEqual(referral.grid[0][s.REFERRAL_PRIORITY - 1], 'Priority');
    assert.deepStrictEqual(referral.grid[0].slice(0, 3), ['Company', 'Role', 'Person']);
  });
  run('every link travelled with its own row rather than with a row number', () => {
    // The failure a move gets wrong quietly: six referrals at one employer differ
    // only by which posting they are about, so a link that lands one row out is a
    // person being asked for the wrong favour and nothing on the tab looks odd.
    assert.strictEqual(referral.grid[1][s.REFERRAL_JOB_LINK - 1],
                       'https://boards.example/Stripe');
    assert.strictEqual(referral.grid[2][s.REFERRAL_JOB_LINK - 1],
                       'https://boards.example/Notion');
    assert.strictEqual(referral.grid[1][2], 'Stripe Person');
    assert.strictEqual(referral.grid[2][2], 'Notion Person');
  });
  run('the columns the move passed over closed up behind it, values and all', () => {
    // Person through Cancel each shift one to the left as Job Link leaves, and
    // Priority pushes only Status, Mode and Cancel back. A value that stayed on
    // its old number would put a draft timestamp under Template.
    assert.strictEqual(referral.grid[1][s.REFERRAL_DRAFTED_AT - 1], 'Aug 20, 2026 9:00 AM');
    assert.strictEqual(referral.grid[1][s.REFERRAL_SCHEDULED_AT - 1], 'Aug 20, 2026 10:00 AM');
    assert.strictEqual(referral.grid[1][s.REFERRAL_STATUS - 1], 'Queued');
    assert.strictEqual(referral.grid[1][s.REFERRAL_MODE - 1], 'Draft');
    assert.strictEqual(referral.grid[2][s.REFERRAL_STATUS - 1], 'Drafted');
  });
  run('and the machinery behind Job Link is intact', () => {
    assert.strictEqual(referral.grid[1][s.REFERRAL_JOB_LINK], 'draft-Stripe');
    assert.strictEqual(referral.grid[1][18], 'q-Stripe');
    assert.strictEqual(referral.grid[1][19], 'v1');
  });
  run('Priority arrives empty — not FALSE on every row of the tab', () => {
    // An inherited checkbox renders every empty cell as FALSE, and FALSE is a
    // value: it would read as a tab of asks somebody had already declined to star.
    for (let r = 1; r < referral.grid.length; r++) {
      const cell = referral.grid[r][s.REFERRAL_PRIORITY - 1];
      assert.ok(cell === '' || cell === undefined || cell === null,
                'row ' + (r + 1) + ' holds ' + JSON.stringify(cell));
    }
  });
  run('the rows themselves are left alone — a migration moves columns, not data', () => {
    assert.strictEqual(referral.getLastRow(), 3);
    assert.deepStrictEqual(companies(referral.grid.slice(1)), ['Stripe', 'Notion']);
  });
  run('the colour rules follow the columns they colour rather than staying put', () => {
    // A rule left on its old number would colour whichever column slid into that
    // place — Tier\'s rule painting Template, Queue ID\'s painting Last Error.
    const rules = formatRules['Referral'] || [];
    const columnOf = (name) =>
      rules.filter((r) => r.name === name)[0].getRanges()[0].getColumn();
    assert.strictEqual(columnOf('Tier'), s.REFERRAL_TIER_COL);
    assert.strictEqual(referral.grid[0][columnOf('Tier') - 1], 'Tier');
    assert.strictEqual(columnOf('Queue ID'), 19);
    assert.strictEqual(referral.grid[0][columnOf('Queue ID') - 1], 'Queue ID');
  });
  run('it says what moved and that the sender has to be redeployed', () => {
    assert.match(toasts[toasts.length - 1], /Job Link/);
    assert.match(toasts[toasts.length - 1], /Priority/);
    assert.match(toasts[toasts.length - 1], /deploy the sender project/);
  });
  run('and it reports back that it moved something', () => {
    // migrateReferralCancelColumn asks, because it cannot see this for itself and
    // must not toast "nothing moved" over a run that renumbered ten columns.
    assert.strictEqual(moved, true);
  });
  run('running it again moves nothing and says so', () => {
    const width = referral.grid[0].length;
    const again = s.migrateReferralLayout();
    assert.strictEqual(again, false);
    assert.strictEqual(referral.grid[0].length, width);
    assert.deepStrictEqual(referral.grid[0], Array.from(s.REFERRAL_HEADERS));
    assert.strictEqual(referral.grid[1][s.REFERRAL_JOB_LINK - 1],
                       'https://boards.example/Stripe');
    assert.strictEqual(referral.grid[1][s.REFERRAL_STATUS - 1], 'Queued');
    assert.match(toasts[toasts.length - 1], /already on the current layout/);
  });
}

console.log('migrateReferralLayout — the validation and format the insert brings in');
{
  jobs = freshJobs();
  app = freshApp();
  referral = makeSheet('Referral', [
    PRE_MOVE_HEADER,
    preLayoutRow('Stripe', 'Queued'),
    preLayoutRow('Notion', 'Drafted'),
  ]);
  const s = load();
  // Status\'s colours, sitting where they sit on a real tab: on the column
  // Priority is about to be inserted in front of.
  formatRules['Referral'] = [ruleAt(11, 'Sent')];
  s.migrateReferralLayout();

  // An inserted column inherits the data validation and the formatting of the
  // column beside it, and Priority lands between Scheduled At and Status — the two
  // worst neighbours on the tab. From Status it would take a seven-word list with
  // allowInvalid off, so a ticked box holds TRUE, which is not in the list, and the
  // whole column flags red; worse, the dropdown it offers puts "Cancelled" in
  // Priority, which reads as a called-off row to a person and a live one to the
  // script. From Scheduled At it would take the timestamp format, and the checkbox
  // then lands on a column that renders every value as a date.
  run('whatever the insert brought in is stripped from the new column', () => {
    const onPriority = cleared.filter((c) => c[1] === s.REFERRAL_PRIORITY);
    assert.ok(onPriority.length >= 1,
              'nothing was cleared on column ' + s.REFERRAL_PRIORITY);
    // The whole column, header row included, and not only the rows holding data
    // today: the rule covers the column, so a row added tomorrow would otherwise
    // arrive already wearing it.
    assert.strictEqual(onPriority[0][0], 1);
    assert.ok(onPriority[0][2] >= referral.grid.length);
  });
  run('the inherited number format is taken off too, not only the validation', () => {
    // clearFormat is documented not to touch number formatting rules, so a strip
    // that stopped at validation would leave Priority wearing Scheduled At\'s
    // timestamp pattern: a ticked box rendering as "Dec 30, 1899", which is the
    // exact cell somebody deletes, taking the tick with it.
    const general = formats.filter((f) => f[0] === s.REFERRAL_PRIORITY && f[2] === 'General');
    assert.ok(general.length >= 1, 'the number format was never reset');
    const stamped = formats.filter((f) => f[2] === s.OUTREACH_TIMESTAMP_FORMAT);
    assert.ok(!stamped.some((f) => f[0] === s.REFERRAL_PRIORITY),
              'a timestamp format was laid on the checkbox column');
  });
  run('and the colour rules the insert could have widened onto it are dropped', () => {
    // Status\'s six rules must not paint a checkbox column: a ticked box wearing
    // the colour "Sent" wears reads as a row that has already gone.
    const rules = formatRules['Referral'] || [];
    assert.ok(!rules.some((r) => r.getRanges()[0].getColumn() === s.REFERRAL_PRIORITY),
              'a colour rule was left painting Priority');
    // The rule itself is not lost — it followed Status to its new column.
    const sent = rules.filter((r) => r.name === 'Sent');
    if (sent.length) assert.strictEqual(sent[0].getRanges()[0].getColumn(), s.REFERRAL_STATUS);
  });
  run('and the checkbox rule is then applied deliberately, at column 10', () => {
    // Stripping alone would leave Priority as free text, where "x" and "yes" and a
    // stray space all look like a star to a person and none of them lift the ask.
    const onPriority = validatedRules.filter((v) => v[1] === s.REFERRAL_PRIORITY);
    assert.strictEqual(onPriority.length, 1);
    assert.strictEqual(onPriority[0][4].kind, 'checkbox');
    assert.strictEqual(onPriority[0][4].list, null);
    assert.strictEqual(onPriority[0][4].allowInvalid, null);
  });
  run('the strip happens before the rule, not after it', () => {
    // Order matters and is invisible in the end state: a clear that ran after the
    // rule was applied would take the checkbox straight back off again, leaving the
    // column exactly as free text as doing nothing.
    const stripped = cleared.filter((c) => c[1] === s.REFERRAL_PRIORITY).length;
    const rule = validatedRules.filter((v) => v[1] === s.REFERRAL_PRIORITY)[0];
    assert.ok(stripped >= 1);
    assert.strictEqual(rule[0], 2);      // the rule covers rows 2..500
    assert.strictEqual(rule[2], 499);
  });
  run('the columns either side of Priority keep their own values', () => {
    assert.strictEqual(referral.grid[1][s.REFERRAL_SCHEDULED_AT - 1], 'Aug 20, 2026 10:00 AM');
    assert.strictEqual(referral.grid[1][s.REFERRAL_STATUS - 1], 'Queued');
  });
}

console.log('migrateReferralLayout — repairing a tab whose Priority kept Status\'s dropdown');
{
  jobs = freshJobs();
  app = freshApp();
  // Already migrated in shape, but column J carries what an unstripped insert
  // leaves: a word somebody picked out of the inherited Status dropdown, sitting
  // beside a real star and a real blank.
  const starred = (company, priority) => referralRow(company, 'Queued', false, priority);
  referral = freshReferral([
    starred('Stripe', 'Cancelled'),
    starred('Notion', true),
    starred('Ramp', false),
  ]);
  const s = load();
  const moved = s.migrateReferralLayout();

  run('nothing structural happens — no second Priority is opened', () => {
    assert.strictEqual(moved, false);
    assert.strictEqual(referral.grid[0].length, 20);
    assert.deepStrictEqual(referral.grid[0], Array.from(s.REFERRAL_HEADERS));
  });
  run('the Status word the unstripped insert left behind is cleared', () => {
    // The lesson the two migrations before this one each had to be patched twice
    // to learn: the insert has already happened on this tab, so the branch that
    // strips is never reached again, and this branch is the only route back.
    assert.strictEqual(referral.grid[1][s.REFERRAL_PRIORITY - 1], '');
  });
  run('a real star somebody made is not touched', () => {
    assert.strictEqual(referral.grid[2][s.REFERRAL_PRIORITY - 1], true);
    assert.strictEqual(referral.grid[3][s.REFERRAL_PRIORITY - 1], false);
  });
  run('the stale validation and the stale format are stripped on this branch too', () => {
    const onPriority = cleared.filter((c) => c[1] === s.REFERRAL_PRIORITY);
    assert.ok(onPriority.length >= 1);
    assert.strictEqual(onPriority[0][0], 2);   // below the header, where the stars are
    assert.ok(formats.some((f) => f[0] === s.REFERRAL_PRIORITY && f[2] === 'General'));
  });
  run('and the checkbox rule is put back', () => {
    const onPriority = validatedRules.filter((v) => v[1] === s.REFERRAL_PRIORITY);
    assert.strictEqual(onPriority[onPriority.length - 1][4].kind, 'checkbox');
  });
  run('the toast counts what it healed rather than claiming nothing happened', () => {
    assert.match(toasts[toasts.length - 1], /Cleared 1 inherited dropdown cell/);
  });
  run('nothing else on the row was disturbed by the repair', () => {
    assert.strictEqual(referral.grid[1][s.REFERRAL_STATUS - 1], 'Queued');
    assert.strictEqual(referral.grid[1][s.REFERRAL_JOB_LINK - 1],
                       'https://boards.example/Stripe');
  });
  run('running it a third time is a clean no-op', () => {
    s.migrateReferralLayout();
    assert.strictEqual(referral.grid[1][s.REFERRAL_PRIORITY - 1], '');
    assert.strictEqual(referral.grid[2][s.REFERRAL_PRIORITY - 1], true);
    assert.match(toasts[toasts.length - 1], /Nothing moved/);
  });
}

console.log('migrateReferralLayout — resuming a run that died between the two steps');
{
  jobs = freshJobs();
  app = freshApp();
  // Job Link is already behind Cancel and Priority was never opened: the state the
  // migration itself passes through. A version that recognised only the two ends
  // would refuse here, and the tab it refused on would be one no other function in
  // this file can read either.
  referral = makeSheet('Referral', [
    MID_MOVE_HEADER,
    midMoveRow('Stripe', 'Queued'),
    midMoveRow('Notion', 'Drafted'),
  ]);
  const s = load();
  const moved = s.migrateReferralLayout();

  run('it finishes the job rather than moving Job Link a second time', () => {
    assert.strictEqual(moved, true);
    assert.deepStrictEqual(referral.grid[0], Array.from(s.REFERRAL_HEADERS));
    assert.strictEqual(referral.grid[1][s.REFERRAL_JOB_LINK - 1],
                       'https://boards.example/Stripe');
    assert.strictEqual(referral.grid[2][s.REFERRAL_JOB_LINK - 1],
                       'https://boards.example/Notion');
  });
  run('Priority is the only thing that opened', () => {
    assert.strictEqual(referral.grid[0].length, 20);
    assert.strictEqual(referral.grid[1][s.REFERRAL_PRIORITY - 1], '');
    assert.strictEqual(referral.grid[1][s.REFERRAL_STATUS - 1], 'Queued');
    assert.strictEqual(referral.grid[1][s.REFERRAL_JOB_LINK], 'draft-Stripe');
  });
  run('and the toast names only the half that was left to do', () => {
    assert.match(toasts[toasts.length - 1], /Priority/);
    assert.ok(!/Job Link/.test(toasts[toasts.length - 1]));
  });
}

console.log('migrateReferralLayout — layouts it does not recognise');
{
  jobs = freshJobs();
  app = freshApp();
  referral = makeSheet('Referral', [Array.from(PRE_MOVE_HEADER)]);
  referral.grid[0][2] = 'Referrer Notes';
  const s = load();
  run('a column of somebody else\'s at 3 is refused, and named', () => {
    assert.throws(() => s.migrateReferralLayout(), /Referral column 3 is "Referrer Notes"/);
  });
  run('the error says what it expected there, so the fix does not need the source', () => {
    assert.throws(() => s.migrateReferralLayout(),
                  /"Job Link" before the move, or "Person" after it/);
  });
  run('the refusal moves nothing at all', () => {
    assert.strictEqual(referral.grid[0].length, PRE_MOVE_HEADER.length);
    assert.strictEqual(referral.grid[0][2], 'Referrer Notes');
    assert.deepStrictEqual(widths, []);
  });
  run('a half-built tab behind the gap is refused before anything shifts', () => {
    // Job Link at 3 is not on its own proof this is the layout: a tab whose tail
    // has been edited by hand would be shifted into something no version of this
    // file has ever described.
    referral = makeSheet('Referral', [Array.from(PRE_MOVE_HEADER)]);
    referral.grid[0][13] = 'Sent At';
    const s2 = load();
    assert.throws(() => s2.migrateReferralLayout(), /Referral column 14 is "Sent At"/);
    assert.throws(() => s2.migrateReferralLayout(), /"Gmail Draft ID"/);
    assert.strictEqual(referral.grid[0].length, PRE_MOVE_HEADER.length);
  });
  run('a tab from before Cancel existed is sent to the other migration by name', () => {
    // This one cannot do that move, and saying so is more use than shifting a
    // tab that is two layouts behind into a shape neither migration knows.
    referral = makeSheet('Referral', [Array.from(PRE_CANCEL_HEADER)]);
    const s3 = load();
    assert.throws(() => s3.migrateReferralLayout(), /run migrateReferralCancelColumn first/);
  });
  run('a column of somebody else\'s at 10 is refused once step one has passed', () => {
    referral = makeSheet('Referral', [Array.from(MID_MOVE_HEADER)]);
    referral.grid[0][9] = 'Urgency';
    const s4 = load();
    assert.throws(() => s4.migrateReferralLayout(), /Referral column 10 is "Urgency"/);
    assert.throws(() => s4.migrateReferralLayout(),
                  /"Status" before the move, or "Priority" after it/);
  });
  run('and a migrated tab that lost a column behind Priority is refused too', () => {
    // "Priority is at J" is not proof the rest landed: a run that died mid-insert
    // leaves exactly that, and a second run trusting column J alone would call it
    // finished and hand a half-built tab back to the sender.
    referral = freshReferral([]);
    referral.grid[0][13] = 'Gmail Draft ID';   // Job Link gone from 14
    const s5 = load();
    assert.throws(() => s5.migrateReferralLayout(), /Referral column 14 is "Gmail Draft ID"/);
    assert.throws(() => s5.migrateReferralLayout(), /"Job Link"/);
  });
}

console.log('migrateReferralLayout — a tab that has never been set up');
{
  jobs = freshJobs();
  app = freshApp();
  referral = makeSheet('Referral', [[]]);
  const s = load();
  run('a blank tab is not an error: there is nothing to move', () => {
    assert.doesNotThrow(() => s.migrateReferralLayout());
    assert.deepStrictEqual(referral.grid[0], Array.from(s.REFERRAL_HEADERS));
  });
  run('and nothing was moved, so the tab is simply the current layout', () => {
    assert.strictEqual(referral.getLastRow(), 1);
    assert.match(toasts[toasts.length - 1], /already on the current layout/);
  });
  run('a tab with no Referral sheet at all says which tab it wanted', () => {
    referral = null;
    const s2 = load();
    assert.throws(() => s2.migrateReferralLayout(), /No tab named "Referral"/);
  });
}



console.log('onEdit on the Referral Cancel column');
{
  jobs = freshJobs();
  app = freshApp();
  referral = freshReferral([
    referralRow('Stripe', 'Queued'),
    referralRow('Notion', 'Drafted'),
  ]);
  const s = load();

  run('ticking Cancel sets Cancelled and clears both booked hours', () => {
    referral.grid[1][12] = true;
    s.onEdit({ source: ss, range: referral.getRange(2, 13, 1, 1) });
    assert.deepStrictEqual(stateOf('Stripe'),
      { drafted: '', scheduled: '', status: 'Cancelled', cancel: true });
  });

  // The row does not stay where it was. Sinking it on the keystroke is the point:
  // a row that says Cancelled and sits among the live ones is a queue you have to
  // read twice, and reading it twice is how the wrong box gets ticked.
  run('and it sinks to the bottom on the same keystroke', () => {
    assert.strictEqual(rowOf('Stripe'), 3);
    assert.strictEqual(rowOf('Notion'), 2);
  });

  run('both timestamps, not just the one that says when it leaves', () => {
    // Drafted At is the hour the message appears in Gmail Drafts, an hour ahead of
    // sending. A row left holding one still puts a draft in front of you tomorrow
    // morning for somebody you decided last week not to write to.
    assert.strictEqual(cellOf('Stripe', 7), '');
    assert.strictEqual(cellOf('Stripe', 8), '');
  });
  run('the tick itself stays, because it is the record of who called it off', () => {
    assert.strictEqual(cellOf('Stripe', 12), true);
  });
  run('the row beside it keeps everything, including its hour', () => {
    // A Drafted row has a message written against a particular hour, so the reflow
    // leaves it alone even as it moves up the tab.
    assert.deepStrictEqual(stateOf('Notion'), {
      drafted: 'Aug 20, 2026 9:00 AM', scheduled: 'Aug 20, 2026 10:00 AM',
      status: 'Drafted', cancel: false,
    });
  });
  run('everything outside Drafted At..Cancel is left exactly as it was', () => {
    assert.strictEqual(cellOf('Stripe', 0), 'Stripe');
    assert.strictEqual(cellOf('Stripe', 2), 'Stripe Person');
    assert.strictEqual(cellOf('Stripe', 11), 'Draft');
    assert.strictEqual(cellOf('Stripe', 13), 'https://boards.example/Stripe');
    assert.strictEqual(cellOf('Stripe', 14), 'draft-Stripe');
    assert.strictEqual(cellOf('Stripe', 18), 'q-Stripe');
  });
  run('it says what it did rather than going silent', () => {
    assert.match(toasts[toasts.length - 1], /Cancelled 1 row/);
  });
}

console.log('onEdit on Referral — the row that has already gone');
{
  jobs = freshJobs();
  app = freshApp();
  referral = freshReferral([referralRow('Stripe', 'Sent')]);
  const s = load();
  referral.grid[1][12] = true;
  s.onEdit({ source: ss, range: referral.getRange(2, 13, 1, 1) });

  run('a Sent row keeps its Status — calling off a message that has gone means nothing', () => {
    // There is no draft left to delete and no hour left to give back, so
    // "Cancelled" here would be the tab telling you a thing that is not true, and
    // the reply, when it comes, would land on a row claiming you never wrote.
    assert.strictEqual(referral.grid[1][10], 'Sent');
  });
  run('and it keeps both timestamps, which are the record of when it went', () => {
    assert.strictEqual(referral.grid[1][7], 'Aug 20, 2026 9:00 AM');
    assert.strictEqual(referral.grid[1][8], 'Aug 20, 2026 10:00 AM');
  });
  run('the box is put back rather than left as a grey claim it was called off', () => {
    assert.strictEqual(referral.grid[1][12], false);
  });
  run('and it says so, so the click is not simply swallowed', () => {
    assert.match(toasts[toasts.length - 1], /already sent/);
  });
  run('a Sent row typed in lower case is refused just the same', () => {
    referral.grid[1][10] = 'sent';
    referral.grid[1][12] = true;
    s.onEdit({ source: ss, range: referral.getRange(2, 13, 1, 1) });
    assert.strictEqual(referral.grid[1][10], 'sent');
    assert.strictEqual(referral.grid[1][12], false);
  });
}

console.log('onEdit on Referral — the edits that must do nothing');
{
  jobs = freshJobs();
  app = freshApp();
  referral = freshReferral([referralRow('Stripe', 'Cancelled', true)]);
  const s = load();

  run('unticking a cancelled row does not resurrect it', () => {
    // The box is not a switch with an off position. What would put this row back
    // in the queue is a Scheduled At, and the sender is the only thing that picks
    // one — restoring an hour here would either invent one the sender never agreed
    // to or take back an hour since given to somebody else.
    referral.grid[1][7] = '';
    referral.grid[1][8] = '';
    referral.grid[1][12] = false;
    const wroteBefore = wrote.length;
    s.onEdit({ source: ss, range: referral.getRange(2, 13, 1, 1) });
    assert.deepStrictEqual(cancelState(1),
      { drafted: '', scheduled: '', status: 'Cancelled', cancel: false });
    assert.strictEqual(wrote.length, wroteBefore, 'an untick wrote to the sheet');
  });
  run('an edit in a column that is not Cancel is ignored', () => {
    const wroteBefore = wrote.length;
    s.onEdit({ source: ss, range: referral.getRange(2, 12, 1, 1) });   // Mode
    s.onEdit({ source: ss, range: referral.getRange(2, 14, 1, 1) });   // Gmail Draft ID
    assert.strictEqual(wrote.length, wroteBefore);
  });
  run('an edit on the header row alone never cancels row 1', () => {
    referral.grid[0][12] = true;
    const wroteBefore = wrote.length;
    s.onEdit({ source: ss, range: referral.getRange(1, 13, 1, 1) });
    assert.strictEqual(wrote.length, wroteBefore);
    assert.strictEqual(referral.grid[0][10], 'Status');
    referral.grid[0][12] = 'Cancel';
  });
  run('a ticked box on a blank row below the data conjures nothing', () => {
    // Those rows carry a checkbox because the validation covers the whole column.
    // Writing Cancelled there would invent an ask that never existed and extend
    // getLastRow, so every sweep after it read a phantom row as the queue's bottom.
    referral.grid.push(blankReferralRow());
    referral.grid[2][12] = true;
    const wroteBefore = wrote.length;
    s.onEdit({ source: ss, range: referral.getRange(3, 13, 1, 1) });
    assert.strictEqual(wrote.length, wroteBefore);
    assert.strictEqual(referral.grid[2][10], '');
  });
  run('an edit on another tab still reaches its own half of the dispatcher', () => {
    // One onEdit entry point, three branches. A second function of this name would
    // not fail — Apps Script would quietly keep the last one loaded and turn the
    // Jobs and App halves off.
    jobs.grid[1][APPLIED] = true;
    const before = app.getLastRow();
    s.onEdit({ source: ss, range: jobs.getRange(2, 6, 1, 1) });
    assert.ok(app.getLastRow() > before, 'the Jobs branch stopped creating App rows');
  });
}

console.log('onEdit on Referral — a fill-down over many rows');
{
  jobs = freshJobs();
  app = freshApp();
  referral = freshReferral([
    referralRow('Stripe', 'Queued'),
    referralRow('Notion', 'Sent'),
    referralRow('Ramp', 'Drafted'),
  ]);
  const s = load();
  referral.grid[1][12] = true;
  referral.grid[2][12] = true;
  referral.grid[3][12] = true;
  const wroteBefore = wrote.length;
  s.onEdit({ source: ss, range: referral.getRange(2, 13, 3, 1) });

  run('a drag over three rows is two writes, not one per row', () => {
    // onEdit is a simple trigger with thirty seconds. One round trip per row is
    // how a fill-down over a real queue dies halfway down the tab. Two: the block
    // of cancelled cells, then the reordered tab.
    assert.strictEqual(wrote.length, wroteBefore + 2);
  });
  run('the two live rows are cancelled and the sent one is stepped over', () => {
    assert.strictEqual(stateOf('Stripe').status, 'Cancelled');
    assert.strictEqual(stateOf('Notion').status, 'Sent');
    assert.strictEqual(stateOf('Ramp').status, 'Cancelled');
    assert.strictEqual(stateOf('Notion').cancel, false);
  });
  run('the toast reports both halves rather than only the ones it changed', () => {
    assert.match(toasts[toasts.length - 1], /Cancelled 2 rows/);
    assert.match(toasts[toasts.length - 1], /1 row left alone as already sent/);
  });

  // The sent row is the only one still going, so it leads; the two called off sink
  // behind it in the order they were met.
  run('the cancelled rows sink and the live one leads', () => {
    assert.deepStrictEqual(companies(referral.grid.slice(1, 4)),
                           ['Notion', 'Stripe', 'Ramp']);
  });
}

console.log('orderReferralCancelledRows_ — the ordering on its own, no sheet');
{
  const s = load();
  const rows = [
    referralRow('A', 'Cancelled'), referralRow('P', 'Queued'),
    referralRow('B', 'Cancelled'), referralRow('Q', 'Drafted'),
    referralRow('C', 'Cancelled'), referralRow('R', 'Sent'),
  ];
  const out = s.orderReferralCancelledRows_(rows);

  run('the live rows come first and the cancelled ones sink', () => {
    assert.deepStrictEqual(companies(out), ['P', 'Q', 'R', 'A', 'B', 'C']);
  });
  run('the live group keeps the order it was already in', () => {
    // Identity, not equality: these must be the same row objects in the same
    // sequence, so a sort that rebuilt the group from a comparator fails here even
    // if it happened to produce equal-looking rows.
    assert.strictEqual(out[0], rows[1]);
    assert.strictEqual(out[1], rows[3]);
    assert.strictEqual(out[2], rows[5]);
  });
  run('and the cancelled group keeps its order too — it is a history', () => {
    // A history reordered is a history you cannot scan for "what did I stop doing
    // last week".
    assert.strictEqual(out[3], rows[0]);
    assert.strictEqual(out[4], rows[2]);
    assert.strictEqual(out[5], rows[4]);
  });
  run('nothing is dropped and nothing is duplicated', () => {
    assert.strictEqual(out.length, rows.length);
    assert.deepStrictEqual(companies(out).sort(), ['A', 'B', 'C', 'P', 'Q', 'R']);
  });
  run('a cancelled row is never deleted, only moved', () => {
    // It is the record that you decided not to write to this person, which is what
    // stops you asking them again in six weeks having forgotten.
    assert.ok(companies(out).indexOf('A') !== -1);
  });
  run('a Status typed in lower case still sinks', () => {
    const typed = [referralRow('P', 'Queued'), referralRow('A', 'cancelled')];
    assert.deepStrictEqual(companies(s.orderReferralCancelledRows_(typed)), ['P', 'A']);
    const reversed = [referralRow('A', ' CANCELLED '), referralRow('P', 'Queued')];
    assert.deepStrictEqual(companies(s.orderReferralCancelledRows_(reversed)), ['P', 'A']);
  });
  run('running the ordering on its own output changes nothing', () => {
    assert.deepStrictEqual(rowsOf(s.orderReferralCancelledRows_(out)), rowsOf(out));
  });
}

console.log('orderReferralCancelledRows_ — the empty tail');
{
  const s = load();
  const rows = [
    referralRow('A', 'Cancelled'), referralRow('P', 'Queued'),
    referralRow('B', 'Cancelled'), referralRow('Q', 'Drafted'),
    blankReferralRow(), blankReferralRow(),
  ];
  const out = s.orderReferralCancelledRows_(rows);

  run('the blank rows stay below the cancelled ones rather than sorting in', () => {
    assert.deepStrictEqual(companies(out), ['P', 'Q', 'A', 'B', '', '']);
  });
  run('a row that is only an unticked Cancel box still counts as blank', () => {
    // false is a value, and every untouched row on the tab has one in column M.
    // Counting it as content would make a blank row look occupied, so it would
    // never be pinned to the bottom and would sort in among the asks.
    assert.strictEqual(s.appRowIsEmpty_(blankReferralRow()), true);
    assert.strictEqual(s.appRowIsEmpty_(referralRow('P', 'Queued')), false);
  });
  run('a blank row with real rows still under it keeps its place', () => {
    // Only the trailing blanks are pinned. A gap in the middle is something
    // somebody left there, and sinking it is the reshuffle stability prevents.
    const gapped = [referralRow('P', 'Queued'), blankReferralRow(),
                    referralRow('A', 'Cancelled'), referralRow('Q', 'Queued')];
    assert.deepStrictEqual(companies(s.orderReferralCancelledRows_(gapped)),
                           ['P', '', 'Q', 'A']);
  });
  run('a tab that is nothing but blank rows is left completely alone', () => {
    const empty = [blankReferralRow(), blankReferralRow()];
    assert.deepStrictEqual(rowsOf(s.orderReferralCancelledRows_(empty)), empty);
  });
  run('a tab with nothing cancelled on it is left completely alone', () => {
    const live = [referralRow('P', 'Queued'), referralRow('Q', 'Sent')];
    assert.deepStrictEqual(rowsOf(s.orderReferralCancelledRows_(live)), live);
  });
  run('running it on its own output changes nothing, blanks included', () => {
    assert.deepStrictEqual(rowsOf(s.orderReferralCancelledRows_(out)), rowsOf(out));
  });
}

console.log('sortReferralCancelledToBottom');
{
  jobs = freshJobs();
  app = freshApp();
  referral = freshReferral([
    referralRow('Stripe', 'Cancelled', true),
    referralRow('Notion', 'Queued'),
    referralRow('Ramp', 'Cancelled', true),
    referralRow('Figma', 'Drafted'),
  ]);
  const s = load();
  const wroteBefore = wrote.length;
  s.sortReferralCancelledToBottom();

  run('the cancelled rows sink and the live ones close up', () => {
    assert.deepStrictEqual(companies(referral.grid.slice(1, 5)),
      ['Notion', 'Figma', 'Stripe', 'Ramp']);
  });
  run('the whole block moves in one write, not one call per row', () => {
    assert.strictEqual(wrote.length, wroteBefore + 1);
  });
  run('the block is twenty wide and starts at row 2', () => {
    // Twenty because a row moved with fewer columns in hand is a row torn apart:
    // the right-hand end of the queue would stay behind and reattach itself to
    // whichever ask slid into that line. The number follows REFERRAL_HEADERS
    // rather than a digit in the sort, which is why the layout move widened it
    // without a second edit.
    const last = wrote[wrote.length - 1];
    assert.strictEqual(last[0], 2);           // below the header
    assert.strictEqual(last[1], 1);           // from column A
    assert.strictEqual(last[2], 4);           // the four data rows, not out to 500
    assert.strictEqual(last[3], 20);
    assert.strictEqual(last[3], Array.from(s.REFERRAL_HEADERS).length);
  });
  run('the rows arrive whole — every cell travelled with its own row', () => {
    assert.strictEqual(referral.grid[3][0], 'Stripe');
    assert.strictEqual(referral.grid[3][13], 'https://boards.example/Stripe');
    assert.strictEqual(referral.grid[3][14], 'draft-Stripe');
    assert.strictEqual(referral.grid[3][18], 'q-Stripe');
    assert.strictEqual(referral.grid[3][12], true);
    assert.strictEqual(referral.grid[1][0], 'Notion');
    assert.strictEqual(referral.grid[1][18], 'q-Notion');
  });
  run('running it again writes nothing at all', () => {
    const before = wrote.length;
    s.sortReferralCancelledToBottom();
    assert.strictEqual(wrote.length, before);
    assert.deepStrictEqual(companies(referral.grid.slice(1, 5)),
      ['Notion', 'Figma', 'Stripe', 'Ramp']);
    assert.match(toasts[toasts.length - 1], /already in order/);
  });
  run('a tab with no rows yet says nothing moved instead of throwing', () => {
    referral = freshReferral([]);
    const s2 = load();
    assert.doesNotThrow(() => s2.sortReferralCancelledToBottom());
    assert.strictEqual(referral.getLastRow(), 1);
  });
}

console.log('sortReferralCancelledToBottom — a column past Version');
{
  jobs = freshJobs();
  app = freshApp();
  // A note of the operator's own at column 21. A sort that moved only the twenty
  // columns this tool owns would leave that cell sitting on whatever row landed in
  // its place — and on this tab the note is about a human being asked for a
  // favour, so reattaching it to a different person is worse than a wrong cell.
  referral = freshReferral([
    referralRow('Stripe', 'Cancelled', true).concat(['owes me nothing']),
    referralRow('Notion', 'Queued').concat(['met at the career fair']),
  ]);
  referral.grid[0].push('Notes');
  const s = load();
  s.sortReferralCancelledToBottom();

  run('the block widens to the real extent of the data', () => {
    const last = wrote[wrote.length - 1];
    assert.strictEqual(last[3], 21);
  });
  run("the operator's own column travelled with its row", () => {
    assert.deepStrictEqual(companies(referral.grid.slice(1, 3)), ['Notion', 'Stripe']);
    assert.strictEqual(referral.grid[1][20], 'met at the career fair');
    assert.strictEqual(referral.grid[2][20], 'owes me nothing');
  });
}

console.log('sortReferralCancelledToBottom — a tab narrower than the layout');
{
  jobs = freshJobs();
  app = freshApp();
  // Version and Queue ID are empty on every row, so getLastColumn comes back at 15
  // rather than 20. Trusting it alone would tear the right-hand end off every row
  // the sort moved.
  const short = (company, status) => {
    const row = referralRow(company, status);
    row[18] = '';
    row[19] = '';
    return row;
  };
  referral = freshReferral([short('Stripe', 'Cancelled'), short('Notion', 'Queued')]);
  referral.grid[0][18] = '';
  referral.grid[0][19] = '';
  const s = load();
  s.sortReferralCancelledToBottom();

  run('the width is floored at the twenty columns the layout owns', () => {
    const last = wrote[wrote.length - 1];
    assert.strictEqual(last[3], 20);
  });
  run('and the rows still swap, whole', () => {
    assert.deepStrictEqual(companies(referral.grid.slice(1, 3)), ['Notion', 'Stripe']);
    assert.strictEqual(referral.grid[2][13], 'https://boards.example/Stripe');
    assert.strictEqual(referral.grid[2][14], 'draft-Stripe');
  });
}

console.log('the Cancel box end to end: tick, then sort');
{
  jobs = freshJobs();
  app = freshApp();
  referral = freshReferral([
    referralRow('Stripe', 'Queued'),
    referralRow('Notion', 'Queued'),
    referralRow('Ramp', 'Sent'),
  ]);
  const s = load();

  run('ticking the top row sinks it on the keystroke', () => {
    referral.grid[1][12] = true;
    s.onEdit({ source: ss, range: referral.getRange(2, 13, 1, 1) });
    assert.deepStrictEqual(companies(referral.grid.slice(1, 4)),
      ['Notion', 'Ramp', 'Stripe']);
  });
  run('and running the sweep afterwards changes nothing', () => {
    s.sortReferralCancelledToBottom();
    assert.deepStrictEqual(companies(referral.grid.slice(1, 4)),
      ['Notion', 'Ramp', 'Stripe']);
  });
  run('and the cancelled row still holds no booked hours after the move', () => {
    assert.deepStrictEqual(stateOf('Stripe'),
      { drafted: '', scheduled: '', status: 'Cancelled', cancel: true });
  });
}


// referralRow fixes the role at 'SWE Intern', which cannot express two different
// asks at one employer — the case the whole grouping rests on. This spells the ask
// out and names the person, so an assertion can read as a list of who went.
const askRow = (company, role, person, status, cancel, priority) => {
  const row = referralRow(company, status, cancel, priority);
  row[1] = role;
  row[2] = person;
  row[3] = person.toLowerCase() + '@'
           + company.toLowerCase().replace(/\W/g, '') + '.example';
  return row;
};
// The row somebody is in the middle of typing: an employer and a job on it, nobody
// named yet, and no Status at all. It is not a queue row, and it is the sharp case
// for the blank-Status guard because it DOES carry a group key's worth of text.
const halfTypedRow = (company, role) => {
  const row = blankReferralRow();
  row[0] = company;
  row[1] = role;
  return row;
};
// Person is index 2 now, not 3: the Job Link move pulled every column between
// Role and Cancel one to the left, and Priority put only Status, Mode and Cancel
// back. An accessor left on the old index would read the email address as the
// person's name and every assertion below would still pass on the wrong column.
const people = (rows) => Array.from(rows, (r) => r[2]);
const statuses = (rows) => Array.from(rows, (r) => r[10]);
const ticks = (rows) => Array.from(rows, (r) => r[12]);
const stars = (rows) => Array.from(rows, (r) => r[9]);

console.log('referralGroupKey_ — which rows are one ask');
{
  const s = load();
  const key = (company, role) => s.referralGroupKey_(company, role);

  run('a trailing space and a doubled space do not make one ask into two', () => {
    assert.strictEqual(key('Stripe ', 'SWE Intern'), key('stripe', 'swe  intern'));
  });
  run('case alone never splits an ask', () => {
    assert.strictEqual(key('STRIPE', 'SWE INTERN'), key('Stripe', 'SWE Intern'));
  });
  run('punctuation collapses, the way the rest of the tool compares employers', () => {
    // Two trackers write one job as "SWE - Intern" and "SWE Intern", and a person
    // types the employer with and without its comma. All four are one ask.
    assert.strictEqual(key('Meta, Inc.', 'SWE - Intern'), key('meta inc', 'swe intern'));
  });
  run('two jobs at one employer are two asks', () => {
    assert.notStrictEqual(key('Stripe', 'SWE Intern'), key('Stripe', 'Data Intern'));
  });
  run('two employers hiring for one job are two asks', () => {
    assert.notStrictEqual(key('Stripe', 'SWE Intern'), key('Notion', 'SWE Intern'));
  });
  run('a row with no Role is in no group at all', () => {
    // An empty Role is not evidence that this row belongs with anything — it is
    // evidence nobody has said yet what it belongs with.
    assert.strictEqual(key('Stripe', ''), '');
  });
  run('a row with no Company is in no group at all', () => {
    assert.strictEqual(key('', 'SWE Intern'), '');
  });
  run('a field holding nothing but spaces or punctuation counts as missing', () => {
    assert.strictEqual(key('Stripe', '   '), '');
    assert.strictEqual(key('Stripe', '--'), '');
  });
  run('the two blank-keyed rows do not match each other', () => {
    // They both come back '', and every caller has to read that as "no group"
    // rather than as a group of blanks — grouping them would put one key over
    // every unfinished row on the tab.
    assert.strictEqual(key('Stripe', ''), key('Notion', ''));
    assert.strictEqual(key('Stripe', ''), '');
  });
  run('the two fields cannot run together into one key', () => {
    assert.notStrictEqual(key('IBM A', 'B'), key('IBM', 'A B'));
  });
  run('it is the same comparison the Jobs → App sync already makes', () => {
    // Not a second spelling of the rule: a Referral tab that held "Meta, Inc." and
    // "Meta" apart while App counted them as one would drift with nothing to catch it.
    assert.strictEqual(s.referralGroupKey_('Meta, Inc.', 'SWE Intern'),
                       s.identity('Meta, Inc.', 'SWE Intern'));
  });
}

console.log('onEdit on Referral — one tick cancels the whole ask');
{
  jobs = freshJobs();
  app = freshApp();
  referral = freshReferral([
    askRow('Stripe', 'SWE Intern', 'Ana', 'Queued'),
    askRow('Stripe', 'SWE Intern', 'Bo', 'Queued'),
    askRow('Stripe', 'SWE Intern', 'Cy', 'Drafted'),
    askRow('Stripe', 'SWE Intern', 'Di', 'Queued'),
    askRow('Stripe', 'SWE Intern', 'Ed', 'Queued'),
    askRow('Stripe', 'SWE Intern', 'Fi', 'Queued'),
    askRow('Stripe', 'Data Intern', 'Gus', 'Queued'),
    askRow('Notion', 'SWE Intern', 'Hal', 'Queued'),
  ]);
  const s = load();
  const wroteBefore = wrote.length;
  // The third of the six, not the first: the tick acts on the ask, not on the rows
  // under the one clicked.
  referral.grid[3][12] = true;
  s.onEdit({ source: ss, range: referral.getRange(4, 13, 1, 1) });

  // The ask sinks on the keystroke, so it is no longer the first six rows. Read it
  // by the people in it rather than by where they used to sit.
  const askRows = () => referral.grid.slice(1).filter(
    (r) => ['Ana', 'Bo', 'Cy', 'Di', 'Ed', 'Fi'].indexOf(String(r[2])) !== -1);
  const personRow = (name) =>
    referral.grid.slice(1).filter((r) => String(r[2]) === name)[0];

  run('all six people of the ask are cancelled from the one tick', () => {
    assert.strictEqual(askRows().length, 6);
    assert.deepStrictEqual(statuses(askRows()),
      ['Cancelled', 'Cancelled', 'Cancelled', 'Cancelled', 'Cancelled', 'Cancelled']);
  });
  run('every one of the six shows its own tick, not just the row clicked', () => {
    // An ask with one tick and five bare Cancelled cells reads as five rows that
    // lost their draft for five separate reasons nobody wrote down.
    assert.deepStrictEqual(ticks(askRows()), [true, true, true, true, true, true]);
  });
  run('and every one of them loses both booked hours', () => {
    askRows().forEach((r) => {
      assert.strictEqual(r[7], '', String(r[2]) + ' kept a Drafted At');
      assert.strictEqual(r[8], '', String(r[2]) + ' kept a Scheduled At');
    });
  });
  run('the six sink below the rows still going', () => {
    assert.deepStrictEqual(people(referral.grid.slice(1, 3)), ['Gus', 'Hal']);
  });
  run('the same employer on a different job is a different ask and is untouched', () => {
    const gus = personRow('Gus');
    assert.strictEqual(gus[10], 'Queued');
    assert.strictEqual(gus[12], false);
    // Its hour is one of the two the tab still had, redealt to the rows still going.
    assert.ok(String(gus[8]).length > 0);
  });
  run('and so is the same job at a different employer', () => {
    const hal = personRow('Hal');
    assert.strictEqual(hal[10], 'Queued');
    assert.strictEqual(hal[12], false);
    assert.ok(String(hal[8]).length > 0);
  });
  run('six rows go in one write, and the reorder is the second', () => {
    // A simple trigger has thirty seconds. A group cancel that dies partway leaves
    // half the ask called off and half of it still sending, on a tab that looks tidy.
    assert.strictEqual(wrote.length, wroteBefore + 2);
  });
  run('the cancel write covers the ask and stops there', () => {
    const cancelWrite = wrote[wrote.length - 2];
    assert.strictEqual(cancelWrite[0], 2);   // the first row of the ask
    assert.strictEqual(cancelWrite[1], 8);   // Drafted At
    assert.strictEqual(cancelWrite[2], 6);   // the six, not the eight rows on the tab
    assert.strictEqual(cancelWrite[3], 6);   // Drafted At..Cancel, Priority inside it
  });
  run('nothing outside Drafted At..Cancel moved on any of the six', () => {
    assert.deepStrictEqual(people(askRows()), ['Ana', 'Bo', 'Cy', 'Di', 'Ed', 'Fi']);
    assert.strictEqual(personRow('Di')[13], 'https://boards.example/Stripe');
    assert.strictEqual(referral.grid[3][14], 'draft-Stripe');
    assert.strictEqual(referral.grid[3][18], 'q-Stripe');
  });
  run('the toast counts the ask rather than the click', () => {
    assert.match(toasts[toasts.length - 1], /Cancelled 6 rows/);
  });
}

console.log('onEdit on Referral — one ask spelled six different ways');
{
  jobs = freshJobs();
  app = freshApp();
  referral = freshReferral([
    askRow('Stripe ', 'SWE Intern', 'Ana', 'Queued'),
    askRow('stripe', 'swe  intern', 'Bo', 'Queued'),
    askRow('STRIPE', 'SWE-Intern', 'Cy', 'Queued'),
    askRow('Stripe', 'Data Intern', 'Di', 'Queued'),
  ]);
  const s = load();
  referral.grid[1][12] = true;
  s.onEdit({ source: ss, range: referral.getRange(2, 13, 1, 1) });

  const byPerson = (name) =>
    referral.grid.slice(1).filter((r) => String(r[2]) === name)[0];

  run('case, doubled spaces and a hyphen do not hide a member of the ask', () => {
    // A row that fell out of the group because somebody typed the role in lower
    // case is a message that still goes out, and nothing on the tab looks wrong.
    ['Ana', 'Bo', 'Cy'].forEach((who) => {
      assert.strictEqual(byPerson(who)[10], 'Cancelled', who);
    });
  });
  run('the other job at that employer still is not part of it', () => {
    assert.strictEqual(byPerson('Di')[10], 'Queued');
    assert.strictEqual(byPerson('Di')[12], false);
  });
  run('and the three called off are now below the one still going', () => {
    assert.deepStrictEqual(people(referral.grid.slice(1, 5)),
      ['Di', 'Ana', 'Bo', 'Cy']);
  });
}

console.log('onEdit on Referral — a Sent row inside the ask');
{
  jobs = freshJobs();
  app = freshApp();
  referral = freshReferral([
    askRow('Stripe', 'SWE Intern', 'Ana', 'Queued'),
    askRow('Stripe', 'SWE Intern', 'Bo', 'Sent'),
    askRow('Stripe', 'SWE Intern', 'Cy', 'Queued'),
  ]);
  const s = load();
  const wroteBefore = wrote.length;
  referral.grid[1][12] = true;
  s.onEdit({ source: ss, range: referral.getRange(2, 13, 1, 1) });

  const who = (name) => referral.grid.slice(1).filter((r) => String(r[2]) === name)[0];

  run('the colleague already written to keeps her Status', () => {
    // The message has gone. "Cancelled" would be the tab telling you a thing that
    // is not true, and the reply, when it comes, lands on a row claiming you never
    // wrote.
    assert.strictEqual(who('Bo')[10], 'Sent');
  });
  run('she keeps both timestamps, which are the record of when it went', () => {
    assert.strictEqual(who('Bo')[7], 'Aug 20, 2026 9:00 AM');
    assert.strictEqual(who('Bo')[8], 'Aug 20, 2026 10:00 AM');
  });
  run('and her box is left unticked rather than claiming she was called off', () => {
    assert.strictEqual(who('Bo')[12], false);
  });
  run('the guard is per row, so the rest of the ask still goes', () => {
    // One colleague having already been written to is no reason to leave the other
    // two queued — which is what a group-wide Sent guard would do.
    assert.strictEqual(who('Ana')[10], 'Cancelled');
    assert.strictEqual(who('Cy')[10], 'Cancelled');
    assert.strictEqual(who('Ana')[12], true);
    assert.strictEqual(who('Cy')[12], true);
  });
  run('the cancel write spans the ask, and the reorder follows it', () => {
    assert.strictEqual(wrote.length, wroteBefore + 2);
    assert.deepStrictEqual(wrote[wrote.length - 2], [2, 8, 3, 6]);
  });
  run('and the one still standing leads the tab', () => {
    assert.deepStrictEqual(people(referral.grid.slice(1, 4)), ['Bo', 'Ana', 'Cy']);
  });
  run('the toast reports both halves rather than only the rows it changed', () => {
    assert.match(toasts[toasts.length - 1], /Cancelled 2 rows/);
    assert.match(toasts[toasts.length - 1], /1 row left alone as already sent/);
  });
}

console.log('onEdit on Referral — the tick lands on the Sent row itself');
{
  jobs = freshJobs();
  app = freshApp();
  referral = freshReferral([
    askRow('Stripe', 'SWE Intern', 'Ana', 'Sent'),
    askRow('Stripe', 'SWE Intern', 'Bo', 'Queued'),
  ]);
  const s = load();
  referral.grid[1][12] = true;
  s.onEdit({ source: ss, range: referral.getRange(2, 13, 1, 1) });

  const at = (name) => referral.grid.slice(1).filter((r) => String(r[2]) === name)[0];
  run('the sent row is put back exactly as it stood', () => {
    const row = at('Ana');
    assert.deepStrictEqual(
      { drafted: row[7], scheduled: row[8], status: row[10], cancel: row[12] },
      { drafted: 'Aug 20, 2026 9:00 AM', scheduled: 'Aug 20, 2026 10:00 AM',
        status: 'Sent', cancel: false });
  });
  run('but the ask is still called off — the click meant the ask, not the row', () => {
    // Ticking the box on the one row that has gone is the likeliest way to say
    // "stop this"; refusing the whole ask because of it would leave the other five
    // sending.
    const row = at('Bo');
    assert.deepStrictEqual(
      { drafted: row[7], scheduled: row[8], status: row[10], cancel: row[12] },
      { drafted: '', scheduled: '', status: 'Cancelled', cancel: true });
  });
}

console.log('onEdit on Referral — an ask scattered down the tab');
{
  jobs = freshJobs();
  app = freshApp();
  // The rows of one ask are usually consecutive and must not be assumed to be: a
  // sort, a row inserted by hand or the sixth name added a fortnight late all leave
  // somebody else's row in the middle of a group.
  referral = freshReferral([
    askRow('Stripe', 'SWE Intern', 'Ana', 'Queued'),
    askRow('Notion', 'SWE Intern', 'Bo', 'Queued'),
    askRow('Stripe', 'SWE Intern', 'Cy', 'Queued'),
    askRow('Ramp', 'SWE Intern', 'Di', 'Drafted'),
    askRow('Stripe', 'SWE Intern', 'Ed', 'Queued'),
    halfTypedRow('Stripe', 'SWE Intern'),
  ]);
  const s = load();
  const wroteBefore = wrote.length;
  referral.grid[3][12] = true;
  s.onEdit({ source: ss, range: referral.getRange(4, 13, 1, 1) });

  const who = (name) => referral.grid.slice(1).filter((r) => String(r[2]) === name)[0];

  run('every member is caught, above and below the rows between them', () => {
    assert.strictEqual(who('Ana')[10], 'Cancelled');
    assert.strictEqual(who('Cy')[10], 'Cancelled');
    assert.strictEqual(who('Ed')[10], 'Cancelled');
  });
  run('the strangers sitting inside the ask are not cancelled', () => {
    assert.strictEqual(who('Bo')[10], 'Queued');
    assert.strictEqual(who('Bo')[12], false);
    assert.strictEqual(who('Di')[10], 'Drafted');
    assert.strictEqual(who('Di')[12], false);
  });
  run('and the drafted stranger keeps the hour its message was written against', () => {
    // The reflow re-deals hours among Queued rows only. A Drafted row has a message
    // in Gmail against a particular hour, and handing it an earlier one would send
    // it before the hour it was meant to be readable in.
    assert.strictEqual(who('Di')[7], 'Aug 20, 2026 9:00 AM');
    assert.strictEqual(who('Di')[8], 'Aug 20, 2026 10:00 AM');
  });
  run('the queued stranger still holds an hour, drawn from the tab own supply', () => {
    // Its hour may not be the one it had — the cancelled rows gave theirs back and
    // the survivors were dealt the earliest ones — but it must still have one.
    assert.ok(String(who('Bo')[8]).length > 0);
  });
  run('the half-typed row is skipped: no Status means it is not a queue row', () => {
    // Writing Cancelled there would conjure an ask that never existed, and the tick
    // would claim somebody called off a row nobody had finished writing.
    const blank = referral.grid.slice(1).filter((r) => String(r[2]) === '')[0];
    assert.strictEqual(blank[10], '');
    assert.strictEqual(blank[12], false);
  });
  run('and skipping it does not stop the three real rows going', () => {
    assert.match(toasts[toasts.length - 1], /Cancelled 3 rows/);
  });
  run('the scattered ask is one write, and the reorder is the second', () => {
    assert.strictEqual(wrote.length, wroteBefore + 2);
    assert.deepStrictEqual(wrote[wrote.length - 2], [2, 8, 5, 6]);
  });
  run('the three called off end up below everything still standing', () => {
    // The half-typed row keeps its place among the live ones rather than being
    // herded to either end: somebody is in the middle of writing it.
    assert.deepStrictEqual(people(referral.grid.slice(1, 7)),
      ['Bo', 'Di', '', 'Ana', 'Cy', 'Ed']);
  });
}

console.log('onEdit on Referral — an untick still does nothing to the ask');
{
  jobs = freshJobs();
  app = freshApp();
  referral = freshReferral([
    askRow('Stripe', 'SWE Intern', 'Ana', 'Cancelled', true),
    askRow('Stripe', 'SWE Intern', 'Bo', 'Cancelled', true),
  ]);
  const s = load();

  run('unticking one row does not resurrect the ask', () => {
    // The box has no off position. What would put these rows back in the queue is a
    // Scheduled At, and the sender is the only thing that picks one.
    referral.grid[1][7] = '';
    referral.grid[1][8] = '';
    referral.grid[1][12] = false;
    const wroteBefore = wrote.length;
    s.onEdit({ source: ss, range: referral.getRange(2, 13, 1, 1) });
    assert.strictEqual(wrote.length, wroteBefore, 'an untick wrote to the sheet');
    assert.strictEqual(referral.grid[1][12], false);
    assert.strictEqual(referral.grid[2][12], true, 'an untick reached across the ask');
  });
}

console.log('onEdit on Referral — dropping exactly one person by hand');
{
  jobs = freshJobs();
  app = freshApp();
  referral = freshReferral([
    askRow('Stripe', 'SWE Intern', 'Ana', 'Queued'),
    askRow('Stripe', 'SWE Intern', 'Bo', 'Queued'),
    askRow('Stripe', 'SWE Intern', 'Cy', 'Queued'),
    askRow('Stripe', 'SWE Intern', 'Di', 'Queued'),
    askRow('Stripe', 'SWE Intern', 'Ed', 'Queued'),
    askRow('Stripe', 'SWE Intern', 'Fi', 'Queued'),
  ]);
  const s = load();
  const wroteBefore = wrote.length;
  // The documented escape hatch: the Status dropdown, set by hand on the one row.
  referral.grid[3][10] = 'Cancelled';
  s.onEdit({ source: ss, range: referral.getRange(4, 11, 1, 1) });

  run('a hand-set Cancelled Status writes nothing at all', () => {
    // Nothing here listens to a Status edit — the column guard returns on every
    // column that is not Cancel. If it ever did, the hatch would close and there
    // would be no way left to drop one of six.
    assert.strictEqual(wrote.length, wroteBefore);
  });
  run('and it does not drag the other five down with it', () => {
    assert.deepStrictEqual(statuses(referral.grid.slice(1, 7)),
      ['Queued', 'Queued', 'Cancelled', 'Queued', 'Queued', 'Queued']);
  });
  run('the hand-cancelled row keeps its box unticked', () => {
    // The tick means "a person called this ask off". This row was dropped on its
    // own, which is a different decision and reads as one.
    assert.strictEqual(referral.grid[3][12], false);
  });
  run('the sort sinks it on Status alone, which is what makes the hatch work', () => {
    s.sortReferralCancelledToBottom();
    assert.deepStrictEqual(people(referral.grid.slice(1, 7)),
      ['Ana', 'Bo', 'Di', 'Ed', 'Fi', 'Cy']);
  });
  run('and the five that are left are still one ask, cancelled by one tick', () => {
    referral.grid[1][12] = true;
    s.onEdit({ source: ss, range: referral.getRange(2, 13, 1, 1) });
    assert.deepStrictEqual(statuses(referral.grid.slice(1, 6)),
      ['Cancelled', 'Cancelled', 'Cancelled', 'Cancelled', 'Cancelled']);
  });
}

console.log('orderReferralCancelledRows_ — the rows of one ask');
{
  const s = load();
  const rows = [
    askRow('Stripe', 'SWE Intern', 'Ana', 'Queued'),
    askRow('Notion', 'SWE Intern', 'Bo', 'Queued'),
    askRow('Stripe', 'SWE Intern', 'Cy', 'Queued'),
    askRow('Ramp', 'SWE Intern', 'Di', 'Cancelled', true),
    askRow('Notion', 'SWE Intern', 'Ed', 'Queued'),
    askRow('Stripe', 'SWE Intern', 'Fi', 'Queued'),
  ];
  const out = s.orderReferralCancelledRows_(rows);

  run('the live rows come out grouped, each ask where its first row was', () => {
    assert.deepStrictEqual(people(out), ['Ana', 'Cy', 'Fi', 'Bo', 'Ed', 'Di']);
  });
  run('the members are the same row objects, not rebuilt copies', () => {
    // Identity, so a sort that rebuilt the group from a comparator fails here even
    // if it happened to produce equal-looking rows.
    assert.strictEqual(out[0], rows[0]);
    assert.strictEqual(out[1], rows[2]);
    assert.strictEqual(out[2], rows[5]);
  });
  run('an ask never moves above an ask that was already above it', () => {
    // Anchoring each ask at its first row is the whole of the stability rule: the
    // queue you were working down is the queue you come back to.
    assert.ok(people(out).indexOf('Ana') < people(out).indexOf('Bo'));
  });
  run('within an ask the rows keep the order they arrived in', () => {
    assert.deepStrictEqual(people(out).slice(0, 3), ['Ana', 'Cy', 'Fi']);
  });
  run('nothing is dropped and nothing is duplicated', () => {
    assert.strictEqual(out.length, rows.length);
    assert.deepStrictEqual(people(out).slice().sort(),
      ['Ana', 'Bo', 'Cy', 'Di', 'Ed', 'Fi']);
  });
  run('running it on its own output changes nothing', () => {
    assert.deepStrictEqual(rowsOf(s.orderReferralCancelledRows_(out)), rowsOf(out));
  });
  run('a row with no Role is an ask of one, never folded into the ask above it', () => {
    const gapped = [
      askRow('Stripe', 'SWE Intern', 'Ana', 'Queued'),
      askRow('Stripe', '', 'Nia', 'Queued'),
      askRow('Stripe', 'SWE Intern', 'Cy', 'Queued'),
    ];
    assert.deepStrictEqual(people(s.orderReferralCancelledRows_(gapped)),
                           ['Ana', 'Cy', 'Nia']);
  });
  run('and two rows with no Role are not herded together either', () => {
    // They share the empty key, and an implementation that bucketed on it would
    // pull every unfinished row on the tab into one block.
    const blanks = [
      askRow('Stripe', '', 'Ana', 'Queued'),
      askRow('Notion', '', 'Bo', 'Queued'),
      askRow('Stripe', '', 'Cy', 'Queued'),
    ];
    assert.deepStrictEqual(people(s.orderReferralCancelledRows_(blanks)),
                           ['Ana', 'Bo', 'Cy']);
  });
  run('the cancelled block is left in the order things were stopped', () => {
    // It is a history, read as "what did I stop doing last week", and that question
    // is answered in the order things were stopped rather than by employer.
    const history = [
      askRow('Stripe', 'SWE Intern', 'Ana', 'Cancelled', true),
      askRow('Notion', 'SWE Intern', 'Bo', 'Cancelled', true),
      askRow('Stripe', 'SWE Intern', 'Cy', 'Cancelled', true),
    ];
    assert.deepStrictEqual(people(s.orderReferralCancelledRows_(history)),
                           ['Ana', 'Bo', 'Cy']);
  });
  run('the blank tail is still pinned below a grouped live block', () => {
    const tailed = [
      askRow('Stripe', 'SWE Intern', 'Ana', 'Queued'),
      askRow('Notion', 'SWE Intern', 'Bo', 'Queued'),
      askRow('Stripe', 'SWE Intern', 'Cy', 'Queued'),
      blankReferralRow(),
    ];
    assert.deepStrictEqual(people(s.orderReferralCancelledRows_(tailed)),
                           ['Ana', 'Cy', 'Bo', '']);
  });
}

console.log('sortReferralCancelledToBottom — the rows of one ask stay together');
{
  jobs = freshJobs();
  app = freshApp();
  referral = freshReferral([
    askRow('Stripe', 'SWE Intern', 'Ana', 'Queued'),
    askRow('Notion', 'SWE Intern', 'Bo', 'Queued'),
    askRow('Stripe', 'SWE Intern', 'Cy', 'Queued'),
    askRow('Ramp', 'SWE Intern', 'Di', 'Cancelled', true),
    askRow('Notion', 'SWE Intern', 'Ed', 'Queued'),
    askRow('Stripe', 'SWE Intern', 'Fi', 'Queued'),
  ]);
  const s = load();
  const wroteBefore = wrote.length;
  s.sortReferralCancelledToBottom();

  run('the asks come out contiguous and the cancelled row still sinks', () => {
    assert.deepStrictEqual(people(referral.grid.slice(1, 7)),
      ['Ana', 'Cy', 'Fi', 'Bo', 'Ed', 'Di']);
  });
  run('the rows arrive whole — every cell travelled with its own person', () => {
    assert.strictEqual(referral.grid[2][2], 'Cy');
    assert.strictEqual(referral.grid[2][3], 'cy@stripe.example');
    assert.strictEqual(referral.grid[6][2], 'Di');
    assert.strictEqual(referral.grid[6][12], true);
  });
  run('the whole block moves in one write, not one call per row', () => {
    assert.strictEqual(wrote.length, wroteBefore + 1);
  });
  run('and it is still twenty wide from row 2', () => {
    assert.deepStrictEqual(wrote[wrote.length - 1], [2, 1, 6, 20]);
  });
  run('running it again writes nothing at all', () => {
    const before = wrote.length;
    s.sortReferralCancelledToBottom();
    assert.strictEqual(wrote.length, before);
    assert.deepStrictEqual(people(referral.grid.slice(1, 7)),
      ['Ana', 'Cy', 'Fi', 'Bo', 'Ed', 'Di']);
    assert.match(toasts[toasts.length - 1], /already in order/);
  });
  run('a tick and then a sort leaves the ask whole at the bottom', () => {
    // End to end: the six-row ask is what the tick cancels and what the sort keeps
    // together, so the tab reads as one decision rather than as scattered rows.
    referral.grid[1][12] = true;
    s.onEdit({ source: ss, range: referral.getRange(2, 13, 1, 1) });
    s.sortReferralCancelledToBottom();
    assert.deepStrictEqual(people(referral.grid.slice(1, 7)),
      ['Bo', 'Ed', 'Ana', 'Cy', 'Fi', 'Di']);
    assert.deepStrictEqual(statuses(referral.grid.slice(3, 6)),
      ['Cancelled', 'Cancelled', 'Cancelled']);
  });
}

console.log('runHourlyHousekeeping');
{
  jobs = freshJobs();
  app = freshApp();
  referral = freshReferral([askRow('Stripe', 'SWE Intern', 'Ana', 'Queued')]);
  const s = load();
  const order = [];
  // Reassigned on the sandbox itself, which is the script's own global object, so
  // the calls inside runHourlyHousekeeping resolve to these. Nothing else in this
  // block may use the real halves afterwards.
  s.paintAppOfficialRows = () => order.push('App');
  s.sortReferralCancelledToBottom = () => order.push('Referral');
  s.runHourlyHousekeeping();

  run('the App repaint runs first and the Referral sort second', () => {
    // The App half is the one whose output a person acts on next, so if the
    // execution budget is ever hit it should be the second job that is cut short.
    assert.deepStrictEqual(order, ['App', 'Referral']);
  });
}

console.log('runHourlyHousekeeping — both tabs really are tidied');
{
  jobs = freshJobs();
  app = freshApp();
  referral = freshReferral([
    askRow('Stripe', 'SWE Intern', 'Ana', 'Cancelled', true),
    askRow('Notion', 'SWE Intern', 'Bo', 'Queued'),
    askRow('Ramp', 'SWE Intern', 'Cy', 'Queued'),
  ]);
  const s = load();
  s.runHourlyHousekeeping();

  run('the cancelled Referral row is sunk by the hourly run, not left where it was', () => {
    // The gap this closes: ticking Cancel greys the ask out and deliberately does
    // not move it, and until this ran on the clock nothing ever did.
    assert.deepStrictEqual(people(referral.grid.slice(1, 4)), ['Bo', 'Cy', 'Ana']);
  });
  run('and the App rows needing an official link were painted and lifted', () => {
    assert.ok(painted.length > 0, 'the App half did not run');
  });
  run('each half is still callable on its own, for somebody debugging one of them', () => {
    // Somebody chasing a bug in the Referral sort should not have to repaint App to
    // reproduce it, and the other way round.
    referral.grid[1][10] = 'Cancelled';   // Bo, now at the top of the tab
    referral.grid[1][12] = true;
    assert.doesNotThrow(() => s.sortReferralCancelledToBottom());
    assert.deepStrictEqual(people(referral.grid.slice(1, 4)), ['Cy', 'Bo', 'Ana']);
    const before = painted.length;
    assert.doesNotThrow(() => s.paintAppOfficialRows());
    assert.ok(painted.length > before, 'the App repaint did nothing on its own');
  });
}

console.log('runHourlyHousekeeping — one half failing');
{
  jobs = freshJobs();
  app = freshApp();
  referral = freshReferral([
    askRow('Stripe', 'SWE Intern', 'Ana', 'Cancelled', true),
    askRow('Notion', 'SWE Intern', 'Bo', 'Queued'),
  ]);
  const s = load();
  s.paintAppOfficialRows = () => { throw new Error('No tab named "App".'); };

  run('a failing App repaint does not take the Referral sort down with it', () => {
    // Without the isolation this would fail silently once an hour, on a tab where
    // nothing looked wrong.
    assert.throws(() => s.runHourlyHousekeeping(), /the App repaint failed/);
    assert.deepStrictEqual(people(referral.grid.slice(1, 3)), ['Bo', 'Ana']);
  });
  run('and it says the other tab was tidied anyway', () => {
    assert.throws(() => s.runHourlyHousekeeping(), /The other tab was tidied normally/);
  });
  run('it reports by throwing, because nobody is watching a clock trigger', () => {
    // A toast is seen only by somebody with the spreadsheet open. A throw is what
    // makes Apps Script send its failure notification.
    assert.throws(() => s.runHourlyHousekeeping(), /No tab named "App"/);
  });
}

console.log('runHourlyHousekeeping — the other half failing');
{
  jobs = freshJobs();
  app = freshApp();
  referral = freshReferral([askRow('Stripe', 'SWE Intern', 'Ana', 'Queued')]);
  const s = load();
  s.sortReferralCancelledToBottom = () => { throw new Error('No tab named "Referral".'); };

  run('a failing Referral sort does not stop the App repaint', () => {
    const before = painted.length;
    assert.throws(() => s.runHourlyHousekeeping(), /the Referral sort failed/);
    assert.ok(painted.length > before, 'the App half was skipped');
  });
  run('and the message still names the tab that came through', () => {
    assert.throws(() => s.runHourlyHousekeeping(), /The other tab was tidied normally/);
  });
}

console.log('runHourlyHousekeeping — both halves failing');
{
  jobs = freshJobs();
  app = freshApp();
  referral = freshReferral([]);
  const s = load();
  s.paintAppOfficialRows = () => { throw new Error('App is gone.'); };
  s.sortReferralCancelledToBottom = () => { throw new Error('Referral is gone.'); };

  run('the error names both halves rather than only the first to fail', () => {
    assert.throws(() => s.runHourlyHousekeeping(), /App is gone/);
    assert.throws(() => s.runHourlyHousekeeping(), /Referral is gone/);
  });
  run('and says plainly that nothing was tidied', () => {
    assert.throws(() => s.runHourlyHousekeeping(), /Neither tab was tidied/);
  });
}

console.log('installAppOfficialTrigger / removeAppOfficialTrigger');
{
  jobs = freshJobs();
  app = freshApp();
  referral = freshReferral([]);
  const s = load();

  run('installing puts one hourly trigger on the joined entry point', () => {
    s.installAppOfficialTrigger();
    assert.strictEqual(triggers.length, 1);
    assert.strictEqual(triggers[0].getHandlerFunction(), 'runHourlyHousekeeping');
    assert.strictEqual(triggers[0].kind, 'timeBased');
    assert.strictEqual(triggers[0].hours, 1);
  });
  run('installing three times still leaves one, not three sweeps an hour', () => {
    s.installAppOfficialTrigger();
    s.installAppOfficialTrigger();
    assert.strictEqual(triggers.length, 1);
  });
  run('the remover takes it off', () => {
    s.removeAppOfficialTrigger();
    assert.deepStrictEqual(triggers, []);
  });
  run('a trigger installed under the old handler name is removed too', () => {
    // The shape a spreadsheet set up before the two sweeps were joined is in. A
    // remover that only knew the current name would leave this firing every hour
    // with nothing on the sheet to say where it came from.
    triggers = [{ getHandlerFunction: () => 'paintAppOfficialRows' }];
    s.removeAppOfficialTrigger();
    assert.deepStrictEqual(triggers, []);
  });
  run('installing over an old-name trigger replaces it rather than joining it', () => {
    triggers = [{ getHandlerFunction: () => 'paintAppOfficialRows' }];
    s.installAppOfficialTrigger();
    assert.strictEqual(triggers.length, 1);
    assert.strictEqual(triggers[0].getHandlerFunction(), 'runHourlyHousekeeping');
  });
  run('both old and new are cleared when a spreadsheet somehow carries both', () => {
    triggers = [
      { getHandlerFunction: () => 'paintAppOfficialRows' },
      { getHandlerFunction: () => 'runHourlyHousekeeping' },
      { getHandlerFunction: () => 'paintAppOfficialRows' },
    ];
    s.removeAppOfficialTrigger();
    assert.deepStrictEqual(triggers, []);
  });
  run("somebody else's trigger is left exactly where it is", () => {
    // The remover is a kill switch for this pair, not for the project.
    triggers = [{ getHandlerFunction: () => 'onOpen' }];
    s.removeAppOfficialTrigger();
    assert.strictEqual(triggers.length, 1);
    assert.strictEqual(triggers[0].getHandlerFunction(), 'onOpen');
  });
}

console.log('onEdit on the Referral Priority column');
{
  jobs = freshJobs();
  app = freshApp();
  referral = freshReferral([
    referralRow('Acme', 'Queued'),
    referralRow('Acme', 'Queued'),
    referralRow('Beta', 'Queued'),
    referralRow('Acme', 'Sent'),
    ['', '', '', '', '', '', '', '', '', false, '', '', false, '', '', '', '', '', '', '']
  ]);
  const s = load();
  const tick = (row, value) => {
    referral.grid[row - 1][s.REFERRAL_PRIORITY - 1] = value;
    s.onEdit({
      source: { toast() {} },
      range: {
        getSheet: () => referral, getRow: () => row, getLastRow: () => row,
        getColumn: () => s.REFERRAL_PRIORITY, getLastColumn: () => s.REFERRAL_PRIORITY
      }
    });
  };
  const priorityOf = (row) => referral.grid[row - 1][s.REFERRAL_PRIORITY - 1];

  // Ticking one box and seeing nothing happen is what made the column look broken:
  // the ordering it causes waits an hour, and an hour with no feedback is
  // indistinguishable from a dead control.
  run('a tick spreads across the ask straight away', () => {
    tick(2, true);
    assert.strictEqual(priorityOf(2), true);
    assert.strictEqual(priorityOf(3), true, 'the sibling should follow');
  });

  run('and a different ask is untouched', () => {
    assert.strictEqual(priorityOf(4), false);
  });

  // A sent message has gone; prioritising it means nothing and claiming otherwise
  // on the tab is worse than leaving it alone.
  run('a sent row in the ask is left alone', () => {
    assert.strictEqual(priorityOf(5), false);
  });

  // Column-wide validation gives every empty line a checkbox; ticking one would
  // invent a row and push getLastRow past the real bottom of the queue.
  run('a blank row below the data is never ticked', () => {
    assert.strictEqual(priorityOf(6), false);
  });

  // Somebody who changes their mind about one row means the ask, exactly as they
  // meant the tick.
  run('an untick clears the ask the same way', () => {
    tick(3, false);
    assert.strictEqual(priorityOf(2), false);
    assert.strictEqual(priorityOf(3), false);
  });

  // The whole ask goes to the top, the sent member included: splitting it so that
  // one row leads the tab and the rest sit in the middle is the mess the grouping
  // exists to prevent.
  run('the prioritised ask leads the tab straight away', () => {
    tick(2, true);
    const order = referral.grid.slice(1, 5).map((r) => String(r[s.REFERRAL_COMPANY - 1]));
    assert.strictEqual(order.join(','), 'Acme,Acme,Acme,Beta');
  });

  // Hours are redealt, never invented: choosing new ones here would be a second
  // thing picking sending slots with no idea what the sender's caps allow.
  run('and it holds an hour the tab already had, with its status untouched', () => {
    const first = referral.grid[1];
    assert.strictEqual(first[s.REFERRAL_STATUS - 1], 'Queued');
    assert.strictEqual(first[s.REFERRAL_SCHEDULED_AT - 1], 'Aug 20, 2026 10:00 AM');
  });
}


console.log('reflowReferralTimes_ — the two hours travel as a pair');
{
  const s = load();
  const row = (status, drafted, scheduled) => {
    const r = new Array(20).fill('');
    r[s.REFERRAL_COMPANY - 1] = 'Acme';
    r[s.REFERRAL_ROLE - 1] = 'SWE Intern';
    r[s.REFERRAL_DRAFTED_AT - 1] = drafted;
    r[s.REFERRAL_SCHEDULED_AT - 1] = scheduled;
    r[s.REFERRAL_STATUS - 1] = status;
    return r;
  };
  // Two queued rows out of order, a drafted one and a cancelled one.
  const rows = [
    row('Queued', 'Aug 31, 2026 1:00 PM', 'Aug 31, 2026 2:00 PM'),
    row('Queued', 'Aug 31, 2026 9:00 AM', 'Aug 31, 2026 10:00 AM'),
    row('Drafted', 'Aug 31, 2026 5:00 AM', 'Aug 31, 2026 6:00 AM'),
    row('Cancelled', 'Aug 31, 2026 7:00 AM', 'Aug 31, 2026 8:00 AM'),
  ];
  s.reflowReferralTimes_(rows);
  const D = s.REFERRAL_DRAFTED_AT - 1, S_ = s.REFERRAL_SCHEDULED_AT - 1;

  // Dealing the send times out while leaving the draft times where they were would
  // put every row's draft against somebody else's send.
  run('the first queued row takes the earliest pair, both halves of it', () => {
    assert.strictEqual(rows[0][S_], 'Aug 31, 2026 10:00 AM');
    assert.strictEqual(rows[0][D], 'Aug 31, 2026 9:00 AM');
  });
  run('and the second takes the later pair', () => {
    assert.strictEqual(rows[1][S_], 'Aug 31, 2026 2:00 PM');
    assert.strictEqual(rows[1][D], 'Aug 31, 2026 1:00 PM');
  });

  // A drafted row has a message in Gmail written against a particular hour.
  run('a drafted row is not in the deal and keeps both its hours', () => {
    assert.strictEqual(rows[2][S_], 'Aug 31, 2026 6:00 AM');
    assert.strictEqual(rows[2][D], 'Aug 31, 2026 5:00 AM');
  });

  run('a cancelled row keeps neither, because it is not going', () => {
    assert.strictEqual(rows[3][S_], '');
    assert.strictEqual(rows[3][D], '');
  });

  run('and no hour is invented: the same times come back, redealt', () => {
    const sent = [rows[0][S_], rows[1][S_]].sort();
    assert.deepStrictEqual(sent, ['Aug 31, 2026 10:00 AM', 'Aug 31, 2026 2:00 PM'].sort());
  });
}
