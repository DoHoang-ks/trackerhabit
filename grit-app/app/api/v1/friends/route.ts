import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, created, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { publicUser } from "@/lib/social";

export const dynamic = "force-dynamic";

// GET /friends — danh sách bạn đã kết.
export const GET = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const fs = await prisma.friendship.findMany({
    where: { status: "accepted", OR: [{ requesterId: auth.user.id }, { addresseeId: auth.user.id }] },
    include: {
      requester: { select: { id: true, handle: true, displayName: true } },
      addressee: { select: { id: true, handle: true, displayName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const data = fs.map((f) => {
    const other = f.requesterId === auth.user.id ? f.addressee : f.requester;
    return { friendship_id: f.id, ...publicUser(other) };
  });
  return ok({ data });
});

const Body = z.object({ handle: z.string().min(1) });

// POST /friends — gửi lời mời kết bạn theo @handle.
export const POST = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("VALIDATION_ERROR", "Thiếu handle.");
  const handle = parsed.data.handle.replace(/^@/, "").toLowerCase();

  const target = await prisma.user.findUnique({ where: { handle }, select: { id: true } });
  if (!target) return fail("NOT_FOUND", "Không tìm thấy @" + handle);
  if (target.id === auth.user.id) return fail("VALIDATION_ERROR", "Không thể kết bạn với chính mình.");

  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: auth.user.id, addresseeId: target.id },
        { requesterId: target.id, addresseeId: auth.user.id },
      ],
    },
  });
  if (existing) {
    if (existing.status === "accepted") return fail("CONFLICT", "Đã là bạn bè.");
    // nếu người kia đã mời mình → tự động chấp nhận
    if (existing.addresseeId === auth.user.id) {
      await prisma.friendship.update({ where: { id: existing.id }, data: { status: "accepted" } });
      return ok({ status: "accepted" });
    }
    return fail("CONFLICT", "Đã gửi lời mời, đang chờ.");
  }

  const fr = await prisma.friendship.create({
    data: { requesterId: auth.user.id, addresseeId: target.id, status: "pending" },
  });
  return created({ friendship_id: fr.id, status: "pending" });
});
