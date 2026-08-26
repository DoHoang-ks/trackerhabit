import { handler, ok } from "@/lib/http";
import { ENV } from "@/lib/env";

export const dynamic = "force-dynamic";

// GET /push/vapid — public key để client subscribe.
export const GET = handler(async () => {
  return ok({ publicKey: ENV.VAPID_PUBLIC, enabled: ENV.PUSH_ENABLED });
});
