import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { handler, json } from "@/lib/api-handler";
import { applyLayoutAndCreateVersion } from "@/lib/lot-layout";

// ---------------------------------------------------------------------------
// GET: load current lot layout (non-archived spots only + editor groups)
// ---------------------------------------------------------------------------
export const GET = handler({}, async () => {
  const [spots, settings] = await Promise.all([
    prisma.spot.findMany({
      where: { archivedAt: null },
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
  message: z.string().max(200).optional(),
  restoredFromId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// PUT: save full lot layout (admin only).
// Creates a LotLayoutVersion row for every save and archives spots that are
// removed from the layout — see src/lib/lot-layout.ts for details.
// ---------------------------------------------------------------------------
export const PUT = handler(
  { body: LayoutSaveSchema },
  async ({ body }) => {
    const auth = await requireAdmin();

    const result = await applyLayoutAndCreateVersion({
      spots: body.spots,
      groups: body.groups,
      message: body.message ?? null,
      restoredFromId: body.restoredFromId ?? null,
      createdBy: auth.sub || "admin",
    });

    return json({
      ok: true,
      spotCount: body.spots.length,
      version: result.version,
    });
  },
);
