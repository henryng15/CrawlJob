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

## Nguồn thứ hai: ATS của chính công ty

Tracker Markdown phủ tốt các chương trình đã nổi tiếng và phủ startup gần như bằng không —
một công ty phải nổi đủ để có người tình nguyện gõ tên nó vào. Chính startup đó thì vẫn
đăng bài, trên **applicant tracking system** họ dùng để nhận đơn, qua endpoint JSON công
khai không cần key.

| ATS | endpoint | ngày lấy từ |
|---|---|---|
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{slug}/jobs` | `first_published` |
| Lever | `api.lever.co/v0/postings/{slug}?mode=json` | `createdAt` (epoch ms) |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{slug}` | `publishedAt` |

Ba thứ khiến chúng **tốt hơn** tracker chứ không chỉ nhiều hơn:

- Link là board của chính employer, nên nó không mục đi như redirect aggregator.
- Ngày là `first_published` của board, chứ không phải ngày một người tình nguyện để ý thấy.
- Một startup bốn người đứng ngang hàng với một công ty bốn vạn người.

### Biết board nào tồn tại

Đó mới là phần khó, và nó nằm ở [`scripts/discover_boards.py`](../scripts/discover_boards.py).
Slug lấy từ hai danh sách **tên**, không phải từ việc scrape trang của ai:

