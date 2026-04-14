import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { handler, json } from "@/lib/api-handler";

// ---------------------------------------------------------------------------
// GET: load full lot layout (spots with positions + editor groups)
// ---------------------------------------------------------------------------
export const GET = handler({}, async () => {
  const [spots, settings] = await Promise.all([
    prisma.spot.findMany({
      orderBy: { label: "asc" },
      select: { id: true, label: true, type: true, cx: true, cy: true, w: true, h: true, rot: true },
    }),
    prisma.settings.findFirst({ select: { lotGroups: true } }),
  ]);

  // Convert spots array to Record<id, spot> for editor state
  const spotsMap: Record<string, object> = {};
  for (const s of spots) {
    spotsMap[s.id] = s;
  }

  return json({
    spots: spotsMap,
    groups: settings?.lotGroups ?? [],
  });
});

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const SpotSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["BOBTAIL", "TRUCK_TRAILER"]),
  cx: z.number(),
  cy: z.number(),
  w: z.number(),
  h: z.number(),
  rot: z.number(),
});

const LayoutSaveSchema = z.object({
  spots: z.array(SpotSchema),
  groups: z.any(), // JSON blob — groups are editor UI metadata
});

// ---------------------------------------------------------------------------
// PUT: save full lot layout (admin only)
// ---------------------------------------------------------------------------
export const PUT = handler(
  { body: LayoutSaveSchema },
  async ({ body }) => {
    await requireAdmin();

    const { spots: incoming, groups } = body;
    const incomingIds = new Set(incoming.map((s) => s.id));

    // Get existing spot IDs from DB
    const existing = await prisma.spot.findMany({ select: { id: true } });
    const existingIds = new Set(existing.map((s) => s.id));

    // Upsert all incoming spots
    for (const spot of incoming) {
      await prisma.spot.upsert({
        where: { id: spot.id },
        create: {
          id: spot.id,
          label: spot.label,
          type: spot.type,
          cx: spot.cx,
          cy: spot.cy,
          w: spot.w,
          h: spot.h,
          rot: spot.rot,
        },
        update: {
          label: spot.label,
          type: spot.type,
          cx: spot.cx,
          cy: spot.cy,
          w: spot.w,
          h: spot.h,
          rot: spot.rot,
        },
      });
    }

    // Delete spots that are no longer in the layout — but only if they have no
    // active/overstay sessions attached (sessions are the source of truth for occupancy).
    const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));
    if (toDelete.length > 0) {
      await prisma.spot.deleteMany({
        where: {
          id: { in: toDelete },
          sessions: { none: { status: { in: ["ACTIVE", "OVERSTAY"] } } },
        },
      });
    }

    // Save groups to Settings
    await prisma.settings.upsert({
      where: { id: "default" },
      create: { lotGroups: groups },
      update: { lotGroups: groups },
    });

    return json({ ok: true, spotCount: incoming.length });
  },
);
