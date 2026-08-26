import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, created, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { userToday, parseUserDate, toDbDate, diffDays } from "@/lib/dates";
import {
  resolveSchedule,
  isScheduledDayForSchedule,
  evaluateCompletion,
  recomputeStreak,
  freezesEarned,
} from "@/lib/streak";

// GET /habits/:id/logs?from=&to=  — lịch sử (heatmap/biểu đồ)
export const GET = handler(async (req, ctx: { params: { id: string } }) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const habit = await prisma.habit.findFirst({
    where: { id: BigInt(ctx.params.id), userId: auth.user.id },
    select: { id: true },
  });
  if (!habit) return fail("NOT_FOUND", "Habit không tồn tại.");

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const logs = await prisma.log.findMany({
    where: {
      habitId: habit.id,
      ...(from ? { loggedDate: { gte: new Date(from) } } : {}),
      ...(to ? { loggedDate: { lte: new Date(to) } } : {}),
    },
    orderBy: { loggedDate: "asc" },
    select: { loggedDate: true, status: true, value: true, durationSecs: true },
  });
  return ok({ data: logs });
});

const Body = z.object({
  logged_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Định dạng YYYY-MM-DD"),
  value: z.number().nonnegative().optional(),
  duration_secs: z.number().int().nonnegative().optional(),
  note: z.string().max(1000).optional(),
});

// POST /habits/:id/logs — check-in (upsert idempotent). Lõi hệ thống.
export const POST = handler(async (req, ctx: { params: { id: string } }) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Dữ liệu không hợp lệ.", {
      fields: parsed.error.flatten().fieldErrors,
    });
  }

  // Load habit + schedules (IDOR: bắt buộc userId khớp).
  const habit = await prisma.habit.findFirst({
    where: { id: BigInt(ctx.params.id), userId: auth.user.id },
    include: { schedules: { orderBy: { effectiveFrom: "desc" } } },
  });
  if (!habit) return fail("NOT_FOUND", "Habit không tồn tại.");

  const tz = auth.user.timezone;
  const cutoff = auth.user.dayCutoff;
  const today = userToday(tz, cutoff);

  const loggedDay = parseUserDate(parsed.data.logged_date, tz);
  if (!loggedDay) return fail("VALIDATION_ERROR", "Ngày không hợp lệ.");

  // Cửa sổ backfill: hôm nay hoặc hôm qua (Mục VI.2). diff = today - loggedDay.
  const backDiff = diffDays(today, loggedDay);
  if (backDiff < 0) return fail("BACKFILL_WINDOW_EXCEEDED", "Không check-in cho ngày tương lai.");
  if (backDiff > 1) return fail("BACKFILL_WINDOW_EXCEEDED", "Chỉ được sửa tối đa 1 ngày trước.");

  // Ngày đến hạn? (Mục VI.1)
  const schedule = resolveSchedule(habit.schedules, loggedDay);
  if (!schedule || !isScheduledDayForSchedule(schedule, loggedDay)) {
    return fail("NOT_SCHEDULED_DAY", "Habit không đến hạn vào ngày này.");
  }

  const value = parsed.data.value ?? null;
  const durationSecs = parsed.data.duration_secs ?? null;
  const note = parsed.data.note?.trim() || null;
  const status = evaluateCompletion(habit.type, schedule, value, durationSecs);
  const completedAt = status === "completed" || status === "partial" ? new Date() : null;

  const result = await prisma.$transaction(async (tx) => {
    // Upsert log (UNIQUE habitId+loggedDate → idempotent).
    const log = await tx.log.upsert({
      where: { habitId_loggedDate: { habitId: habit.id, loggedDate: toDbDate(loggedDay) } },
      create: {
        habitId: habit.id,
        userId: auth.user.id,
        loggedDate: toDbDate(loggedDay),
        status,
        value,
        durationSecs,
        note,
        completedAt,
        source: "manual",
      },
      update: { status, value, durationSecs, ...(note !== null ? { note } : {}), completedAt, source: "manual" },
    });

    // Tính lại streak tới ngày hiện tại (pending hôm nay không đứt chuỗi).
    const recomputed = await recomputeStreak({
      tx,
      habitId: habit.id,
      schedules: habit.schedules,
      uptoDay: today,
      todayForUser: today,
      previousLongest: habit.longestStreak,
      weeklyMissAllowance: habit.weeklyMissAllowance,
    });

    // Cấp Freeze khi chuỗi vượt mốc bội số 7.
    const earned = freezesEarned(habit.currentStreak, recomputed.currentStreak, habit.freezeBalance);
    let balance = habit.freezeBalance;
    for (let i = 0; i < earned; i++) {
      balance += 1;
      await tx.freezeLedger.create({
        data: {
          habitId: habit.id,
          userId: auth.user.id,
          delta: 1,
          reason: "earned_streak",
          balanceAfter: balance,
        },
      });
    }

    await tx.habit.update({
      where: { id: habit.id },
      data: {
        currentStreak: recomputed.currentStreak,
        longestStreak: recomputed.longestStreak,
        lastCompletedDate: recomputed.lastCompletedDate,
        freezeBalance: balance,
      },
    });

    return { log, streak: recomputed, balance, earned };
  });

  const payload = {
    log: {
      id: result.log.id,
      habit_id: result.log.habitId,
      logged_date: result.log.loggedDate,
      status: result.log.status,
      value: result.log.value,
      duration_secs: result.log.durationSecs,
      source: result.log.source,
    },
    streak: {
      current_streak: result.streak.currentStreak,
      longest_streak: result.streak.longestStreak,
      freeze_balance: result.balance,
      earned_freeze: result.earned > 0,
    },
  };

  // 201 nếu vừa tạo, 200 nếu update — đơn giản hóa: trả 200 (upsert).
  return ok(payload);
});
