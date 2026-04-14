import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, json } from "@/lib/api-handler";
import { VehicleTypeSchema } from "@/lib/schemas";

const SpotsQuery = z.object({
  type: VehicleTypeSchema.optional(),
});

export const GET = handler(
  { query: SpotsQuery },
  async ({ query }) => {
    const spots = await prisma.spot.findMany({
      where: query,
      orderBy: { label: "asc" },
      include: {
        sessions: {
          where: { status: { in: ["ACTIVE", "OVERSTAY"] } },
          include: { driver: true, vehicle: true },
          orderBy: { startedAt: "desc" },
          take: 1,
        },
      },
    });
    return json({ spots });
  },
);
