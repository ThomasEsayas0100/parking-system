import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, json } from "@/lib/api-handler";

const DriverAuthSchema = z.object({
  phone: z.string().min(7).max(20),
  name: z.string().min(1).max(100).optional(),
});

// POST: identify a driver by phone number.
// If found, return their record.
// If not found and name provided, create them.
// If not found and no name, return needsName: true.
export const POST = handler({ body: DriverAuthSchema }, async ({ body }) => {
  const { phone, name } = body;

  const existing = await prisma.driver.findFirst({ where: { phone } });
  if (existing) {
    return json({ driver: existing, created: false, needsName: false });
  }

  if (!name) {
    return json({ driver: null, created: false, needsName: true });
  }

  // Generate a placeholder email from phone so the unique constraint is satisfied
  const email = `driver-${phone.replace(/\D/g, "")}@scan.local`;

  const driver = await prisma.driver.create({
    data: { name, phone, email },
  });

  return json({ driver, created: true, needsName: false }, { status: 201 });
});
