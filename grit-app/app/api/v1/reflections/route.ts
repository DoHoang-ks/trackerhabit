import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, created, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth";

// GET /reflections?week_start=YYYY-MM-DD[&goal_id=]  — lấy reflection của tuần.
export const GET = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const url = new URL(req.url);
  const weekStart = url.searchParams.get("week_start");
  const goalId = url.searchParams.get("goal_id");

  const rows = await prisma.reflection.findMany({
    where: {
      userId: auth.user.id,
      ...(weekStart ? { weekStart: new Date(weekStart) } : {}),
      ...(goalId ? { goalId: BigInt(goalId) } : goalId === null ? {} : {}),
    },
    orderBy: { weekStart: "desc" },
    take: 20,
  });
  return ok({ data: rows });
});

const Body = z.object({
  goal_id: z.union([z.string(), z.number()]).optional(),
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Định dạng YYYY-MM-DD"),
  blocker_text: z.string().max(2000).optional(),
  adjustment_text: z.string().max(2000).optional(),
});

// POST /reflections — upsert theo (userId, goalId, weekStart).
// Xử lý tay vì goalId có thể NULL (Postgres UNIQUE không chặn nhiều NULL).
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
  const goalId = b.goal_id != null ? BigInt(b.goal_id) : null;

  // Nếu gắn goal, xác thực goal thuộc user (chống IDOR).
  if (goalId !== null) {
    const g = await prisma.goal.findFirst({ where: { id: goalId, userId: auth.user.id }, select: { id: true } });
    if (!g) return fail("NOT_FOUND", "Goal không tồn tại.");
  }

  const weekStart = new Date(b.week_start);
  const existing = await prisma.reflection.findFirst({
    where: { userId: auth.user.id, goalId, weekStart },
    select: { id: true },
  });

  const data = {
    blockerText: b.blocker_text?.trim() || null,
    adjustmentText: b.adjustment_text?.trim() || null,
  };

  if (existing) {
    const updated = await prisma.reflection.update({ where: { id: existing.id }, data });
    return ok(updated);
  }
  const createdRow = await prisma.reflection.create({
    data: { userId: auth.user.id, goalId, weekStart, ...data },
  });
  return created(createdRow);
});
