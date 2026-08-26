import { prisma } from "./prisma";

// Danh sách id bạn bè đã kết (2 chiều).
export async function getFriendIds(userId: bigint): Promise<bigint[]> {
  const fs = await prisma.friendship.findMany({
    where: { status: "accepted", OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true },
  });
  return fs.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId));
}

// Cột public an toàn của user (KHÔNG lộ email khi hiển thị cho người khác).
export const publicUserSelect = { id: true, handle: true, displayName: true };

export function publicUser(u: { id: bigint; handle: string | null; displayName: string | null }) {
  return { id: u.id, handle: u.handle, name: u.displayName || u.handle || "Người dùng" };
}
