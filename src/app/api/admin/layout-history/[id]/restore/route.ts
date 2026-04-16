import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { handler, json, notFound, badRequest } from "@/lib/api-handler";
import { applyLayoutAndCreateVersion, type LotLayoutSnapshot } from "@/lib/lot-layout";

const RestoreBody = z.object({
  message: z.string().max(200).optional(),
});

// POST /api/admin/layout-history/[id]/restore — non-destructive restore.
// Applies the target version's snapshot as a brand new version (parentId is
// the current latest, restoredFromId points back at the source). Previous
// history is preserved.
export const POST = handler(
  { body: RestoreBody },
  async ({ body, params }) => {
    const auth = await requireAdmin();

    const source = await prisma.lotLayoutVersion.findUnique({
      where: { id: params.id },
      select: { id: true, snapshot: true },
    });
    if (!source) throw notFound("Version not found");

    const snap = source.snapshot as unknown as LotLayoutSnapshot | null;
    if (!snap || !Array.isArray(snap.spots)) {
      throw badRequest("Version snapshot is malformed");
    }

    const result = await applyLayoutAndCreateVersion({
      spots: snap.spots,
      groups: snap.groups ?? [],
      message: body.message ?? `Restored version ${source.id.slice(0, 8)}`,
      restoredFromId: source.id,
      createdBy: auth.sub || "admin",
    });

    return json({ ok: true, version: result.version });
  },
);
