import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { userToday, parseUserDate, toDbDate, diffDays } from "@/lib/dates";
import { recomputeStreak } from "@/lib/streak";

// PATCH /habits/:id/logs/:date — cập nhật ghi chú (không đổi trạng thái hoàn thành).
const PatchBody = z.object({ note: z.string().max(1000).nullable().optional() });
export const PATCH = handler(async (req, ctx: { params: { id: string; date: string } }) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const habit = await prisma.habit.findFirst({
    where: { id: BigInt(ctx.params.id), userId: auth.user.id },
    select: { id: true },
  });
  if (!habit) return fail("NOT_FOUND", "Habit không tồn tại.");

  const day = parseUserDate(ctx.params.date, auth.user.timezone);
  if (!day) return fail("VALIDATION_ERROR", "Ngày không hợp lệ.");

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("VALIDATION_ERROR", "Dữ liệu không hợp lệ.");

  const res = await prisma.log.updateMany({
    where: { habitId: habit.id, loggedDate: toDbDate(day) },
    data: { note: parsed.data.note?.trim() || null },
  });
  if (res.count === 0) return fail("NOT_FOUND", "Chưa có bản ghi cho ngày này (hãy hoàn thành trước).");
  return ok({ ok: true });
});

// DELETE /habits/:id/logs/:date — Undo trong ngày (Mục VI.2).
export const DELETE = handler(
  async (req, ctx: { params: { id: string; date: string } }) => {
    const auth = await requireUser(req);
    if ("response" in auth) return auth.response;

    const habit = await prisma.habit.findFirst({
      where: { id: BigInt(ctx.params.id), userId: auth.user.id },
      include: { schedules: { orderBy: { effectiveFrom: "desc" } } },
    });
    if (!habit) return fail("NOT_FOUND", "Habit không tồn tại.");

    const tz = auth.user.timezone;
    const today = userToday(tz, auth.user.dayCutoff);
    const day = parseUserDate(ctx.params.date, tz);
    if (!day) return fail("VALIDATION_ERROR", "Ngày không hợp lệ.");

    // Chỉ cho undo ngày hiện tại (chưa qua cut-off). Ngày cũ đã khóa.
    if (diffDays(today, day) !== 0) {
      return fail("LOG_LOCKED", "Ngày đã khóa, không thể hoàn tác.");
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.log.deleteMany({
        where: { habitId: habit.id, loggedDate: toDbDate(day) },
      });
      const recomputed = await recomputeStreak({
        tx,
        habitId: habit.id,
        schedules: habit.schedules,
        uptoDay: today,
        todayForUser: today,
        previousLongest: habit.longestStreak,
        weeklyMissAllowance: habit.weeklyMissAllowance,
      });
      await tx.habit.update({
        where: { id: habit.id },
        data: {
          currentStreak: recomputed.currentStreak,
          longestStreak: recomputed.longestStreak,
          lastCompletedDate: recomputed.lastCompletedDate,
        },
      });
      return recomputed;
    });

    return ok({
      streak: {
        current_streak: result.currentStreak,
        longest_streak: result.longestStreak,
        freeze_balance: habit.freezeBalance,
      },
    });
  }
);
