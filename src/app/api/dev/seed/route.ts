import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isProd } from "@/lib/env";

// POST: seed a test driver with vehicles and an active session
// DEV ONLY — blocked in production
export async function POST() {
  if (isProd) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Ensure spots exist
  const spotCount = await prisma.spot.count();
  if (spotCount === 0) {
    // Create a handful of test spots
    await prisma.spot.createMany({
      data: [
        { label: "T001", type: "TRUCK_TRAILER" },
        { label: "T002", type: "TRUCK_TRAILER" },
        { label: "T003", type: "TRUCK_TRAILER" },
        { label: "B001", type: "BOBTAIL" },
        { label: "B002", type: "BOBTAIL" },
      ],
    });
  }

  // Upsert test driver
  const driver = await prisma.driver.upsert({
    where: { phone: "5558675309" },
    update: {},
    create: {
      name: "Carlos Martinez",
      email: "carlos@test.com",
      phone: "555-867-5309",
    },
  });

  // Create two vehicles
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

  const bobtail = await prisma.vehicle.upsert({
    where: { driverId_unitNumber: { driverId: driver.id, unitNumber: "1190" } },
    update: {},
    create: {
      driverId: driver.id,
      unitNumber: "1190",
      type: "BOBTAIL",
    },
  });

  // Complete any existing active/overstay sessions (this frees the spots — sessions are
  // the source of truth for spot occupancy).
  await prisma.session.updateMany({
    where: { status: { in: ["ACTIVE", "OVERSTAY"] } },
    data: { status: "COMPLETED", endedAt: new Date() },
  });

  // Create an active session (truck, 8 hours from now)
  const spot1 = await prisma.spot.findFirst({
    where: {
      type: "TRUCK_TRAILER",
      sessions: { none: { status: { in: ["ACTIVE", "OVERSTAY"] } } },
    },
  });

  let activeSession = null;
  if (spot1) {
    activeSession = await prisma.session.create({
      data: {
        driverId: driver.id,
        vehicleId: truck.id,
        spotId: spot1.id,
        expectedEnd: new Date(Date.now() + 8 * 60 * 60 * 1000),
      },
    });

    await prisma.payment.create({
      data: {
        sessionId: activeSession.id,
        type: "CHECKIN",
        externalPaymentId: "pi_test_seed_001",
        amount: 120.0,
        hours: 8,
      },
    });
  }

  return NextResponse.json({
    message: "Test data seeded",
    driverId: driver.id,
    driverName: driver.name,
    vehicles: [
      { id: truck.id, unit: "4821", plate: "TX-ABR-7742", type: "TRUCK_TRAILER" },
      { id: bobtail.id, unit: "1190", type: "BOBTAIL" },
    ],
    activeSession: activeSession
      ? { id: activeSession.id, spot: spot1?.label }
      : null,
    instructions:
      "Set localStorage: parking_driver = {id, name, phone}. Then visit /entry.",
  });
}
