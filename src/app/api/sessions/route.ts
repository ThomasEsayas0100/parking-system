import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assignSpot, freeSpot } from "@/lib/spots";
import { getSettings } from "@/lib/settings";
import { triggerGateOpen } from "@/lib/gate";
import { log as audit } from "@/lib/audit";
import { verifyAndClaimPayment } from "@/lib/payments";
import { hourlyRate, monthlyRate, addHours, addMonths } from "@/lib/rates";
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

// POST: create a new parking session (check-in)
export const POST = handler(
  { body: SessionCreateSchema },
  async ({ body }) => {
    const { driverId, vehicleId, durationType, hours, months, paymentId, termsVersion, overstayAuthorized } = body;
    const isMonthly = durationType === "MONTHLY";

    // Check if this vehicle already has an active or overstay session
    const existingSession = await prisma.session.findFirst({
      where: { vehicleId, status: { in: ["ACTIVE", "OVERSTAY"] } },
    });
    if (existingSession) throw conflict("This vehicle is already parked");

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw notFound("Vehicle not found");

    const settings = await getSettings();

    // Terms version must match the current version in settings
    if (termsVersion !== settings.termsVersion) {
      throw conflict("Terms have been updated. Please reload the page and accept the current terms.");
    }

    // Reserve spot BEFORE verifying payment
    const spot = await assignSpot(vehicle.type);
    if (!spot) throw conflict("No available spots for this vehicle type");

    // Verify payment (skip if payment is disabled in settings)
    if (settings.paymentRequired && paymentId) {
      try {
        await verifyAndClaimPayment(paymentId);
      } catch (err) {
        await freeSpot(spot.id);
        throw err;
      }
    }

    const now = new Date();
    let expectedEnd: Date;
    let amount: number;
    let paymentType: "CHECKIN" | "MONTHLY_CHECKIN";
    let durationLabel: string;

    if (isMonthly) {
      const mths = months!;
      expectedEnd = addMonths(now, mths);
      amount = monthlyRate(settings, vehicle.type) * mths;
      paymentType = "MONTHLY_CHECKIN";
      durationLabel = `${mths} month${mths > 1 ? "s" : ""}`;
    } else {
      const hrs = hours!;
      expectedEnd = addHours(now, hrs);
      amount = hourlyRate(settings, vehicle.type) * hrs;
      paymentType = "CHECKIN";
      durationLabel = `${hrs}h`;
    }

    const session = await prisma.session.create({
      data: {
        driverId,
        vehicleId,
        spotId: spot.id,
        expectedEnd,
        termsVersion,
        overstayAuthorized,
      },
      include: { spot: true, driver: true, vehicle: true, payments: true },
    });

    await prisma.payment.create({
      data: {
        sessionId: session.id,
        type: paymentType,
        externalPaymentId: paymentId || `free_${Date.now()}`,
        amount: settings.paymentRequired ? amount : 0,
        hours: isMonthly ? null : hours,
      },
    });

    await audit({
      action: "CHECKIN",
      sessionId: session.id,
      driverId,
      vehicleId,
      spotId: spot.id,
      details: `Checked in for ${durationLabel}, paid $${amount.toFixed(2)}, plate: ${vehicle.licensePlate}, terms:v${termsVersion}`,
    });

    triggerGateOpen();

    return json({ session }, { status: 201 });
  },
);
