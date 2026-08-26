import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, created, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth";

export const GET = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const url = new URL(req.url);
  const goalId = url.searchParams.get("goal_id");
  const includeArchived = url.searchParams.get("include_archived") === "true";

  const habits = await prisma.habit.findMany({
    where: {
      userId: auth.user.id, // IDOR guard
      ...(goalId ? { goalId: BigInt(goalId) } : {}),
      ...(includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ isFocus: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      schedules: { orderBy: { effectiveFrom: "desc" } },
    },
  });

  const data = habits.map((h) => {
    const current = h.schedules.find((s) => s.effectiveTo === null) ?? h.schedules[0] ?? null;
    return {
      id: h.id,
      goal_id: h.goalId,
      name: h.name,
      type: h.type,
      is_focus: h.isFocus,
      color: h.color,
      icon: h.icon,
      polarity: h.polarity,
      sort_order: h.sortOrder,
      weekly_miss_allowance: h.weeklyMissAllowance,
      current_streak: h.currentStreak,
      longest_streak: h.longestStreak,
      freeze_balance: h.freezeBalance,
      last_completed_date: h.lastCompletedDate,
      current_schedule: current
        ? {
            schedule_type: current.scheduleType,
            weekdays_mask: current.weekdaysMask,
            target_value: current.targetValue,
            target_unit: current.targetUnit,
            min_percent: current.minPercent,
            effective_from: current.effectiveFrom,
            effective_to: current.effectiveTo,
          }
        : null,
    };
  });
  return ok({ data });
});

const Schedule = z.object({
  schedule_type: z.enum(["daily", "weekly_days"]).default("daily"),
  weekdays_mask: z.number().int().min(0).max(127).default(127),
  target_value: z.number().positive().optional(),
  target_unit: z.string().max(20).optional(),
  min_percent: z.number().min(1).max(100).default(100),
  effective_from: z.string(),
});

const Body = z.object({
  goal_id: z.union([z.string(), z.number()]),
  name: z.string().min(1).max(120),
  type: z.enum(["checkbox", "quantity", "timer"]).default("checkbox"),
  is_focus: z.boolean().default(false),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(8).optional(),
  polarity: z.enum(["good", "bad"]).optional(),
  sort_order: z.number().int().optional(),
  weekly_miss_allowance: z.number().int().min(0).max(6).optional(),
  schedule: Schedule,
});

export const POST = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Dữ liệu không hợp lệ.", {
      fields: parsed.error.flatten().fieldErrors,
    });
  }
  const b = parsed.data;

  // Validation theo habit_type: checkbox không được có target.
  if (b.type === "checkbox" && b.schedule.target_value != null) {
    return fail("VALIDATION_ERROR", "Habit checkbox không nhận target_value.");
  }
  if (b.type !== "checkbox" && b.schedule.target_value == null) {
    return fail("VALIDATION_ERROR", "Habit quantity/timer cần target_value.");
  }

  // Xác thực goal thuộc user (chống gán habit vào goal người khac).
  const goal = await prisma.goal.findFirst({
    where: { id: BigInt(b.goal_id), userId: auth.user.id },
    select: { id: true },
  });
  if (!goal) return fail("NOT_FOUND", "Goal không tồn tại.");

  const habit = await prisma.habit.create({
    data: {
      goalId: goal.id,
      userId: auth.user.id,
      name: b.name,
      type: b.type,
      isFocus: b.is_focus,
      ...(b.color ? { color: b.color } : {}),
      ...(b.icon ? { icon: b.icon } : {}),
      ...(b.polarity ? { polarity: b.polarity } : {}),
      ...(b.sort_order != null ? { sortOrder: b.sort_order } : {}),
      ...(b.weekly_miss_allowance != null ? { weeklyMissAllowance: b.weekly_miss_allowance } : {}),
      schedules: {
        create: {
          scheduleType: b.schedule.schedule_type,
          weekdaysMask: b.schedule.weekdays_mask,
          targetValue: b.schedule.target_value,
          targetUnit: b.schedule.target_unit,
          minPercent: b.schedule.min_percent,
          effectiveFrom: new Date(b.schedule.effective_from),
        },
      },
    },
    include: { schedules: true },
  });
  return created(habit);
});
