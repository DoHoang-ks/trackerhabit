// Integration test end-to-end qua HTTP. Cần server đang chạy (npm run dev) + Postgres đã migrate.
// Chạy: npm run test:integration   (hoặc BASE=http://host/api/v1 npx tsx scripts/integration.ts)
import { DateTime } from "luxon";

const BASE = process.env.BASE || "http://localhost:3000/api/v1";
const CRON_SECRET = process.env.INTERNAL_CRON_SECRET || "change-me-cron";
const TZ = "Asia/Ho_Chi_Minh";
const today = DateTime.now().setZone(TZ).toISODate()!; // ngày logic của user

let pass = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`);
  }
}

type Req = { method?: string; token?: string; body?: unknown; headers?: Record<string, string> };
async function api(path: string, opts: Req = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* 204 no content */
  }
  return { status: res.status, json };
}

async function main() {
  console.log(`BASE=${BASE}  today(${TZ})=${today}\n`);
  const email = `it_${Date.now()}@grit.test`;
  const password = "test1234";

  console.log("Health");
  let h = await api("/health");
  check("health 200 + db up", h.status === 200 && h.json?.db === "up", h.json);

  console.log("Auth");
  let r = await api("/auth/register", { method: "POST", body: { email, password, timezone: TZ } });
  check("register 201", r.status === 201, r.json);
  const token: string = r.json?.access_token;
  check("có access_token", !!token);
  const refresh: string = r.json?.refresh_token;

  r = await api("/auth/login", { method: "POST", body: { email, password } });
  check("login 200", r.status === 200, r.json);

  r = await api("/auth/login", { method: "POST", body: { email, password: "wrong" } });
  check("login sai mật khẩu 401", r.status === 401);

  r = await api("/auth/refresh", { method: "POST", body: { refresh_token: refresh } });
  check("refresh 200 + access mới", r.status === 200 && !!r.json?.access_token);

  r = await api("/users/me", { token });
  check("me 200 tz đúng", r.status === 200 && r.json?.timezone === TZ, r.json);

  r = await api("/users/me"); // không token
  check("me không token → 401", r.status === 401);

  console.log("\nGoal + Habit");
  r = await api("/goals", { method: "POST", token, body: { title: "Chạy 5km" } });
  check("tạo goal 201", r.status === 201, r.json);
  const goalId = r.json?.id;

  r = await api("/habits", {
    method: "POST",
    token,
    body: {
      goal_id: goalId,
      name: "Đi bộ 5 phút",
      type: "checkbox",
      is_focus: true,
      schedule: { schedule_type: "daily", weekdays_mask: 127, effective_from: today },
    },
  });
  check("tạo habit checkbox 201", r.status === 201, r.json);
  const habitId = r.json?.id;

  // Validation: checkbox không được có target_value
  r = await api("/habits", {
    method: "POST",
    token,
    body: {
      goal_id: goalId,
      name: "sai",
      type: "checkbox",
      schedule: { schedule_type: "daily", weekdays_mask: 127, effective_from: today, target_value: 5 },
    },
  });
  check("checkbox + target_value → 422", r.status === 422, r.json);

  console.log("\nCheck-in (lõi)");
  r = await api(`/habits/${habitId}/logs`, { method: "POST", token, body: { logged_date: today } });
  check("check-in hôm nay 200", r.status === 200, r.json);
  check("status completed", r.json?.log?.status === "completed", r.json?.log);
  check("current_streak = 1", r.json?.streak?.current_streak === 1, r.json?.streak);

  // Idempotency: check-in lại cùng ngày vẫn = 1
  r = await api(`/habits/${habitId}/logs`, { method: "POST", token, body: { logged_date: today } });
  check("check-in lại idempotent, vẫn 1", r.json?.streak?.current_streak === 1, r.json?.streak);

  // Backfill quá xa → 422
  const farPast = DateTime.now().setZone(TZ).minus({ days: 10 }).toISODate();
  r = await api(`/habits/${habitId}/logs`, { method: "POST", token, body: { logged_date: farPast } });
  check("backfill 10 ngày trước → 422", r.status === 422, r.json?.error?.code);

  // Tương lai → 422
  const future = DateTime.now().setZone(TZ).plus({ days: 1 }).toISODate();
  r = await api(`/habits/${habitId}/logs`, { method: "POST", token, body: { logged_date: future } });
  check("check-in tương lai → 422", r.status === 422, r.json?.error?.code);

  console.log("\nDashboard");
  r = await api(`/dashboard/focus?date=${today}`, { token });
  check("focus 200", r.status === 200, r.json);
  check("focus.today_status completed", r.json?.focus?.today_status === "completed", r.json?.focus);
  check("focus.current_streak = 1", r.json?.focus?.current_streak === 1);

  r = await api("/stats/overview?days=30", { token });
  check("overview 200 gộp habit", r.status === 200 && r.json?.active_habits >= 1 && Array.isArray(r.json?.days), r.json);
  check("overview this_week_done >= 1", (r.json?.this_week_done ?? 0) >= 1, r.json?.this_week_done);

  console.log("\nUndo");
  r = await api(`/habits/${habitId}/logs/${today}`, { method: "DELETE", token });
  check("undo 200", r.status === 200, r.json);
  check("streak về 0", r.json?.streak?.current_streak === 0, r.json?.streak);

  // check-in lại
  r = await api(`/habits/${habitId}/logs`, { method: "POST", token, body: { logged_date: today } });
  check("check-in lại → 1", r.json?.streak?.current_streak === 1);

  console.log("\nQuản lý habit + Reflection");
  // tạo habit thứ 2 (quantity) dưới cùng goal
  r = await api("/habits", {
    method: "POST", token,
    body: {
      goal_id: goalId, name: "Uống nước", type: "quantity", is_focus: false,
      schedule: { schedule_type: "daily", weekdays_mask: 127, effective_from: today, target_value: 2000, target_unit: "ml", min_percent: 80 },
    },
  });
  check("tạo habit#2 quantity 201", r.status === 201, r.json);
  const habit2Id = r.json?.id;

  r = await api("/dashboard/today", { token });
  check("today có 2 habit", (r.json?.items?.length ?? 0) === 2, r.json?.items?.length);

  r = await api(`/habits/${habitId}`, { token });
  check("habit#1 detail is_focus=true", r.json?.is_focus === true, r.json);

  // đặt habit#2 làm focus → habit#1 phải bị bỏ focus
  r = await api(`/habits/${habit2Id}`, { method: "PATCH", token, body: { is_focus: true } });
  check("PATCH set focus habit#2 → 200", r.status === 200);
  r = await api(`/habits/${habitId}`, { token });
  check("habit#1 is_focus bị gỡ về false", r.json?.is_focus === false, r.json?.is_focus);

  // reflection upsert (không gắn goal → goalId null)
  const wk = DateTime.now().setZone(TZ).startOf("week").toISODate();
  r = await api("/reflections", { method: "POST", token, body: { week_start: wk, blocker_text: "Bận", adjustment_text: "Sáng sớm" } });
  check("reflection tạo 201", r.status === 201, r.json);
  r = await api("/reflections", { method: "POST", token, body: { week_start: wk, blocker_text: "Bận hơn", adjustment_text: "Sáng sớm" } });
  check("reflection upsert 200 (không trùng)", r.status === 200, r.json);
  r = await api(`/reflections?week_start=${wk}`, { token });
  check("GET reflection 1 row + text mới", (r.json?.data?.length === 1) && r.json.data[0].blockerText === "Bận hơn", r.json?.data);

  // xóa habit#2 (archive)
  r = await api(`/habits/${habit2Id}`, { method: "DELETE", token });
  check("DELETE habit#2 → 204", r.status === 204);
  r = await api("/dashboard/today", { token });
  check("today còn 1 habit sau xóa", (r.json?.items?.length ?? 0) === 1, r.json?.items?.length);

  console.log("\nIDOR");
  const email2 = `it2_${Date.now()}@grit.test`;
  r = await api("/auth/register", { method: "POST", body: { email: email2, password, timezone: TZ } });
  const token2 = r.json?.access_token;
  r = await api(`/habits/${habitId}`, { token: token2 }); // user2 xem habit user1 (route detail chưa có → dùng logs)
  r = await api(`/habits/${habitId}/logs`, { method: "POST", token: token2, body: { logged_date: today } });
  check("user2 check-in habit user1 → 404 (IDOR chặn)", r.status === 404, r.json);

  console.log("\nCron end-of-day");
  r = await api("/internal/evaluate", { method: "POST", headers: { "x-cron-secret": "sai" } });
  check("cron sai secret → 403", r.status === 403);
  r = await api("/internal/evaluate", { method: "POST", headers: { "x-cron-secret": CRON_SECRET } });
  check("cron đúng secret → 200", r.status === 200, r.json);

  console.log(`\nKết quả: ${pass} pass, ${failed} fail`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Lỗi chạy integration (server có đang chạy không?):", e.message);
  process.exit(1);
});
