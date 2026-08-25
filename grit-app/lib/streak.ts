import type { Prisma, PrismaClient, HabitSchedule } from "@prisma/client";
import { DateTime } from "luxon";
import {
  fromDbDate,
  toDbDate,
  isScheduledDay,
  diffDays,
} from "./dates";

type Tx = PrismaClient | Prisma.TransactionClient;

export type CompletionStatus = "completed" | "partial" | "missed";

// Chọn schedule có hiệu lực cho một ngày (versioned theo effective_from/to).
export function resolveSchedule(
  schedules: HabitSchedule[],
  day: DateTime
): HabitSchedule | null {
  // So sánh theo chuỗi lịch YYYY-MM-DD (bỏ giờ/timezone) để tránh lệch múi giờ:
  // `day` ở tz user, còn effective_from/to đọc từ @db.Date ở UTC — cùng ngày nhưng khác instant.
  const dayISO = day.toISODate()!;
  for (const s of schedules) {
    const fromISO = fromDbDate(s.effectiveFrom).toISODate()!;
    const toISO = s.effectiveTo ? fromDbDate(s.effectiveTo).toISODate()! : null;
    if (dayISO >= fromISO && (toISO === null || dayISO <= toISO)) return s;
  }
  return null;
}

// Một schedule cụ thể có bật ngày `day` không.
export function isScheduledDayForSchedule(schedule: HabitSchedule, day: DateTime): boolean {
  return isScheduledDay(day, schedule.weekdaysMask);
}

// Ngày `day` có phải ngày đến hạn của habit không (Mục VI.1).
export function isDue(schedules: HabitSchedule[], day: DateTime): boolean {
  const s = resolveSchedule(schedules, day);
  if (!s) return false;
  return isScheduledDay(day, s.weekdaysMask);
}

// Đánh giá "hoàn thành" theo loại habit (Mục VI.3).
export function evaluateCompletion(
  type: "checkbox" | "quantity" | "timer",
  schedule: HabitSchedule,
  value: number | null,
  durationSecs: number | null
): CompletionStatus {
  if (type === "checkbox") return "completed";

  const target = schedule.targetValue ? Number(schedule.targetValue) : 0;
  const minPct = Number(schedule.minPercent);
  // timer dùng durationSecs, quantity dùng value.
  const actual = type === "timer" ? durationSecs ?? 0 : value ?? 0;
  if (target <= 0) return "completed"; // không đặt target → coi như đạt khi có log

  const pct = (actual / target) * 100;
  if (pct >= 100) return "completed";
  if (pct >= minPct) return "partial";
  return "missed";
}

// Tính lại streak bằng cách đi ngược từ uptoDay qua các ngày đến hạn.
// - completed/partial: +1
// - frozen: bỏ qua (không +1, không đứt)
// - pending (hôm nay chưa thao tác): bỏ qua
// - missed / ngày đến hạn quá khứ không có log: đứt chuỗi
export async function recomputeStreak(params: {
  tx: Tx;
  habitId: bigint;
  schedules: HabitSchedule[];
  uptoDay: DateTime;
  todayForUser: DateTime;
  previousLongest: number;
  weeklyMissAllowance?: number;
}): Promise<{ currentStreak: number; longestStreak: number; lastCompletedDate: Date | null }> {
  const { tx, habitId, schedules, uptoDay, todayForUser, previousLongest } = params;
  const allowance = params.weeklyMissAllowance ?? 0;
  const MAX_WALK = 730; // trần an toàn ~2 năm

  const windowStart = uptoDay.minus({ days: MAX_WALK });
  const rows = await tx.log.findMany({
    where: {
      habitId,
      loggedDate: { gte: toDbDate(windowStart), lte: toDbDate(uptoDay) },
    },
    select: { loggedDate: true, status: true },
  });
  const byDate = new Map<string, string>();
  for (const r of rows) byDate.set(fromDbDate(r.loggedDate).toISODate()!, r.status);

  let streak = 0;
  let lastCompleted: DateTime | null = null;
  let cursor = uptoDay;
  const missesByWeek = new Map<string, number>(); // số lần bỏ lỡ đã gặp trong mỗi tuần (đi ngược)

  for (let i = 0; i < MAX_WALK; i++) {
    if (!isDue(schedules, cursor)) {
      cursor = cursor.minus({ days: 1 });
      continue;
    }
    const key = cursor.toISODate()!;
    const st = byDate.get(key);
    const isTodayOrFuture = diffDays(cursor, todayForUser) >= 0;

    if (st === "completed" || st === "partial") {
      streak += 1;
      if (!lastCompleted) lastCompleted = cursor;
    } else if (st === "frozen") {
      // chuỗi được bảo vệ bằng Freeze — bỏ qua ngày này
    } else if (!st && isTodayOrFuture) {
      // hôm nay chưa thao tác → pending, không đứt chuỗi
    } else {
      // Ngày bỏ lỡ (missed hoặc ngày quá khứ không có log).
      // Áp "hạn mức bỏ lỡ mỗi tuần": trong cùng 1 tuần, tối đa `allowance` lần được bỏ qua.
      const wk = cursor.startOf("week").toISODate()!; // tuần bắt đầu thứ Hai (luxon)
      const n = (missesByWeek.get(wk) ?? 0) + 1;
      missesByWeek.set(wk, n);
      if (n <= allowance) {
        // trong hạn mức → dung thứ, không đứt chuỗi (không tính là ngày hoàn thành)
      } else {
        break; // vượt hạn mức tuần → đứt chuỗi
      }
    }
    cursor = cursor.minus({ days: 1 });
  }

  return {
    currentStreak: streak,
    longestStreak: Math.max(previousLongest, streak),
    lastCompletedDate: lastCompleted ? toDbDate(lastCompleted) : null,
  };
}

// Cấp Freeze khi streak vượt các mốc bội số 7 (Mục VI.4): 1 freeze / 7 ngày, trần 3.
export function freezesEarned(oldStreak: number, newStreak: number, currentBalance: number): number {
  if (newStreak <= oldStreak) return 0;
  const crossed = Math.floor(newStreak / 7) - Math.floor(oldStreak / 7);
  const capacity = 3 - currentBalance;
  return Math.max(0, Math.min(crossed, capacity));
}
