import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { triggerGateOpen } from "@/lib/gate";
import { log as audit } from "@/lib/audit";
import { getSessionSpotLabel } from "@/lib/sessions";
import { verifyAndClaimPayment } from "@/lib/payments";
import { overstayRate, ceilHours } from "@/lib/rates";
import { handler, json, notFound, conflict } from "@/lib/api-handler";
import { SessionExitSchema } from "@/lib/schemas";

export const POST = handler(
  { body: SessionExitSchema },
  async ({ body }) => {
    const { sessionId, driverId, overstayPaymentId } = body;

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { spot: true, vehicle: true },
    });
    // 404 on both missing and ownership mismatch — don't leak existence
    if (
      !session ||
      session.driverId !== driverId ||
      !["ACTIVE", "OVERSTAY"].includes(session.status)
    ) {
      throw notFound("No active session found");
    }

    const now = new Date();
    const isOverstayed = now > session.expectedEnd || session.status === "OVERSTAY";

    if (isOverstayed) {
      const settings = await getSettings();
      const rate = overstayRate(settings, session.vehicle.type);
      const overstayHours = ceilHours(session.expectedEnd, now);
      const overstayAmount = rate * overstayHours;

      if (!overstayPaymentId) {
        return json({
          requiresPayment: true,
          overstayHours,
          overstayAmount,
          overstayRate: rate,
          sessionId: session.id,
        });
      }

      await verifyAndClaimPayment(overstayPaymentId);

      // Atomic: payment + session-complete in one transaction.
      // P2002 on concurrent overstay payment → clean 409.
      try {
        await prisma.$transaction([
          prisma.payment.create({
            data: {
              sessionId,
              type: "OVERSTAY",
              externalPaymentId: overstayPaymentId,
              amount: overstayAmount,
              hours: overstayHours,
            },
          }),
          prisma.session.update({
            where: { id: sessionId },
            data: { status: "COMPLETED", endedAt: now },
          }),
        ]);
      } catch (err) {
        if (err instanceof Error && (err as { code?: string }).code === "P2002") {
          throw conflict("This payment has already been used");
        }
        throw err;
      }

      await audit({
        action: "OVERSTAY_PAYMENT",
        sessionId,
        driverId: session.driverId,
        vehicleId: session.vehicleId,
        details: `Overstay ${overstayHours}h, paid $${overstayAmount.toFixed(2)}, plate: ${session.vehicle.licensePlate}`,
      });
    } else {
      await prisma.session.update({
        where: { id: sessionId },
        data: { status: "COMPLETED", endedAt: now },
      });
    }

    // CHECKOUT is the canonical exit event — gate open is implied
    await audit({
      action: "CHECKOUT",
      sessionId,
      driverId: session.driverId,
      vehicleId: session.vehicleId,
      spotId: session.spotId,
      details: `Checked out from spot ${getSessionSpotLabel(session)}, plate: ${session.vehicle.licensePlate}`,
    });

    triggerGateOpen();

    return json({ success: true, gateOpened: true });
  },
);
