import { prisma } from "@/lib/prisma";
import { handler, ok, noContent, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// PATCH /friends/:id — chấp nhận lời mời (chỉ người được mời).
export const PATCH = handler(async (req, ctx: { params: { id: string } }) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const fr = await prisma.friendship.findFirst({
    where: { id: BigInt(ctx.params.id), addresseeId: auth.user.id, status: "pending" },
    select: { id: true },
  });
  if (!fr) return fail("NOT_FOUND", "Lời mời không tồn tại.");
  await prisma.friendship.update({ where: { id: fr.id }, data: { status: "accepted" } });
  return ok({ status: "accepted" });
});

// DELETE /friends/:id — hủy kết bạn / từ chối (cả hai phía).
export const DELETE = handler(async (req, ctx: { params: { id: string } }) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const res = await prisma.friendship.deleteMany({
    where: { id: BigInt(ctx.params.id), OR: [{ requesterId: auth.user.id }, { addresseeId: auth.user.id }] },
  });
  if (res.count === 0) return fail("NOT_FOUND", "Không tìm thấy.");
  return noContent();
});
