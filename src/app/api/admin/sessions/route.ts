import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { log as audit } from "@/lib/audit";
import { handler, json, notFound, conflict } from "@/lib/api-handler";
import { assignSpot } from "@/lib/spots";
import { getSettings } from "@/lib/settings";
import { hourlyRate, monthlyRate, addHours, addMonths } from "@/lib/rates";
import { verifyAndClaimInvoice } from "@/lib/payments";

// ---------------------------------------------------------------------------
// PUT: edit a session (extend time, change status)
// ---------------------------------------------------------------------------
const SessionEditBody = z.object({
  sessionId: z.string().min(1),
  action: z.enum(["extend", "cancel", "close"]),
  // For extend: how many hours to add
  hours: z.number().int().min(1).max(720).optional(),
  // For cancel/close: reason required
  reason: z.string().min(1).max(500).optional(),
  // For close: backdate the session end to this time
  endedAt: z.string().optional(),
});

export const PUT = handler({ body: SessionEditBody }, async ({ body }) => {
  await requireAdmin();

  const { sessionId, action, hours, reason, endedAt } = body;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { spot: true, driver: true, vehicle: true },
  });

  if (!session) throw notFound("Session not found");

  if (action === "extend") {
    if (!hours) {
      return json({ error: "Hours required for extension" }, { status: 400 });
    }

    if (!["ACTIVE", "OVERSTAY"].includes(session.status)) {
      return json({ error: "Can only extend active or overstay sessions" }, { status: 400 });
    }

    const newEnd = new Date(session.expectedEnd.getTime() + hours * 60 * 60 * 1000);

    // If session was OVERSTAY, extending it brings it back to ACTIVE
    const newStatus = session.status === "OVERSTAY" ? "ACTIVE" : session.status;

    const updated = await prisma.session.update({
      where: { id: sessionId },
      data: { expectedEnd: newEnd, status: newStatus, reminderSent: false },
    });

    await audit({
      action: "EXTEND",
      sessionId,
      driverId: session.driverId,
      vehicleId: session.vehicleId,
      spotId: session.spotId,
      details: `ADMIN extended ${hours}h, new expiry: ${newEnd.toISOString()}, driver: ${session.driver.name}`,
    });

    return json({ session: updated });
  }

  if (action === "cancel") {
    if (!reason) {
      return json({ error: "Reason required for cancellation" }, { status: 400 });
    }

    if (session.status === "COMPLETED") {
      return json({ error: "Session already completed" }, { status: 400 });
    }

    // Void all pending/completed payments — cancelled sessions should not
    // count toward revenue. QB-side charges are the manager's responsibility;
    // we only update our own records here so dashboards stay accurate.
    await prisma.payment.updateMany({
      where: { sessionId, status: { notIn: ["VOIDED", "REFUNDED"] } },
      data: { status: "VOIDED" },
    });

    // Complete the session — spot is implicitly freed (no session referencing it = free)
    await prisma.session.update({
      where: { id: sessionId },
      data: { status: "COMPLETED", endedAt: new Date() },
    });

    await audit({
      action: "SPOT_FREED",
      sessionId,
      driverId: session.driverId,
      vehicleId: session.vehicleId,
      spotId: session.spotId,
      details: `ADMIN cancelled session. Reason: ${reason}. Driver: ${session.driver.name}, Spot: ${session.spot.label}`,
    });

    return json({ success: true, action: "cancelled" });
  }

  if (action === "close") {
    if (!reason) {
      return json({ error: "Reason required" }, { status: 400 });
    }

    if (session.status === "COMPLETED") {
      return json({ error: "Session already completed" }, { status: 400 });
    }

    // Parse the backdated end time, default to now
    const closedAt = endedAt ? new Date(endedAt) : new Date();

    // Validate the date is after session start
    if (closedAt < session.startedAt) {
      return json({ error: "End time cannot be before session start" }, { status: 400 });
    }

    // Delete any overstay payments created after the backdated end time
    // (they shouldn't have been charged if the driver actually left at closedAt)
    const deletedPayments = await prisma.payment.deleteMany({
      where: {
        sessionId,
        type: "OVERSTAY",
        createdAt: { gt: closedAt },
      },
    });

    // Complete the session with the backdated end time (spot implicitly freed)
    await prisma.session.update({
      where: { id: sessionId },
      data: { status: "COMPLETED", endedAt: closedAt },
    });

    await audit({
      action: "SPOT_FREED",
      sessionId,
      driverId: session.driverId,
      vehicleId: session.vehicleId,
      spotId: session.spotId,
      details: `ADMIN closed session (backdated to ${closedAt.toISOString()}). Reason: ${reason}. Driver: ${session.driver.name}. ${deletedPayments.count > 0 ? `Removed ${deletedPayments.count} overstay payment(s).` : ""}`,
    });

    return json({ success: true, action: "closed", endedAt: closedAt.toISOString(), paymentsRemoved: deletedPayments.count });
  }

  return json({ error: "Unknown action" }, { status: 400 });
});

// ---------------------------------------------------------------------------
// POST: Admin creates a session manually (driver came to office rather than scanning)
// ---------------------------------------------------------------------------

