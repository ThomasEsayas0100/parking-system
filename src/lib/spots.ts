import { prisma } from "./prisma";
import { VehicleType } from "@/generated/prisma/client";

export async function assignSpot(vehicleType: VehicleType) {
  const spotType = vehicleType === "BOBTAIL" ? "BOBTAIL" : "TRUCK_TRAILER";

  const spot = await prisma.spot.findFirst({
    where: { type: spotType, status: "AVAILABLE" },
    orderBy: { label: "asc" },
  });

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
