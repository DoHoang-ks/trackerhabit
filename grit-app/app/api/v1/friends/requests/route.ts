import { prisma } from "@/lib/prisma";
import { handler, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { publicUser } from "@/lib/social";

export const dynamic = "force-dynamic";

// GET /friends/requests — lời mời kết bạn đến mình (đang chờ).
export const GET = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const rows = await prisma.friendship.findMany({
    where: { addresseeId: auth.user.id, status: "pending" },
    include: { requester: { select: { id: true, handle: true, displayName: true } } },
    orderBy: { createdAt: "desc" },
  });
  return ok({ data: rows.map((r) => ({ friendship_id: r.id, ...publicUser(r.requester) })) });
});
