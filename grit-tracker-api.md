# Grit Tracker — API Contract (REST v1)

Hợp đồng API bám sát `grit-tracker-schema.md`. Mọi endpoint tài nguyên **luôn scope theo `current_user`** (chống IDOR ở tầng server — Mục VI.5). Client không bao giờ được tin để tính streak.

---

## 0. Quy ước chung

- **Base URL:** `/api/v1`
- **Định dạng:** JSON (UTF-8). `Content-Type: application/json`.
- **Xác thực:** `Authorization: Bearer <access_token>` (JWT ngắn hạn) + refresh token (httpOnly cookie hoặc body).
- **Ngày/giờ:** date = `YYYY-MM-DD` (theo timezone user); timestamp = ISO-8601 UTC (`2026-08-24T09:00:00Z`).
- **Phân trang:** `?limit=20&cursor=<opaque>` → response có `next_cursor` (null nếu hết).
- **Định dạng lỗi thống nhất:**
```json
{ "error": { "code": "FORBIDDEN", "message": "You do not own this resource." } }
```
- **HTTP codes:** 200 OK, 201 Created, 204 No Content, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 409 Conflict, 422 Unprocessable (validation), 429 Rate limited.

### Bảng mã lỗi nghiệp vụ
| code | HTTP | Ý nghĩa |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Thiếu/invalid token |
| `FORBIDDEN` | 403 | Không sở hữu resource (IDOR guard) |
| `NOT_FOUND` | 404 | Không tồn tại (hoặc không thuộc user) |
| `VALIDATION_ERROR` | 422 | Body sai schema; kèm `fields[]` |
| `BACKFILL_WINDOW_EXCEEDED` | 422 | Check-in ngoài cửa sổ cho phép (Mục VI.2) |
| `NOT_SCHEDULED_DAY` | 422 | Ngày không nằm trong lịch habit (Mục VI.1) |
| `LOG_LOCKED` | 409 | Ngày đã qua cut-off, không sửa được |
| `DUPLICATE_REFLECTION` | 409 | Đã có reflection cho tuần đó |

> **Lưu ý IDOR:** với resource không tồn tại HOẶC không thuộc user, trả **`404 NOT_FOUND`** (không lộ sự tồn tại). Chỉ dùng `403` khi hữu ích cho UX nội bộ.

---

## 1. Auth & User

### POST `/auth/register`
Req: `{ "email", "password", "display_name?", "timezone?" }`
Res `201`: `{ "user": {...}, "access_token", "refresh_token" }`

### POST `/auth/login`
Req: `{ "email", "password" }` → Res `200`: `{ "access_token", "refresh_token" }`

### POST `/auth/refresh`
Req: `{ "refresh_token" }` → Res `200`: `{ "access_token" }`

### POST `/auth/logout` → `204` (thu hồi refresh token)

### GET `/users/me` → `200`
```json
{ "id": 1, "email": "a@b.com", "display_name": "Long",
  "timezone": "Asia/Ho_Chi_Minh", "day_cutoff": "00:00" }
```

### PATCH `/users/me`
Req (partial): `{ "display_name?", "timezone?", "day_cutoff?" }` → `200` user đã cập nhật.
> Đổi `timezone`/`day_cutoff` **không** hồi tố streak quá khứ; chỉ áp dụng cho lần cron kế tiếp.

---

## 2. Goals

### GET `/goals?status=active&limit=20&cursor=`
Res `200`:
```json
{ "data": [
    { "id": 10, "title": "Chạy 5km", "status": "active",
      "progress_baseline": 5.0, "progress_percent": 22.5,
      "progress_display": 27.5, "habit_count": 3, "start_date": "2026-08-01",
      "target_date": "2026-11-01" }
  ], "next_cursor": null }
```

### POST `/goals`
Req: `{ "title", "description?", "start_date?", "target_date?", "progress_baseline?": 5.0 }`
Res `201`: goal object.

### GET `/goals/:id` → `200` (goal + danh sách habits tóm tắt). `404` nếu không thuộc user.

### PATCH `/goals/:id`
Req (partial): `{ "title?", "description?", "status?", "target_date?", "progress_percent?" }` → `200`.

### DELETE `/goals/:id`
Mặc định **archive** (`status=archived`, giữ history). `?hard=true` mới xóa cứng (cascade). → `204`.

---

## 3. Habits

### GET `/habits?goal_id=10&include_archived=false` → `200`
Mỗi habit kèm **schedule hiện hành** + snapshot streak:
```json
{ "data": [
  { "id": 100, "goal_id": 10, "name": "Đi bộ 5 phút", "type": "timer",
    "is_focus": true,
    "current_streak": 14, "longest_streak": 21,
    "freeze_balance": 2, "last_completed_date": "2026-08-23",
    "current_schedule": {
      "schedule_type": "weekly_days", "weekdays_mask": 42,
      "target_value": 300, "target_unit": "giây", "min_percent": 100,
      "effective_from": "2026-08-01", "effective_to": null }
  } ] }
```
> `weekdays_mask` bit0=T2…bit6=CN (42 = `0101010` = T3,T5,CN... — client tự decode).

### POST `/habits`
Tạo habit + schedule khởi tạo trong 1 request:
```json
{ "goal_id": 10, "name": "Uống 2L nước", "type": "quantity", "is_focus": false,
  "schedule": { "schedule_type": "daily", "weekdays_mask": 127,
                "target_value": 2000, "target_unit": "ml",
                "min_percent": 80, "effective_from": "2026-08-24" } }
```
Res `201`: habit object (streak = 0). `422 VALIDATION_ERROR` nếu type=checkbox mà gửi target_value, v.v.

### GET `/habits/:id` → `200` (detail + current_schedule). `404` nếu không thuộc user.

