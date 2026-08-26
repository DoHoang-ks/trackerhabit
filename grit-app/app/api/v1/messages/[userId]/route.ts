import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, created, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { getFriendIds } from "@/lib/social";

export const dynamic = "force-dynamic";

// GET /messages/:userId — hội thoại với 1 người bạn (đánh dấu đã đọc tin nhận).
export const GET = handler(async (req, ctx: { params: { userId: string } }) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const other = BigInt(ctx.params.userId);
  const friends = await getFriendIds(auth.user.id);
  if (!friends.includes(other)) return fail("NOT_FOUND", "Không phải bạn bè.");

  const url = new URL(req.url);
  const afterId = url.searchParams.get("after");

  const rows = await prisma.message.findMany({
    where: {
      OR: [
        { senderId: auth.user.id, receiverId: other },
        { senderId: other, receiverId: auth.user.id },
      ],
      ...(afterId ? { id: { gt: BigInt(afterId) } } : {}),
    },
    orderBy: { id: "asc" },
    take: 200,
    select: { id: true, senderId: true, text: true, createdAt: true },
  });

  // đánh dấu đã đọc các tin từ người kia
  await prisma.message.updateMany({
    where: { senderId: other, receiverId: auth.user.id, readAt: null },
    data: { readAt: new Date() },
  });

  return ok({ data: rows.map((m) => ({ id: m.id, mine: m.senderId === auth.user.id, text: m.text, created_at: m.createdAt })) });
});

const Body = z.object({ text: z.string().min(1).max(1000) });

// POST /messages/:userId — gửi tin nhắn cho bạn.
export const POST = handler(async (req, ctx: { params: { userId: string } }) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const other = BigInt(ctx.params.userId);
  const friends = await getFriendIds(auth.user.id);
  if (!friends.includes(other)) return fail("NOT_FOUND", "Không phải bạn bè.");

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("VALIDATION_ERROR", "Nội dung không hợp lệ.");

  const m = await prisma.message.create({
    data: { senderId: auth.user.id, receiverId: other, text: parsed.data.text.trim() },
  });
  return created({ id: m.id });
});