- [`Feashliaa/job-board-aggregator`](https://github.com/Feashliaa/job-board-aggregator) —
  15.862 slug, harvest từ index Common Crawl của các URL ATS công khai.
  Data theo **CC BY-NC 4.0**; attribution được ghi thẳng vào file output, và tracker này là
  cá nhân, phi thương mại.
- [`yc-oss/api`](https://github.com/yc-oss/api) — công ty YC đang tuyển, dựng lại mỗi ngày
  từ chính Algolia index của YC. Chỉ những slug danh sách trên chưa có mới được thử.

### Vì sao chia hai tầng

Lượt sync không thể hỏi 19.899 board, 5 lần một ngày — đó là nửa tháng Actions minutes tiêu
vào những công ty chưa từng nhận intern. Nên:

| | tần suất | phạm vi | tiêu chí giữ lại |
|---|---|---|---|
| `discover_boards.py` | tuần, workflow riêng | tất cả 19.899 | board **đang đăng internship bất kỳ ngành nào** |
| `boards.py` | **2 lần/ngày**, lượt 08:00 và 14:00 ET | 902 board trong shortlist | role khớp `roles.py` |

Số đo lần đầu (19/08/2026): 9.062 board còn sống, **902** đang tuyển intern, trong đó
**312 role khớp** bộ lọc SWE. Lượt hàng ngày hỏi hết 902 board mất **36 giây**.

Tiêu chí của tầng một là "công ty này có nhận intern" chứ không phải "có SWE intern hôm
nay" — công ty đã chạy chương trình intern mới là công ty có thể đăng SWE intern tuần sau.

Đánh đổi: posting mới ở công ty **đã** nhận intern thì bắt được trong vòng một ngày; công
ty mở chương trình lần đầu thì trong vòng một tuần. Nói ra ở đây thay vì giấu trong một con
số.

Vì sao 2 lần chứ không phải cả 5 lượt: chi phí không nằm ở Actions minutes — 36 giây gần
như tan hết vào việc GitHub làm tròn lên từng phút của một run vốn đã 3,4 phút. Chi phí nằm
ở **902 request lên API của người khác**, mỗi lượt. Hai lần sáng–chiều đưa độ trễ tối đa
xuống ~6 tiếng; năm lần đưa xuống ~2 tiếng nhưng gấp 2,5 lần lưu lượng.

Sửa ở `BOARD_HOURS` trong [`main.py`](../job_sync/main.py), một dòng. Cần ngay thì bấm
**Run workflow**: lượt chạy tay luôn hỏi board, bất kể giờ nào.

Shortlist nằm ở `job_sync/data/ats_boards.json`, đi theo wheel qua `package-data`. Thiếu
file thì tính năng tắt, sync vẫn chạy trên tracker Markdown như cũ. Bỏ qua bằng
`--no-boards`.

## Lọc "trong nước Mỹ"

Tracker Markdown là danh sách US theo bản chất — người curate làm cho người đọc ở Mỹ. Board
ATS thì **không**: nó là mọi job công ty đang mở ở mọi nơi. Lượt crawl đầu tiên cho thấy
**137 trong 312 role (44%)** nằm ngoài US — Munich, Singapore, London, Auckland, Berlin,
Ho Chi Minh, Taipei, Colombia, Toronto.

[`places.py`](../job_sync/places.py) đọc dòng location. Nó là **văn xuôi, không phải field**:
`San Francisco`, `New York, NY`, `Austin, Texas, United States; South San Francisco,
California, U`, `Colombia, Remote` đều là giá trị thật trong một lượt crawl. Không có cách
nào chính xác tuyệt đối.

Nên luật cố tình **lệch một bên**, vì hai loại sai không tốn như nhau:

> Bỏ nhầm một intern US thì **vô hình** — dòng đó đơn giản không bao giờ xuất hiện, và
> không ai nhớ được thứ mình chưa từng thấy. Giữ nhầm một job ở Berlin thì tốn đúng một
> cái liếc mắt.

Nên: **giữ, trừ khi dòng chữ nói ngược lại.**

1. Có tên bang, mã bang, hoặc chữ `United States` / `USA` → **giữ**, chốt luôn. Chạy trước
   để `Vancouver, WA` không bị nhầm với Vancouver BC.
2. Không có thì mới xét quốc gia / thành phố / vùng chắc chắn không thuộc US → **bỏ**.
3. Còn lại → **giữ**. Một thành phố Mỹ trần trụi không có bang (`San Francisco`) là trường
   hợp phổ biến nhất, và nó rơi vào nhánh này.

Ô location trống cũng **giữ**: board không nói job ở đâu thì nó chưa nói job ở nước ngoài.

Mã bang chỉ khớp trên chuỗi **gốc**, không lowercase — `IN`, `OR`, `ME`, `OK`, `HI`, `DE`,
`LA`, `PA` đều là từ tiếng Anh thường, và fold case sẽ biến "Remote **in** Europe" thành
Indiana rồi giữ lại.

Riêng Lever có field `country` là **mã ISO-3166** (`US`, `GB`, `KR`, `JP`…) — field địa
điểm rõ ràng duy nhất trong cả ba API, nên nó được đọc trước khi phải đoán từ văn xuôi.

### Dòng ngoài US đã lỡ vào sheet

Sheet **không tự phán được**: tab Jobs không có cột location, và tới lúc một posting đã
thành một dòng thì thứ duy nhất còn lại là cái link. Board là thứ duy nhất biết, và chỉ
biết khi posting còn treo.

Nên mỗi lượt crawl trả về thêm **tập link của những role khớp nhưng ở nước ngoài**, và
`_drop_foreign_rows` gỡ chúng khỏi sheet theo đúng cái link đã normalize mà dedupe dùng. Đó
là cách một bộ lọc thêm hôm nay lấy lại được thứ lượt chạy hôm qua đã ghi vào.

Gỡ hẳn chứ không giữ làm tombstone như dòng Applied/Expired: tombstone tồn tại để chặn một
job bị append lần hai, mà một posting trượt bài kiểm tra địa điểm thì vốn không nằm trong
tập được append.

**Dòng bạn đã viết vào thì không bị đụng.** Tick Applied cho một job ở London là một quyết
định, và cái này không có quyền lật nó — cùng luật khiến ghi chú cột H chặn được auto-tick.

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

**Từ ATS board** — chính xác, luôn có:

| Greenhouse | `first_published`, fallback `updated_at` |
|---|---|
| Lever | `createdAt`, epoch ms đọc theo UTC |
| Ashby | `publishedAt` |

Greenhouse dùng `first_published` chứ không phải `updated_at`: cái sau nhảy mỗi lần có
người sửa lỗi chính tả trong mô tả, mà cột này là cột sort — một lỗi chính tả được sửa sẽ
đẩy bài đăng một tháng trước lên đầu danh sách việc còn phải làm.

Cả ba đều đọc theo UTC hoặc cắt thẳng phần ngày của chuỗi ISO, không parse rồi format lại:
runner chạy giờ UTC còn bạn ở ET, một bài đăng không được mang hai ngày khác nhau tuỳ ai
chạy sync.

**Từ tracker Markdown** — theo thứ tự ưu tiên:

1. Cột `Added` / `Posted` của tracker, nếu có.
2. Nếu tracker chỉ ghi tuổi (`3d`, `2mo`) thì quy đổi ra ngày.
3. Nếu không có cả hai thì lấy **ngày tool nhìn thấy job đó lần đầu**.

Ngày luôn ở dạng ISO `YYYY-MM-DD` vì việc sort so sánh nó như chuỗi — cũng là lý do cột
A–D phải được ghi bằng `RAW`, xem [spreadsheet.md](spreadsheet.md).

Có một mốc chặn: job đăng trước **2026-07-01** bị bỏ qua. Các tracker mang theo cả một năm
lịch sử, không có mốc này thì lượt sync đầu tiên sẽ nhồi hết vào sheet. Đổi bằng `--since`.

Mốc đó cũng lọc luôn phía ATS, và ở đó nó còn cần hơn: board giữ bài đăng cũ khá lâu — có
posting Ashby từ giữa 2025 vẫn đang nằm đó. Ngày thật từ board là thứ khiến lọc được.

## Khi nào một dòng bị xoá khỏi `Jobs`

Ba lý do, và chỉ ba:

1. **Board báo posting đã đóng** — xem phần dưới.
2. **Công ty nằm trong danh sách không theo dõi** — hiện là TikTok và ByteDance. Board của
   họ trả 200 cho cả requisition chưa từng tồn tại, nên dòng của họ sẽ không bao giờ tự
   được dọn. Đã chặn thì dòng cũ cũng bị gỡ, chứ không chỉ ngừng thêm mới.
3. **Trùng với một dòng khác** — xem [matching.md](matching.md).

Ô tick và ghi chú của bạn ở cột F trở đi **không** phải là lý do để giữ hay xoá một dòng, ngoại
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
