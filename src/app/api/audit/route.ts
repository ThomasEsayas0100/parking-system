import { prisma } from "@/lib/prisma";
import { handler, json } from "@/lib/api-handler";
import { AuditQuerySchema } from "@/lib/schemas";

export const GET = handler(
  { query: AuditQuerySchema },
  async ({ query }) => {
    const { limit, offset, action, vehicleId, driverId, spotId } = query;

    const where = {
      ...(action ? { action } : {}),
      ...(vehicleId ? { vehicleId } : {}),
      ...(driverId ? { driverId } : {}),
      ...(spotId ? { spotId } : {}),
    };

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          driver: { select: { name: true, phone: true } },
          vehicle: { select: { licensePlate: true, type: true } },
          spot: { select: { label: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return json({ logs, total, limit, offset, hasMore: offset + logs.length < total });
  },
);
