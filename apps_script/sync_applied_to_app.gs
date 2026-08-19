/**
 * Jobs → App: tick ô "Applied" ở tab Jobs, dòng đó tự sang tab App.
 *
 * Cách chạy:
 *   1. Mở Google Sheet, Extensions → Apps Script
 *   2. Thêm file mới, dán toàn bộ file này vào
 *   3. Chọn hàm setupJobsCheckboxes ở thanh trên, bấm Run
 *   4. Lần đầu Google sẽ hỏi quyền → Review permissions → chọn account
 *      → Advanced → Go to (project name) → Allow
 *
 * Không cần cài trigger: onEdit là simple trigger, Google tự gọi.
 *
 * Sync một chiều Jobs → App. App là source of truth — script này không bao giờ
 * sửa hay xoá một dòng đã sang App, kể cả khi bạn untick lại ở Jobs, và kể cả khi
 * sau đó bạn tick Expired. Expired chỉ chặn dòng đi sang, không gọi dòng nào về.
 */

var JOBS_TAB    = 'Jobs';
var APP_TAB     = 'App';
var APPLIED_COL = 5;    // Jobs cột E
var EXPIRED_COL = 6;    // Jobs cột F — tick vào đây thì dòng không sang App
var FIRST_ROW   = 2;    // dòng 1 là header
var LAST_ROW    = 500;  // chừa sẵn chỗ, khớp với setup_process_dropdown.gs

// Jobs: Company | Role | Link Apply | Date Posted
var JOB_COMPANY = 0, JOB_ROLE = 1, JOB_LINK = 2;

// App: Property | Company | Application Link | Date Applied | Location | Process | Role | Note
// Số cột 1-based cho getRange; trừ 1 khi tra vào mảng của getValues.
var APP_WIDTH = 8, APP_PROPERTY = 1, APP_COMPANY = 2, APP_LINK = 3, APP_DATE = 4, APP_ROLE = 7;
var PROCESS_COL = 6;   // App cột F — dropdown Process

// Cột J chứ không phải I. Cột I là ô bôi đỏ báo "công ty này có recruiter", do phía
// Python vẽ ở highlight.py — nó không mang chữ nào, nhưng đặt text lên nền đỏ thì
// vừa không đọc được vừa khiến hai thứ chẳng liên quan tranh nhau một cột.
var UPDATE_COL = 10;

// Đúng pipeline mà setup_process_dropdown.gs dựng, và cùng danh sách với
// PROCESS_STAGES trong job_sync/sheet.py. Phần tử đầu là chặng mọi dòng bắt đầu.
var STAGES = ['Applied', 'OA', 'Interview', 'Offer', 'Rejected'];

// Ngắn hơn DATE_FORMAT vì mấy dòng này xếp chồng trong một ô, nhưng vẫn đọc theo
// cùng một kiểu với phần còn lại của sheet.
var UPDATE_DATE_FORMAT = 'MMM d, yyyy';

// Chặng có thật nhưng ngày thì chưa từng được ghi lại ở đâu. Ghi dấu ra để còn tìm
// mà điền tay, thay vì bịa một ngày trông như thật.
var UNKNOWN_DATE = '?';

// Lượt khớp thứ hai của backfillTicksFromApp. Link của cùng một job có thể khác nhau
// giữa hai tab — Python thay link aggregator bằng link của chính employer khi tìm được
// — nên chỉ khớp link thì sót. Đổi thành false nếu thấy nó tick nhầm quá nhiều.
var MATCH_BY_NAME = true;

// Khớp cách các dòng đang có hiển thị ngày, thay vì để dòng mới rơi về format mặc định.
var DATE_FORMAT = 'mmmm d, yyyy';

// Cùng danh sách với TRACKING_PARAMS trong job_sync/sources.py: chỉ những param
// nói ai gửi cú click, không bao giờ là param định danh chính bài tuyển.
var TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
                       'utm_term', 'ref', 'gh_src', 'src'];


