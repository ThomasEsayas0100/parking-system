import { prisma } from "./prisma";
import { VehicleType } from "@/generated/prisma/client";
import { getSettings } from "./settings";

export async function assignSpot(vehicleType: VehicleType) {
  const spotType = vehicleType === "BOBTAIL" ? "BOBTAIL" : "TRUCK_TRAILER";

  // Try to find a spot matching the vehicle type
  let spot = await prisma.spot.findFirst({
    where: { type: spotType, status: "AVAILABLE" },
    orderBy: { label: "asc" },
  });

  // Bobtail overflow: if no bobtail spots available, try truck spots
  // (a bobtail can fit in a truck spot, but not vice versa)
  if (!spot && spotType === "BOBTAIL") {
    const settings = await getSettings();
    if (settings.bobtailOverflow) {
      spot = await prisma.spot.findFirst({
        where: { type: "TRUCK_TRAILER", status: "AVAILABLE" },
        orderBy: { label: "asc" },
      });
    }
  }

  if (!spot) return null;

  await prisma.spot.update({
    where: { id: spot.id },
    data: { status: "OCCUPIED" },
  });

  return spot;
}

export async function freeSpot(spotId: string) {
  await prisma.spot.update({
    where: { id: spotId },
    data: { status: "AVAILABLE" },
  });
}
