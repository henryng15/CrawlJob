# Ai có thể nói giúp bạn một câu

Danh bạ alumni của trường được dán vào một tab riêng. Mỗi lượt sync, tool đánh dấu **cả
hai phía** của phần giao nhau:

- Tab **`Alumni`** — dòng của người đang làm ở công ty bạn đã nộp được **tô vàng**. Đây là
  người đáng hỏi xin referral.
- Tab **`App`** — cột **I `Alumni`** được tick ở đơn mà bạn *có người quen bên trong*.

Và một dấu thứ hai ở tab `App`: cột **J `Recruiter`** được tick khi công ty đó có sẵn
recruiter trong danh sách liên hệ. Hai cột độc lập, một đơn có thể tick cả hai.

Hai dấu ở tab `App` trước đây là màu nền — vàng cả dòng và đỏ ở cột I. Checkbox nói đúng
cùng một điều nhưng **lọc và sort được**, còn màu nền thì không: muốn xem "mọi đơn có
alumni" thì với checkbox là một filter, với màu là mắt thường dò từng dòng. Lượt sync đầu
tiên sau khi đổi tự gỡ màu cũ.

Bên tab `Alumni` vẫn là màu, vì ở đó không có đơn nào để mà tick — mỗi dòng là một con
người, không phải một lần nộp.

## Vì sao phải nằm trong spreadsheet

GitHub Actions chạy trên runner của GitHub, Apps Script chạy trên server Google. Không cái
nào thấy được file `.xlsx` trong thư mục Downloads trên máy bạn. Muốn tự động thì dữ liệu
phải nằm ở chỗ mà chúng đọc được — và spreadsheet là chỗ đã có sẵn.

## Cài một lần

1. Mở spreadsheet → **File → Import → Upload**, chọn file alumni `.xlsx` vừa tải.
2. Chọn **Insert new sheet(s)**, bấm Import.
3. Đổi tên tab vừa tạo thành **`Alumni`**. Muốn tên khác thì đặt biến
   `GOOGLE_SHEET_ALUMNI_TAB`.

Cột A phải là tên công ty. Bản export hiện tại đúng như vậy:

```
Job Organization | Job Title | Industry | State | Degrees Aggregated | LinkedIn
```

Dòng 1 là header và không bao giờ bị tô.

Lần sau có bản export mới thì import đè lên tab đó. Không cần làm gì thêm — lượt sync kế
tiếp tự tô lại từ đầu.

## Khớp tên công ty thế nào

Danh bạ ghi tên đăng ký, đơn ứng tuyển ghi tên trên trang careers, hai bên hiếm khi giống
hệt. `company_tokens` bỏ hoa thường, dấu câu, và các từ chỉ loại hình doanh nghiệp
(`Inc`, `LLC`, `Ltd`, `Corp`, `Company`, `Group`, `Technologies`…). Sau đó khớp khi **tập
từ của bên này nằm trong bên kia**:

| Danh bạ alumni | Đơn đã nộp | |
|---|---|---|
| `Chicago Trading Company (CTC)` | `Chicago Trading Company` | ✅ |
| `Hakkōda, an IBM Company` | `IBM` | ✅ |
| `Google Cloud` | `Google` | ✅ |
| `Altamira Technologies` | `Altamira` | ✅ |
| `Dicerna Pharmaceuticals` | `Dice` | ❌ |
| `Champion Sports` | `HP` | ❌ |

Chứa nhau tính theo **từ nguyên vẹn**, không phải chuỗi con. Nếu tính theo chuỗi con thì
`Dice` sẽ khớp `Dicerna` và `HP` khớp `Champion`, và cả danh bạ sẽ vàng khè.

Đây là luật lỏng theo đúng lựa chọn khi thiết kế: bỏ sót một alumni thì bạn không bao giờ
biết, còn tô vàng thừa một dòng thì nhìn phát ra ngay. Mọi cặp được khớp đều in ra log của
Actions để soát:

```
Alumni row 41: Google Cloud — applied to Google
```

Một cái tên rút gọn xong chẳng còn từ nào (`The Company Ltd`) sẽ **không khớp gì cả** —
tập rỗng nằm trong mọi tập, và nếu không chặn thì nó sẽ tô vàng toàn bộ danh bạ. Có test
ghim lại chuyện này.

## Hai cột đó là của tool, không phải của bạn

Mỗi lượt sync tool ghi **cả hai câu trả lời** vào cột I và J — TRUE ở dòng khớp, FALSE ở
dòng không. Tự tick tay một ô thì lượt sau nó bị gỡ.

