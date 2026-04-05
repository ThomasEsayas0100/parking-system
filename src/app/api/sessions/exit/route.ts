import { prisma } from "@/lib/prisma";
import { freeSpot } from "@/lib/spots";
import { getSettings } from "@/lib/settings";
import { triggerGateOpen } from "@/lib/gate";
import { log as audit } from "@/lib/audit";
import { stripe } from "@/lib/stripe";
import { handler, json, notFound, paymentRequired, conflict } from "@/lib/api-handler";
import { SessionExitSchema } from "@/lib/schemas";

export const POST = handler(
  { body: SessionExitSchema },
  async ({ body }) => {
    const { sessionId, overstayPaymentId } = body;

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { spot: true, vehicle: true },
    });
    if (!session || session.status !== "ACTIVE") {
      throw notFound("No active session found");
    }

    const now = new Date();
    const isOverstayed = now > session.expectedEnd;

    if (isOverstayed) {
      const settings = await getSettings();
      const overstayRate =
        session.vehicle.type === "BOBTAIL"
          ? settings.overstayRateBobtail
          : settings.overstayRateTruck;
      const overstayMs = now.getTime() - session.expectedEnd.getTime();
      const overstayHours = Math.ceil(overstayMs / (1000 * 60 * 60));
      const overstayAmount = overstayRate * overstayHours;

      if (!overstayPaymentId) {
        return json({
          requiresPayment: true,
          overstayHours,
          overstayAmount,
          overstayRate,
          sessionId: session.id,
        });
      }

      // Verify overstay payment was actually charged
      try {
        const pi = await stripe.paymentIntents.retrieve(overstayPaymentId);
        if (pi.status !== "succeeded") {
          throw paymentRequired("Overstay payment not confirmed");
        }
      } catch (err) {
        if (err instanceof Error && err.name === "ApiError") throw err;
        throw paymentRequired("Could not verify overstay payment");
      }

      // Prevent payment reuse
      const paymentReuse = await prisma.payment.findFirst({
        where: { stripePaymentId: overstayPaymentId },
      });
      if (paymentReuse) {
        throw conflict("This payment has already been used");
      }

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

    await audit({
      action: "CHECKOUT",
      sessionId,
      driverId: session.driverId,
      vehicleId: session.vehicleId,
      spotId: session.spotId,
      details: `Checked out from spot ${session.spot.label}, plate: ${session.vehicle.licensePlate}`,
    });
    await audit({
      action: "SPOT_FREED",
      spotId: session.spotId,
      sessionId,
      details: `Spot ${session.spot.label} freed`,
    });
    await audit({
      action: "GATE_OPEN",
      sessionId,
      driverId: session.driverId,
      details: "Gate opened for exit",
    });

    triggerGateOpen();

    return json({ success: true, gateOpened: true });
  },
);
