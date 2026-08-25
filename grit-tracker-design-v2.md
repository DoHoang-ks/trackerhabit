# Thiết Kế Chi Tiết Web-App: Grit Tracker (Ứng Dụng Tâm Lý Học Hành Vi)

Tài liệu này mô tả chi tiết kiến trúc, lộ trình phát triển và các tính năng cốt lõi cho ứng dụng web Grit Tracker. Cốt lõi của hệ thống này không phải là một danh sách công việc (to-do list) thông thường, mà là một cỗ máy thay đổi hành vi dựa trên tâm lý học.

---

## 0. Thuật Ngữ & Mô Hình Chuẩn Hóa (Canonical Model)

> Mục này chốt các định nghĩa để gỡ **3 xung đột** giữa tài liệu v1 (`Tổng Quan...`) và bản thiết kế này. Toàn bộ phần sau tuân theo mô hình này.

**Phân cấp dữ liệu chuẩn:** `User` → **`Goal`** (mục tiêu lớn) → **`Habit`** (micro-habit) → **`Log`** (bản ghi check-in theo ngày).
- 1 Goal chứa nhiều Habit; **mỗi Habit có streak riêng**. Streak cấp Goal (nếu hiển thị) = tổng hợp từ các Habit thành phần.

| Xung đột (v1 vs v2) | Quyết định chuẩn |
|---|---|
| **Bảo vệ chuỗi**: v1 dùng "Skip / Vacation Mode / Shield tự động", v2 dùng "Freeze Pass" | Dùng **MỘT** cơ chế duy nhất: **Freeze** (tên hiển thị cho user). "Shield/Grace-day" chỉ là tên kỹ thuật nội bộ của cùng một cơ chế. Bỏ "Skip" và "Vacation Mode" như các khái niệm riêng — Vacation = kích hoạt nhiều Freeze liên tiếp. |
| **Phạm vi Dashboard**: v1 hiện nhiều habit + tab lọc, v2 chỉ 1 card/ngày | **Focus Dashboard** mặc định chỉ hiện **1 card ưu tiên/ngày** (habit "must-do" của Goal đang active). Các habit còn lại nằm ở màn hình phụ **"All Habits"** (list đầy đủ). Không mâu thuẫn: Focus là mặc định, All Habits là tùy chọn xem sâu. |
| **Đơn vị theo dõi**: v1 xoay quanh `habits`, v2 xoay quanh `goals` (thiếu bảng `goals`) | Bổ sung bảng **`goals`** làm mắt xích còn thiếu trong schema. `habits.goal_id` là khóa ngoại bắt buộc (habit luôn thuộc về 1 goal; goal mặc định "Chung" nếu user tạo habit rời). |

---

## I. Ưu Điểm Vượt Trội Của Ứng Dụng (So với To-do list truyền thống)

Ứng dụng Grit Tracker giải quyết 3 điểm yếu lớn nhất của các ứng dụng quản lý mục tiêu hiện tại:
1. **Chống lại sự tê liệt (Anti-paralysis):** Thay vì làm người dùng choáng ngợp bởi một danh sách dài các mục tiêu vĩ mô, hệ thống ép buộc sự tập trung vào các hành động siêu nhỏ (micro-habits) của hiện tại.
2. **Thao túng động lực tích cực:** Sử dụng các thiên kiến nhận thức có sẵn của con người (như sợ mất mát, hội chứng Zeigarnik) để tạo ra "ma sát" khi người dùng muốn bỏ cuộc và "bôi trơn" khi họ muốn tiếp tục.
3. **Cá nhân hóa theo nỗ lực:** Hệ thống hiểu rằng sự bền bỉ (Grit) không phải là lúc nào cũng làm việc 100% công suất, mà là khả năng duy trì nhịp độ ngay cả trong những ngày tồi tệ nhất (thông qua cơ chế Freeze).

---

## II. Phase 1: MVP (Minimum Viable Product) - Phá Bỏ Rào Cản Bắt Đầu

Mục tiêu của Phase 1 là xây dựng các tính năng nền tảng. Dưới đây là mô tả chi tiết và sâu sắc về 3 trụ cột tính năng chính:

