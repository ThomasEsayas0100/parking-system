import { prisma } from "@/lib/prisma";
import { handler, json } from "@/lib/api-handler";
import { DriverUpsertSchema, DriverLookupSchema } from "@/lib/schemas";

// GET: look up driver by email or phone (used by /scan and "remember me")
export const GET = handler(
  { query: DriverLookupSchema },
  async ({ query }) => {
    const { email } = query;
    const phone = query.phone ? query.phone.replace(/\D/g, "") : undefined;

    // Phone-first (primary identifier)
    const driver = await prisma.driver.findFirst({
      where: phone ? { phone } : { email: email! },
      include: { vehicles: true },
    });

    if (!driver) return json({ driver: null });

    const activeSessions = await prisma.session.findMany({
      where: { driverId: driver.id, status: { in: ["ACTIVE", "OVERSTAY"] } },
      include: { spot: true, vehicle: true },
    });

    return json({ driver, activeSessions });
  },
);

// POST: create or update a driver. Phone is the primary key.
// If phone matches an existing driver → update name/email.
// If phone is new → create. Email conflicts are ignored (email is just contact info).
export const POST = handler(
  { body: DriverUpsertSchema },
  async ({ body }) => {
    const { name, email } = body;
    // Normalize phone to digits-only so "555-123-4567" and "5551234567" match
    const phone = body.phone.replace(/\D/g, "");

    const driver = await prisma.driver.upsert({
      where: { phone },
      update: { name, email },
      create: { name, email, phone },
    });

    return json({ driver }, { status: 201 });
  },
);
