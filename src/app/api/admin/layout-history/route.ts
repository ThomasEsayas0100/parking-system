import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { handler, json } from "@/lib/api-handler";

const ListQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// GET /api/admin/layout-history — list versions (most recent first).
// Omits the full snapshot (can be large) from the list; clients that need
// a snapshot call the detail endpoint.
export const GET = handler(
  { query: ListQuery },
  async ({ query }) => {
    await requireAdmin();

    const rows = await prisma.lotLayoutVersion.findMany({
      orderBy: { createdAt: "desc" },
      take: query.limit + 1,
      ...(query.cursor
        ? { cursor: { id: query.cursor }, skip: 1 }
        : {}),
      select: {
        id: true,
        createdAt: true,
        createdBy: true,
        message: true,
        spotCount: true,
        diffSummary: true,
        parentId: true,
        restoredFromId: true,
      },
    });

    const hasMore = rows.length > query.limit;
    const versions = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? versions[versions.length - 1].id : null;

    return json({ versions, nextCursor });
  },
);
