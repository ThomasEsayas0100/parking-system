import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isProd } from "@/lib/env";

// POST: seed realistic test sessions across the existing lot
// DEV ONLY — blocked in production
export async function POST() {
  if (isProd) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const spotCount = await prisma.spot.count();
  if (spotCount === 0) {
    return NextResponse.json(
      { error: "No spots found. The lot must be configured before seeding sessions." },
      { status: 409 },
    );
  }

  // Clear all existing active/overstay sessions so we start clean
  await prisma.session.updateMany({
    where: { status: { in: ["ACTIVE", "OVERSTAY"] } },
    data: { status: "COMPLETED", endedAt: new Date() },
  });

  // ── Test drivers ──────────────────────────────────────────────────────────
  const driverDefs = [
    { name: "Carlos Martinez", phone: "5558675309", email: "carlos@test.com" },
    { name: "James Okafor",    phone: "5552341100", email: null },
    { name: "Linda Nguyen",    phone: "5559874321", email: "linda.n@test.com" },
    { name: "Roy Delgado",     phone: "5554449012", email: null },
    { name: "Priya Sharma",    phone: "5557773456", email: "priya@test.com" },
  ];

  const drivers = await Promise.all(
    driverDefs.map((d) =>
      prisma.driver.upsert({
        where: { phone: d.phone },
        update: { name: d.name },
        create: { name: d.name, phone: d.phone, email: d.email ?? undefined },
      }),
    ),
  );

  // ── Vehicles (one per driver) ─────────────────────────────────────────────
  const vehicleDefs = [
    { driverIdx: 0, unitNumber: "4821", licensePlate: "TX-ABR-7742", type: "TRUCK_TRAILER" as const, nickname: "Blue Kenworth" },
    { driverIdx: 1, unitNumber: "0033", licensePlate: "TX-ZZK-1193", type: "TRUCK_TRAILER" as const, nickname: null },
    { driverIdx: 2, unitNumber: "9910", licensePlate: "TX-LNX-5512", type: "BOBTAIL"       as const, nickname: null },
    { driverIdx: 3, unitNumber: "7744", licensePlate: "TX-RDG-8821", type: "TRUCK_TRAILER" as const, nickname: "Red Peterbilt" },
    { driverIdx: 4, unitNumber: "2205", licensePlate: "TX-PSH-3304", type: "BOBTAIL"       as const, nickname: null },
  ];

  const vehicles = await Promise.all(
    vehicleDefs.map((v) =>
      prisma.vehicle.upsert({
        where: { driverId_unitNumber: { driverId: drivers[v.driverIdx].id, unitNumber: v.unitNumber } },
        update: {},
        create: {
          driverId: drivers[v.driverIdx].id,
          unitNumber: v.unitNumber,
          licensePlate: v.licensePlate,
          type: v.type,
          nickname: v.nickname ?? undefined,
        },
      }),
    ),
  );

  // ── Pick spots spread across the lot ─────────────────────────────────────
  // Fetch a sample of truck and bobtail spots to distribute sessions visually
  const truckSpots = await prisma.spot.findMany({
    where: { type: "TRUCK_TRAILER" },
    orderBy: { label: "asc" },
    take: 60,
  });
  const bobtailSpots = await prisma.spot.findMany({
    where: { type: "BOBTAIL" },
    orderBy: { label: "asc" },
    take: 20,
  });

  // Pick every ~6th truck spot and every ~4th bobtail spot for a sparse but spread-out look
  const pickedTruck  = truckSpots.filter((_, i) => i % 6 === 0);   // ~10 spots
  const pickedBobtail = bobtailSpots.filter((_, i) => i % 4 === 0); // ~5 spots

  const now = Date.now();
  const hour = 60 * 60 * 1000;

  // Session definitions: [spotId, driverIdx, vehicleIdx, expectedEndOffset, status, paymentAmount]
  type SessionDef = {
    spot: (typeof truckSpots)[number];
    driverIdx: number;
    vehicleIdx: number;
    expectedEnd: Date;
    status: "ACTIVE" | "OVERSTAY";
    amount: number;
    hours: number;
    paymentType: "CHECKIN" | "MONTHLY_CHECKIN";
  };

  const sessionDefs: SessionDef[] = [
    // Active truck sessions — various time remaining
    { spot: pickedTruck[0], driverIdx: 0, vehicleIdx: 0, expectedEnd: new Date(now + 6 * hour),   status: "ACTIVE"   as const, amount: 90,  hours: 6,  paymentType: "CHECKIN"        as const },
    { spot: pickedTruck[1], driverIdx: 1, vehicleIdx: 1, expectedEnd: new Date(now + 12 * hour),  status: "ACTIVE"   as const, amount: 180, hours: 12, paymentType: "CHECKIN"        as const },
    { spot: pickedTruck[2], driverIdx: 3, vehicleIdx: 3, expectedEnd: new Date(now + 2 * hour),   status: "ACTIVE"   as const, amount: 30,  hours: 2,  paymentType: "CHECKIN"        as const },
    { spot: pickedTruck[3], driverIdx: 0, vehicleIdx: 0, expectedEnd: new Date(now + 24 * hour),  status: "ACTIVE"   as const, amount: 360, hours: 24, paymentType: "CHECKIN"        as const },
    { spot: pickedTruck[4], driverIdx: 1, vehicleIdx: 1, expectedEnd: new Date(now + 48 * hour),  status: "ACTIVE"   as const, amount: 720, hours: 48, paymentType: "CHECKIN"        as const },
    // Overstay truck sessions — expectedEnd in the past
    { spot: pickedTruck[5], driverIdx: 3, vehicleIdx: 3, expectedEnd: new Date(now - 3 * hour),   status: "OVERSTAY" as const, amount: 120, hours: 8,  paymentType: "CHECKIN"        as const },
    { spot: pickedTruck[6], driverIdx: 1, vehicleIdx: 1, expectedEnd: new Date(now - 1 * hour),   status: "OVERSTAY" as const, amount: 60,  hours: 4,  paymentType: "CHECKIN"        as const },
    // Active bobtail sessions
    { spot: pickedBobtail[0], driverIdx: 2, vehicleIdx: 2, expectedEnd: new Date(now + 8 * hour), status: "ACTIVE"   as const, amount: 60,  hours: 8,  paymentType: "CHECKIN"        as const },
    { spot: pickedBobtail[1], driverIdx: 4, vehicleIdx: 4, expectedEnd: new Date(now + 4 * hour), status: "ACTIVE"   as const, amount: 30,  hours: 4,  paymentType: "CHECKIN"        as const },
    // Monthly active
    { spot: pickedTruck[7], driverIdx: 4, vehicleIdx: 3, expectedEnd: new Date(now + 30 * 24 * hour), status: "ACTIVE" as const, amount: 1200, hours: 720, paymentType: "MONTHLY_CHECKIN" as const },
  ].filter((s) => s.spot !== undefined);

  const created: { spot: string; driver: string; status: string }[] = [];

  for (const def of sessionDefs) {
    const session = await prisma.session.create({
      data: {
        driverId: drivers[def.driverIdx].id,
        vehicleId: vehicles[def.vehicleIdx].id,
        spotId: def.spot.id,
        startedAt: new Date(def.expectedEnd.getTime() - def.hours * hour),
        expectedEnd: def.expectedEnd,
        status: def.status,
        termsVersion: "1.0",
      },
    });

    await prisma.payment.create({
      data: {
        sessionId: session.id,
        type: def.paymentType,
        legacyQbReference: `dev_seed_${session.id}`,
        amount: def.amount,
        hours: def.paymentType === "CHECKIN" ? def.hours : undefined,
        status: "COMPLETED",
      },
    });

    created.push({
      spot: def.spot.label,
      driver: drivers[def.driverIdx].name,
      status: def.status,
    });
  }

  return NextResponse.json({
    message: `Seeded ${created.length} sessions across ${spotCount} spots`,
    sessions: created,
    instructions: "Refresh /admin to see the lot map. To log in as a driver, set localStorage parking_driver = {id, name, phone}.",
  });
}
