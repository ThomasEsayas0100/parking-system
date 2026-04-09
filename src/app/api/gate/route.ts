import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { triggerGateOpen } from "@/lib/gate";
import { log as audit } from "@/lib/audit";
import { handler, json } from "@/lib/api-handler";

const GateOpenBody = z.object({
  sessionId: z.string().min(1, "Session ID required"),
  driverId: z.string().optional(),
  deviceId: z.string().optional(),
  direction: z.enum(["ENTRANCE", "EXIT"]).optional(),
});

export const POST = handler({ body: GateOpenBody }, async ({ body }) => {
  const { sessionId, driverId, deviceId, direction } = body;

  // ── Session validation — gate only opens for valid, non-expired sessions ──
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, driverId: true, expectedEnd: true },
  });

  if (!session) {
    return json({ success: false, error: "No session found" }, { status: 403 });
  }

  if (!["ACTIVE", "OVERSTAY"].includes(session.status)) {
    return json({ success: false, error: "Session is not active" }, { status: 403 });
  }

  // For ENTRANCE: only allow if session hasn't expired (OVERSTAY can still exit but not enter)
  if (direction === "ENTRANCE" && session.status === "OVERSTAY") {
    return json({ success: false, error: "Session has expired — please settle overstay first" }, { status: 403 });
  }

  // Verify the driver matches the session (if driverId provided)
  if (driverId && session.driverId !== driverId) {
    return json({ success: false, error: "Session does not belong to this driver" }, { status: 403 });
  }

  // ── Gate opens ──
  const result = await triggerGateOpen();

  const dirLabel = direction === "EXIT" ? "Exit" : "Entrance";
  const details = [
    `Gate ${dirLabel.toLowerCase()} via QR scan`,
    deviceId ? `device:${deviceId.slice(0, 8)}` : null,
  ]
    .filter(Boolean)
    .join(" — ");

  await audit({
    action: "GATE_OPEN",
    driverId: driverId ?? session.driverId,
    sessionId,
    details,
  });

  // ── Suspicious entry detection ──
  if (direction === "ENTRANCE" && deviceId) {
    try {
      const recentGateEvents = await prisma.auditLog.findMany({
        where: { sessionId, action: "GATE_OPEN" },
        orderBy: { createdAt: "desc" },
        take: 2,
        select: { details: true, createdAt: true },
      });

      if (recentGateEvents.length >= 2) {
        const previous = recentGateEvents[1];
        const prevDetails = previous.details ?? "";
        const prevWasEntrance = prevDetails.includes("Gate entrance");
        const prevDeviceMatch = prevDetails.match(/device:(\w+)/);
        const prevDevicePrefix = prevDeviceMatch?.[1];
        const currentDevicePrefix = deviceId.slice(0, 8);

        if (prevWasEntrance && prevDevicePrefix && prevDevicePrefix !== currentDevicePrefix) {
          await audit({
            action: "SUSPICIOUS_ENTRY",
            sessionId,
            driverId: driverId ?? session.driverId,
            details: `Double entrance from different devices — device:${currentDevicePrefix} after device:${prevDevicePrefix}`,
          });
        }
      }
    } catch {
      // Detection failed — don't block the gate
    }
  }

  return json({ ...result, openedAt: new Date().toISOString() });
});
