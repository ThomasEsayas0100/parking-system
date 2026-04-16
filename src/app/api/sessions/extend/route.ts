import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { log as audit } from "@/lib/audit";
import { verifyAndClaimPayment } from "@/lib/payments";
import { hourlyRate, addHours } from "@/lib/rates";
import { handler, json, notFound, conflict } from "@/lib/api-handler";
import { SessionExtendSchema } from "@/lib/schemas";

export const POST = handler(
  { body: SessionExtendSchema },
  async ({ body }) => {
    const { sessionId, driverId, hours, paymentId } = body;

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { vehicle: true, spot: true },
    });
    // 404 on both missing and ownership mismatch — don't leak existence
    if (!session || session.driverId !== driverId || session.status !== "ACTIVE") {
      throw notFound("No active session found");
    }

    await verifyAndClaimPayment(paymentId);

    const settings = await getSettings();
    const rate = hourlyRate(settings, session.vehicle.type);
    const amount = rate * hours;
    const newEnd = addHours(session.expectedEnd, hours);

    // Atomic: update session expiry and create payment in one transaction.
    // P2002 on payment unique constraint → clean 409.
    let updated;
    try {
      const [sessionUpdate] = await prisma.$transaction([
        prisma.session.update({
          where: { id: sessionId },
          data: { expectedEnd: newEnd, reminderSent: false },
          include: { spot: true, vehicle: true },
        }),
        prisma.payment.create({
          data: {
            sessionId,
            type: "EXTENSION",
            externalPaymentId: paymentId,
            amount,
            hours,
          },
        }),
      ]);
      updated = sessionUpdate;
    } catch (err) {
      if (err instanceof Error && (err as { code?: string }).code === "P2002") {
        throw conflict("This payment has already been used");
      }
      throw err;
    }

    await audit({
      action: "EXTEND",
      sessionId,
      driverId: session.driverId,
      vehicleId: session.vehicleId,
      spotId: session.spotId,
      details: `Extended ${hours}h, paid $${amount.toFixed(2)}, new expiry: ${newEnd.toISOString()}, plate: ${session.vehicle.licensePlate}`,
    });

    return json({ session: updated });
  },
);
