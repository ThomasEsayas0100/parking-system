import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function backfill() {
  console.log("=== Backfilling lot history ===");

  // 1. Populate Session.spotLabelSnapshot for rows where it's still empty.
  const emptyRows = await prisma.session.findMany({
    where: { spotLabelSnapshot: "" },
    select: { id: true, spot: { select: { label: true } } },
  });
  console.log(`Sessions missing snapshot: ${emptyRows.length}`);
  let backfilled = 0;
  for (const row of emptyRows) {
    if (!row.spot?.label) continue;
    await prisma.session.update({
      where: { id: row.id },
      data: { spotLabelSnapshot: row.spot.label },
    });
    backfilled++;
  }
  console.log(`Backfilled ${backfilled} session label snapshots`);

  // 2. Create a baseline LotLayoutVersion if none exists yet.
  const versionCount = await prisma.lotLayoutVersion.count();
  if (versionCount === 0) {
    const [spots, settings] = await Promise.all([
      prisma.spot.findMany({
        where: { archivedAt: null },
        select: { id: true, label: true, type: true, cx: true, cy: true, w: true, h: true, rot: true },
        orderBy: { label: "asc" },
      }),
      prisma.settings.findFirst({ select: { lotGroups: true } }),
    ]);
    const snapshot = {
      spots,
      groups: (settings?.lotGroups as unknown) ?? [],
    };
    await prisma.lotLayoutVersion.create({
      data: {
        createdBy: "system",
        message: "Initial baseline (backfill)",
        spotCount: spots.length,
        snapshot: snapshot as object,
        diffSummary: undefined,
        parentId: null,
        restoredFromId: null,
      },
    });
    console.log(`Created baseline version with ${spots.length} spots`);
  } else {
    console.log(`Versions already exist (${versionCount}), skipping baseline`);
  }

  console.log("\n✓ Backfill complete");
}

backfill()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
