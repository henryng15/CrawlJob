# Job từ đâu ra, và khi nào một dòng biến mất

## Nguồn

[`sources.toml`](../sources.toml) liệt kê các public tracker, mỗi cái là một file Markdown
thô trên GitHub. Thêm một block `[[sources]]` là xong, không cần đổi code.

| Tracker | Ghi chú |
|---|---|
| Simplify / Pitt CSC — Summer 2027 | |
| sndsh404 — Summer 2027 | |
| speedyapply — 2027 SWE College Jobs | |
| zshah101 — 2027 / Fall 2026 Tech Internships | |
| Jobright — 2026 Software Engineer Internship | không có cột Apply riêng; link nằm trong ô Job Title và là redirect `jobright.ai`, không phải URL board của công ty |

Đây là danh sách baseline, không có cách đáng tin cậy nào để khẳng định đã bao phủ *tất
cả* repo tracker trên GitHub.

Một tracker hỏng không làm chết cả lượt sync: lỗi được bắt riêng cho từng nguồn, in ra
`WARNING` và các nguồn còn lại vẫn chạy. Chỉ khi **không nguồn nào** parse ra job thì lượt
đó mới fail.

## Role nào được giữ

[`roles.py`](../job_sync/roles.py) chứa toàn bộ regex. Một role phải thoả **cả hai**:

1. Có `intern`, `internship`, `co-op`, `placement` hoặc `student`.
2. Khớp một trong các nhóm: software engineering/engineer/developer/dev/SWE/SDE; frontend,
   backend, full-stack, web, mobile, iOS, Android; platform, infrastructure, production
   infrastructure, developer experience; cloud/cloud operations, DevOps, SRE,
   build/release, MLOps; embedded, firmware, systems, application; FDE/forward deployed;
   ML/data platform engineer; quantitative developer.

Muốn nới hay siết thì sửa ngay file đó, pipeline không cần biết.

## `Date Posted` lấy từ đâu

Theo thứ tự ưu tiên:

1. Cột `Added` / `Posted` của tracker, nếu có.
2. Nếu tracker chỉ ghi tuổi (`3d`, `2mo`) thì quy đổi ra ngày.
3. Nếu không có cả hai thì lấy **ngày tool nhìn thấy job đó lần đầu**.

Ngày luôn ở dạng ISO `YYYY-MM-DD` vì việc sort so sánh nó như chuỗi — cũng là lý do cột
A–D phải được ghi bằng `RAW`, xem [spreadsheet.md](spreadsheet.md).

Có một mốc chặn: job đăng trước **2026-07-01** bị bỏ qua. Các tracker mang theo cả một năm
lịch sử, không có mốc này thì lượt sync đầu tiên sẽ nhồi hết vào sheet. Đổi bằng `--since`.

## Khi nào một dòng bị xoá khỏi `Jobs`

Ba lý do, và chỉ ba:

1. **Board báo posting đã đóng** — xem phần dưới.
2. **Công ty nằm trong danh sách không theo dõi** — hiện là TikTok và ByteDance. Board của
   họ trả 200 cho cả requisition chưa từng tồn tại, nên dòng của họ sẽ không bao giờ tự
   được dọn. Đã chặn thì dòng cũ cũng bị gỡ, chứ không chỉ ngừng thêm mới.
3. **Trùng với một dòng khác** — xem [matching.md](matching.md).

Ô tick và ghi chú của bạn ở cột E–G **không** phải là lý do để giữ hay xoá một dòng, ngoại
trừ việc chúng thắng khi phải chọn giữ dòng nào trong hai dòng trùng nhau.

## Liveness: hỏi board xem posting còn mở không

Phần lớn job board trả HTTP 200 dù posting còn hay mất, vì trang chỉ là vỏ rỗng và nội
dung đến sau bằng JavaScript. Nên status code một mình gần như không quyết định được gì,
và [`liveness.py`](../job_sync/liveness.py) hỏi ba kiểu khác nhau:

- **Workday** — có một endpoint JSON nấp sau cùng đường dẫn. Nó trả 404 khi requisition
  đã gỡ.
- **Jobright** — render title phía server. Posting không còn thì title tụt về tên site.
- **Còn lại** (Greenhouse, Lever, Ashby, workatastartup) — 404 thật thà.

Ba lớp bảo vệ để không xoá nhầm:

- **Không đọc được thì không xoá.** Board trả 200 cho một id không tồn tại là board không
  phán được; kết quả là `UNKNOWN` và dòng được **giữ lại**.
- **Hỏi lại lần hai.** Khi bị bắn 16 request song song, Jobright từng trả vỏ generic cho
  41 trong 83 posting còn sống — tất cả đều sống lại khi hỏi riêng. Nên các host được quét
  song song với nhau nhưng trong một host thì tuần tự, và dòng nào vẫn có vẻ chết sẽ được
  hỏi thêm một lần nữa trước khi bị xoá.
- **Ô không phải link thì không bị hỏi.** Một ghi chú hay một dấu chấm lạc không phải
  posting nào cả.

### Đo thực tế

Quét 291 link của một lượt gần đây:

```
alive = 267      dead = 8      UNKNOWN (giữ lại) = 16
```

16 dòng không phán được chủ yếu là Workday tenant không trả lời. Ngoài ra đã tải nội dung
142 trang không phải Workday/Jobright để tìm chữ "no longer accepting", "position has been
filled"… và **không trang nào có** — nghĩa là các board này 404 thật khi hết hạn chứ không
trả 200 rồi giấu.

Phần còn lại là việc của con người: tick [cột `Expired`](spreadsheet.md#cột-f--expired)
cho posting đã đóng mà máy không đọc ra được.
