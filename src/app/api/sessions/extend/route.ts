import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { log as audit } from "@/lib/audit";
import { hourlyRate, addHours } from "@/lib/rates";
import { handler, json, notFound, conflict } from "@/lib/api-handler";
import { SessionExtendSchema } from "@/lib/schemas";

/**
 * POST: free-mode session extension.
 *
 * Real-money extensions go through Stripe Checkout → `checkout.session.completed`
 * webhook with metadata.sessionPurpose=EXTENSION, which updates expectedEnd
 * and writes the Payment row atomically. This route only serves the
 * paymentRequired=false path.
 */
export const POST = handler(
  { body: SessionExtendSchema },
  async ({ body }) => {
    const { sessionId, driverId, hours } = body;

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { vehicle: true, spot: true },
    });
    if (!session || session.driverId !== driverId || session.status !== "ACTIVE") {
      throw notFound("No active session found");
    }

    const settings = await getSettings();
    if (settings.paymentRequired) {
      throw conflict("Payment is required — use /api/payments/checkout to create a Stripe Checkout session for the extension");
    }

    const rate = hourlyRate(settings, session.vehicle.type);
    const amount = rate * hours;
    const newEnd = addHours(session.expectedEnd, hours);

    const [updated] = await prisma.$transaction([
      prisma.session.update({
        where: { id: sessionId },
        data: { expectedEnd: newEnd, reminderSent: false },
        include: { spot: true, vehicle: true },
      }),
      prisma.payment.create({
        data: {
          sessionId,
          type: "EXTENSION",
          amount,
          hours,
          legacyQbReference: `free_${randomUUID()}`,
        },
      }),
    ]);

    await audit({
      action: "EXTEND",
      sessionId,
      driverId: session.driverId,
      vehicleId: session.vehicleId,
      spotId: session.spotId,
      details: `Extended ${hours}h (payment disabled), new expiry: ${newEnd.toISOString()}, plate: ${session.vehicle.licensePlate}`,
    });

    return json({ session: updated });
  },
);