const AdminSessionCreateSchema = z.object({
  // Driver
  name: z.string().trim().min(1, "Name required").max(120),
  phone: z.string().regex(/^\d{10}$/, "Phone must be exactly 10 digits"),
  email: z.union([z.string().email("Invalid email").max(200), z.literal("")]).optional(),
  // Vehicle
  vehicleType: z.enum(["BOBTAIL", "TRUCK_TRAILER"]),
  licensePlate: z.string().trim().max(20).optional(),
  unitNumber: z.string().trim().max(50).optional(),
  nickname: z.string().trim().max(80).optional(),
  // Duration
  durationType: z.enum(["HOURLY", "MONTHLY"]),
  hours: z.number().int().min(1).max(72).optional(),
  months: z.number().int().min(1).max(12).optional(),
  // Spot (omit for auto-assign)
  spotId: z.string().min(1).max(200).optional(),
  // QB invoice ID — required when paymentRequired is true, optional otherwise
  invoiceId: z.string().min(1).max(200).optional(),
}).refine(
  (d) => d.licensePlate || d.unitNumber,
  { message: "Provide license plate or unit number", path: ["licensePlate"] }
).refine(
  (d) => (d.durationType === "HOURLY" ? d.hours != null : d.months != null),
  { message: "Provide hours (HOURLY) or months (MONTHLY)", path: ["hours"] }
);

export const POST = handler(
  { body: AdminSessionCreateSchema },
  async ({ body }) => {
    await requireAdmin();

    const {
      name, phone, email, vehicleType,
      licensePlate, unitNumber, nickname,
      durationType, hours, months,
      spotId, invoiceId,
    } = body;

    const settings = await getSettings();

    // ── Upsert driver by phone ───────────────────────────────────────────────
    let driver = await prisma.driver.findUnique({ where: { phone } });
    if (driver) {
      driver = await prisma.driver.update({
        where: { id: driver.id },
        data: { name, ...(email ? { email } : {}) },
      });
    } else {
      driver = await prisma.driver.create({
        data: { phone, name, email: email || "" },
      });
    }

    // ── Upsert vehicle for this driver ───────────────────────────────────────
    const vehicleWhere = {
      driverId: driver.id,
      OR: [
        ...(licensePlate ? [{ licensePlate }] : []),
        ...(unitNumber ? [{ unitNumber }] : []),
      ] as object[],
    };

    let vehicle = await prisma.vehicle.findFirst({ where: vehicleWhere });
    if (vehicle) {
      vehicle = await prisma.vehicle.update({
        where: { id: vehicle.id },
        data: {
          type: vehicleType,
          ...(licensePlate && { licensePlate }),
          ...(unitNumber && { unitNumber }),
          ...(nickname && { nickname }),
        },
      });
    } else {
      vehicle = await prisma.vehicle.create({
        data: {
          driverId: driver.id,
          type: vehicleType,
          licensePlate: licensePlate || null,
          unitNumber: unitNumber || null,
          nickname: nickname || null,
        },
      });
    }

    // ── Check for existing active session ────────────────────────────────────
    const existingSession = await prisma.session.findFirst({
      where: { vehicleId: vehicle.id, status: { in: ["ACTIVE", "OVERSTAY"] } },
    });
    if (existingSession) {
      throw conflict("This vehicle already has an active session");
    }

    // ── Verify QB invoice ────────────────────────────────────────────────────
    // When payments are required, invoiceId is mandatory and must be verified.
    // When payments are disabled, use a synthetic ID to avoid collisions
    // if the setting is later flipped back on.
    let externalPaymentId: string;
    if (settings.paymentRequired) {
      if (!invoiceId) {
        throw conflict("Invoice ID is required when payments are enabled");
      }
      await verifyAndClaimInvoice(invoiceId);
      externalPaymentId = invoiceId;
    } else {
      externalPaymentId = `free_admin_${randomUUID()}`;
    }

    // ── Assign spot ──────────────────────────────────────────────────────────
    let spot;
    if (spotId) {
      spot = await prisma.spot.findFirst({
        where: {
          id: spotId,
          sessions: { none: { status: { in: ["ACTIVE", "OVERSTAY"] } } },
        },
      });
      if (!spot) throw conflict("Selected spot is not available");
    } else {
      spot = await assignSpot(vehicleType);
      if (!spot) throw conflict("No available spots for this vehicle type");
    }

    // ── Calculate duration & amount ──────────────────────────────────────────
    const isMonthly = durationType === "MONTHLY";
    const now = new Date();

    let expectedEnd: Date;
    let amount: number;
    let paymentType: "CHECKIN" | "MONTHLY_CHECKIN";
    let durationLabel: string;

    if (isMonthly) {
      const mths = months!;
      expectedEnd = addMonths(now, mths);
      amount = monthlyRate(settings, vehicleType) * mths;
      paymentType = "MONTHLY_CHECKIN";
      durationLabel = `${mths} month${mths > 1 ? "s" : ""}`;
    } else {
      const hrs = hours!;
      expectedEnd = addHours(now, hrs);
      amount = hourlyRate(settings, vehicleType) * hrs;
      paymentType = "CHECKIN";
      durationLabel = `${hrs}h`;
    }

    // ── Create session ───────────────────────────────────────────────────────
    const session = await prisma.session.create({
      data: {
        id: randomUUID(),
        driverId: driver.id,
        vehicleId: vehicle.id,
        spotId: spot.id,
        startedAt: now,
        expectedEnd,
        status: "ACTIVE",
        termsVersion: settings.termsVersion,
        overstayAuthorized: false,
        payments: {
          create: {
            id: randomUUID(),
            type: paymentType,
            externalPaymentId,
            amount: settings.paymentRequired ? amount : 0,
            status: "COMPLETED",
          },
        },
      },
      include: { spot: true, vehicle: true, driver: true },
    });

    await audit({
      action: "CHECKIN",
      sessionId: session.id,
      driverId: driver.id,
      vehicleId: vehicle.id,
      spotId: spot.id,
      details: `ADMIN created session for ${name} — ${durationLabel}, $${(settings.paymentRequired ? amount : 0).toFixed(2)}, spot ${spot.label}, payment ${externalPaymentId}`,
    });

    return json({ session }, { status: 201 });
  }
);
