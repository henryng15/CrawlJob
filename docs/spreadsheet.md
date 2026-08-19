# Hai tab, và ai được ghi vào đâu

Spreadsheet là giao diện của cả hệ thống. Hiểu ai sở hữu cột nào là hiểu gần hết.

## Tab `Jobs` — việc còn phải nộp

| Cột | | Ai ghi |
|---|---|---|
| A | Company | tool |
| B | Role | tool |
| C | Link Apply | tool |
| D | Date Posted | tool |
| E | **Applied** ☑ | bạn, và tool tick sẵn hộ |
| F | **Expired** ☑ | chỉ bạn |
| G trở đi | ghi chú tự do | chỉ bạn |

Mỗi lượt sync tool **ghi đè toàn bộ** A–D rồi sort lại. Cột E trở đi được đọc lên và ghi
lại nguyên vẹn, nên ô tick của bạn luôn đi theo đúng dòng của nó chứ không nằm lại ở số
dòng cũ.

### Thứ tự sắp xếp

**Việc còn phải làm nổi lên trên, việc đã xong chìm xuống dưới.** Dòng đã tick `Applied`
**hoặc** `Expired` bị đẩy xuống cuối; trong mỗi nửa thì bài đăng mới nhất đứng trước.

Giữa hai nửa là **một dòng trống bôi vàng** làm mốc. Phía trên nó là việc cần làm, phía
dưới là việc đã xong — không có khoảng trống nào khác.

Dòng mốc đó không phải dữ liệu: nó rỗng, nên lượt đọc sau không phân biệt được nó với các
dòng chỉ-có-checkbox và xoá luôn. Mỗi lượt nó được dựng lại từ đầu, và đó chính là cách nó
luôn nằm đúng chỗ khi hai nửa thay đổi kích thước. Ô màu cũng được dời theo, bằng cùng cơ
chế xoá-có-chọn-lọc dùng cho alumni.

Khoảng trống đó từng có thật. `setupJobsCheckboxes` phủ validation lên `E2:F500` bất kể
dòng đó có job hay không, mà ô checkbox chưa tick đọc ra `FALSE` chứ không phải rỗng — nên
một lần đọc `A:Z` trả về đủ cả 499 dòng, phần lớn chỉ có hai chữ `FALSE`. Chúng xếp vào
nhóm "chưa làm" với ngày trống, tức là sau job thật nhưng trước đám đã tick. Giờ dòng nào
không có gì ở A–D đều bị xoá hẳn trước khi sort.

### Cột E — `Applied`

Tick vào là dòng đó lập tức được copy sang tab `App`, đầy đủ Property, ngày hôm nay và
`Process = Applied`. Mất khoảng một giây.

Tool cũng tự tick hộ ô này cho những job mà tab `App` cho thấy bạn đã nộp rồi — xem
[matching.md](matching.md). Nói cách khác: **dòng nào còn trống ở cột E chính là việc còn
phải làm.**

### Cột F — `Expired`

Dành cho posting đã đóng nhưng board vẫn trả HTTP 200, nên liveness check không tự xoá
được. Tick vào thì:

- Dòng đó **không sang `App`**, kể cả khi `Applied` cũng đang tick. Expired thắng.
- Tool **không** tự tick `Applied` cho dòng đó nữa.
- Dòng đó không còn được đếm vào số "còn phải nộp".

Nó chỉ chặn chiều đi. Một dòng đã sang `App` rồi thì tick `Expired` sau đó **không** gọi
nó về — `App` là source of truth. Gỡ tick ra thì dòng lại đi được bình thường, không có
trạng thái kẹt.

### Cột G trở đi — ghi chú

Ghi bất cứ gì vào đây là tool ngừng đụng vào checkbox của dòng đó. Đây là cách duy nhất
để nói "tool khớp sai rồi", vì untick suông sẽ bị tick lại ở lượt sau.

> **Vì sao ghi chú phải từ G chứ không phải F.** Một cột checkbox đọc ra `FALSE` ở *mọi*
> dòng nó phủ, không phải ô rỗng. Nếu F được coi là chỗ ghi chú thì tool sẽ thấy cả sheet
> đã có ghi chú và ngừng tick tự động hoàn toàn. Đúng lỗi này từng khiến bản đầu tiên tick
> được 0 dòng mà workflow vẫn báo xanh. Có test ghim lại: `test_the_expired_column_is_not_read_as_a_note`.

### Đừng xoá dòng khỏi `Jobs`

Cả dòng đã Applied lẫn dòng đã Expired đều phải **ở lại làm tombstone**. Tool biết một job
đã có trong sheet bằng cách so với chính các link đang nằm trong sheet; xoá dòng đi thì
job đó vẫn còn trong tracker nguồn và sẽ được append lại ở lượt sau.

Muốn cho khuất mắt thì dùng **filter view** ẩn `E = TRUE` hoặc `F = TRUE`, đừng xoá.

## Tab `App` — đã nộp

