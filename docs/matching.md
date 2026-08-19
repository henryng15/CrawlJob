# Khi nào hai dòng là một job

Cùng một posting đến từ năm tracker khác nhau, mỗi nơi viết một kiểu. Quyết định "hai dòng
này là một" phải trả lời hai câu hỏi rất khác nhau, và **hai câu hỏi đó không được dùng
chung một luật**:

| Câu hỏi | Dùng để | Sai thì mất gì |
|---|---|---|
| Hai dòng ở `Jobs` có phải một job? | **xoá bớt một dòng** | mất một cơ hội thật, không bao giờ biết |
| Dòng `Jobs` này có nằm trong `App` không? | **tick một ô** | ghi chú vào cột H là gỡ được |

Vì thiệt hại lệch nhau như vậy nên có ba lớp, lỏng dần, và lớp lỏng nhất **không bao giờ**
được dùng để xoá.

---

## Lớp 1 — theo link (`normalize_link`)

Chặt nhất và chắc chắn nhất. Hai URL quy về cùng một chuỗi thì là một posting.

Bốn thứ bị bỏ đi:

**Tham số tracking** — `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`,
`utm_term`, `ref`, `gh_src`, `src`. Simplify gắn `?utm_source=Simplify&ref=Simplify` vào
đúng cái link mà speedyapply để trần.

**Tham số chỉ đổi cách render** — `embed`, `mobile`, `needsredirect`. Chúng đổi cách trang
tự vẽ, không đổi trang là trang nào.

**Đoạn `/application` và `/apply` ở cuối path** — một số tracker link vào form nộp, số
khác link vào chính posting nằm ngay trên nó. Ashby treo form ở `/application`, Lever ở
`/apply`, đều là một segment dưới cùng một id:

```
jobs.ashbyhq.com/replit/7e0dafe8-.../application?embed=true&utm_source=Simplify
jobs.ashbyhq.com/replit/7e0dafe8-...
```

Hai dòng Replit từng cùng tồn tại trong sheet chính là cặp này. Riêng luật này gộp được
**15 cặp**.

Có bảo vệ: nếu path chỉ có mỗi `/apply` thì không cắt, vì cắt xong sẽ còn host trần và mọi
thứ trên host đó gộp thành một.

**`gh_jid` khi nó lặp lại đúng id đã có trong path** — Greenhouse ghi id vào cả hai chỗ:

```
boards.greenhouse.io/spacex/jobs/8621757002?utm_source=Simplify
boards.greenhouse.io/spacex/jobs/8621757002?gh_jid=8621757002
```

Bỏ có điều kiện chứ không bỏ hẳn: form nhúng `/embed/job_app?gh_jid=...` **không** có id
trong path, bỏ `gh_jid` ở đó là gộp mọi posting của board đó thành một dòng.

## Lớp 2 — theo `(company, role)` (`role_key`)

Cho những posting mà link khác nhau thật — ví dụ jobright mirror lại board của công ty.

`name_key` hạ hoa thường và bỏ dấu câu, nhưng vẫn để `engineer` khác `engineering`.
`role_key` gộp thêm các đuôi từ mà hai tracker viết khác nhau về cùng một việc:

```
engineering, engineers  → engineer
internship, internships, interns → intern
development, developers → developer
```

**Giữ nguyên thứ tự từ và giữ nguyên đợt tuyển.** Đây là lựa chọn có chủ đích:

```
Notion — Software Engineer Intern (Summer 2027)
Notion — Software Engineer Intern (Winter 2027)
```

Hai đợt tuyển khác nhau. Một luật đủ lỏng để gộp chúng sẽ **xoá mất một cơ hội thật**.
Điều tương tự với SpaceX (Spring / Summer), Melius (Fall/Winter / Spring/Summer), Heliux.
Có test ghim: `test_two_intakes_are_not_merged_out_of_the_sheet`.

Khi hai dòng cùng identity, giữ dòng nào được quyết theo thứ tự ưu tiên trong `_preference`:

1. Dòng đã có tick hoặc ghi chú của bạn — thắng tuyệt đối.
2. Link của chính công ty, thay vì link redirect của aggregator.
3. Dòng đến trước.

## Lớp 3 — theo tập từ (`role_tokens`) — **chỉ để tick, không bao giờ để xoá**

Bỏ luôn thứ tự từ, bỏ năm (`20\d\d`) và bỏ mùa (`summer`, `fall`, `winter`, `spring`,
`program`). So hai bên như hai tập hợp.

Cần lớp này vì hai tab mô tả cùng một job từ hai đầu ngược nhau:

```
App  — "2027 Internship - Software Engineer"
Jobs — "Software Engineer Intern - Software Engineer"
        → cả hai đều là {engineer, intern, software}
```

Đây chính là ca Virtu Financial: đã nộp rõ ràng mà không tick được, cho tới khi có lớp
này. Lớp 1 trượt (nộp qua career site công ty, Jobs đang giữ link khác), lớp 2 cũng trượt
(khác thứ tự từ).

Nó lỏng, nhưng vẫn không bừa: một từ phân biệt là đủ để không khớp.
`Frontend Developer Internship` ≠ `Software Engineer Intern`.

### Đánh đổi đã biết của lớp 3

Vì bỏ mùa, một dòng `Jobs` thuộc **đợt tuyển khác** có thể bị tick từ một dòng `App` không
ghi đợt. Lượt gần nhất có 2 trong 9 dòng khớp theo tên rơi vào diện này:

```
Figma    — Software Engineer Intern - Winter 2027
Deepgram — Software Engineering- Internship - Fall 2026/Summer 2027
```

Đây là đánh đổi có chủ đích, không phải bug: chính việc bỏ năm là thứ làm Virtu khớp
được. Giữ lại mùa sẽ tránh được hai ca trên nhưng lại làm trượt những dòng `App` có ghi
mùa mà `Jobs` thì không.

Cách chọn hiện tại thiên về **tick nhiều hơn**, vì tick thừa có đường lùi (ghi chú vào cột
G) còn sót thì không có gì báo cho bạn biết. Muốn đổi hướng thì bỏ `ROLE_NOISE` khỏi
`role_tokens`, một dòng — Virtu vẫn khớp vì nó chỉ cần bỏ năm.

Mọi dòng được tick nhờ lớp 3 đều được in tên ra log của Actions, đúng để soát lại:

```
Ticked by company and role: Virtu Financial — Software Engineer Intern - Software Engineer
```

---

## Vì sao `Applied` không dùng lớp 3 khi bạn tự tick

Khi bạn tự tay tick `Applied`, Apps Script chỉ chống trùng **theo link**, không theo tên.
Lúc đó bạn vừa nộp thật; một dòng bị bỏ qua vì "trùng tên" là **mất bản ghi**, tệ hơn hẳn
so với việc có thêm một dòng thừa trong `App`.

Hệ quả nhỏ: một dòng mà tool đã tick theo tên, nếu bạn untick rồi tick lại bằng tay, sẽ
tạo dòng mới ở `App`.
