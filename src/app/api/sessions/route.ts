import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assignSpot } from "@/lib/spots";
import { getSettings } from "@/lib/settings";
import { triggerGateOpen } from "@/lib/gate";
import { log as audit } from "@/lib/audit";
import { verifyAndClaimInvoice } from "@/lib/payments";
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
    // 404 (not 403) on ownership mismatch so we don't leak existence of
    // vehicles belonging to other drivers.
    if (!vehicle || vehicle.driverId !== driverId) throw notFound("Vehicle not found");

    const settings = await getSettings();

    // Terms version must match the current version in settings
    if (termsVersion !== settings.termsVersion) {
      throw conflict("Terms have been updated. Please reload the page and accept the current terms.");
    }

    // Find an available spot (pure read — no lock).
    // If payment fails below, no rollback is needed since we haven't written anything yet.
    const spot = await assignSpot(vehicle.type);
    if (!spot) throw conflict("No available spots for this vehicle type");

    // Verify payment (skip if payment is disabled in settings).
    // Check-in uses the **invoice** path (hosted checkout), so we
    // require the invoice to be fully paid — not partial, not voided.
    if (settings.paymentRequired && paymentId) {
      await verifyAndClaimInvoice(paymentId);
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

    // Atomic create: session + payment in one write so we can't end up
    // with an orphaned session if the payment insert fails. Prisma wraps
    // nested creates in an implicit transaction.
    //
    // If two requests race on the same paymentId, the DB unique constraint
    // on Payment.externalPaymentId turns the loser into P2002, which we
    // catch below and rethrow as a clean 409.
    let session;
    try {
      session = await prisma.session.create({
        data: {
          driverId,
          vehicleId,
          spotId: spot.id,
          expectedEnd,
          termsVersion,
          overstayAuthorized,
          // Freeze the spot label at check-in time so future renames can't
          // rewrite this session's history. See src/lib/sessions.ts.
          spotLabelSnapshot: spot.label,
          payments: {
            create: {
              type: paymentType,
              externalPaymentId: paymentId || `free_${randomUUID()}`,
              amount: settings.paymentRequired ? amount : 0,
              hours: isMonthly ? null : hours,
            },
          },
        },
        include: { spot: true, driver: true, vehicle: true, payments: true },
      });
    } catch (err) {
      if (err instanceof Error && (err as { code?: string }).code === "P2002") {
        throw conflict("This payment has already been used for another session");
      }
      throw err;
    }

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
