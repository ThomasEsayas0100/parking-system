import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assignSpot } from "@/lib/spots";
import { getSettings } from "@/lib/settings";
import { triggerGateOpen } from "@/lib/gate";
import { log as audit } from "@/lib/audit";
import { addDays, addMonths } from "@/lib/rates";
import { handler, json, notFound, conflict } from "@/lib/api-handler";
import { SessionCreateSchema, idSchema } from "@/lib/schemas";

const SessionListQuery = z.object({ driverId: idSchema });

// GET: check for active or overstay sessions by driver ID
export const GET = handler(
  { query: SessionListQuery },
  async ({ query }) => {
    const sessions = await prisma.session.findMany({
      where: { driverId: query.driverId, status: { in: ["ACTIVE", "OVERSTAY"] } },
      include: { spot: true, driver: true, vehicle: true, payments: true },
      orderBy: { startedAt: "desc" },
    });
    return json({
      session: sessions[0] || null,
      activeSessions: sessions,
    });
  },
);

/**
 * POST: free-mode check-in (paymentRequired=false in Settings).
 *
 * Real-money check-ins go through Stripe Checkout → `checkout.session.completed`
 * webhook, which creates Session + Payment atomically. This route exists
 * only so the no-payment test/dev flow and the admin-created manual path
 * can still mint sessions without a payment round-trip.
 *
 * If paymentRequired is true, this route refuses — clients must use
 * /api/payments/checkout to get a Stripe Checkout URL.
 */
export const POST = handler(
  { body: SessionCreateSchema },
  async ({ body }) => {
    const { driverId, vehicleId, durationType, days, months, termsVersion, overstayAuthorized } = body;
    const isMonthly = durationType === "MONTHLY";

    const existingSession = await prisma.session.findFirst({
      where: { vehicleId, status: { in: ["ACTIVE", "OVERSTAY"] } },
    });
    if (existingSession) throw conflict("This vehicle is already parked");

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle || vehicle.driverId !== driverId) throw notFound("Vehicle not found");

    const settings = await getSettings();
    if (termsVersion !== settings.termsVersion) {
      throw conflict("Terms have been updated. Please reload the page and accept the current terms.");
    }
    if (settings.paymentRequired) {
      throw conflict("Payment is required — use /api/payments/checkout to create a Stripe Checkout session");
    }

    const spot = await assignSpot(vehicle.type);
    if (!spot) throw conflict("No available spots for this vehicle type");

    const now = new Date();
    const expectedEnd = isMonthly ? addMonths(now, months!) : addDays(now, days!);
    const paymentType = isMonthly ? "MONTHLY_CHECKIN" : "CHECKIN";
    const durationLabel = isMonthly ? `${months} month${months! > 1 ? "s" : ""}` : `${days}d`;

    // Free-mode Payment row records the event with zero amount. legacyQbReference
    // is repurposed here to flag "this is a free-mode row" so reconciliation
    // reports can filter it out.
    const session = await prisma.session.create({
      data: {
        driverId,
        vehicleId,
        spotId: spot.id,
        expectedEnd,
        termsVersion,
        overstayAuthorized,
        payments: {
          create: {
            type: paymentType,
            amount: 0,
            days: isMonthly ? null : days,
            legacyQbReference: `free_${randomUUID()}`,
          },
        },
      },
      include: { spot: true, driver: true, vehicle: true, payments: true },
    });

    await audit({
      action: "CHECKIN",
      sessionId: session.id,
      driverId,
      vehicleId,
      spotId: spot.id,
      details: `Checked in for ${durationLabel} (payment disabled), plate: ${vehicle.licensePlate}, terms:v${termsVersion}`,
    });

    triggerGateOpen();

    return json({ session }, { status: 201 });
  },
);
