import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { handler, json, notFound } from "@/lib/api-handler";

// ---------------------------------------------------------------------------
// GET: search/list drivers (admin only)
// ---------------------------------------------------------------------------
const DriversQuery = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const GET = handler({ query: DriversQuery }, async ({ query }) => {
  await requireAdmin();

  const { q, limit, offset } = query;

  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q.replace(/\D/g, "") } },
          { email: { contains: q, mode: "insensitive" as const } },
          {
            vehicles: {
              some: {
                OR: [
                  { licensePlate: { contains: q, mode: "insensitive" as const } },
                  { unitNumber: { contains: q, mode: "insensitive" as const } },
                ],
              },
            },
          },
        ],
      }
    : {};

  const [drivers, total] = await Promise.all([
    prisma.driver.findMany({
      where,
      include: {
        vehicles: true,
        sessions: {
          where: { status: { in: ["ACTIVE", "OVERSTAY"] } },
          include: { spot: true },
          orderBy: { startedAt: "desc" },
          take: 1,
        },
        _count: { select: { sessions: true } },
      },
      orderBy: { name: "asc" },
      take: limit,
      skip: offset,
    }),
    prisma.driver.count({ where }),
  ]);

  return json({ drivers, total, limit, offset, hasMore: offset + drivers.length < total });
});

// ---------------------------------------------------------------------------
// PUT: update a driver's info (admin only)
// ---------------------------------------------------------------------------
const DriverUpdateBody = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(4).max(20).optional(),
});

export const PUT = handler({ body: DriverUpdateBody }, async ({ body }) => {
  await requireAdmin();

  const { id, name, email, phone } = body;

  const driver = await prisma.driver.findUnique({ where: { id } });
  if (!driver) throw notFound("Driver not found");

  const updated = await prisma.driver.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(phone !== undefined ? { phone: phone.replace(/\D/g, "") } : {}),
    },
    include: { vehicles: true },
  });

  return json({ driver: updated });
});
