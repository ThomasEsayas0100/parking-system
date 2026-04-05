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

// POST: create or update a driver.
// Matches first by phone (for scan-flow drivers upgrading from placeholder email),
// then by email. Creates a new record if neither exists.
export const POST = handler(
  { body: DriverUpsertSchema },
  async ({ body }) => {
    const { name, email, phone } = body;

    // 1) Phone match takes priority (covers the /scan → /checkin upgrade path)
    const byPhone = await prisma.driver.findFirst({ where: { phone } });
    if (byPhone) {
      // Make sure the new email isn't already owned by a DIFFERENT driver
      if (byPhone.email !== email) {
        const emailOwner = await prisma.driver.findFirst({
          where: { email, NOT: { id: byPhone.id } },
        });
        if (emailOwner) {
          throw badRequest("Email already in use by another account");
        }
      }
      const driver = await prisma.driver.update({
        where: { id: byPhone.id },
        data: { name, email },
      });
      return json({ driver });
    }

    // 2) Email match (classic remember-me path)
    const byEmail = await prisma.driver.findFirst({ where: { email } });
    if (byEmail) {
      // Phone must not belong to someone else
      const phoneOwner = await prisma.driver.findFirst({
        where: { phone, NOT: { id: byEmail.id } },
      });
      if (phoneOwner) {
        throw badRequest("Phone number already in use by another account");
      }
      const driver = await prisma.driver.update({
        where: { id: byEmail.id },
        data: { name, phone },
      });
      return json({ driver });
    }

    // 3) Brand new driver
    const driver = await prisma.driver.create({
      data: { name, email, phone },
    });
    return json({ driver }, { status: 201 });
  },
);
