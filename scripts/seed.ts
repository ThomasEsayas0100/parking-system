import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function seed() {
  const spotCount = await prisma.spot.count();
  if (spotCount === 0) {
    await prisma.spot.createMany({
      data: [
        { label: "T001", type: "TRUCK_TRAILER" },
        { label: "T002", type: "TRUCK_TRAILER" },
        { label: "T003", type: "TRUCK_TRAILER" },
        { label: "B001", type: "BOBTAIL" },
        { label: "B002", type: "BOBTAIL" },
      ],
    });
    console.log("Created 5 spots");
  } else {
    console.log("Spots exist:", spotCount);
  }

  const driver = await prisma.driver.upsert({
    where: { phone: "5558675309" },
    update: {},
    create: { name: "Carlos Martinez", email: "carlos@test.com", phone: "5558675309" },
  });
  console.log("Driver:", driver.id, driver.name);

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
  console.log("Vehicle:", truck.id);

  // Complete old sessions
  await prisma.session.updateMany({
    where: { driverId: driver.id, status: "ACTIVE" },
    data: { status: "COMPLETED", endedAt: new Date() },
  });

  // Free up any occupied spots
  await prisma.spot.updateMany({
    where: { status: "OCCUPIED" },
    data: { status: "AVAILABLE" },
  });

  const spot = await prisma.spot.findFirst({
    where: { type: "TRUCK_TRAILER", status: "AVAILABLE" },
  });
  if (!spot) {
    console.log("No available truck spots!");
    return;
  }

  await prisma.spot.update({
    where: { id: spot.id },
    data: { status: "OCCUPIED" },
  });

  const session = await prisma.session.create({
    data: {
      driverId: driver.id,
      vehicleId: truck.id,
      spotId: spot.id,
      expectedEnd: new Date(Date.now() + 8 * 60 * 60 * 1000),
    },
  });

  await prisma.payment.create({
    data: {
      sessionId: session.id,
      type: "CHECKIN",
      stripePaymentId: "pi_test_seed_" + Date.now(),
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
      spotId: spot.id,
      details: "Checked in for 8h, paid $120.00, plate: TX-ABR-7742",
    },
  });

  console.log("Session:", session.id, "| Spot:", spot.label);
  console.log("Done! Carlos Martinez parked at", spot.label, "for 8 hours.");
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
