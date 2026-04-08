import { prisma } from "@/lib/prisma";
import { freeSpot } from "@/lib/spots";
import { getSettings } from "@/lib/settings";
import { triggerGateOpen } from "@/lib/gate";
import { log as audit } from "@/lib/audit";
import { verifyAndClaimPayment } from "@/lib/payments";
import { overstayRate, ceilHours } from "@/lib/rates";
import { handler, json, notFound } from "@/lib/api-handler";
import { SessionExitSchema } from "@/lib/schemas";

export const POST = handler(
  { body: SessionExitSchema },
  async ({ body }) => {
    const { sessionId, overstayPaymentId } = body;

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { spot: true, vehicle: true },
    });
    if (!session || !["ACTIVE", "OVERSTAY"].includes(session.status)) {
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

      await prisma.payment.create({
        data: {
          sessionId,
          type: "OVERSTAY",
          stripePaymentId: overstayPaymentId,
          amount: overstayAmount,
          hours: overstayHours,
        },
      });

      await prisma.session.update({
        where: { id: sessionId },
        data: { status: "COMPLETED", endedAt: now },
      });

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

    await freeSpot(session.spotId);

    // CHECKOUT is the canonical exit event — gate open is implied
    await audit({
      action: "CHECKOUT",
      sessionId,
      driverId: session.driverId,
      vehicleId: session.vehicleId,
      spotId: session.spotId,
      details: `Checked out from spot ${session.spot.label}, plate: ${session.vehicle.licensePlate}`,
    });

    triggerGateOpen();

    return json({ success: true, gateOpened: true });
  },
);