### 1. Hệ thống Phân rã mục tiêu (Goal Chunking)
*   **Chức năng:** Cho phép người dùng nhập một mục tiêu lớn (ví dụ: Chạy bộ 5km hoặc Đạt chứng chỉ bảo mật quốc tế) và ứng dụng sẽ tự động (hoặc hướng dẫn người dùng) chia nhỏ nó thành các nhiệm vụ ngày cực kỳ đơn giản (ví dụ: Xỏ giày và đi bộ 5 phút, hoặc đọc 1 trang tài liệu).
*   **Tâm lý học ứng dụng:** *Giảm tải lượng nhận thức (Cognitive Load)*. Khi đối mặt với mục tiêu quá lớn, não bộ dễ rơi vào trạng thái tê liệt và trì hoãn (Analysis Paralysis). Việc chỉ hiển thị một nhiệm vụ siêu nhỏ trong ngày giúp người dùng đánh lừa bộ não, vượt qua lực cản (ma sát) ban đầu để bắt đầu hành động.
*   **Mô tả UI/UX:** Màn hình "Focus Dashboard" sẽ chỉ hiển thị đúng 1 thẻ (card) nhiệm vụ của ngày hôm nay. Không có danh sách dài, không có lộ trình tương lai hiển thị ở màn hình chính.

### 2. Theo dõi chuỗi liên tục (Streaks Tracker)
*   **Chức năng:** Đếm và hiển thị nổi bật số ngày liên tiếp người dùng hoàn thành thói quen. Ứng dụng bổ sung tính năng cốt lõi "Đóng băng" (Freeze Pass) để cho phép người dùng nghỉ ngơi một ngày (do ốm đau, bận đột xuất) mà không bị mất chuỗi.
*   **Tâm lý học ứng dụng:** *Thiên kiến sợ mất mát (Loss Aversion)*. Con người ghét việc mất đi những gì mình đã cất công xây dựng gấp đôi so với niềm vui nhận được thứ mới. Khi người dùng đã tích lũy được chuỗi 15 ngày, nỗi sợ làm "đứt chuỗi" sẽ tạo động lực mạnh mẽ thúc đẩy họ hành động, lớn hơn cả mục tiêu ban đầu. Cơ chế Freeze giúp ngăn chặn "What the hell effect" (tâm lý buông xuôi khi lỡ làm hỏng một việc nhỏ).
*   **Mô tả UI/UX:** Biểu tượng ngọn lửa (hoặc tương tự) hiển thị số ngày. Khi chuỗi càng dài, hiệu ứng hình ảnh càng rực rỡ. Nút check-in cần to, rõ ràng và có hiệu ứng âm thanh thỏa mãn.

### 3. Thanh tiến trình hiển thị dạng dang dở (Visual Progress)
*   **Chức năng:** Thay vì một vòng tròn trống không (0%) khi mới bắt đầu, thanh tiến trình luôn được mặc định bắt đầu ở mức 5-10% ngay khi người dùng hoàn tất việc thiết lập mục tiêu (Onboarding).
*   **Tâm lý học ứng dụng:** Kết hợp *Hiệu ứng Goal-Gradient* (chúng ta nỗ lực và tăng tốc độ hơn khi thấy mình sắp chạm đích) và *Hiệu ứng Zeigarnik* (não bộ luôn bị thôi thúc và ghi nhớ tốt hơn về những công việc đang làm dang dở so với công việc chưa bắt đầu hoặc đã xong). Việc "tặng" trước 5% tạo cảm giác nhiệm vụ đã được khởi động, khiến não bộ khao khát hoàn thiện nó.
*   **Mô tả UI/UX:** Thanh tiến trình có màu sắc tương phản cao. Phần % được tặng (ảo) có thể có màu nhạt hơn một chút để phân biệt với nỗ lực thực tế, nhưng vẫn đóng góp vào tổng tiến trình.

---

## III. Phase 2: Động Lực, Giữ Chân (Retention) & Phản Ngẫm

