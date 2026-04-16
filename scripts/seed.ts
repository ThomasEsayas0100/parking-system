import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import defaultState from "../src/components/lot/editor/defaultState.json" with { type: "json" };

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

type EditorSpot = {
  id: string;
  label: string;
  type: "BOBTAIL" | "TRUCK_TRAILER";
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
};

async function seed() {
  console.log("=== Seeding lot layout from defaultState.json ===");

  const spots = Object.values(defaultState.spots) as EditorSpot[];
  console.log(`Found ${spots.length} spots in default layout`);

  // Complete all active/overstay sessions — this implicitly frees every spot,
  // since occupancy is derived from the Session table (see docs/DATA_MODEL.md).
  const completed = await prisma.session.updateMany({
    where: { status: { in: ["ACTIVE", "OVERSTAY"] } },
    data: { status: "COMPLETED", endedAt: new Date() },
  });
  console.log(`Completed ${completed.count} active sessions`);

  // Upsert each spot: create if new, update layout if existing
  // Use the editor ID as the DB ID so they match exactly
  let created = 0, updated = 0;
  for (const spot of spots) {
    const existing = await prisma.spot.findUnique({ where: { id: spot.id } });
    if (existing) {
      await prisma.spot.update({
        where: { id: spot.id },
        data: { label: spot.label, type: spot.type, cx: spot.cx, cy: spot.cy, w: spot.w, h: spot.h, rot: spot.rot },
      });
      updated++;
    } else {
      // Check if label already exists with different ID (old seeded spots)
      const byLabel = await prisma.spot.findUnique({ where: { label: spot.label } });
      if (byLabel) {
        // Migrate: update old spot to use new editor ID + layout
        // Can't change ID directly, so update the label to temp, delete constraints
        // Simplest: just update the layout on the existing row
        await prisma.spot.update({
          where: { id: byLabel.id },
          data: { cx: spot.cx, cy: spot.cy, w: spot.w, h: spot.h, rot: spot.rot },
        });
        updated++;
      } else {
        await prisma.spot.create({
          data: {
            id: spot.id,
            label: spot.label,
            type: spot.type,
            cx: spot.cx,
            cy: spot.cy,
            w: spot.w,
            h: spot.h,
            rot: spot.rot,
          },
        });
        created++;
      }
    }
  }
  console.log(`Spots: ${created} created, ${updated} updated`);

  // Save groups to Settings
  await prisma.settings.upsert({
    where: { id: "default" },
    create: { lotGroups: defaultState.groups },
    update: { lotGroups: defaultState.groups },
  });
  console.log(`Saved ${defaultState.groups.length} groups to Settings`);

  // Create a test driver + vehicle + active session
  const driver = await prisma.driver.upsert({
    where: { phone: "5558675309" },
    update: {},
    create: { name: "Carlos Martinez", email: "carlos@test.com", phone: "5558675309" },
  });
  console.log(`Driver: ${driver.id} (${driver.name})`);

  const truck = await prisma.vehicle.upsert({
    where: { driverId_unitNumber: { driverId: driver.id, unitNumber: "4821" } },
    update: {},
    create: {
      driverId: driver.id,
      unitNumber: "4821",
      licensePlate: "TX-ABR-7742",
      type: "TRUCK_TRAILER",
      nickname: "Blue Kenworth",
    },
  });
  console.log(`Vehicle: ${truck.id}`);

  // Find first truck spot (by editor ID if exists, otherwise by label)
  const firstTruckSpot = spots.find((s) => s.type === "TRUCK_TRAILER");
  if (!firstTruckSpot) {
    console.log("No truck spots in layout!");
    return;
  }

  // Find the DB spot — could be the editor ID or the old UUID
  let dbSpot = await prisma.spot.findUnique({ where: { id: firstTruckSpot.id } });
  if (!dbSpot) {
    dbSpot = await prisma.spot.findUnique({ where: { label: firstTruckSpot.label } });
  }
  if (!dbSpot) {
    console.log("Truck spot not found in DB!");
    return;
  }

  const session = await prisma.session.create({
    data: {
      driverId: driver.id,
      vehicleId: truck.id,
      spotId: dbSpot.id,
      expectedEnd: new Date(Date.now() + 8 * 60 * 60 * 1000),
      spotLabelSnapshot: dbSpot.label,
    },
  });

  await prisma.payment.create({
    data: {
      sessionId: session.id,
      type: "CHECKIN",
      externalPaymentId: "pi_test_seed_" + Date.now(),
      amount: 120.0,
      hours: 8,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "CHECKIN",
      sessionId: session.id,
      driverId: driver.id,
      vehicleId: truck.id,
      spotId: dbSpot.id,
      details: `Checked in for 8h, paid $120.00, plate: TX-ABR-7742`,
    },
  });

  console.log(`Session: ${session.id} | Spot: ${dbSpot.label} (${dbSpot.id})`);
  console.log(`\n✓ Done! Carlos Martinez parked at spot ${dbSpot.label} for 8 hours.`);
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
