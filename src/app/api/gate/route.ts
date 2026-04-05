import { z } from "zod";
import { triggerGateOpen } from "@/lib/gate";
import { log as audit } from "@/lib/audit";
import { handler, json } from "@/lib/api-handler";

const GateOpenBody = z.object({
  driverId: z.string().optional(),
  sessionId: z.string().optional(),
}).optional();

export const POST = handler({ body: GateOpenBody }, async ({ body }) => {
  const result = await triggerGateOpen();

  await audit({
    action: "GATE_OPEN",
    driverId: body?.driverId,
    sessionId: body?.sessionId,
    details: "Gate opened via QR scan",
  });

  return json({ ...result, openedAt: new Date().toISOString() });
});
