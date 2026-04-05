import { prisma } from "@/lib/prisma";
import { freeSpot } from "@/lib/spots";
import { log as audit } from "@/lib/audit";
import { handler, json, notFound } from "@/lib/api-handler";
import { SpotOverrideSchema } from "@/lib/schemas";
import { requireAdmin } from "@/lib/auth";

// POST: manager override — free a spot / end a session manually
export const POST = handler(
  { body: SpotOverrideSchema },
  async ({ body }) => {
    await requireAdmin();
    const { spotId, action, reason } = body;

    const spot = await prisma.spot.findUnique({
      where: { id: spotId },
      include: {
        sessions: {
          where: { status: "ACTIVE" },
          include: { driver: true, vehicle: true },
        },
      },
    });

    if (!spot) throw notFound("Spot not found");

    if (action === "free") {
      for (const session of spot.sessions) {
        await prisma.session.update({
          where: { id: session.id },
          data: { status: "COMPLETED", endedAt: new Date() },
        });

        await audit({
          action: "SPOT_FREED",
          sessionId: session.id,
          driverId: session.driverId,
          vehicleId: session.vehicleId,
          spotId: spot.id,
          details: `MANAGER OVERRIDE: Spot ${spot.label} freed. Reason: ${reason}. Driver: ${session.driver.name}, Plate: ${session.vehicle.licensePlate}`,
        });
      }

      await freeSpot(spotId);

      return json({ success: true, action: "freed", spotLabel: spot.label });
    }

    // Schema enum makes this unreachable, but TypeScript exhaustiveness:
    return json({ success: false }, { status: 400 });
  },
);
