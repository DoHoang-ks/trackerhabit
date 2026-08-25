# Grit Tracker — MVP Backend (Next.js + Prisma + PostgreSQL)

Scaffold API cho MVP, hiện thực trực tiếp `grit-tracker-schema.md` và `grit-tracker-api.md`.
Trọng tâm: **auth** + **check-in lõi** (tính streak/freeze server-authoritative).

## Yêu cầu
- Node.js ≥ 18, npm
- PostgreSQL (hoặc Docker)

## Chạy nhanh — KHÔNG cần Docker (khuyến nghị cho máy dev)
Dùng Postgres nhúng (`embedded-postgres`, binary trong `node_modules`, không đụng hệ thống).
```bash
cd grit-app
cp .env.example .env            # DATABASE_URL đã trỏ localhost:5432 khớp db:local
npm install
npm run db:local                # Terminal 1: dựng Postgres local (giữ chạy, Ctrl+C để dừng)
# Terminal 2:
npm run prisma:migrate -- --name init   # hoặc: npx prisma db push
npm run seed                    # (tuỳ chọn) demo@grit.app / demo1234
npm run dev                     # http://localhost:3000
npm run test:integration        # kiểm luồng end-to-end
```

**Hoặc một lệnh duy nhất (tự dựng DB tạm → server → integration → dọn sạch):**
```bash
npm run test:e2e                # đã verify: 25/25 pass, không cần Docker
```

## Chạy với Docker (thay thế)
```bash
docker compose up -d
npm install && npm run prisma:migrate -- --name init && npm run dev
```

## Cấu trúc
```
lib/
  prisma.ts     Prisma singleton
  http.ts       response helper + mã lỗi + serialize BigInt/Decimal
  auth.ts       hash mật khẩu, JWT access/refresh, requireUser (IDOR gate)
  dates.ts      "ngày" theo timezone + cut-off, scheduled-day, backfill
  streak.ts     resolve schedule, đánh giá completed/partial/missed, tính lại streak, cấp Freeze
  cron.ts       đánh giá cuối ngày: materialize missed/frozen + tự tiêu Freeze
app/api/v1/
  auth/{register,login,refresh}     đăng ký / đăng nhập / làm mới token
  users/me                          GET/PATCH hồ sơ (timezone, cut-off)
  goals                             GET danh sách / POST tạo
  habits                            GET danh sách / POST tạo (kèm schedule khởi tạo)
  habits/[id]/logs                  ⭐ POST check-in (upsert idempotent) / GET lịch sử
  habits/[id]/logs/[date]           DELETE undo trong ngày
  dashboard/focus                   card ưu tiên hôm nay (Focus Dashboard)
  internal/evaluate                 cron end-of-day (bảo vệ x-cron-secret)
```

## Ràng buộc nghiệp vụ đã cài (map Mục VI)
| Ràng buộc | Nơi cài |
|---|---|
| "Ngày" theo timezone + cut-off | `lib/dates.ts` (`userToday`, `parseUserDate`) |
| Chỉ đánh giá scheduled days | `lib/streak.ts` `isDue`; check-in trả `NOT_SCHEDULED_DAY` |
| 1 log/ngày (idempotency) | `@@unique([habitId, loggedDate])` + `upsert` |
| Backfill tối đa 1 ngày | check-in kiểm `diffDays` → `BACKFILL_WINDOW_EXCEEDED` |
| Completed theo loại | `evaluateCompletion` (checkbox/quantity/timer + min_percent) |
| Freeze 1/7 ngày, trần 3, ≤2 liên tiếp | `freezesEarned` (cấp) + `cron.ts` (tiêu tự động) |
| Server là nguồn chân lý | streak chỉ đổi ở POST/DELETE logs + cron, không endpoint set trực tiếp |
| Chống IDOR | `requireUser` + mọi query gắn `userId` |

## Cron end-of-day
Chạy sau mốc cut-off mỗi ngày (vd crontab của VPS):
```bash
curl -X POST http://localhost:3000/api/v1/internal/evaluate \
  -H "x-cron-secret: $INTERNAL_CRON_SECRET"
```

## Kiểm thử

**Logic lõi (không cần DB):**
```bash
npm run typecheck        # tsc --noEmit
npm test                 # scripts/smoke.ts — 22 test streak/freeze/dates (mock tx)
```

**Integration end-to-end (cần Postgres + server chạy):**
```bash
# Terminal 1
docker compose up -d
npm run prisma:migrate -- --name init
npm run dev
# Terminal 2
npm run test:integration   # đăng ký → goal → habit → check-in → dashboard → undo → IDOR → cron
```
`test:integration` tự tạo user ngẫu nhiên, assert từng bước, exit code ≠ 0 nếu có test fail.
Đổi target: `BASE=https://grit.example.com/api/v1 npm run test:integration`.

## Thử check-in nhanh
```bash
# 1) đăng nhập lấy token
TOKEN=$(curl -s localhost:3000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"demo@grit.app","password":"demo1234"}' | jq -r .access_token)

# 2) check-in habit hôm nay (thay <id> bằng habitId từ seed)
curl -s -X POST localhost:3000/api/v1/habits/<id>/logs \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"logged_date\":\"$(date +%F)\",\"duration_secs\":300}" | jq
```

## Chưa cài (Phase sau — có chỗ móc sẵn)
- Reflections API, dashboard/today, goals/habits detail & PATCH/DELETE
- Reminders/push, AI goal breakdown, accountability
- Rate-limit `/auth/*` (nên thêm middleware trước production)
