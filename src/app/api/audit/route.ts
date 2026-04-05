import { prisma } from "@/lib/prisma";
import { handler, json } from "@/lib/api-handler";
import { AuditQuerySchema } from "@/lib/schemas";

export const GET = handler(
  { query: AuditQuerySchema },
  async ({ query }) => {
    const { limit, vehicleId, driverId, spotId } = query;

    const logs = await prisma.auditLog.findMany({
      where: {
        ...(vehicleId ? { vehicleId } : {}),
        ...(driverId ? { driverId } : {}),
        ...(spotId ? { spotId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        driver: { select: { name: true, phone: true } },
        vehicle: { select: { licensePlate: true, type: true } },
        spot: { select: { label: true } },
      },
    });

    return json({ logs });
  },
);
