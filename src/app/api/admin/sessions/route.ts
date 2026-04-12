import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { freeSpot } from "@/lib/spots";
import { requireAdmin } from "@/lib/auth";
import { log as audit } from "@/lib/audit";
import { handler, json, notFound } from "@/lib/api-handler";

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

    // Complete the session and free the spot
    await prisma.session.update({
      where: { id: sessionId },
      data: { status: "COMPLETED", endedAt: new Date() },
    });

    await freeSpot(session.spotId);

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

    // Complete the session with the backdated end time
    await prisma.session.update({
      where: { id: sessionId },
      data: { status: "COMPLETED", endedAt: closedAt },
    });

    await freeSpot(session.spotId);

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
