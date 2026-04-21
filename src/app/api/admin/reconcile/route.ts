import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { handler, json } from "@/lib/api-handler";

type ReconcileHealth = "ok" | "warning" | "critical";

type ReconcileRefundRow = {
  id: string;
  amount: number;
  stripeRefundId: string | null;
  qbRefundReceiptId: string | null;
  createdAt: string;
};

type ReconcilePaymentRow = {
  id: string;
  type: string;
  status: string;
  amount: number;
  hours: number | null;
  createdAt: string;
  stripeChargeId: string | null;
  stripePaymentIntentId: string | null;
  stripeSubscriptionId: string | null;
  qbSalesReceiptId: string | null;
  refunds: ReconcileRefundRow[];
};

export type ReconcileSessionRow = {
  id: string;
  health: ReconcileHealth;
  issues: string[];
  sessionType: "MONTHLY" | "HOURLY";
  driver: { id: string; name: string };
  vehicle: { licensePlate: string | null; type: string } | null;
  spot: { label: string } | null;
  status: string;
  startedAt: string;
  payments: ReconcilePaymentRow[];
  stripeInvoiceCount?: number;
  dbPaymentCount?: number;
};

type ReconcileResponse = {
  sessions: ReconcileSessionRow[];
  total: number;
  hasMore: boolean;
};

function worstHealth(a: ReconcileHealth, b: ReconcileHealth): ReconcileHealth {
  if (a === "critical" || b === "critical") return "critical";
  if (a === "warning" || b === "warning") return "warning";
  return "ok";
}

export const GET = handler({}, async ({ req }) => {
  await requireAdmin();

  const url = new URL(req.url);
  const healthFilter = (url.searchParams.get("health") ?? "all") as "all" | "warning" | "critical";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "30", 10), 100);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const sessions = await prisma.session.findMany({
    where: { createdAt: { gte: ninetyDaysAgo } },
    orderBy: { createdAt: "desc" },
    include: {
      driver: { select: { id: true, name: true } },
      vehicle: { select: { licensePlate: true, type: true } },
      spot: { select: { label: true } },
      payments: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          type: true,
          amount: true,
          hours: true,
          createdAt: true,
          status: true,
          stripeChargeId: true,
          stripePaymentIntentId: true,
          stripeSubscriptionId: true,
          qbSalesReceiptId: true,
          refunds: {
            select: {
              id: true,
              amount: true,
              stripeRefundId: true,
              qbRefundReceiptId: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });

  // For monthly sessions with a subscription, fetch Stripe invoice counts in parallel.
  // Only fetch if Stripe is configured; otherwise skip and omit the check.
  const stripeOk = stripeConfigured();
  const stripe = stripeOk ? getStripe() : null;

  const invoiceCountMap = new Map<string, number>();
  if (stripe) {
    const monthlySessionsWithSub = sessions.filter(
      (s) => s.payments.some((p) => p.stripeSubscriptionId),
    );
    await Promise.all(
      monthlySessionsWithSub.map(async (s) => {
        const subId = s.payments.find((p) => p.stripeSubscriptionId)?.stripeSubscriptionId;
        if (!subId) return;
        try {
          // Stripe invoices list auto-paginates up to the limit; 100 covers all reasonable cases.
          const invoices = await stripe.invoices.list({ subscription: subId, limit: 100 });
          // Count only invoices that have actually been paid (not draft/open/void).
          const paidCount = invoices.data.filter(
            (inv) => inv.status === "paid",
          ).length;
          invoiceCountMap.set(s.id, paidCount);
        } catch {
          // If Stripe call fails, omit the check gracefully.
        }
      }),
    );
  }

  const rows: ReconcileSessionRow[] = [];

  for (const session of sessions) {
    const isMonthly = session.payments.some(
      (p) => p.type === "MONTHLY_CHECKIN" || p.type === "MONTHLY_RENEWAL",
    );

    const issues: string[] = [];
    let health: ReconcileHealth = "ok";

    // Check 1: zero payments on a completed session
    if (session.status === "COMPLETED" && session.payments.length === 0) {
      issues.push("No payments recorded");
      health = worstHealth(health, "critical");
    }

    // Check 2: per-payment integrity
    for (const p of session.payments) {
      if (!p.stripeChargeId && !p.stripePaymentIntentId) {
        issues.push("No Stripe charge recorded — webhook may have been missed");
        health = worstHealth(health, "critical");
      } else if (p.stripeChargeId && !p.qbSalesReceiptId) {
        issues.push("QB Sales Receipt missing");
        health = worstHealth(health, "warning");
      }

      for (const r of p.refunds) {
        if (!r.qbRefundReceiptId) {
          issues.push("QB Refund Receipt missing");
          health = worstHealth(health, "warning");
        }
      }

      if ((p.status === "REFUNDED" || p.status === "PARTIALLY_REFUNDED") && p.refunds.length === 0) {
        issues.push("Refund recorded on payment but no refund detail row — charge.refunded webhook may have been missed");
        health = worstHealth(health, "warning");
      }
    }

    // Check 3: monthly — Stripe invoice count vs DB payment count
    let stripeInvoiceCount: number | undefined;
    let dbPaymentCount: number | undefined;
    if (isMonthly) {
      const monthlyPayments = session.payments.filter(
        (p) => p.type === "MONTHLY_CHECKIN" || p.type === "MONTHLY_RENEWAL",
      );
      dbPaymentCount = monthlyPayments.length;

      if (invoiceCountMap.has(session.id)) {
        stripeInvoiceCount = invoiceCountMap.get(session.id);
        if (stripeInvoiceCount !== undefined && stripeInvoiceCount > dbPaymentCount) {
          const diff = stripeInvoiceCount - dbPaymentCount;
          issues.push(
            `${diff} Stripe invoice${diff > 1 ? "s" : ""} ha${diff > 1 ? "ve" : "s"} no matching payment row`,
          );
          health = worstHealth(health, "warning");
        }
      }
    }

    // Apply filter
    if (healthFilter === "warning" && health === "ok") continue;
    if (healthFilter === "critical" && health !== "critical") continue;

    const row: ReconcileSessionRow = {
      id: session.id,
      health,
      issues: Array.from(new Set(issues)), // deduplicate
      sessionType: isMonthly ? "MONTHLY" : "HOURLY",
      driver: session.driver,
      vehicle: session.vehicle
        ? { licensePlate: session.vehicle.licensePlate, type: session.vehicle.type }
        : null,
      spot: session.spot ? { label: session.spot.label } : null,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      payments: session.payments.map((p) => ({
        id: p.id,
        type: p.type,
        status: p.status,
        amount: p.amount,
        hours: p.hours,
        createdAt: p.createdAt.toISOString(),
        stripeChargeId: p.stripeChargeId,
        stripePaymentIntentId: p.stripePaymentIntentId,
        stripeSubscriptionId: p.stripeSubscriptionId,
        qbSalesReceiptId: p.qbSalesReceiptId,
        refunds: p.refunds.map((r) => ({
          id: r.id,
          amount: r.amount,
          stripeRefundId: r.stripeRefundId,
          qbRefundReceiptId: r.qbRefundReceiptId,
          createdAt: r.createdAt.toISOString(),
        })),
      })),
      ...(isMonthly ? { stripeInvoiceCount, dbPaymentCount } : {}),
    };

    rows.push(row);
  }

  const total = rows.length;
  const paginated = rows.slice(offset, offset + limit);

  return json<ReconcileResponse>({
    sessions: paginated,
    total,
    hasMore: offset + limit < total,
  });
});
