import { prisma } from "@/lib/prisma";
import { handler, json, badRequest } from "@/lib/api-handler";
import { DriverUpsertSchema, DriverLookupSchema } from "@/lib/schemas";

// GET: look up driver by email or phone (for Remember Me)
export const GET = handler(
  { query: DriverLookupSchema },
  async ({ query }) => {
    const { email, phone } = query;

    const driver = await prisma.driver.findFirst({
      where: email ? { email } : { phone: phone! },
      include: { vehicles: true },
    });

    if (!driver) return json({ driver: null });

    const activeSessions = await prisma.session.findMany({
      where: { driverId: driver.id, status: "ACTIVE" },
      include: { spot: true, vehicle: true },
    });

    return json({ driver, activeSessions });
  },
);

// POST: create or update a driver
export const POST = handler(
  { body: DriverUpsertSchema },
  async ({ body }) => {
    const { name, email, phone } = body;

    // Phone must also be unique — if someone else has this phone with a different email, fail
    const phoneConflict = await prisma.driver.findFirst({
      where: { phone, NOT: { email } },
    });
    if (phoneConflict) {
      throw badRequest("Phone number already in use by another account");
    }

    const driver = await prisma.driver.upsert({
      where: { email },
      update: { name, phone },
      create: { name, email, phone },
    });

    return json({ driver }, { status: 201 });
  },
);
