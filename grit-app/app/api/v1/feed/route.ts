import { prisma } from "@/lib/prisma";
import { handler, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { getFriendIds, publicUser } from "@/lib/social";

export const dynamic = "force-dynamic";

// GET /feed — bảng tin: thành tựu của mình + bạn bè, kèm reaction & số comment.
export const GET = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const ids = [...(await getFriendIds(auth.user.id)), auth.user.id];
  const events = await prisma.activityEvent.findMany({
    where: { userId: { in: ids } },
    orderBy: { createdAt: "desc" },
    take: 60,
    include: {
      user: { select: { id: true, handle: true, displayName: true } },
      reactions: { select: { emoji: true, userId: true } },
      _count: { select: { comments: true } },
    },
  });

  const data = events.map((e) => {
    const counts: Record<string, number> = {};
    let mine: string | null = null;
    for (const r of e.reactions) {
      counts[r.emoji] = (counts[r.emoji] ?? 0) + 1;
      if (r.userId === auth.user.id) mine = r.emoji;
    }
    return {
      id: e.id,
      type: e.type,
      title: e.title,
      icon: e.icon,
      value: e.value,
      created_at: e.createdAt,
      user: publicUser(e.user),
      is_me: e.userId === auth.user.id,
      reactions: counts,
      my_reaction: mine,
      comment_count: e._count.comments,
    };
  });
  return ok({ data });
});
