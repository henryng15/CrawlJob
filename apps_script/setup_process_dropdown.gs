/**
 * Track App — thiết lập cột Process thành dropdown có màu.
 *
 * Cách chạy:
 *   1. Mở Google Sheet "Track App"
 *   2. Extensions → Apps Script
 *   3. Xoá code mẫu, dán toàn bộ file này vào
 *   4. Chọn hàm setupProcessDropdown ở thanh trên, bấm Run
 *   5. Lần đầu Google sẽ hỏi quyền → Review permissions → chọn account
 *      → Advanced → Go to (project name) → Allow
 */

function setupProcessDropdown() {
  var SHEET_GID     = 1712615786;  // tab lấy từ #gid= trong URL
  var PROCESS_COL   = 6;           // cột F
  var FIRST_ROW     = 2;           // dòng 1 là header
  var LAST_ROW      = 500;         // chừa sẵn chỗ cho entry mới

  // Thứ tự này = thứ tự hiện trong dropdown, đi theo pipeline tuyển dụng
  var STAGES = [
    { name: 'Applied',   bg: '#CFE2F3', fg: '#1155CC' },  // xanh dương — đã nộp
    { name: 'OA',        bg: '#FFF2CC', fg: '#BF9000' },  // vàng — cần làm bài
    { name: 'Interview', bg: '#D9D2E9', fg: '#674EA7' },  // tím — đã vào vòng phỏng vấn
    { name: 'Offer',     bg: '#D9EAD3', fg: '#38761D' },  // xanh lá — thành công
    { name: 'Rejected',  bg: '#F4CCCC', fg: '#CC0000' }   // đỏ — đã đóng
  ];

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets().filter(function (s) {
    return s.getSheetId() === SHEET_GID;
  })[0];
  if (!sheet) {
    throw new Error('Không tìm thấy tab có gid ' + SHEET_GID + '. Kiểm tra lại URL.');
  }

  var range = sheet.getRange(FIRST_ROW, PROCESS_COL, LAST_ROW - FIRST_ROW + 1, 1);
  var names = STAGES.map(function (s) { return s.name; });

  // 1) Dropdown — setAllowInvalid(false) chặn luôn việc gõ sai chính tả
  var validation = SpreadsheetApp.newDataValidation()
    .requireValueInList(names, true)
    .setAllowInvalid(false)
    .setHelpText('Chọn một trong: ' + names.join(', '))
    .build();
  range.setDataValidation(validation);

  // 2) Màu theo giá trị.
  //    Giữ lại các rule đang áp cho cột khác, chỉ thay rule của cột Process,
  //    để chạy lại script nhiều lần không bị nhân bản rule.
  var kept = sheet.getConditionalFormatRules().filter(function (rule) {
    return rule.getRanges().every(function (r) {
      return r.getColumn() !== PROCESS_COL;
    });
  });

  var colorRules = STAGES.map(function (s) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(s.name)
      .setBackground(s.bg)
      .setFontColor(s.fg)
      .setRanges([range])
      .build();
  });

  sheet.setConditionalFormatRules(kept.concat(colorRules));

  ss.toast('Cột Process (F2:F' + LAST_ROW + ') đã có dropdown + màu.', 'Xong', 5);
}
