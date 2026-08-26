import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, created, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { userToday, parseUserDate, toDbDate, diffDays } from "@/lib/dates";

export const dynamic = "force-dynamic";

// GET /mood?from=&to= — danh sách tâm trạng theo ngày
export const GET = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const rows = await prisma.moodLog.findMany({
    where: {
      userId: auth.user.id,
      ...(from ? { loggedDate: { gte: new Date(from) } } : {}),
      ...(to ? { loggedDate: { lte: new Date(to) } } : {}),
    },
    orderBy: { loggedDate: "asc" },
    select: { loggedDate: true, mood: true, note: true },
  });
  return ok({ data: rows });
});

const Body = z.object({
  logged_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mood: z.number().int().min(1).max(5),
  note: z.string().max(1000).optional(),
});

// POST /mood — upsert tâm trạng cho 1 ngày (cửa sổ hôm nay/hôm qua như check-in)
export const POST = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("VALIDATION_ERROR", "Dữ liệu không hợp lệ.");

  const tz = auth.user.timezone;
  const today = userToday(tz, auth.user.dayCutoff);
  const day = parseUserDate(parsed.data.logged_date, tz);
  if (!day) return fail("VALIDATION_ERROR", "Ngày không hợp lệ.");
  const back = diffDays(today, day);
  if (back < 0 || back > 1) return fail("BACKFILL_WINDOW_EXCEEDED", "Chỉ ghi tâm trạng hôm nay hoặc hôm qua.");

  const note = parsed.data.note?.trim() || null;
  const existing = await prisma.moodLog.findFirst({
    where: { userId: auth.user.id, loggedDate: toDbDate(day) },
    select: { id: true },
  });
  if (existing) {
    const row = await prisma.moodLog.update({ where: { id: existing.id }, data: { mood: parsed.data.mood, note } });
    return ok(row);
  }
  const row = await prisma.moodLog.create({
    data: { userId: auth.user.id, loggedDate: toDbDate(day), mood: parsed.data.mood, note },
  });
  return created(row);
});
