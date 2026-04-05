import { handler, json } from "@/lib/api-handler";
import { clearAuthCookie } from "@/lib/auth";

export const POST = handler({}, async () => {
  await clearAuthCookie();
  return json({ ok: true });
});
