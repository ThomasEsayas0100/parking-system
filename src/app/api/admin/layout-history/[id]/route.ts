import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { handler, json, notFound } from "@/lib/api-handler";

// GET /api/admin/layout-history/[id] — single version with full snapshot.
export const GET = handler(
  {},
  async ({ params }) => {
    await requireAdmin();

    const version = await prisma.lotLayoutVersion.findUnique({
      where: { id: params.id },
    });
    if (!version) throw notFound("Version not found");

    return json({ version });
  },
);
