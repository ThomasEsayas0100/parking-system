import { prisma } from "@/lib/prisma";
import { handler, json } from "@/lib/api-handler";
import { requireAdmin } from "@/lib/auth";
import { SessionHistoryQuerySchema } from "@/lib/schemas";
import type { Prisma } from "@/generated/prisma/client";

// GET /api/sessions/history — browse historical sessions with filters
//
// Filters:
//   driverId, vehicleId, spotId  — exact match
//   licensePlate, spotLabel      — case-insensitive prefix match
//   status                       — ACTIVE | COMPLETED | OVERSTAY
//   from, to                     — startedAt range
//   q                            — fuzzy search across plate/unit/name/phone/spot label
//   limit (default 50, max 200)
//   offset (default 0)
//
// Admin-only: session history contains PII.
export const GET = handler(
  { query: SessionHistoryQuerySchema },
  async ({ query }) => {
    await requireAdmin();

    const {
      driverId,
      vehicleId,
      spotId,
      licensePlate,
      spotLabel,
      status,
      from,
      to,
      q,
      limit,
      offset,
    } = query;

    // spotLabel + q both emit OR clauses. If we spread them into the same
    // object only one survives — so collect into AND.
    const andClauses: Prisma.SessionWhereInput[] = [];
    if (spotLabel) {
      // Match either the snapshot (historical) or the spot's current label
      // (for sessions created before snapshotting was added).
      andClauses.push({
        OR: [
          { spotLabelSnapshot: { contains: spotLabel, mode: "insensitive" } },
          { spot: { label: { contains: spotLabel, mode: "insensitive" } } },
        ],
      });
    }
    if (q) {
      andClauses.push({
        OR: [
          { driver: { name: { contains: q, mode: "insensitive" } } },
          { driver: { phone: { contains: q, mode: "insensitive" } } },
          { driver: { email: { contains: q, mode: "insensitive" } } },
          { vehicle: { licensePlate: { contains: q, mode: "insensitive" } } },
          { vehicle: { unitNumber: { contains: q, mode: "insensitive" } } },
          { spotLabelSnapshot: { contains: q, mode: "insensitive" } },
          { spot: { label: { contains: q, mode: "insensitive" } } },
        ],
      });
    }

    const where: Prisma.SessionWhereInput = {
      ...(driverId ? { driverId } : {}),
      ...(vehicleId ? { vehicleId } : {}),
      ...(spotId ? { spotId } : {}),
      ...(status ? { status } : {}),
      ...(from || to
        ? {
            startedAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      ...(licensePlate
        ? {
            vehicle: {
              licensePlate: {
                contains: licensePlate,
                mode: "insensitive",
              },
            },
          }
        : {}),
      ...(andClauses.length ? { AND: andClauses } : {}),
    };

    const [sessions, total] = await Promise.all([
      prisma.session.findMany({
        where,
        orderBy: { startedAt: "desc" },
        skip: offset,
        take: limit,
        include: {
          driver: { select: { id: true, name: true, email: true, phone: true } },
          vehicle: {
            select: {
              id: true,
              unitNumber: true,
              licensePlate: true,
              type: true,
              nickname: true,
            },
          },
          spot: { select: { id: true, label: true, type: true } },
          payments: {
            select: {
              id: true,
              type: true,
              externalPaymentId: true,
              amount: true,
              hours: true,
              status: true,
              refundedAmount: true,
              refundedAt: true,
              refundExternalId: true,
              createdAt: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
      }),
      prisma.session.count({ where }),
    ]);

    return json({
      sessions,
      total,
      limit,
      offset,
      hasMore: offset + sessions.length < total,
    });
  },
);
