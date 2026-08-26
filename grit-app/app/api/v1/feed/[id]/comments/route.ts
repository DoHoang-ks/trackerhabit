import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, created, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { getFriendIds, publicUser } from "@/lib/social";

export const dynamic = "force-dynamic";

async function canSee(userId: bigint, eventId: bigint) {
  const ev = await prisma.activityEvent.findUnique({ where: { id: eventId }, select: { userId: true } });
  if (!ev) return false;
  if (ev.userId === userId) return true;
  return (await getFriendIds(userId)).includes(ev.userId);
}

// GET /feed/:id/comments — lời chúc mừng / bình luận.
export const GET = handler(async (req, ctx: { params: { id: string } }) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const eventId = BigInt(ctx.params.id);
  if (!(await canSee(auth.user.id, eventId))) return fail("NOT_FOUND", "Không thấy bài này.");

  const rows = await prisma.feedComment.findMany({
    where: { eventId },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, handle: true, displayName: true } } },
    take: 200,
  });
  return ok({ data: rows.map((r) => ({ id: r.id, text: r.text, created_at: r.createdAt, user: publicUser(r.user) })) });
});

const Body = z.object({ text: z.string().min(1).max(500) });

// POST /feed/:id/comments — chúc mừng.
export const POST = handler(async (req, ctx: { params: { id: string } }) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const eventId = BigInt(ctx.params.id);
  if (!(await canSee(auth.user.id, eventId))) return fail("NOT_FOUND", "Không thấy bài này.");

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("VALIDATION_ERROR", "Nội dung không hợp lệ.");

  const row = await prisma.feedComment.create({
    data: { eventId, userId: auth.user.id, text: parsed.data.text.trim() },
  });
  return created({ id: row.id });
});