Khi thói quen đã bắt đầu hình thành, cần cơ chế để tối ưu hóa và duy trì:

*   **Weekly Reflection (Nhật ký Tự ngẫm cuối tuần):** 
    *   Hệ thống popup nhắc nhở vào tối Chủ Nhật. Đưa ra 2 câu hỏi ngắn gọn: "Điều gì cản trở bạn tuần qua?" và "Bạn sẽ điều chỉnh micro-habit tuần tới như thế nào để dễ dàng hơn?".
    *   Giúp người dùng tự nhận thức và pivot (chuyển hướng) kịp thời, thay vì mù quáng lặp lại một phương pháp không hiệu quả dẫn đến chán nản.
*   **Dynamic Difficulty (Độ khó động):** Nếu người dùng hoàn thành xuất sắc chuỗi 14 ngày, app gợi ý (không ép buộc) tăng nhẹ độ khó của micro-habit (VD: từ 5 phút chạy lên 10 phút).

---

## IV. Phase 3: Tự Động Hóa & Mở Rộng bằng AI

*   **AI Goal Breakdown (Phân rã bằng LLM):** Thay vì người dùng tự nghĩ micro-habit, họ chỉ cần nhập prompt mục tiêu. Backend (tích hợp API của các LLM) sẽ tự động phân tích và generate ra một lịch trình 90 ngày với các công việc cực kỳ chi tiết, phù hợp với năng lực được khai báo.
*   **Cơ chế Accountability (Trách nhiệm giải trình):** Tính năng ghép cặp ngẫu nhiên hoặc mời bạn bè. Hai người sẽ nhìn thấy trạng thái chuỗi (Streaks) của nhau. Tâm lý học áp dụng: Áp lực đồng trang lứa tích cực.

---

## V. Lưu Ý Kỹ Thuật Khi Phát Triển

Để đảm bảo hệ thống vận hành trơn tru và an toàn, đặc biệt với các dữ liệu mang tính cá nhân cao:

1.  **Thiết kế Database cho Streaks:** Tránh việc tính toán chuỗi (count) bằng cách query toàn bộ lịch sử check-in mỗi khi load trang. Nên lưu trữ các field `current_streak`, `longest_streak`, và `last_checkin_date` trực tiếp vào bảng User/Goal và cập nhật qua các database triggers hoặc background jobs.
2.  **Kiểm soát Truy cập & Phân quyền (Authorization):** Bắt buộc phải có cơ chế kiểm tra quyền sở hữu đối với các API endpoints (ví dụ: `/api/goals/:id`). Phải xác thực ID người dùng gọi API khớp với `user_id` của Goal đó để ngăn chặn rủi ro Insecure Direct Object Reference (IDOR).
3.  **Sanitization Dữ liệu:** Đối với các trường nhập liệu tự do như Weekly Reflection hay Tên mục tiêu, cần thực hiện sanitize nghiêm ngặt ở cả hai phía Client và Server để loại bỏ các script độc hại, phòng chống XSS.

---

## VI. Ràng Buộc Nghiệp Vụ Chi Tiết (Business Rules)

Đây là các quy tắc **bắt buộc phải chốt trước khi code**, vì streak/freeze là logic rủi ro nhất (dễ tính sai → mất niềm tin của user).

### 1. Định nghĩa "Ngày" & Streak
- **Mốc ngày:** Streak tính theo `logged_date` chuẩn hóa theo **timezone của user**. Ngày đổi lúc **00:00 giờ user** (mặc định). Cho phép tùy chỉnh "cut-off" (vd 03:00 sáng cho người thức khuya) ở **Phase 2**.
- **Chỉ đánh giá "ngày đến hạn" (scheduled days):** Habit lịch T2–T4–T6 mà bỏ T3 thì **KHÔNG** đứt chuỗi. Cron job cuối ngày chỉ đặt `Missed` cho những ngày nằm trong lịch của habit (đọc từ bảng `frequencies`/`schedules`).
- **Trạng thái mỗi ngày đến hạn:** `completed` | `missed` | `frozen` (đã dùng Freeze) | `not_due` (không tính).

