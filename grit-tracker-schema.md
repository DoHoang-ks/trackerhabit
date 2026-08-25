# Grit Tracker — Thiết Kế Database Schema (PostgreSQL)

Tài liệu này chốt mô hình dữ liệu cho MVP, hiện thực hóa toàn bộ ràng buộc nghiệp vụ ở Mục VI của `grit-tracker-design-v2.md`. Đây là **hợp đồng dữ liệu** — API, UI và cron job đều bám theo.

---

## 0. Chốt hướng stack (mức nguyên tắc)

- **CSDL:** **PostgreSQL** — bắt buộc quan hệ vì streak cần `UNIQUE`, khóa ngoại và transaction. NoSQL sẽ khổ với tính toàn vẹn chuỗi.
- **Backend/ORM:** đề xuất **Next.js (API routes) + Prisma**, hoặc **NestJS + Prisma** nếu muốn tách backend rõ. Cả hai deploy Docker lên VPS dễ, hợp PWA/offline-first.
- **Lưu ý:** Prisma không dùng DB trigger. → Toàn bộ tính toán streak/freeze chạy trong **background job (cron) + transaction ở tầng app**. Điều này khớp nguyên tắc "server là nguồn chân lý". DB chỉ giữ ràng buộc cứng (UNIQUE/FK/CHECK).

---

## 1. Sơ đồ quan hệ (ER tổng quan)

```
users ──1:N──> goals ──1:N──> habits ──1:N──> habit_schedules   (lịch + target theo thời gian)
                                   │
                                   ├──1:N──> logs            (1 bản ghi/ngày đến hạn; UNIQUE habit_id+logged_date)
                                   └──1:N──> freeze_ledger   (sổ cái earned/spent Freeze)
users ──1:N──> reflections   (nhật ký tự ngẫm cuối tuần)
```

Nguyên tắc phân cấp (Mục 0 của design v2): `User → Goal → Habit → Log`. Habit luôn thuộc 1 Goal (`goal_id` NOT NULL; goal mặc định "Chung" nếu tạo habit rời).

---

## 2. ENUM types

```sql
CREATE TYPE habit_type      AS ENUM ('checkbox', 'quantity', 'timer');
CREATE TYPE goal_status     AS ENUM ('active', 'paused', 'archived', 'completed');
CREATE TYPE log_status      AS ENUM ('completed', 'partial', 'missed', 'frozen', 'not_due');
CREATE TYPE log_source      AS ENUM ('manual', 'auto');
CREATE TYPE schedule_type   AS ENUM ('daily', 'weekly_days');   -- MVP; 'monthly_days'/'interval' để Phase sau
CREATE TYPE freeze_reason   AS ENUM ('earned_streak', 'spent_auto', 'vacation_grant', 'admin_adjust');
```

---

## 3. Bảng chi tiết (DDL)

