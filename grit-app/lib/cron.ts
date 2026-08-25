import type { Prisma, PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "./prisma";
import { userToday, fromDbDate, toDbDate, diffDays } from "./dates";
import { isDue, recomputeStreak } from "./streak";

type Tx = Prisma.TransactionClient;

// Đánh giá cuối ngày cho 1 habit: materialize missed/frozen cho ngày đến hạn user không thao tác,
// tự tiêu Freeze theo Mục VI.4 (trần liên tiếp 2 ngày), rồi tính lại streak.
async function evaluateHabit(
  tx: Tx,
  habit: any,
  timezone: string,
  dayCutoff: string
): Promise<{ evaluated: number }> {
  const today = userToday(timezone, dayCutoff);
  const endDay = today.minus({ days: 1 }); // ngày vừa kết thúc

  // Bắt đầu từ ngày sau lần đánh giá gần nhất; nếu chưa từng đánh giá, chỉ xử lý endDay.
  const startDay = habit.lastEvaluatedDate
    ? fromDbDate(habit.lastEvaluatedDate).plus({ days: 1 })
    : endDay;

  if (diffDays(endDay, startDay) < 0) return { evaluated: 0 };

  const existing = await tx.log.findMany({
    where: {
      habitId: habit.id,
      loggedDate: { gte: toDbDate(startDay), lte: toDbDate(endDay) },
    },
    select: { loggedDate: true, status: true },
  });
  const byDate = new Map<string, string>();
  for (const r of existing) byDate.set(fromDbDate(r.loggedDate).toISODate()!, r.status);

  // Hạn mức bỏ lỡ mỗi tuần: nạp trước số 'missed' đã có trong các tuần liên quan
  // (kể cả ngày trước startDay đã xử lý ở lần cron trước) để đếm xuyên suốt tuần.
  const allowance = habit.weeklyMissAllowance ?? 0;
  const missWeek = new Map<string, number>();
  if (allowance > 0) {
    const priorMissed = await tx.log.findMany({
      where: { habitId: habit.id, status: "missed", loggedDate: { gte: toDbDate(startDay.startOf("week")), lte: toDbDate(endDay) } },
      select: { loggedDate: true },
    });
    for (const r of priorMissed) {
      const wk = fromDbDate(r.loggedDate).startOf("week").toISODate()!;
      missWeek.set(wk, (missWeek.get(wk) ?? 0) + 1);
    }
  }

  const upsertStatus = (cursor: DateTime, status: "missed" | "frozen") =>
    tx.log.upsert({
      where: { habitId_loggedDate: { habitId: habit.id, loggedDate: toDbDate(cursor) } },
      create: { habitId: habit.id, userId: habit.userId, loggedDate: toDbDate(cursor), status, source: "auto" },
      update: { status, source: "auto" },
    });

  let balance = habit.freezeBalance;
  let consec = habit.consecutiveFreezeDays;
  let evaluated = 0;

  let cursor = startDay;
  const MAX = 400;
  for (let i = 0; i < MAX && diffDays(endDay, cursor) >= 0; i++, cursor = cursor.plus({ days: 1 })) {
    if (!isDue(habit.schedules, cursor)) continue;
    const key = cursor.toISODate()!;
    const st = byDate.get(key);

    if (st === "completed" || st === "partial") {
      consec = 0;
      continue;
    }
    if (st === "frozen") continue; // đã xử lý trước đó

    // Ngày đến hạn bị bỏ lỡ.
    evaluated++;
    const wk = cursor.startOf("week").toISODate()!;
    const usedThisWeek = missWeek.get(wk) ?? 0;

    if (usedThisWeek < allowance) {
      // Trong hạn mức bỏ lỡ của tuần → ghi 'missed' nhưng KHÔNG đứt chuỗi, KHÔNG tiêu Freeze.
      await upsertStatus(cursor, "missed");
      missWeek.set(wk, usedThisWeek + 1);
      consec = 0;
    } else if (balance > 0 && consec < 2) {
      // Vượt hạn mức tuần → tiêu 1 Freeze để cứu.
      balance -= 1;
      consec += 1;
      const log = await upsertStatus(cursor, "frozen");
      await tx.freezeLedger.create({
        data: { habitId: habit.id, userId: habit.userId, delta: -1, reason: "spent_auto", relatedLogId: log.id, balanceAfter: balance },
      });
    } else {
      // Hết hạn mức lẫn Freeze → 'missed' thật, chuỗi sẽ đứt.
      await upsertStatus(cursor, "missed");
      missWeek.set(wk, usedThisWeek + 1);
      consec = 0;
    }
  }

  const recomputed = await recomputeStreak({
    tx,
    habitId: habit.id,
    schedules: habit.schedules,
    uptoDay: today,
    todayForUser: today,
    previousLongest: habit.longestStreak,
    weeklyMissAllowance: allowance,
  });

  await tx.habit.update({
    where: { id: habit.id },
    data: {
      currentStreak: recomputed.currentStreak,
      longestStreak: recomputed.longestStreak,
      lastCompletedDate: recomputed.lastCompletedDate,
      freezeBalance: balance,
      consecutiveFreezeDays: consec,
      lastEvaluatedDate: toDbDate(endDay),
    },
  });

  return { evaluated };
}

// Chạy đánh giá cho toàn bộ habit đang active. Gọi bởi cron daily.
export async function runEndOfDayEvaluation(): Promise<{ habits: number; days: number }> {
  const habits = await prisma.habit.findMany({
    where: { archivedAt: null },
    include: {
      schedules: { orderBy: { effectiveFrom: "desc" } },
      user: { select: { timezone: true, dayCutoff: true } },
    },
  });

  let totalDays = 0;
  for (const habit of habits) {
    const res = await prisma.$transaction((tx) =>
      evaluateHabit(tx as unknown as Tx, habit, habit.user.timezone, habit.user.dayCutoff)
    );
    totalDays += res.evaluated;
  }
  return { habits: habits.length, days: totalDays };
}