/**
 * "Cùng một bài tuyển" theo nghĩa của tool: Simplify gắn ?utm_source=Simplify&ref=Simplify
 * vào link mà speedyapply để trần, hai link đó là một.
 *
 * Không cần khớp từng byte với normalize_link() bên Python. Hàm này chỉ so link ở
 * Jobs với link đã nằm ở App, và cả hai vế đều đi qua đúng hàm này.
 */
function normalizeLink(value) {
  var url = String(value == null ? '' : value).trim();
  var parts = url.match(/^([A-Za-z][A-Za-z0-9+.\-]*):\/\/([^\/?#]*)([^?#]*)(?:\?([^#]*))?/);
  if (!parts) return url.toLowerCase();
  var host = parts[2].toLowerCase().replace(/^www\./, '');
  var path = parts[3].replace(/\/+$/, '').toLowerCase();
  var query = (parts[4] || '').split('&').filter(function (pair) {
    return pair && TRACKING_PARAMS.indexOf(pair.split('=')[0].toLowerCase()) === -1;
  }).join('&');
  return parts[1].toLowerCase() + '://' + host + path + (query ? '?' + query : '');
}


/**
 * Một job theo cách Python nhận diện nó: cặp (company, role) đã bỏ hoa thường và
 * dấu câu. Xem name_key() và _identity() trong job_sync/. Hai tracker viết cùng một
 * bài là "Intern - Summer 2027" và "Intern (Summer 2027)", vẫn phải ra một key.
 */
function nameKey(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function identity(company, role) {
  var left = nameKey(company), right = nameKey(role);
  // Ngăn cách bằng NUL chứ không phải dấu cách: nameKey trả về chuỗi có dấu cách,
  // nên ("ibm a", "b") và ("ibm", "a b") sẽ ra cùng một key nếu nối bằng dấu cách.
  return left && right ? left + '\u0000' + right : '';
}


/**
 * Chạy tay một lần: dựng header và checkbox cho cột E và F của tab Jobs.
 *
 * Ghi chú tự do bắt đầu từ cột G, không phải F. Một cột checkbox đọc ra FALSE ở
 * mọi dòng nó phủ, nên nếu F được coi là chỗ ghi chú thì phía Python sẽ thấy cả
 * sheet đã có ghi chú và ngừng tick tự động.
 */
function setupJobsCheckboxes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var jobs = ss.getSheetByName(JOBS_TAB);
  if (!jobs) throw new Error('Không tìm thấy tab "' + JOBS_TAB + '".');
  if (!ss.getSheetByName(APP_TAB)) throw new Error('Không tìm thấy tab "' + APP_TAB + '".');

  jobs.getRange(1, APPLIED_COL).setValue('Applied');
  jobs.getRange(1, EXPIRED_COL).setValue('Expired');
  jobs.getRange(FIRST_ROW, APPLIED_COL, LAST_ROW - FIRST_ROW + 1, 2)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());

  ss.toast('Cột E và F (dòng 2–' + LAST_ROW + ') đã thành checkbox.', 'Xong', 5);
}


/**
 * Chạy tay một lần: dựng header cột J của tab App và điền lịch sử cho các dòng đã có.
 *
 * Chỉ chặng Applied là suy ra được, từ ô Date Applied. Ngày chuyển sang OA hay
 * Interview thì chưa từng được ghi ở đâu cả — dòng nào đang ở chặng sau Applied
 * được ghi thêm một dòng mang dấu '?', để bạn tìm bằng Ctrl+F mà điền tay nếu còn
 * nhớ, thay vì bịa ra một ngày trông như thật.
 *
 * Ô đã có chữ thì không đụng vào, nên chạy lại nhiều lần cũng không hỏng gì.
 */
function setupUpdateColumn() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var app = ss.getSheetByName(APP_TAB);
  if (!app) throw new Error('Không tìm thấy tab "' + APP_TAB + '".');

  app.getRange(1, UPDATE_COL).setValue('Update');
  var bottom = app.getLastRow();
  if (bottom < FIRST_ROW) {
    ss.toast('Tab ' + APP_TAB + ' chưa có dòng nào.', 'Update', 5);
    return;
  }

  var count = bottom - FIRST_ROW + 1;
  var dates = app.getRange(FIRST_ROW, APP_DATE, count, 1).getValues();
  var stages = app.getRange(FIRST_ROW, PROCESS_COL, count, 1).getValues();
  var column = app.getRange(FIRST_ROW, UPDATE_COL, count, 1);
  var notes = column.getValues();
  var filled = 0;
  var unknown = 0;

  for (var i = 0; i < count; i++) {
    if (String(notes[i][0] == null ? '' : notes[i][0]).trim()) continue;
    // Không có Process thì không phải một entry — App có sẵn vài dòng chỉ có mỗi link.
    var stage = stageLabel(stages[i][0]);
    if (!stage) continue;
    var text = STAGES[0] + ': ' + stamp(dates[i][0]);
    if (stage !== STAGES[0]) {
      text += '\n' + stage + ': ' + UNKNOWN_DATE;
      unknown++;
    }
    notes[i][0] = text;
    filled++;
  }

  column.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  if (filled) column.setValues(notes);
  ss.toast(updateReport(filled, unknown), 'Update', 10);
}


function updateReport(filled, unknown) {
  if (!filled) return 'Không có dòng nào cần điền.';
  var text = 'Đã điền ' + filled + ' dòng ở cột Update';
  if (unknown) {
    text += '; ' + unknown + ' dòng đang ở chặng sau Applied nên ngày ghi "'
         + UNKNOWN_DATE + '", tìm dấu đó để điền tay';
  }
  return text + '.';
}


/**
 * Chạy tay: tick sẵn ở Jobs những job đã nằm ở App, để danh sách chưa tick đúng
 * bằng danh sách còn phải nộp.
 *
 * Chỉ ghi vào cột E của Jobs. Không dòng nào được thêm vào App: Apps Script không
 * kích hoạt onEdit cho thay đổi do chính script tạo ra, và mấy job này vốn đã ở App.
 *
 * Chỉ tick, không bao giờ untick — một ô bạn tự tick vì lý do riêng không bị xoá.
 */
function backfillTicksFromApp() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var jobs = ss.getSheetByName(JOBS_TAB);
  var app = ss.getSheetByName(APP_TAB);
  if (!jobs) throw new Error('Không tìm thấy tab "' + JOBS_TAB + '".');
  if (!app) throw new Error('Không tìm thấy tab "' + APP_TAB + '".');

  var bottom = jobs.getLastRow();
  if (bottom < FIRST_ROW) {
    ss.toast('Tab ' + JOBS_TAB + ' chưa có dòng nào.', 'App → Jobs', 5);
    return;
  }

  var links = existingLinks(app);
  var names = MATCH_BY_NAME ? existingNames(app) : Object.create(null);
  var count = bottom - FIRST_ROW + 1;
  var rows = jobs.getRange(FIRST_ROW, 1, count, 4).getValues();
  var ticks = jobs.getRange(FIRST_ROW, APPLIED_COL, count, 1).getValues();
  var byLink = 0;
  var byName = [];

  for (var i = 0; i < count; i++) {
    if (ticks[i][0] === true) continue;
    var key = normalizeLink(rows[i][JOB_LINK]);
    if (key && links[key]) {
      ticks[i][0] = true;
      byLink++;
      continue;
    }
    var name = identity(rows[i][JOB_COMPANY], rows[i][JOB_ROLE]);
    if (name && names[name]) {
      ticks[i][0] = true;
      // Khớp tên là lượt dễ sai hơn, nên ghi ra log để soát lại được.
      byName.push('Jobs!' + (FIRST_ROW + i) + ': ' + rows[i][JOB_COMPANY] + ' — ' + rows[i][JOB_ROLE]);
    }
  }

  if (byLink + byName.length) {
    jobs.getRange(FIRST_ROW, APPLIED_COL, count, 1).setValues(ticks);
    if (byName.length) console.log('Tick theo company + role:\n' + byName.join('\n'));
  }
  ss.toast(backfillReport(byLink, byName.length), 'App → Jobs', 10);
}


