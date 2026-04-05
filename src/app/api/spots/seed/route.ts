import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { handler, json, conflict } from "@/lib/api-handler";
import { requireAdmin } from "@/lib/auth";

// POST: seed spots based on settings (for initial setup)
export const POST = handler({}, async () => {
  await requireAdmin();

  const settings = await getSettings();

  const existingCount = await prisma.spot.count();
  if (existingCount > 0) {
    throw conflict("Spots already seeded. Delete existing spots first.");
  }

  const spots: { label: string; type: "TRUCK_TRAILER" | "BOBTAIL" }[] = [];
  for (let i = 1; i <= settings.totalSpotsTruck; i++) {
    spots.push({
      label: `T${String(i).padStart(3, "0")}`,
      type: "TRUCK_TRAILER",
    });
  }
  for (let i = 1; i <= settings.totalSpotsBobtail; i++) {
    spots.push({
      label: `B${String(i).padStart(3, "0")}`,
      type: "BOBTAIL",
    });
  }

  await prisma.spot.createMany({ data: spots });

  return json({
    message: `Seeded ${settings.totalSpotsTruck} truck and ${settings.totalSpotsBobtail} bobtail spots`,
    total: spots.length,
  });
});
