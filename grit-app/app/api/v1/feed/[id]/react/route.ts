import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, noContent, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { getFriendIds } from "@/lib/social";

export const dynamic = "force-dynamic";

async function canSee(userId: bigint, eventId: bigint) {
  const ev = await prisma.activityEvent.findUnique({ where: { id: eventId }, select: { userId: true } });
  if (!ev) return null;
  if (ev.userId === userId) return ev;
  const friends = await getFriendIds(userId);
  return friends.includes(ev.userId) ? ev : null;
}

const Body = z.object({ emoji: z.string().min(1).max(8) });

// POST /feed/:id/react — thả cảm xúc (👏 🔥 ❤️ …).
export const POST = handler(async (req, ctx: { params: { id: string } }) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const eventId = BigInt(ctx.params.id);
  if (!(await canSee(auth.user.id, eventId))) return fail("NOT_FOUND", "Không thấy bài này.");

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("VALIDATION_ERROR", "Thiếu emoji.");

  await prisma.feedReaction.upsert({
    where: { eventId_userId: { eventId, userId: auth.user.id } },
    create: { eventId, userId: auth.user.id, emoji: parsed.data.emoji },
    update: { emoji: parsed.data.emoji },
  });
  return ok({ ok: true });
});

// DELETE /feed/:id/react — bỏ cảm xúc.
export const DELETE = handler(async (req, ctx: { params: { id: string } }) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  await prisma.feedReaction.deleteMany({ where: { eventId: BigInt(ctx.params.id), userId: auth.user.id } });
  return noContent();
});