### 2. Idempotency & Backfill (chống gian lận + UX)
- **UNIQUE `(habit_id, logged_date)`** trên bảng `logs`: mỗi habit chỉ 1 log/ngày. Check-in lại = update, không tạo bản ghi mới.
- **Undo trong ngày:** cho phép đảo trạng thái về "chưa hoàn thành" **trước giờ cut-off**.
- **Cửa sổ backfill giới hạn:** chỉ cho check-in ngày hiện tại + sửa **tối đa 1 ngày trước (hôm qua)** trước giờ cut-off. **Không** cho backfill vô hạn (nếu không streak trở nên vô nghĩa).

### 3. Quy tắc "Hoàn thành" theo loại habit
| Loại | Điều kiện tính `completed` |
|---|---|
| **Checkbox** | 1 thao tác check = hoàn thành. |
| **Quantity** | Mặc định đạt **100%** `target_value`. Tùy chọn "đạt tối thiểu X% vẫn giữ chuỗi" (Phase 2). |
| **Timer** | Chỉ tính **thời gian chạy thực** (không tính thời gian pause). Đạt `target_duration` = completed. |

### 4. Cơ chế Freeze (gỡ "hộp đen")
- **Cách kiếm:** tự động cấp **1 Freeze cho mỗi 7 ngày streak liên tục** (không mua bằng tiền ở MVP).
- **Trần tích lũy:** tối đa **giữ 3 Freeze** cùng lúc (tránh lạm dụng, giữ ý nghĩa của chuỗi).
- **Kích hoạt:** khi cron phát hiện 1 ngày đến hạn bị `missed` mà user còn Freeze → **tự động tiêu 1 Freeze**, đặt ngày đó là `frozen`, streak **được giữ nguyên** (không +1, không reset).
- **Giới hạn liên tiếp:** không cho phép Freeze **quá 2 ngày liên tiếp** (buộc user quay lại thực thi). Vacation Mode = cấp lô Freeze cho khoảng nghỉ dài, phải bật thủ công trước.
- **Minh bạch:** UI hiển thị rõ số Freeze còn lại và lịch sử "ngày được cứu bằng Freeze".

### 4b. Hạn mức bỏ lỡ mỗi tuần (Weekly Miss Allowance)
- **Định nghĩa:** mỗi habit có tham số `weekly_miss_allowance` (0–6, mặc định 0). Trong **một tuần (bắt đầu thứ Hai)**, cho phép bỏ lỡ tối đa `N` ngày đến hạn mà **vẫn giữ chuỗi**; ngày bỏ lỡ thứ `N+1` trong tuần → **đứt chuỗi**.
- **Miễn phí & tự làm mới:** khác Freeze — hạn mức này không tốn Freeze, tự reset mỗi tuần. Dùng cho thói quen linh hoạt ("tập 5/7 ngày", cho nghỉ cuối tuần).
- **Thứ tự áp dụng khi bỏ lỡ:** (1) dùng hạn mức tuần trước → (2) nếu hết hạn mức mà còn Freeze thì tiêu Freeze (≤2 ngày liên tiếp) → (3) hết cả hai thì đứt chuỗi.
- **Nguồn chân lý:** `recomputeStreak` đếm số `missed` theo từng tuần (Monday key) và so với hạn mức; cron materialize ngày bỏ lỡ và chỉ tiêu Freeze cho phần **vượt** hạn mức (không lãng phí Freeze).

### 5. Bảo mật & Toàn vẹn dữ liệu
- **Phân quyền (IDOR):** mọi endpoint `/api/goals/:id`, `/api/habits/:id`, `/api/logs/:id` phải kiểm tra `resource.user_id == current_user.id` phía server (không tin client).
- **Server là nguồn chân lý cho streak:** client chỉ hiển thị; mọi tính toán streak/freeze chạy ở backend để tránh chỉnh sửa gian lận (đổi ngày máy client).
- **Sanitize XSS** cho các field tự do (tên Goal/Habit, Weekly Reflection) ở cả client và server.

---

## VII. Kiến Trúc Triển Khai Đa Nền Tảng (Deployment)

