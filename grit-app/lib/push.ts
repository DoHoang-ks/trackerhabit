import webpush from "web-push";
import { prisma } from "./prisma";
import { ENV } from "./env";

let configured = false;
function ensure(): boolean {
  if (configured) return true;
  if (!ENV.PUSH_ENABLED) return false;
  webpush.setVapidDetails(ENV.VAPID_SUBJECT, ENV.VAPID_PUBLIC, ENV.VAPID_PRIVATE);
  configured = true;
  return true;
}

// Gửi push tới tất cả thiết bị của user; tự xóa subscription hết hạn (404/410).
export async function sendPushToUser(userId: bigint, payload: object): Promise<number> {
  if (!ensure()) return 0;
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload)
      );
      sent++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      }
    }
  }
  return sent;
}
