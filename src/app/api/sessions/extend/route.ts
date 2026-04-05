import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { log as audit } from "@/lib/audit";
import { stripe } from "@/lib/stripe";
import { handler, json, notFound, paymentRequired, conflict } from "@/lib/api-handler";
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

    // Verify payment
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentId);
      if (pi.status !== "succeeded") {
        throw paymentRequired("Extension payment not confirmed");
      }
    } catch (err) {
      if (err instanceof Error && err.name === "ApiError") throw err;
      throw paymentRequired("Could not verify payment");
    }

    // Prevent payment reuse
    const paymentReuse = await prisma.payment.findFirst({
      where: { stripePaymentId: paymentId },
    });
    if (paymentReuse) {
      throw conflict("This payment has already been used");
    }

    const settings = await getSettings();
    const hourlyRate =
      session.vehicle.type === "BOBTAIL"
        ? settings.hourlyRateBobtail
        : settings.hourlyRateTruck;
    const amount = hourlyRate * hours;
    const newEnd = new Date(
      session.expectedEnd.getTime() + hours * 60 * 60 * 1000,
    );

    const updated = await prisma.session.update({
      where: { id: sessionId },
      data: { expectedEnd: newEnd, reminderSent: false },
      include: { spot: true, vehicle: true },
    });

    await prisma.payment.create({
      data: {
        sessionId,
        type: "EXTENSION",
        stripePaymentId: paymentId,
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
