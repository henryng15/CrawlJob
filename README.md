# Internship Sheet Sync

Một tool nhỏ, chỉ làm một việc: đọc các public GitHub internship trackers, giữ các
role SWE liên quan, xoá duplicate theo `Link Apply`, và append job mới vào một Google
Sheet với đúng bốn cột:

`Company | Role | Link Apply | Date Posted`

Không có browser automation, database, AI, queue, email hay web dashboard.

## Role được lấy

Mỗi role phải có `intern`, `internship`, `co-op`, `placement` hoặc `student`, và khớp
một trong các nhóm sau: software engineering/engineer/developer/dev/SWE/SDE;
frontend, backend, full-stack, web, mobile, iOS, Android; platform, infrastructure,
production infrastructure, developer experience; cloud/cloud operations, DevOps, SRE,
build/release, MLOps; embedded, firmware, systems, application; FDE/forward deployed;
ML/data platform engineer; quantitative developer. Danh sách regex nằm tại
`job_sync/roles.py`, nên có thể thêm/bớt dễ dàng mà không đổi pipeline.

## Nguồn và ngày đăng

`sources.toml` chứa các tracker public được kiểm tra còn hoạt động: Simplify/Pitt CSC,
sndsh404, speedyapply và zshah101. Đây là danh sách baseline có thể cấu hình, không có
cách đáng tin cậy để khẳng định đã bao phủ “tất cả” repo trên GitHub. Parser dùng cột
`Added`/`Posted` của nguồn khi có; nếu nguồn chỉ có age thì quy đổi sang ngày; nếu không
có cả hai, `Date Posted` là ngày tool lần đầu quan sát job đó. Sheet được đọc trước mỗi
lần ghi nên chạy lại không tạo duplicate.

## Cột Applied (E)

Cột E của tab `Jobs` là checkbox. Tick vào đó thì `apps_script/sync_applied_to_app.gs`
(Apps Script, chạy phía Google) copy dòng sang tab `App` ngay lập tức. Xem header file
đó để biết cách cài. Tool chỉ ghi vào ô còn trống của cột này, xem mục bên dưới.

Hai chỗ trong `job_sync/sheet.py` phụ thuộc vào cột này. `_is_annotated` coi `FALSE` là
ô trống, vì checkbox chưa tick đọc ra `"FALSE"` chứ không phải rỗng, và nếu không thì
mọi dòng đều thành "đã annotate" và tầng ưu tiên đó mất tác dụng. `_write` ghi `A:D` bằng
`RAW` còn `E` trở đi bằng `USER_ENTERED`, vì `Date Posted` phải giữ nguyên chuỗi ISO cho
việc sort, còn `"TRUE"` thì phải được parse thành boolean mà checkbox đọc được.

Đừng xoá dòng khỏi `Jobs` sau khi đã apply: dòng đó chính là thứ giữ cho job không bị
append lại ở run kế tiếp. Muốn giấu thì dùng filter view ẩn `E = TRUE`.

## Tick tự động những job đã nộp

Mỗi lần sync, tool đọc tab `App` rồi tick sẵn cột Applied ở `Jobs` cho job đã nộp, để
những dòng còn trống đúng bằng danh sách còn phải nộp. Khớp hai lượt: theo link trước,
rồi theo `(company, role)`. Lượt thứ hai là bắt buộc chứ không phải cho chắc — đơn nộp
thường đi qua career site của chính công ty, trong khi dòng ở `Jobs` vẫn đang mang link
aggregator mà tracker công bố, nên khớp link không thôi thì trượt gần hết.

Ô chưa tick thì đều được tick, dù nó đọc ra `FALSE` hay rỗng — `requireCheckbox()` ghi
`FALSE` vào cả dải một lượt nên `FALSE` là trạng thái mặc định, không mang ý nghĩa gì.

Muốn giữ một dòng không bị tick, **ghi bất cứ ghi chú gì vào cột F**. Đó là cách duy
nhất để nói "match này sai", vì một ô checkbox tự nó không nói được — untick suông sẽ bị
tick lại ở lượt sau. Dòng nào được tick nhờ khớp tên đều in ra log của Actions để soát.

`GOOGLE_SHEET_APP_TAB` mặc định là `App`, chỉ cần đặt nếu bạn đổi tên tab.

Hàm `backfillTicksFromApp` trong `apps_script/sync_applied_to_app.gs` làm đúng việc này
nhưng chạy tay, dùng khi không muốn chờ lượt cron kế tiếp.

## Chạy local

```bash
uv venv && uv pip install -e .
set -a; source .env; set +a
internship-sync
```

Tạo Google service account, bật Google Sheets API, chia sẻ spreadsheet cho email của
service account, rồi đặt ba biến trong `.env` theo `.env.example`. Không commit JSON
credentials. `GOOGLE_SHEET_TAB` mặc định là `Jobs`.

## Tự chạy cloud

Workflow GitHub Actions tại `.github/workflows/sync.yml` chạy lúc 08:00, 10:00, 12:00,
14:00 và 16:00 `America/New_York`. GitHub cron dùng UTC, vì vậy workflow được đánh thức
mỗi giờ trong cửa sổ 12–21 UTC và command tự bỏ qua giờ không đúng, nên vẫn đúng qua
chuyển đổi EST/EDT.

Thêm GitHub Actions secrets: `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB`,
`GOOGLE_SERVICE_ACCOUNT_JSON`, sau đó bật Actions schedule hoặc chạy `workflow_dispatch`
lần đầu. Đây là giải pháp cloud gọn nhất: không cần VM, Terraform, database, hay cron
server.
