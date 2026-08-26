import { prisma } from "@/lib/prisma";
import { handler, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /export — xuất toàn bộ dữ liệu của user (JSON) để sao lưu/mang đi.
export const GET = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const uid = auth.user.id;
  const [user, goals, habits, schedules, logs, reflections] = await Promise.all([
    prisma.user.findUnique({ where: { id: uid }, select: { email: true, displayName: true, timezone: true, dayCutoff: true, createdAt: true } }),
    prisma.goal.findMany({ where: { userId: uid } }),
    prisma.habit.findMany({ where: { userId: uid } }),
    prisma.habitSchedule.findMany({ where: { habit: { userId: uid } } }),
    prisma.log.findMany({ where: { userId: uid }, orderBy: { loggedDate: "asc" } }),
    prisma.reflection.findMany({ where: { userId: uid } }),
  ]);

  return ok({
    exported_at: new Date().toISOString(),
    format: "grit-tracker-export-v1",
    user,
    goals,
    habits,
    schedules,
    logs,
    reflections,
  });
});