function backfillReport(byLink, byName) {
  if (!byLink && !byName) return 'Không có dòng nào cần tick thêm.';
  var text = 'Đã tick ' + (byLink + byName) + ' dòng: ' + byLink + ' khớp link';
  if (MATCH_BY_NAME) text += ', ' + byName + ' khớp company + role (xem Execution log)';
  return text + '.';
}


/**
 * Trigger này chạy mỗi lần bất cứ ô nào trong file bị sửa, nên việc đầu tiên là hỏi
 * ô đó thuộc tab nào rồi giao cho đúng nửa. Hai tab nghe hai cột khác nhau và làm
 * hai việc khác nhau: Jobs cột E tick Applied thì đẻ ra một dòng ở App; App cột F
 * đổi Process thì ghi thêm một dòng ngày vào cột Update.
 */
function onEdit(e) {
  var name = e.range.getSheet().getName();
  if (name === JOBS_TAB) return onJobsEdit(e);
  if (name === APP_TAB) return onAppEdit(e);
}


function onJobsEdit(e) {
  var range = e.range;
  if (range.getColumn() > APPLIED_COL || range.getLastColumn() < APPLIED_COL) return;
  var jobs = range.getSheet();

  var firstRow = Math.max(range.getRow(), FIRST_ROW);
  var lastRow = range.getLastRow();
  if (lastRow < firstRow) return;  // chỉ sửa header

  // Fill-down và paste sửa nhiều dòng một lúc, nên đọc cả khối chứ không chỉ ô đầu.
  var count = lastRow - firstRow + 1;
  var flags = jobs.getRange(firstRow, APPLIED_COL, count, 2).getValues();
  var picked = [];
  var expired = 0;
  for (var i = 0; i < count; i++) {
    if (flags[i][0] !== true) continue;  // untick không làm gì cả
    // Expired thắng Applied: bạn đã nói posting này không còn để mà nộp, nên dù
    // ô Applied có tick thì cũng không có gì đáng ghi sang App.
    if (flags[i][1] === true) { expired++; continue; }
    picked.push(i);
  }
  if (!picked.length) {
    if (expired) {
      var ss0 = e.source;
      ss0.toast('Bỏ qua ' + expired + ' dòng đã tick Expired.', 'Jobs → App', 6);
    }
    return;
  }

  var ss = e.source;
  var app = ss.getSheetByName(APP_TAB);
  if (!app) {
    ss.toast('Không tìm thấy tab "' + APP_TAB + '".', 'Jobs → App', 8);
    return;
  }

  var jobRows = jobs.getRange(firstRow, 1, count, 4).getValues();
  var seen = existingLinks(app);
  var last = lastEntry(app);
  var property = last.property + 1;
  var fresh = [];
  var skipped = 0;

  for (var j = 0; j < picked.length; j++) {
    var row = jobRows[picked[j]];
    var link = String(row[JOB_LINK] || '').trim();
    var key = link && normalizeLink(link);
    // Dòng thiếu link không có gì để chống trùng, nên để bạn tự điền hơn là đoán.
    if (!key || seen[key]) { skipped++; continue; }
    seen[key] = true;
    // Location để trống: Jobs không mang dữ liệu đó.
    fresh.push([property++, row[JOB_COMPANY], link, new Date(), '', 'Applied', row[JOB_ROLE], '']);
  }

  if (fresh.length) {
    var start = app.getLastRow() + 1;
    var written = app.getRange(start, 1, fresh.length, APP_WIDTH);
    written.setValues(fresh);
    app.getRange(start, APP_DATE, fresh.length, 1).setNumberFormat(DATE_FORMAT);
    // Dòng đầu tiên của lịch sử, gieo ngay tại đây. Script tự ghi 'Applied' vào cột
    // Process, mà Apps Script không gọi lại onEdit cho thay đổi do chính script tạo
    // ra — không gieo thì chặng đầu của mọi dòng mới biến mất không dấu vết.
    var today = stamp(new Date());
    var seeded = [];
    for (var k = 0; k < fresh.length; k++) seeded.push([STAGES[0] + ': ' + today]);
    app.getRange(start, UPDATE_COL, fresh.length, 1)
       .setValues(seeded)
       .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
    // Validation được copy chứ không dựng lại: dropdown Process ở các dòng trên là
    // chip màu tạo từ UI, mà Apps Script không có API đặt màu chip. Copy thì dòng
    // mới giống hệt dòng cũ dù dropdown từng được tạo bằng cách nào.
    if (last.row) {
      app.getRange(last.row, 1, 1, APP_WIDTH)
         .copyTo(written, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    }
  }
  ss.toast(report(fresh.length, skipped, expired), 'Jobs → App', 6);
}


/**
 * App: đổi Process ở cột F thì ghi thêm một dòng "<Chặng>: <ngày>" vào cột J.
 *
 * Ô đó là lịch sử, không phải log. Mỗi chặng ghi đúng một lần: quay lại một chặng
 * đã đi qua, hay paste đè đúng giá trị đang có, đều không sinh thêm dòng. Sửa nhầm
 * thì sửa thẳng trong ô — nó là text tự do, script chỉ nối thêm chứ không bao giờ
 * viết lại cái đã có.
 *
 * Giá trị ngoài pipeline bị bỏ qua: dropdown đã liệt kê hết các chặng có thật, nên
 * cái gì không khớp là gõ nhầm, và gõ nhầm thì không đáng được ghi ngày.
 */
function onAppEdit(e) {
  var range = e.range;
  if (range.getColumn() > PROCESS_COL || range.getLastColumn() < PROCESS_COL) return;
  var firstRow = Math.max(range.getRow(), FIRST_ROW);
  var lastRow = range.getLastRow();
  if (lastRow < firstRow) return;  // chỉ sửa header

  // Fill-down và paste sửa nhiều dòng một lúc, nên đọc cả khối chứ không chỉ ô đầu.
  var app = range.getSheet();
  var count = lastRow - firstRow + 1;
  var stages = app.getRange(firstRow, PROCESS_COL, count, 1).getValues();
  var notes = app.getRange(firstRow, UPDATE_COL, count, 1).getValues();
  var today = stamp(new Date());
  var written = 0;

  for (var i = 0; i < count; i++) {
    var stage = stageLabel(stages[i][0]);
    if (!stage) continue;
    var cell = String(notes[i][0] == null ? '' : notes[i][0]).replace(/\s+$/, '');
    if (hasStage(cell, stage)) continue;
    notes[i][0] = (cell ? cell + '\n' : '') + stage + ': ' + today;
    written++;
  }
  if (!written) return;

  // Không WRAP thì ô chỉ hiện đúng dòng đầu, và cả lịch sử trông như mất sạch.
  app.getRange(firstRow, UPDATE_COL, count, 1)
     .setValues(notes)
     .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  e.source.toast(stageReport(written, today), 'App', 5);
}


function stageReport(written, today) {
  return 'Ghi ' + today + ' vào cột Update của ' + written + ' dòng.';
}


/**
 * Tên chuẩn của một chặng, hoặc '' nếu giá trị không thuộc pipeline. Gõ tay "oa"
 * và chọn "OA" từ dropdown phải ra cùng một dòng, nếu không thì hasStage() đọc hai
 * lần viết khác nhau thành hai chặng khác nhau và ghi trùng.
 */
function stageLabel(value) {
  var text = String(value == null ? '' : value).trim().toLowerCase();
  for (var i = 0; i < STAGES.length; i++) {
    if (STAGES[i].toLowerCase() === text) return STAGES[i];
  }
  return '';
}


/** Chặng này đã có dòng của nó trong ô chưa. So phần đứng trước dấu ':'. */
function hasStage(cell, stage) {
  var lines = String(cell == null ? '' : cell).split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].split(':')[0].trim().toLowerCase() === stage.toLowerCase()) return true;
  }
  return false;
}


