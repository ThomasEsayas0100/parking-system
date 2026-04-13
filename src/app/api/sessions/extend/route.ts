import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { log as audit } from "@/lib/audit";
import { verifyAndClaimPayment } from "@/lib/payments";
import { hourlyRate, addHours } from "@/lib/rates";
import { handler, json, notFound } from "@/lib/api-handler";
import { SessionExtendSchema } from "@/lib/schemas";

export const POST = handler(
  { body: SessionExtendSchema },
  async ({ body }) => {
    const { sessionId, hours, paymentId } = body;

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { vehicle: true, spot: true },
    });
    if (!session || session.status !== "ACTIVE") {
      throw notFound("No active session found");
    }

    await verifyAndClaimPayment(paymentId);

    const settings = await getSettings();
    const rate = hourlyRate(settings, session.vehicle.type);
    const amount = rate * hours;
    const newEnd = addHours(session.expectedEnd, hours);

    const updated = await prisma.session.update({
      where: { id: sessionId },
      data: { expectedEnd: newEnd, reminderSent: false },
      include: { spot: true, vehicle: true },
    });

    await prisma.payment.create({
      data: {
        sessionId,
        type: "EXTENSION",
        externalPaymentId: paymentId,
        amount,
        hours,
      },
    });

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
