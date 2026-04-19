import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isProd } from "@/lib/env";

// POST: wipe all operational data from the dev database.
// Keeps Spot, Settings, and AllowList intact.
// DEV ONLY — blocked in production.
export async function POST() {
  if (isProd) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Delete in dependency order (children before parents)
  await prisma.auditLog.deleteMany();
  await prisma.stripeEvent.deleteMany();
  await prisma.paymentRefund.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.session.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.driver.deleteMany();

  // Reset stripe reconciliation state on Settings
  await prisma.settings.updateMany({
    data: {
      lastStripeWebhookAt: null,
      lastStripeReconcileAt: null,
      stripeReconcileFlaggedIds: [],
    },
  });

  return NextResponse.json({ ok: true });
}
