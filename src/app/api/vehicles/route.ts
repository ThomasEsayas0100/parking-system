import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, json, badRequest } from "@/lib/api-handler";
import { VehicleUpsertSchema, idSchema } from "@/lib/schemas";

const VehicleListQuery = z.object({ driverId: idSchema });

// GET: list vehicles for a driver
export const GET = handler(
  { query: VehicleListQuery },
  async ({ query }) => {
    const vehicles = await prisma.vehicle.findMany({
      where: { driverId: query.driverId },
      orderBy: { createdAt: "desc" },
    });
    return json({ vehicles });
  },
);

// POST: add or update a vehicle for a driver
export const POST = handler(
  { body: VehicleUpsertSchema },
  async ({ body }) => {
    const { driverId, unitNumber, licensePlate, type, nickname } = body;

    // Ensure the driver exists (schema checks shape but not referential integrity)
    const driver = await prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw badRequest("Driver not found");

    const existing = await prisma.vehicle.findFirst({
      where: {
        driverId,
        OR: [
          ...(unitNumber ? [{ unitNumber }] : []),
          ...(licensePlate ? [{ licensePlate }] : []),
        ],
      },
    });

    if (existing) {
      const vehicle = await prisma.vehicle.update({
        where: { id: existing.id },
        data: { unitNumber, licensePlate, type, nickname },
      });
      return json({ vehicle });
    }

    const vehicle = await prisma.vehicle.create({
      data: { driverId, unitNumber, licensePlate, type, nickname },
    });
    return json({ vehicle }, { status: 201 });
  },
);
