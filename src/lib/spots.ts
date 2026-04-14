import { prisma } from "./prisma";
import { VehicleType } from "@/generated/prisma/client";
import { getSettings } from "./settings";

/**
 * Find a free spot for the given vehicle type.
 *
 * A spot is "free" iff no Session references it with status ACTIVE or OVERSTAY.
 * This is a pure read — no DB writes, no locks. The authoritative source of
 * truth is the Session table (see docs/DATA_MODEL.md invariant #4).
 *
 * Race note: two concurrent check-ins could theoretically claim the same spot
 * between this query and the caller's session.create(). At single-lot scale
 * (< ~5 concurrent check-ins ever) this window is negligible — no worse than
 * the prior implementation, which also had a non-atomic findFirst + update.
 * A hold table / serializable tx would be the right fix once concurrency is real.
 */
export async function assignSpot(vehicleType: VehicleType) {
  const freeOfActiveSession = {
    sessions: { none: { status: { in: ["ACTIVE" as const, "OVERSTAY" as const] } } },
  };

  let spot = await prisma.spot.findFirst({
    where: { type: vehicleType, ...freeOfActiveSession },
    orderBy: { label: "asc" },
  });

  // Bobtail overflow: a bobtail can fit in a truck spot (but not vice versa)
  if (!spot && vehicleType === "BOBTAIL") {
    const settings = await getSettings();
    if (settings.bobtailOverflow) {
      spot = await prisma.spot.findFirst({
        where: { type: "TRUCK_TRAILER", ...freeOfActiveSession },
        orderBy: { label: "asc" },
      });
    }
  }

  return spot;
}
