// Smoke test cho logic lõi (không cần DB). Chạy: npx tsx scripts/smoke.ts
import { DateTime } from "luxon";
import { toDbDate, isScheduledDay, diffDays, weekdayBit } from "../lib/dates";
import {
  evaluateCompletion,
  freezesEarned,
  recomputeStreak,
  resolveSchedule,
  isDue,
} from "../lib/streak";

let pass = 0;
let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const D = (s: string) => DateTime.fromISO(s, { zone: "utc" }).startOf("day");

// Schedule mẫu: daily, hiệu lực từ lâu.
function dailySchedule(overrides: Partial<any> = {}): any {
  return {
    id: 1n,
    habitId: 1n,
    scheduleType: "daily",
    weekdaysMask: 127,
    targetValue: null,
    targetUnit: null,
    minPercent: 100,
    effectiveFrom: toDbDate(D("2026-01-01")),
    effectiveTo: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// mock tx trả về logs cố định
function mockTx(rows: Array<{ day: string; status: string }>) {
  const logs = rows.map((r) => ({ loggedDate: toDbDate(D(r.day)), status: r.status }));
  return { log: { findMany: async () => logs } } as any;
}

async function main() {
  console.log("dates.ts");
  eq("weekdayBit(Mon)", weekdayBit(D("2026-08-24")), 1); // 24/8/2026 là thứ Hai
  eq("isScheduledDay Mon in 127", isScheduledDay(D("2026-08-24"), 127), true);
  eq("isScheduledDay Tue in mask 1(Mon only)", isScheduledDay(D("2026-08-25"), 1), false);
  eq("diffDays 24-22", diffDays(D("2026-08-24"), D("2026-08-22")), 2);

  console.log("evaluateCompletion");
  eq("checkbox", evaluateCompletion("checkbox", dailySchedule(), null, null), "completed");
  eq(
    "timer 300/300",
    evaluateCompletion("timer", dailySchedule({ targetValue: 300, minPercent: 100 }), null, 300),
    "completed"
  );
  eq(
    "timer 150/300 min100 -> missed",
    evaluateCompletion("timer", dailySchedule({ targetValue: 300, minPercent: 100 }), null, 150),
    "missed"
  );
  eq(
    "quantity 1600/2000 min80 -> partial",
    evaluateCompletion("quantity", dailySchedule({ targetValue: 2000, minPercent: 80 }), 1600, null),
    "partial"
  );
  eq(
    "quantity 1000/2000 min80 -> missed",
    evaluateCompletion("quantity", dailySchedule({ targetValue: 2000, minPercent: 80 }), 1000, null),
    "missed"
  );

  console.log("freezesEarned");
  eq("6->7 bal0", freezesEarned(6, 7, 0), 1);
  eq("7->7", freezesEarned(7, 7, 3), 0);
  eq("13->14 bal3 (đầy)", freezesEarned(13, 14, 3), 0);
  eq("0->21 bal0 (trần 3)", freezesEarned(0, 21, 0), 3);

  console.log("resolveSchedule / isDue");
  const scheds = [dailySchedule({ weekdaysMask: 1 })]; // chỉ thứ Hai
  eq("isDue Mon", isDue(scheds, D("2026-08-24")), true);
  eq("isDue Tue", isDue(scheds, D("2026-08-25")), false);
  eq("resolveSchedule found", resolveSchedule(scheds, D("2026-08-24")) !== null, true);

  console.log("recomputeStreak");
  const sched = [dailySchedule()];
  const today = D("2026-08-24");

  // A) 2 ngày completed + hôm nay pending → streak 2 (pending không đứt)
  let r = await recomputeStreak({
    tx: mockTx([
      { day: "2026-08-22", status: "completed" },
      { day: "2026-08-23", status: "completed" },
    ]),
    habitId: 1n,
    schedules: sched,
    uptoDay: today,
    todayForUser: today,
    previousLongest: 5,
  });
  eq("A current=2", r.currentStreak, 2);
  eq("A longest giữ 5", r.longestStreak, 5);

  // B) hôm nay completed → streak 3
  r = await recomputeStreak({
    tx: mockTx([
      { day: "2026-08-22", status: "completed" },
      { day: "2026-08-23", status: "completed" },
      { day: "2026-08-24", status: "completed" },
    ]),
    habitId: 1n,
    schedules: sched,
    uptoDay: today,
    todayForUser: today,
    previousLongest: 2,
  });
  eq("B current=3", r.currentStreak, 3);
  eq("B longest=3", r.longestStreak, 3);

  // C) missed ở giữa → đứt tại đó
  r = await recomputeStreak({
    tx: mockTx([
      { day: "2026-08-20", status: "completed" },
      { day: "2026-08-21", status: "missed" },
      { day: "2026-08-22", status: "completed" },
      { day: "2026-08-23", status: "completed" },
    ]),
    habitId: 1n,
    schedules: sched,
    uptoDay: today,
    todayForUser: today,
    previousLongest: 0,
  });
  eq("C current=2 (đứt tại 21)", r.currentStreak, 2);

  // D) frozen xen giữa → không đứt
  r = await recomputeStreak({
    tx: mockTx([
      { day: "2026-08-21", status: "completed" },
      { day: "2026-08-22", status: "frozen" },
      { day: "2026-08-23", status: "completed" },
    ]),
    habitId: 1n,
    schedules: sched,
    uptoDay: today,
    todayForUser: today,
    previousLongest: 0,
  });
  eq("D current=2 (freeze giữ chuỗi)", r.currentStreak, 2);

  console.log("recomputeStreak — hạn mức bỏ lỡ mỗi tuần");
  const sun = D("2026-08-30"); // Chủ Nhật, cùng tuần ISO với 24–30/8
  // E1: allowance 1, tuần có 1 miss → vẫn giữ chuỗi (chỉ đếm ngày completed)
  r = await recomputeStreak({
    tx: mockTx([
      { day: "2026-08-24", status: "completed" }, { day: "2026-08-25", status: "completed" },
      { day: "2026-08-26", status: "completed" }, { day: "2026-08-27", status: "missed" },
      { day: "2026-08-28", status: "completed" }, { day: "2026-08-29", status: "completed" },
      { day: "2026-08-30", status: "completed" },
    ]),
    habitId: 1n, schedules: sched, uptoDay: sun, todayForUser: sun, previousLongest: 0, weeklyMissAllowance: 1,
  });
  eq("E1 allowance=1, 1 miss/tuần → streak 6", r.currentStreak, 6);
  // E2: allowance 1, tuần có 2 miss → đứt tại lần bỏ lỡ thứ 2
  r = await recomputeStreak({
    tx: mockTx([
      { day: "2026-08-28", status: "completed" }, { day: "2026-08-29", status: "completed" }, { day: "2026-08-30", status: "completed" },
      { day: "2026-08-27", status: "missed" }, { day: "2026-08-26", status: "missed" },
    ]),
    habitId: 1n, schedules: sched, uptoDay: sun, todayForUser: sun, previousLongest: 0, weeklyMissAllowance: 1,
  });
  eq("E2 allowance=1, 2 miss/tuần → streak 3 (đứt)", r.currentStreak, 3);

  console.log(`\nKết quả: ${pass} pass, ${failed} fail`);
  if (failed > 0) process.exit(1);
}

main();