Chiến lược: **xây một Web-App (PWA) duy nhất**, phân phối tới 3 điểm chạm — iOS (Add to Home Screen), Android (APK), và desktop (trình duyệt) — không cần viết lại native. Đây là lựa chọn tối ưu chi phí/công sức cho giai đoạn đầu.

### 1. Hạ tầng Web trên VPS + Domain
- **Máy chủ:** một VPS (Ubuntu). Deploy stack gồm Frontend (SPA/PWA) + Backend API + Database.
- **Domain:** trỏ domain cụ thể (vd `grit.<your-domain>`) về IP VPS qua bản ghi **A/AAAA**.
- **HTTPS bắt buộc:** Reverse proxy **Nginx/Caddy** + chứng chỉ **Let's Encrypt** (auto-renew). *HTTPS là điều kiện tiên quyết để PWA cài được và Service Worker hoạt động.*
- **Đóng gói:** Docker Compose (web, api, db, proxy) để deploy/rollback nhất quán.
- **Bảo mật cơ bản VPS:** firewall (chỉ mở 80/443, SSH), fail2ban, disable password-login SSH (chỉ key), backup DB định kỳ.

### 2. iOS — Cài qua "Add to Home Screen" (PWA)
- User mở domain trên **Safari** → nút Share → **"Add to Home Screen"** → app xuất hiện icon như native, chạy toàn màn hình (standalone).
- **Yêu cầu kỹ thuật PWA:** `manifest.json` (name, icons 180/192/512, `display: standalone`, theme color) + **Service Worker** (cache offline-first).
- **Lưu ý giới hạn iOS:** push notification web chỉ hỗ trợ iOS ≥ 16.4 và **chỉ sau khi đã Add to Home Screen**; nhắc nhở streak nên có phương án dự phòng (email/lịch) nếu user chưa cấp quyền.

### 3. Android — Build APK cài đặt
- Bọc PWA thành APK bằng **TWA (Trusted Web Activity)** qua công cụ **Bubblewrap** (hoặc PWABuilder). APK mở full-screen, dùng chung codebase web.
- **Ràng buộc TWA:** cần file **Digital Asset Links** (`assetlinks.json`) đặt tại `https://<domain>/.well-known/assetlinks.json` để verify domain ↔ app (ẩn thanh URL).
- Phân phối: cài trực tiếp APK (sideload) cho nội bộ/thử nghiệm; hoặc lên Google Play sau.
- Push notification Android (qua FCM) hoạt động đầy đủ hơn iOS.

### 4. Desktop — Truy cập qua trình duyệt
- Vào thẳng domain trên Chrome/Edge/Firefox; layout **responsive**. Có thể "Install" như app desktop (PWA) nếu muốn cửa sổ riêng.
- Bố cục desktop tận dụng không gian rộng: Focus Dashboard ở giữa, panel phân tích/biểu đồ hai bên.

### 5. Đồng bộ dữ liệu đa thiết bị
- **Backend là single source of truth**; mọi client (iOS/Android/desktop) đọc/ghi qua cùng REST API + auth token.
- **Offline-first:** Service Worker + hàng đợi ghi (queue) khi mất mạng, đồng bộ lại khi có mạng; xử lý xung đột theo `updated_at` (last-write-wins ở MVP, nâng cấp merge sau).

---

## VIII. Bảng Tổng Kết Lộ Trình Theo Phase

| Phase | Trọng tâm | Hạng mục chính |
|---|---|---|
| **Phase 1 (MVP)** | Phá rào cản bắt đầu | Goal Chunking, Streaks + Freeze cơ bản, Visual Progress, PWA + deploy VPS/HTTPS, phân quyền IDOR |
| **Phase 2** | Giữ chân & phản ngẫm | Weekly Reflection, Dynamic Difficulty, cut-off giờ tùy chỉnh, quantity %-tối-thiểu, APK Android (TWA), push notification |
| **Phase 3** | Tự động hóa & mở rộng | AI Goal Breakdown (LLM), Accountability (ghép cặp), phân tích nâng cao, đồng bộ merge nâng cao |