Phải như vậy thì dấu mới đúng được: một alumnus đổi công ty, hay một đơn bị xoá khỏi `App`,
đều phải làm ô tick tắt đi. Chỉ-tick-chứ-không-bao-giờ-gỡ thì dấu chỉ tích tụ dần rồi sai
lúc nào không biết. Chỗ để ghi thứ bạn muốn giữ là cột **H `Note`**.

Hai cột này là những ô **duy nhất** ngoài tab Jobs mà tool ghi vào. Cột A–H và cột K của
`App` không bao giờ bị đụng tới.

Một ngoại lệ đứng canh: nguồn **thiếu** thì cột đó được để nguyên, không bị ghi. Không có
tab `Alumni` không phải là "không ai làm ở đâu cả" — đọc ra 0 dòng khớp từ một tab không
tồn tại rồi ghi xuống thì gỡ sạch cả cột. Danh sách recruiter cũng vậy: rỗng nghĩa là file
không đi theo bản build, chứ không phải không công ty nào có recruiter.

Lượt nào hai cột đã đúng thì **không gửi request nào**, dù chạy 5 lần mỗi ngày.

Và một chốt nữa đứng trước tất cả: **ô I1 và J1 phải đọc ra đúng `Alumni` và `Recruiter`**
thì tool mới ghi. Sync chạy theo cron 5 lần một ngày, còn `setupAppColumns` thì bạn chạy
tay — chưa chạy mà sync đã tới thì cột J vẫn đang là chỗ cũ của lịch sử `Update`, và ghi
FALSE xuống đó là xoá sạch. Header sai thì tool in một dòng nhắc rồi để yên cả hai cột.

## Tool chỉ xoá đúng màu vàng của chính nó

Bên tab `Alumni`, trước khi tô, tool đọc màu nền đang có và so với đúng màu của nó — vàng
`#FFE599` ở cột A. Chỉ ô mang đúng màu đó mới bị xoá.

- Ô bạn tự tô tay **được giữ nguyên**.
- Công ty bị gỡ khỏi `App` thì dòng alumni tương ứng tự hết vàng.
- Dòng đã đúng màu rồi thì không bị ghi lại.

Cùng cơ chế đó lo việc dọn màu cũ ở tab `App`: hai dấu vàng-cả-dòng và đỏ-cột-I giờ khớp
với tập rỗng, nên tất cả những gì chúng còn làm được là gỡ màu chúng từng tô. Việc dọn phải
có: cột I hôm nay là ô checkbox `Alumni`, mà một checkbox nằm trên nền đỏ trông như một
cảnh báo không ai viết ra.

Một ngoại lệ cần biết: dòng từng được tô vàng thì cả dải A–H thành vàng, nên ô bạn tô tay
trên dòng đó đã bị phủ từ trước. Lượt dọn trả về nền trắng, không trả về màu cũ.

## Recruiter (cột J)

Nguồn là project `ColdEmail`, file `web/db/seed_recruiters.csv` — 2269 liên hệ đã verify.
Nhưng repo này **không mang theo tên hay email của ai**: chỉ danh sách công ty được chép
sang, vào `job_sync/data/recruiter_companies.txt` (720 dòng). Cần biết "có liên hệ", không cần biết
"liên hệ là ai".

Cập nhật lại khi ColdEmail có dữ liệu mới:

```bash
python scripts/recruiter_companies.py ../ColdEmail/web/db/seed_recruiters.csv
```

File nằm **trong package** `job_sync/data/`, không phải ở gốc repo: `pip install .` chỉ
chép `job_sync/` nên một file ở gốc sẽ có mặt khi chạy local và biến mất trên runner —
lỗi im lặng, tô ra 0 dòng mà workflow vẫn xanh. `pyproject.toml` khai báo
`[tool.setuptools.package-data]` để wheel mang theo nó.

File nằm trong repo nên không tốn API call nào, và thiếu file thì chỉ là tính năng tắt.

Khớp bằng đúng luật lỏng ở trên. Thử với các công ty đọc được từ tab App: trúng **32/54**,
cao hơn hẳn alumni — danh sách recruiter phủ rộng hơn danh bạ trường nhiều.

## Chi phí

Thêm 8 API call mỗi lượt sync: đọc `Alumni`, đọc `App`, đọc màu nền ở ba chỗ (cột A của
`Alumni`, cột A và cột I của `App`), đọc hai cột checkbox, rồi một `batchUpdate` và một
`update` — hai cái cuối bị bỏ hẳn khi không có gì đổi. Danh sách recruiter đọc từ đĩa, không tốn call nào. Các dòng liền nhau
được gộp thành một request, nên 100 dòng khớp rải rác vẫn chỉ tốn vài request chứ không
phải 100.

Chưa tạo tab `Alumni` thì tool in một dòng thông báo rồi bỏ qua, sync vẫn chạy bình thường.