/**
 * Ngày để ghi vào ô. Ô Date Applied trả về Date, nhưng vài dòng cũ đang giữ text —
 * cái gì đọc được thì giữ nguyên, không đọc được thì '?' để còn tìm mà điền tay.
 *
 * Object.prototype.toString chứ không phải instanceof: Date do Apps Script trả về
 * và Date của script không phải lúc nào cũng cùng một realm.
 */
function stamp(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), UPDATE_DATE_FORMAT);
  }
  var text = String(value == null ? '' : value).trim();
  return text || UNKNOWN_DATE;
}


/**
 * Các link đã nằm ở App, đã normalize. Tick lại một dòng đã sync — hoặc tick một
 * job bạn từng apply qua link khác — không được đẻ ra dòng thứ hai.
 *
 * Object.create(null) chứ không phải {}: một key trùng tên thuộc tính kế thừa
 * ("constructor") sẽ đọc ra truthy trên object thường và báo trùng nhầm.
 */
function existingLinks(app) {
  var seen = Object.create(null);
  var last = app.getLastRow();
  if (last < FIRST_ROW) return seen;
  var links = app.getRange(FIRST_ROW, APP_LINK, last - FIRST_ROW + 1, 1).getValues();
  for (var i = 0; i < links.length; i++) {
    var key = normalizeLink(links[i][0]);
    if (key) seen[key] = true;
  }
  return seen;
}