| Cột | | |
|---|---|---|
| A | Property | số thứ tự, tự tăng |
| B | Company | |
| C | Application Link | |
| D | Date Applied | ngày bạn tick |
| E | Location (State) | **luôn trống khi tự sinh** — tab Jobs không mang dữ liệu này |
| F | Process | dropdown: Applied / OA / Interview / Offer / Rejected |
| G | Role | |
| H | Note | |
| I | *(không có chữ)* | ô bôi đỏ báo công ty đó có recruiter — xem [alumni.md](alumni.md) |
| J | **Update** | lịch sử chuyển chặng, mỗi chặng một dòng |

`Property` được tính bằng **số lớn nhất đang có + 1**, không phải số dòng — App có thể đã
bị xoá dòng ở giữa, và hai dòng trùng số thì tệ hơn là có lỗ hổng.

Data validation của dòng mới được **copy từ dòng entry cuối cùng** thay vì dựng lại, vì
dropdown `Process` dạng chip màu được tạo từ giao diện Sheets mà Apps Script không có API
đặt màu chip. Copy thì dòng mới giống hệt dòng cũ, bất kể dropdown từng được tạo kiểu gì.

### Cột J — `Update`

Mỗi lần bạn đổi `Process` ở cột F, Apps Script nối thêm một dòng vào ô J của **chính dòng
đó**, ghi chặng vừa chuyển sang và ngày hôm nay. Nhiều dòng nằm trong cùng một ô, ngăn
nhau bằng xuống dòng (Alt+Enter):

```
Applied: Jul 21, 2026
OA: Aug 3, 2026
Interview: Aug 12, 2026
```

Cột `Date Applied` chỉ nhớ được ngày đầu tiên. Cột này nhớ cả đường đi — bao lâu thì có
OA, bao lâu từ OA sang phỏng vấn — thứ mà nhìn một ô `Process` đang đứng ở đâu thì không
bao giờ biết được.

**Mỗi chặng ghi đúng một lần.** Ô này là lịch sử, không phải log: quay lại một chặng đã đi
qua, hay paste đè đúng giá trị đang có, đều không sinh dòng thứ hai. Giá trị nằm ngoài
pipeline (gõ tay "Phone screen" chẳng hạn) bị bỏ qua hẳn — dropdown đã liệt kê hết chặng
có thật, nên cái gì không khớp là gõ nhầm.

Script chỉ **nối thêm**, không bao giờ viết lại cái đã có. Nên ô này sửa tay thoải mái:
ghi nhầm thì xoá dòng đó đi, nhớ ra ngày cũ thì điền vào.

> **Vì sao là cột J chứ không phải I.** Cột I đang là ô bôi đỏ báo "công ty này có
> recruiter", do phía Python vẽ. Nó không mang chữ nào, nhưng đặt text lên nền đỏ thì vừa
> không đọc được vừa khiến hai thứ chẳng liên quan tranh nhau một cột.

### Dấu `?` trong cột Update

`setupUpdateColumn` dựng cột này cho các dòng đã có sẵn. Chỉ chặng `Applied` là suy ra
được — từ ô `Date Applied`. Ngày chuyển sang OA hay Interview thì **chưa từng được ghi ở
đâu cả**, nên dòng nào đang đứng ở chặng sau `Applied` được ghi thêm:

```
Applied: Jul 26, 2026
OA: ?
```

Dấu `?` nghĩa là chặng đó có thật nhưng ngày thì không ai biết. Ctrl+F tìm `: ?` ra đúng
danh sách cần điền tay. Nó ở đó thay cho một ngày bịa trông như thật.

Từ lúc dựng xong trở đi mọi lần chuyển chặng đều tự ghi, nên `?` chỉ xuất hiện ở đám dòng
có trước.

### Điền Role vào là tool tick được nhiều hơn

Một dòng `App` thiếu `Company` hoặc `Role` thì **không bao giờ khớp được theo tên** — nó
chỉ khớp nếu link trùng đúng từng ký tự. Lần audit gần nhất có 14 dòng như vậy trên tổng
82. Điền `Role` vào là lượt sync sau tick thêm được một loạt.

Chạy [`--audit-app`](operations.md#soát-tab-app) để biết chính xác dòng nào.

## Vì sao ghi sheet phải tách làm hai lần

`_write` ghi `A:D` bằng `valueInputOption="RAW"` và `E` trở đi bằng `USER_ENTERED`, tốn
thêm một API call mỗi lượt. Hai nửa cần hai cách parse ngược nhau:

- **`A:D` phải RAW.** `Date Posted` là chuỗi ISO `2026-08-16` và việc sort dựa vào nó vẫn
  là chuỗi. `USER_ENTERED` sẽ parse nó thành date serial và phá sort.
- **`E` trở đi phải USER_ENTERED.** Chuỗi `"TRUE"` ghi kiểu RAW sẽ nằm **đè lên** checkbox
  dưới dạng text chứ không tick nó, và lượt sau đọc lại thành chưa tick.