### 3.1 `users`
```sql
CREATE TABLE users (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email          CITEXT UNIQUE NOT NULL,
    password_hash  TEXT   NOT NULL,
    display_name   TEXT,
    timezone       TEXT   NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',  -- IANA tz; mốc streak theo giờ user
    day_cutoff     TIME   NOT NULL DEFAULT '00:00',             -- cut-off tùy chỉnh (Phase 2), MVP để 00:00
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
> `timezone` + `day_cutoff` hiện thực **Mục VI.1** (định nghĩa "ngày"). Cần extension `citext` cho email không phân biệt hoa/thường.

### 3.2 `goals`
```sql
CREATE TABLE goals (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title             TEXT   NOT NULL,
    description       TEXT,
    status            goal_status NOT NULL DEFAULT 'active',
    progress_baseline NUMERIC(5,2) NOT NULL DEFAULT 5.00,   -- % "tặng" (Zeigarnik/Goal-Gradient), 5–10%
    progress_percent  NUMERIC(5,2) NOT NULL DEFAULT 0,      -- % nỗ lực thực; hiển thị = baseline + percent (cap 100)
    start_date        DATE,
    target_date       DATE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_progress CHECK (progress_percent BETWEEN 0 AND 100
                               AND progress_baseline BETWEEN 0 AND 100)
);
CREATE INDEX idx_goals_user ON goals(user_id);
```
> `progress_baseline` tách khỏi `progress_percent` để hiện thực **Visual Progress "tặng 5%"** (design v2, Phase 1 mục 3) mà vẫn phân biệt được nỗ lực ảo/thật.

### 3.3 `habits`
```sql
CREATE TABLE habits (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    goal_id            BIGINT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- denormalized cho auth/filter nhanh
    name               TEXT   NOT NULL,
    type               habit_type NOT NULL DEFAULT 'checkbox',
    is_focus           BOOLEAN NOT NULL DEFAULT false,  -- card ưu tiên trên Focus Dashboard
    archived_at        TIMESTAMPTZ,

    -- Trạng thái streak (denormalized — Mục V.1 & VI.5: không query toàn lịch sử mỗi lần load)
    current_streak     INT  NOT NULL DEFAULT 0,
    longest_streak     INT  NOT NULL DEFAULT 0,
    last_completed_date DATE,
    last_evaluated_date DATE,           -- cron đã xử lý tới ngày nào (idempotent, tránh double-eval)
    freeze_balance     SMALLINT NOT NULL DEFAULT 0,   -- Mục VI.4: trần 3
    consecutive_freeze_days SMALLINT NOT NULL DEFAULT 0,  -- Mục VI.4: chặn > 2 ngày liên tiếp

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_freeze_balance CHECK (freeze_balance BETWEEN 0 AND 3)
);
CREATE INDEX idx_habits_goal ON habits(goal_id);
CREATE INDEX idx_habits_user ON habits(user_id);
```

### 3.4 `habit_schedules`
Tách riêng để hỗ trợ **"New Repeat Plan"** (v1 — đổi lịch tương lai không phá dữ liệu quá khứ) và **Dynamic Difficulty** (Phase 2 — đổi target theo thời gian). Mỗi lần đổi lịch/target = tạo bản ghi mới với `effective_from`, đóng bản cũ bằng `effective_to`.

```sql
CREATE TABLE habit_schedules (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    habit_id       BIGINT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    schedule_type  schedule_type NOT NULL DEFAULT 'daily',
    weekdays_mask  SMALLINT NOT NULL DEFAULT 127,  -- bitmask: bit0=T2 ... bit6=CN; 127 = mọi ngày
    target_value   NUMERIC(10,2),                  -- quantity: mục tiêu (vd 2000 ml); timer: giây; checkbox: NULL
    target_unit    TEXT,                            -- 'ml','km','phút'... (quantity)
    min_percent    NUMERIC(5,2) NOT NULL DEFAULT 100,  -- Mục VI.3: %tối thiểu để tính completed
    effective_from DATE NOT NULL,
    effective_to   DATE,                            -- NULL = còn hiệu lực
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_effective CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT chk_min_percent CHECK (min_percent BETWEEN 1 AND 100)
);
CREATE INDEX idx_sched_habit ON habit_schedules(habit_id, effective_from);
```
> **"Habit đến hạn ngày D?"** = tồn tại schedule với `effective_from <= D <= COALESCE(effective_to, D)` và `weekdays_mask` bật đúng bit thứ của D. Hiện thực **Mục VI.1 (scheduled days)**.

### 3.5 `logs`
```sql
CREATE TABLE logs (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    habit_id       BIGINT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- denormalized cho auth (chống IDOR nhanh)
    logged_date    DATE   NOT NULL,          -- ngày theo timezone user (không phải UTC)
    status         log_status NOT NULL,
    value          NUMERIC(10,2),            -- quantity: lượng thực nhập
    duration_secs  INT,                      -- timer: thời gian CHẠY THỰC (không tính pause) — Mục VI.3
    completed_at   TIMESTAMPTZ,
    source         log_source NOT NULL DEFAULT 'manual',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_log_habit_date UNIQUE (habit_id, logged_date)   -- Mục VI.2: idempotency, 1 log/ngày
);
CREATE INDEX idx_logs_user_date ON logs(user_id, logged_date);
CREATE INDEX idx_logs_habit_date ON logs(habit_id, logged_date DESC);
```
> Cron cuối ngày **materialize** trạng thái cho mọi ngày đến hạn: nếu không có log `completed`/`partial` → ghi `missed` (hoặc `frozen` nếu tiêu Freeze). Nhờ vậy lịch sử đầy đủ, tái dựng streak & audit Freeze dễ.

### 3.6 `freeze_ledger`
Sổ cái minh bạch (Mục VI.4) — mọi lần cộng/trừ Freeze đều có vết.
```sql
CREATE TABLE freeze_ledger (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    habit_id       BIGINT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta          SMALLINT NOT NULL,        -- +1 earned, -1 spent
    reason         freeze_reason NOT NULL,
    related_log_id BIGINT REFERENCES logs(id) ON DELETE SET NULL,  -- ngày được cứu
    balance_after  SMALLINT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_freeze_habit ON freeze_ledger(habit_id, created_at);
```

### 3.7 `reflections`
```sql
CREATE TABLE reflections (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    goal_id         BIGINT REFERENCES goals(id) ON DELETE CASCADE,  -- NULL = reflection chung
    week_start      DATE   NOT NULL,          -- thứ 2 đầu tuần (chuẩn hóa)
    blocker_text    TEXT,                     -- "Điều gì cản trở bạn tuần qua?"
    adjustment_text TEXT,                     -- "Điều chỉnh micro-habit thế nào?"
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_reflection UNIQUE (user_id, goal_id, week_start)
);
```
> Field tự do (`blocker_text`, `adjustment_text`, `goals.title`, `habits.name`) phải **sanitize XSS** ở cả client và server (Mục VI.5).

---

## 4. Thuật toán cron đánh giá streak (chạy sau cut-off mỗi ngày, theo timezone user)

Chạy trong **transaction** cho từng habit, idempotent nhờ `last_evaluated_date`:

```
for mỗi habit đang active:
  D = ngày vừa kết thúc (theo tz user)
  nếu habit.last_evaluated_date >= D: bỏ qua  (đã xử lý — idempotent)
  nếu D KHÔNG phải scheduled day (theo habit_schedules): 
      ghi log status='not_due'; last_evaluated_date=D; continue

  log = logs[habit_id, D]
  nếu log.status in ('completed','partial-đạt-min_percent'):
      current_streak += 1
      longest_streak = max(longest, current_streak)
      last_completed_date = D
      consecutive_freeze_days = 0
      # cấp Freeze: mỗi 7 ngày streak, nếu balance < 3
      nếu current_streak % 7 == 0 và freeze_balance < 3:
          freeze_balance += 1; ghi freeze_ledger(+1, 'earned_streak')
  ngược lại (missed):
      nếu freeze_balance > 0 và consecutive_freeze_days < 2:
          freeze_balance -= 1; consecutive_freeze_days += 1
          upsert log status='frozen'; ghi freeze_ledger(-1,'spent_auto', log_id)
          # streak GIỮ NGUYÊN (không +1, không reset)
      ngược lại:
          upsert log status='missed'
          current_streak = 0; consecutive_freeze_days = 0
  last_evaluated_date = D
```

Quy tắc `partial`: chỉ với `quantity`/`timer` — `completed` nếu đạt `target_value`; `partial` (vẫn giữ chuỗi) nếu `value/target >= min_percent%`; dưới ngưỡng = `missed`.

---

## 5. Map ràng buộc nghiệp vụ → schema

| Ràng buộc (Mục VI) | Hiện thực trong schema |
|---|---|
| Định nghĩa ngày theo tz + cut-off | `users.timezone`, `users.day_cutoff`; `logs.logged_date` theo tz user |
| Chỉ đánh giá scheduled days | `habit_schedules` (weekdays_mask + effective range); cron kiểm tra trước khi set missed |
| 1 log/ngày (idempotency) | `UNIQUE(habit_id, logged_date)` |
| Backfill tối đa 1 ngày | Ràng buộc **tầng app/API** (so `logged_date` với ngày hiện tại), không phải DB |
| Completed theo loại habit | `habit_type`, `target_value`, `min_percent`, `duration_secs` (chỉ giờ chạy thực) |
| Freeze: 1/7 ngày, trần 3, ≤2 liên tiếp | `freeze_balance` + `CHECK 0..3`, `consecutive_freeze_days`, `freeze_ledger`, logic cron |
| Server là nguồn chân lý | Streak denormalized cập nhật qua cron/transaction app-side, không tin client |
| Chống IDOR | `user_id` denormalized ở `habits`/`logs`; API luôn `WHERE user_id = current_user` |
| Chống XSS | Sanitize field tự do (app-side) |
| Visual Progress "tặng 5%" | `goals.progress_baseline` tách khỏi `progress_percent` |
| New Repeat Plan / Dynamic Difficulty | `habit_schedules` versioned theo `effective_from/to` |

---

## 6. Ghi chú migration & mở rộng (Phase sau)

- **Extension cần bật:** `CREATE EXTENSION IF NOT EXISTS citext;`
- **Phase 2:** thêm `monthly_days`/`interval` vào `schedule_type`; bảng `reminders` (push/notification).
- **Phase 3:** bảng `accountability_pairs` (ghép cặp), `achievements` + `user_achievements`, và cache lịch trình AI-generated.
- **Không dùng ID tuần tự lộ ra ngoài nếu lo enumeration:** cân nhắc thêm cột `public_id UUID` cho resource công khai (chống đoán ID), nhưng khóa nội bộ giữ BIGINT cho hiệu năng.
