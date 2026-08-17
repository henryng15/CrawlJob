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

## Hai cột checkbox: Applied (E) và Expired (F)

Tick `Applied` thì `apps_script/sync_applied_to_app.gs` (Apps Script, chạy phía Google)
copy dòng sang tab `App` ngay lập tức. Xem header file đó để biết cách cài.

Tick `Expired` thì dòng đó **không sang `App`**, kể cả khi `Applied` cũng được tick trên
cùng dòng — dùng cho posting đã đóng mà board vẫn trả 200 nên liveness check không xoá
được. Nó chỉ chặn chiều đi: một dòng đã sang `App` rồi thì tick `Expired` sau đó không
gọi nó về, vì `App` là source of truth và không bao giờ bị script này sửa.

Dòng đã tick `Expired` vẫn ở lại `Jobs` làm tombstone, cùng lý do với dòng đã Applied:
xoá đi thì lượt sync sau append lại. Ẩn bằng filter view.

**Ghi chú tự do bắt đầu từ cột G, không phải F.** Một cột checkbox đọc ra `FALSE` ở mọi
dòng nó phủ, nên nếu `F` được coi là chỗ ghi chú thì `_noted` sẽ thấy cả sheet đã có ghi
chú và auto-tick ngừng hoạt động hoàn toàn.

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

Dòng đã tick `Expired` không được tick `Applied`: bạn đã nói posting đó không còn để mà
nộp, nên không còn gì để khẳng định về nó.

Muốn giữ một dòng không bị tick, **ghi bất cứ ghi chú gì vào cột G**. Đó là cách duy nhất
để nói "match này sai", vì một ô checkbox tự nó không nói được — untick suông sẽ bị tick
lại ở lượt sau. Dòng nào được tick nhờ khớp tên đều in ra log của Actions để soát.

`GOOGLE_SHEET_APP_TAB` mặc định là `App`, chỉ cần đặt nếu bạn đổi tên tab.

Hàm `backfillTicksFromApp` trong `apps_script/sync_applied_to_app.gs` làm đúng việc này
nhưng chạy tay, dùng khi không muốn chờ lượt cron kế tiếp.

## Chống trùng

Ba lớp, cố tình đặt chặt dần theo mức thiệt hại nếu sai. Gộp nhầm ở tab Jobs là **mất
một job thật**, nên hai lớp đầu chỉ gộp khi chắc chắn:

1. **Theo link** — `normalize_link` bỏ tham số tracking, bỏ tham số chỉ đổi cách render
   (`embed`), bỏ đoạn `/application` (Ashby) và `/apply` (Lever) vì đó là form nộp của
   chính posting nằm trên nó, và bỏ `gh_jid` khi nó lặp lại đúng id đã có trong path.
2. **Theo `(company, role)`** — `role_key` gộp `engineering`/`engineer`,
   `internship`/`intern`, `development`/`developer`. **Giữ nguyên thứ tự từ và đợt tuyển**:
   Notion có cả `Summer 2027` lẫn `Winter 2027`, gộp lại là xoá mất một cơ hội thật.
3. **Theo tập từ** — `role_tokens`, bỏ thứ tự và bỏ năm/mùa. **Chỉ dùng để đối chiếu với
   tab App**, không bao giờ dùng để xoá dòng. Đây là thứ khớp được
   `"2027 Internship - Software Engineer"` ở App với `"Software Engineer Intern"` ở Jobs.

## Soát tab App

```bash
internship-sync --audit-app
```

Không sync gì, chỉ đọc từng dòng của tab App và báo: thiếu field, hai dòng cùng một link,
hai dòng cùng một job, giá trị `Process` lạ, và link đã chết. Tách riêng khỏi lượt sync vì
hỏi từng board mất khoảng một phút. Trên GitHub Actions thì chạy bằng `workflow_dispatch`
với input `audit_app`.

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
