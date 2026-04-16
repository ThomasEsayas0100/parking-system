import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, json } from "@/lib/api-handler";
import { RATE_LIMITS } from "@/lib/rate-limit";

// GET: check if a phone number is on the allow list (public — used by entry/exit pages)
// Rate-limited to prevent phone enumeration.
const CheckQuery = z.object({
  phone: z.string().min(4).max(20),
});

export const GET = handler({ query: CheckQuery, rateLimit: RATE_LIMITS.auth }, async ({ query }) => {
  const phone = query.phone.replace(/\D/g, "");
  const entry = await prisma.allowList.findUnique({ where: { phone } });

  if (!entry || !entry.active) {
    return json({ allowed: false });
  }

  return json({
    allowed: true,
    name: entry.name,
    label: entry.label,
  });
});
