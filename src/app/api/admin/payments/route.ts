import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { handler, json } from "@/lib/api-handler";

const PaymentsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  type: z.enum(["CHECKIN", "MONTHLY_CHECKIN", "EXTENSION", "OVERSTAY"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().optional(),
});

export const GET = handler({ query: PaymentsQuery }, async ({ query }) => {
  await requireAdmin();

  const { limit, offset, type, from, to, q } = query;

  const where: Record<string, unknown> = {};
  if (type) where.type = type;
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }
  if (q) {
    where.OR = [
      { session: { driver: { name: { contains: q, mode: "insensitive" } } } },
      { session: { driver: { phone: { contains: q.replace(/\D/g, "") } } } },
      { session: { vehicle: { licensePlate: { contains: q, mode: "insensitive" } } } },
      { externalPaymentId: { contains: q } },
    ];
  }

  const [payments, total, totals] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: {
        session: {
          include: {
            driver: { select: { name: true, phone: true } },
            vehicle: { select: { licensePlate: true, type: true } },
            spot: { select: { label: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.payment.count({ where }),
    // Aggregate totals by type
    prisma.payment.groupBy({
      by: ["type"],
      where: {
        ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
      },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  // Compute summary
  const summary = {
    totalRevenue: 0,
    checkinRevenue: 0,
    monthlyRevenue: 0,
    extensionRevenue: 0,
    overstayRevenue: 0,
    transactionCount: 0,
  };
  for (const t of totals) {
    const amt = t._sum.amount ?? 0;
    summary.totalRevenue += amt;
    summary.transactionCount += t._count;
    if (t.type === "CHECKIN") summary.checkinRevenue = amt;
    if (t.type === "MONTHLY_CHECKIN") summary.monthlyRevenue = amt;
    if (t.type === "EXTENSION") summary.extensionRevenue = amt;
    if (t.type === "OVERSTAY") summary.overstayRevenue = amt;
  }

  return json({
    payments,
    total,
    limit,
    offset,
    hasMore: offset + payments.length < total,
    summary,
  });
});
