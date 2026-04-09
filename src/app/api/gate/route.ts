import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { triggerGateOpen } from "@/lib/gate";
import { log as audit } from "@/lib/audit";
import { handler, json } from "@/lib/api-handler";

const GateOpenBody = z
  .object({
    driverId: z.string().optional(),
    sessionId: z.string().optional(),
    deviceId: z.string().optional(),
    direction: z.enum(["ENTRANCE", "EXIT"]).optional(),
  })
  .optional();

export const POST = handler({ body: GateOpenBody }, async ({ body }) => {
  const { driverId, sessionId, deviceId, direction } = body ?? {};

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
    driverId,
    sessionId,
    details,
  });

  // ── Suspicious entry detection ──
  // If this is an ENTRANCE with a session, check the last gate event for that session.
  // Two consecutive entrances from different devices = potential access sharing.
  if (direction === "ENTRANCE" && sessionId && deviceId) {
    try {
      const recentGateEvents = await prisma.auditLog.findMany({
        where: {
          sessionId,
          action: "GATE_OPEN",
        },
        orderBy: { createdAt: "desc" },
        take: 2, // current + previous
        select: { details: true, createdAt: true },
      });

      // We need at least 2 events (the one we just logged + a previous one)
      if (recentGateEvents.length >= 2) {
        const previous = recentGateEvents[1]; // second most recent
        const prevDetails = previous.details ?? "";

        // Check if previous was also an entrance
        const prevWasEntrance = prevDetails.includes("Gate entrance");

        // Extract previous device ID
        const prevDeviceMatch = prevDetails.match(/device:(\w+)/);
        const prevDevicePrefix = prevDeviceMatch?.[1];
        const currentDevicePrefix = deviceId.slice(0, 8);

        if (prevWasEntrance && prevDevicePrefix && prevDevicePrefix !== currentDevicePrefix) {
          // Two consecutive entrances from different devices
          await audit({
            action: "SUSPICIOUS_ENTRY",
            sessionId,
            driverId,
            details: `Double entrance from different devices — device:${currentDevicePrefix} after device:${prevDevicePrefix}`,
          });
        }
      }
    } catch {
      // Detection failed — don't block the gate open
    }
  }

  return json({ ...result, openedAt: new Date().toISOString() });
});
