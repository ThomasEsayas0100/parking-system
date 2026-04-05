import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, json } from "@/lib/api-handler";
import { VehicleTypeSchema } from "@/lib/schemas";

const SpotsQuery = z.object({
  type: VehicleTypeSchema.optional(),
  status: z.enum(["AVAILABLE", "OCCUPIED"]).optional(),
});

export const GET = handler(
  { query: SpotsQuery },
  async ({ query }) => {
    const spots = await prisma.spot.findMany({
      where: query,
      orderBy: { label: "asc" },
      include: {
        sessions: {
          where: { status: "ACTIVE" },
          include: { driver: true, vehicle: true },
        },
      },
    });
    return json({ spots });
  },
);