/**
 * Các cặp (company, role) đã nằm ở App. Dùng cho backfill, không dùng cho onEdit:
 * lúc bạn vừa tick là bạn vừa nộp thật, nên một dòng bị bỏ qua vì "trùng tên" ở đó
 * là mất bản ghi, tệ hơn hẳn so với việc có thêm một dòng thừa.
 */
function existingNames(app) {
  var seen = Object.create(null);
  var bottom = app.getLastRow();
  if (bottom < FIRST_ROW) return seen;
  var rows = app.getRange(FIRST_ROW, 1, bottom - FIRST_ROW + 1, APP_WIDTH).getValues();
  for (var i = 0; i < rows.length; i++) {
    var key = identity(rows[i][APP_COMPANY - 1], rows[i][APP_ROLE - 1]);
    if (key) seen[key] = true;
  }
  return seen;
}


/**
 * Hai thứ đọc được trong cùng một lượt quét cột Property.
 *
 * `property` là số lớn nhất đang có, chứ không phải số dòng: App có thể đã bị xoá
 * dòng ở giữa, và hai dòng mang cùng một số thì tệ hơn là có lỗ hổng.
 *
 * `row` là dòng cuối cùng thực sự là một entry, dùng làm mẫu để copy dropdown.
 * App có sẵn vài dòng chỉ có mỗi link ở cột C — dòng như thế nằm dưới cùng nhưng
 * không mang validation nào để copy.
 */
function lastEntry(app) {
  var bottom = app.getLastRow();
  if (bottom < FIRST_ROW) return { property: 0, row: 0 };
  var values = app.getRange(FIRST_ROW, APP_PROPERTY, bottom - FIRST_ROW + 1, 1).getValues();
  var found = { property: 0, row: 0 };
  for (var i = 0; i < values.length; i++) {
    var n = Number(values[i][0]);
    if (values[i][0] === '' || !isFinite(n)) continue;
    if (n > found.property) found.property = n;
    found.row = FIRST_ROW + i;
  }
  return found;
}


function report(added, skipped, expired) {
  var tail = '';
  if (skipped) tail += ' Bỏ qua ' + skipped + ' dòng đã có ở App hoặc thiếu link.';
  if (expired) tail += ' Bỏ qua ' + expired + ' dòng đã tick Expired.';
  if (!added) return 'Không thêm dòng nào vào ' + APP_TAB + '.' + tail;
  return 'Đã thêm ' + added + ' dòng vào ' + APP_TAB + '.' + tail;
}
