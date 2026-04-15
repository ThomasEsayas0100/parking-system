import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isProd } from "@/lib/env";
import { requireAdmin } from "@/lib/auth";

// POST: wipe all drivers, vehicles, sessions, and payments from the dev database
// DEV ONLY — blocked in production
export async function POST() {
  if (isProd) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await requireAdmin();

  await prisma.payment.deleteMany();
  await prisma.session.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.driver.deleteMany();

  return NextResponse.json({ message: "Cleared all drivers, vehicles, sessions, and payments." });
}
