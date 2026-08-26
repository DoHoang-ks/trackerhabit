import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, noContent, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { resolveSchedule } from "@/lib/streak";
import { userToday } from "@/lib/dates";

// GET /habits/:id — chi tiết + schedule hiện hành + thống kê streak.
export const GET = handler(async (req, ctx: { params: { id: string } }) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const habit = await prisma.habit.findFirst({
    where: { id: BigInt(ctx.params.id), userId: auth.user.id },
    include: { schedules: { orderBy: { effectiveFrom: "desc" } }, goal: { select: { id: true, title: true } } },
  });
  if (!habit) return fail("NOT_FOUND", "Habit không tồn tại.");

  const today = userToday(auth.user.timezone, auth.user.dayCutoff);
  const sch = resolveSchedule(habit.schedules, today);

  return ok({
    id: habit.id,
    goal_id: habit.goalId,
    goal_title: habit.goal?.title ?? null,
    name: habit.name,
    type: habit.type,
    is_focus: habit.isFocus,
    color: habit.color,
    icon: habit.icon,
    polarity: habit.polarity,
    sort_order: habit.sortOrder,
    weekly_miss_allowance: habit.weeklyMissAllowance,
    current_streak: habit.currentStreak,
    longest_streak: habit.longestStreak,
    freeze_balance: habit.freezeBalance,
    last_completed_date: habit.lastCompletedDate,
    current_schedule: sch
      ? {
          schedule_type: sch.scheduleType,
          weekdays_mask: sch.weekdaysMask,
          target_value: sch.targetValue,
          target_unit: sch.targetUnit,
          min_percent: sch.minPercent,
        }
      : null,
  });
});

const Patch = z.object({
  name: z.string().min(1).max(120).optional(),
  is_focus: z.boolean().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(8).optional(),
  polarity: z.enum(["good", "bad"]).optional(),
  sort_order: z.number().int().optional(),
  weekly_miss_allowance: z.number().int().min(0).max(6).optional(),
});

// PATCH /habits/:id — sửa metadata (tên, đặt làm focus).
export const PATCH = handler(async (req, ctx: { params: { id: string } }) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const habit = await prisma.habit.findFirst({
    where: { id: BigInt(ctx.params.id), userId: auth.user.id },
    select: { id: true },
  });
  if (!habit) return fail("NOT_FOUND", "Habit không tồn tại.");

  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("VALIDATION_ERROR", "Dữ liệu không hợp lệ.");
  const { name, is_focus, color, icon, polarity, sort_order, weekly_miss_allowance } = parsed.data;

  const updated = await prisma.$transaction(async (tx) => {
    // Đặt làm Focus → bỏ Focus các habit khác của user (chỉ 1 Focus tại một thời điểm).
    if (is_focus === true) {
      await tx.habit.updateMany({
        where: { userId: auth.user.id, id: { not: habit.id } },
        data: { isFocus: false },
      });
    }
    return tx.habit.update({
      where: { id: habit.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(is_focus !== undefined ? { isFocus: is_focus } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(icon !== undefined ? { icon } : {}),
        ...(polarity !== undefined ? { polarity } : {}),
        ...(sort_order !== undefined ? { sortOrder: sort_order } : {}),
        ...(weekly_miss_allowance !== undefined ? { weeklyMissAllowance: weekly_miss_allowance } : {}),
      },
      select: { id: true, name: true, isFocus: true, color: true, icon: true, polarity: true, sortOrder: true, weeklyMissAllowance: true },
    });
  });
  return ok(updated);
});

// DELETE /habits/:id — archive mặc định, ?hard=true xóa cứng.
export const DELETE = handler(async (req, ctx: { params: { id: string } }) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const habit = await prisma.habit.findFirst({
    where: { id: BigInt(ctx.params.id), userId: auth.user.id },
    select: { id: true },
  });
  if (!habit) return fail("NOT_FOUND", "Habit không tồn tại.");

  const hard = new URL(req.url).searchParams.get("hard") === "true";
  if (hard) {
    await prisma.habit.delete({ where: { id: habit.id } });
  } else {
    await prisma.habit.update({ where: { id: habit.id }, data: { archivedAt: new Date() } });
  }
  return noContent();
});
