import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assignSpot } from "@/lib/spots";
import { getSettings } from "@/lib/settings";
import { triggerGateOpen } from "@/lib/gate";
import { log as audit } from "@/lib/audit";
import { stripe } from "@/lib/stripe";
import { handler, json, notFound, conflict, paymentRequired } from "@/lib/api-handler";
import { SessionCreateSchema, idSchema } from "@/lib/schemas";

const SessionListQuery = z.object({ driverId: idSchema });

// GET: check for active sessions by driver ID
export const GET = handler(
  { query: SessionListQuery },
  async ({ query }) => {
    const sessions = await prisma.session.findMany({
      where: { driverId: query.driverId, status: "ACTIVE" },
      include: { spot: true, driver: true, vehicle: true, payments: true },
    });
    return json({
      session: sessions[0] || null,
      activeSessions: sessions,
    });
  },
);

// POST: create a new parking session (check-in)
export const POST = handler(
  { body: SessionCreateSchema },
  async ({ body }) => {
    const { driverId, vehicleId, hours, paymentId } = body;

    // Verify payment is confirmed before creating session
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentId);
      if (paymentIntent.status !== "succeeded") {
        throw paymentRequired(
          "Payment not confirmed. Please complete payment first.",
        );
      }
    } catch (err) {
      if (err instanceof Error && err.name === "ApiError") throw err;
      throw paymentRequired("Could not verify payment.");
    }

    // Prevent duplicate payment reuse — same paymentId can't create two sessions
    const paymentReuse = await prisma.payment.findFirst({
      where: { stripePaymentId: paymentId },
    });
    if (paymentReuse) {
      throw conflict("This payment has already been used for a session");
    }

    // Check if this vehicle already has an active session
    const existingSession = await prisma.session.findFirst({
      where: { vehicleId, status: "ACTIVE" },
    });
    if (existingSession) throw conflict("This vehicle is already parked");

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw notFound("Vehicle not found");

    const settings = await getSettings();
    const hourlyRate =
      vehicle.type === "BOBTAIL"
        ? settings.hourlyRateBobtail
        : settings.hourlyRateTruck;

    const spot = await assignSpot(vehicle.type);
    if (!spot) throw conflict("No available spots for this vehicle type");

    const now = new Date();
    const expectedEnd = new Date(now.getTime() + hours * 60 * 60 * 1000);
    const amount = hourlyRate * hours;

    const session = await prisma.session.create({
      data: { driverId, vehicleId, spotId: spot.id, expectedEnd },
      include: { spot: true, driver: true, vehicle: true },
    });

    await prisma.payment.create({
      data: {
        sessionId: session.id,
        type: "CHECKIN",
        stripePaymentId: paymentId,
        amount,
        hours,
      },
    });

    await audit({
      action: "CHECKIN",
      sessionId: session.id,
      driverId,
      vehicleId,
      spotId: spot.id,
      details: `Checked in for ${hours}h, paid $${amount.toFixed(2)}, plate: ${vehicle.licensePlate}`,
    });
    await audit({
      action: "SPOT_ASSIGNED",
      sessionId: session.id,
      spotId: spot.id,
      vehicleId,
      details: `Spot ${spot.label} assigned to ${vehicle.licensePlate}`,
    });
    await audit({
      action: "GATE_OPEN",
      sessionId: session.id,
      driverId,
      details: "Gate opened for check-in",
    });

    triggerGateOpen();

    return json({ session }, { status: 201 });
  },
);
