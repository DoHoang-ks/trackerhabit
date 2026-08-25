import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, created, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth";

export const GET = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  const goals = await prisma.goal.findMany({
    where: {
      userId: auth.user.id, // IDOR guard: chỉ goal của user
      ...(status ? { status: status as any } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { habits: true } } },
  });

  const data = goals.map((g) => ({
    id: g.id,
    title: g.title,
    description: g.description,
    status: g.status,
    progress_baseline: g.progressBaseline,
    progress_percent: g.progressPercent,
    progress_display: Math.min(100, Number(g.progressBaseline) + Number(g.progressPercent)),
    habit_count: g._count.habits,
    start_date: g.startDate,
    target_date: g.targetDate,
  }));
  return ok({ data, next_cursor: null });
});

const Body = z.object({
  title: z.string().min(1).max(140),
  description: z.string().max(2000).optional(),
  start_date: z.string().optional(),
  target_date: z.string().optional(),
  progress_baseline: z.number().min(0).max(100).optional(),
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

  const goal = await prisma.goal.create({
    data: {
      userId: auth.user.id,
      title: b.title,
      description: b.description,
      progressBaseline: b.progress_baseline ?? 5,
      startDate: b.start_date ? new Date(b.start_date) : undefined,
      targetDate: b.target_date ? new Date(b.target_date) : undefined,
    },
  });
  return created(goal);
});
