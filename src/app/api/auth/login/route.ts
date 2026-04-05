import { z } from "zod";
import { handler, json, unauthorized } from "@/lib/api-handler";
import { checkAdminPassword, signAuthToken, setAuthCookie } from "@/lib/auth";
import { RATE_LIMITS } from "@/lib/rate-limit";

const LoginSchema = z.object({
  password: z.string().min(1).max(200),
});

export const POST = handler(
  { body: LoginSchema, rateLimit: RATE_LIMITS.strict },
  async ({ body }) => {
    if (!checkAdminPassword(body.password)) {
      throw unauthorized("Invalid password");
    }
    const token = await signAuthToken({ sub: "admin", role: "admin" });
    await setAuthCookie(token);
    return json({ ok: true, role: "admin" });
  },
);
