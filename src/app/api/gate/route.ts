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

/** Log a gate denial and return 403. */
async function deny(
  reason: string,
  ctx: { sessionId?: string; driverId?: string; deviceId?: string; direction?: string },
) {
  const dirLabel = ctx.direction === "EXIT" ? "exit" : "entrance";
  await audit({
    action: "GATE_DENIED",
    sessionId: ctx.sessionId,
    driverId: ctx.driverId,
    details: [
      `Gate ${dirLabel} denied: ${reason}`,
      ctx.deviceId ? `device:${ctx.deviceId.slice(0, 8)}` : null,
    ].filter(Boolean).join(" — "),
  }).catch(() => {}); // best-effort logging
  return json({ success: false, error: reason }, { status: 403 });
}

export const POST = handler({ body: GateOpenBody }, async ({ body }) => {
  const { sessionId, driverId, deviceId, direction } = body;
  const ctx = { sessionId, driverId, deviceId, direction };

  // ── Session validation ──
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, driverId: true, expectedEnd: true },
  });

  if (!session) {
    return deny("No session found", ctx);
  }

  if (!["ACTIVE", "OVERSTAY"].includes(session.status)) {
    return deny("Session is not active", { ...ctx, driverId: driverId ?? session.driverId });
  }

  if (direction === "ENTRANCE" && session.status === "OVERSTAY") {
    return deny("Session expired — settle overstay first", { ...ctx, driverId: driverId ?? session.driverId });
  }

  if (driverId && session.driverId !== driverId) {
    return deny("Session does not belong to this driver", ctx);
  }

  // ── Gate opens ──
  const result = await triggerGateOpen();

  const dirLabel = direction === "EXIT" ? "Exit" : "Entrance";
  const details = [
    `Gate ${dirLabel.toLowerCase()} via QR scan`,
    deviceId ? `device:${deviceId.slice(0, 8)}` : null,
  ].filter(Boolean).join(" — ");

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