### PATCH `/habits/:id`
Chỉ metadata: `{ "name?", "is_focus?", "goal_id?" }`. Đổi lịch/target **KHÔNG** ở đây → dùng §4. → `200`.

### DELETE `/habits/:id` → archive mặc định (`archived_at`), `?hard=true` xóa cứng. `204`.

---

## 4. Schedules (New Repeat Plan / Dynamic Difficulty)

### GET `/habits/:id/schedules` → `200` toàn bộ lịch sử schedule (versioned).

### POST `/habits/:id/schedules`
Đổi lịch/target từ một ngày tương lai — **không phá history**:
```json
{ "schedule_type": "weekly_days", "weekdays_mask": 42,
  "target_value": 600, "target_unit": "giây", "min_percent": 100,
  "effective_from": "2026-09-01" }
```
Hành vi server (transaction): đặt `effective_to = effective_from - 1 ngày` cho schedule đang mở, rồi insert schedule mới.
Res `201`: schedule mới. `422` nếu `effective_from` <= ngày của schedule hiện hành.

---

## 5. Logs / Check-in  ⭐ (lõi hệ thống)

### POST `/habits/:id/logs` — check-in (upsert idempotent)
```json
{ "logged_date": "2026-08-24", "value": 1800, "duration_secs": 1800 }
```
- `value`/`duration_secs` chỉ áp dụng cho quantity/timer; checkbox bỏ trống = completed.
- **Ràng buộc server thực thi:**
  - `BACKFILL_WINDOW_EXCEEDED` nếu `logged_date` không phải hôm nay hoặc hôm qua (trước cut-off) — Mục VI.2.
  - `NOT_SCHEDULED_DAY` nếu ngày đó habit không đến hạn — Mục VI.1.
  - Idempotent qua `UNIQUE(habit_id, logged_date)`: gọi lại = update, không tạo bản mới.
  - Tính `status`: đạt `target` → `completed`; `>= min_percent%` → `partial`; dưới ngưỡng → `missed`.
- **Server tính lại streak** ngay trong transaction và trả snapshot mới:
```json
{ "log": { "id": 555, "habit_id": 100, "logged_date": "2026-08-24",
           "status": "completed", "value": 1800, "source": "manual" },
  "streak": { "current_streak": 15, "longest_streak": 21,
              "freeze_balance": 2, "earned_freeze": false } }
```

### DELETE `/habits/:id/logs/:date` — Undo trong ngày
Cho phép đảo về "chưa hoàn thành" **nếu chưa qua cut-off**. Server tính lại streak.
Res `200`: `{ "streak": {...} }`. `409 LOG_LOCKED` nếu ngày đã khóa.

### GET `/habits/:id/logs?from=2026-08-01&to=2026-08-24` → `200`
Lịch sử (gồm cả `missed`/`frozen`/`not_due` do cron materialize) — phục vụ heatmap/biểu đồ.

---

## 6. Freeze

### GET `/habits/:id/freeze` → `200`
```json
{ "freeze_balance": 2, "consecutive_freeze_days": 0,
  "ledger": [
    { "delta": 1, "reason": "earned_streak", "balance_after": 2, "created_at": "..." },
    { "delta": -1, "reason": "spent_auto", "related_log_id": 540, "balance_after": 1, "created_at": "..." }
  ] }
```
> MVP: Freeze **chỉ tự động** (cron cấp/tiêu — Mục VI.4). Không có endpoint mua/tiêu thủ công. Vacation Mode (cấp lô Freeze) để Phase 2.

---

## 7. Dashboard

### GET `/dashboard/focus?date=2026-08-24` → `200`
Trả **card ưu tiên hôm nay** (habit `is_focus=true` đến hạn) — hiện thực "Focus Dashboard 1 card/ngày":
```json
{ "date": "2026-08-24",
  "focus": { "habit_id": 100, "name": "Đi bộ 5 phút", "type": "timer",
             "target_value": 300, "target_unit": "giây",
             "today_status": "pending", "current_streak": 14 },
  "has_more": true }
```
`today_status` ∈ `pending|completed|partial|frozen|not_due`.

### GET `/dashboard/today?date=2026-08-24` → `200`
Màn "All Habits": tất cả habit đến hạn hôm nay + trạng thái, phục vụ view đầy đủ.

---

## 8. Reflections (Phase 2)

### GET `/reflections?week_start=2026-08-18` → `200` list.

### POST `/reflections` (upsert theo `UNIQUE(user_id, goal_id, week_start)`)
```json
{ "goal_id": 10, "week_start": "2026-08-18",
  "blocker_text": "Bận công việc tối", "adjustment_text": "Giảm còn 3 phút" }
```
Res `201`/`200`. `409 DUPLICATE_REFLECTION` nếu tạo trùng (dùng PUT/PATCH để sửa).
> Sanitize XSS server-side cho `blocker_text`/`adjustment_text` (Mục VI.5).

---

## 9. Nguyên tắc thực thi xuyên suốt (checklist cho dev)

1. **IDOR:** mọi query gắn `WHERE user_id = :current_user`; không tồn tại/không thuộc user → `404`.
2. **Streak là server-authoritative:** chỉ `POST /logs`, `DELETE /logs/:date`, và cron được sửa streak. Không endpoint nào cho client set `current_streak` trực tiếp.
3. **Idempotency:** check-in dựa `UNIQUE(habit_id, logged_date)`; retry an toàn.
4. **Validation theo `habit_type`:** checkbox không nhận value; quantity/timer bắt buộc value/duration.
5. **Rate limit** `/auth/*` (chống brute force) và `/logs` (chống spam).
6. **Sanitize** mọi field tự do trước khi lưu.
