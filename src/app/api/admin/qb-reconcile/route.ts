/**
 * POST /api/admin/qb-reconcile
 *
 * QuickBooks is the authoritative source of truth for payment state. This
 * endpoint reads QB for each non-terminal payment and writes any status
 * changes back to our DB. Admin only — no body required.
 *
 * Scope: PENDING | COMPLETED payments created in the last 90 days, capped
 * at 100 to stay within QB rate limits. Free sessions (externalPaymentId
 * starts with "free_") are skipped — they have no QB record.
 *
 * Logic per payment:
 *   CHECKIN / MONTHLY_CHECKIN (invoice-based):
 *     QB voided              → VOIDED
 *     QB amountPaid < ours   → PARTIALLY_REFUNDED or REFUNDED (if net = 0)
 *     QB amount matches      → no-op
 *
 *   EXTENSION / OVERSTAY (charge-based):
 *     QB status = VOIDED     → VOIDED
 *     QB has refunds         → PARTIALLY_REFUNDED or REFUNDED
 *     QB amount matches      → no-op
 */

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { handler, json } from "@/lib/api-handler";
import { getInvoiceStatus, getChargeWithRefunds } from "@/lib/quickbooks";
import type { PaymentType } from "@/generated/prisma/enums";

const INVOICE_TYPES: PaymentType[] = ["CHECKIN", "MONTHLY_CHECKIN"];
const CHARGE_TYPES: PaymentType[] = ["EXTENSION", "OVERSTAY"];
// Floating-point tolerance for amount comparisons ($0.02)
const AMOUNT_TOLERANCE = 0.02;

export type ReconcileChange = {
  paymentId: string;
  externalPaymentId: string;
  from: string;
  to: string;
  detail: string;
};

export type ReconcileError = {
  paymentId: string;
  externalPaymentId: string;
  error: string;
};

export const POST = handler({}, async () => {
  await requireAdmin();

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const payments = await prisma.payment.findMany({
    where: {
      status: { in: ["PENDING", "COMPLETED"] },
      createdAt: { gte: since },
      NOT: { externalPaymentId: { startsWith: "free_" } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const changes: ReconcileChange[] = [];
  const errors: ReconcileError[] = [];

  for (const payment of payments) {
    try {
      const change = await reconcileOne(payment);
      if (change) changes.push(change);
    } catch (err) {
      errors.push({
        paymentId: payment.id,
        externalPaymentId: payment.externalPaymentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return json({
    checked: payments.length,
    updated: changes.length,
    unchanged: payments.length - changes.length - errors.length,
    changes,
    errors,
  });
});

// ---------------------------------------------------------------------------
// Per-payment reconciliation logic
// ---------------------------------------------------------------------------

type PaymentRow = {
  id: string;
  type: PaymentType;
  externalPaymentId: string;
  amount: number;
  status: string;
};

async function reconcileOne(payment: PaymentRow): Promise<ReconcileChange | null> {
  if (INVOICE_TYPES.includes(payment.type)) {
    return reconcileInvoice(payment);
  }
  if (CHARGE_TYPES.includes(payment.type)) {
    return reconcileCharge(payment);
  }
  return null;
}

async function reconcileInvoice(payment: PaymentRow): Promise<ReconcileChange | null> {
  const qb = await getInvoiceStatus(payment.externalPaymentId);

  if (qb.voided) {
    return applyUpdate(payment, "VOIDED", null, 0, null, "QB invoice voided");
  }

  const refunded = payment.amount - qb.amountPaid;
  if (refunded > AMOUNT_TOLERANCE) {
    if (qb.amountPaid <= AMOUNT_TOLERANCE) {
      // Net paid is zero — full refund via credit memo
      return applyUpdate(
        payment,
        "REFUNDED",
        null,
        payment.amount,
        new Date(),
        `QB net paid $0 (credit memo or full refund applied)`,
      );
    }
    // Partial refund
    return applyUpdate(
      payment,
      "PARTIALLY_REFUNDED",
      null,
      refunded,
      new Date(),
      `QB amountPaid $${qb.amountPaid.toFixed(2)} < original $${payment.amount.toFixed(2)}`,
    );
  }

  return null; // no-op
}

async function reconcileCharge(payment: PaymentRow): Promise<ReconcileChange | null> {
  const qb = await getChargeWithRefunds(payment.externalPaymentId);

  if (qb.status === "VOIDED") {
    return applyUpdate(payment, "VOIDED", null, 0, null, "QB charge voided");
  }

  if (qb.refunds.length > 0) {
    const totalRefunded = qb.refunds.reduce((s, r) => s + r.amount, 0);
    // Use the most recently created refund's ID as the canonical external ref
    const latestRefund = qb.refunds.sort((a, b) => b.created.localeCompare(a.created))[0];

    if (totalRefunded >= payment.amount - AMOUNT_TOLERANCE) {
      return applyUpdate(
        payment,
        "REFUNDED",
        latestRefund.id,
        totalRefunded,
        new Date(latestRefund.created),
        `QB charge fully refunded (${qb.refunds.length} refund(s), total $${totalRefunded.toFixed(2)})`,
      );
    }
    return applyUpdate(
      payment,
      "PARTIALLY_REFUNDED",
      latestRefund.id,
      totalRefunded,
      new Date(latestRefund.created),
      `QB charge partially refunded: $${totalRefunded.toFixed(2)} of $${payment.amount.toFixed(2)}`,
    );
  }

  return null; // no-op
}

async function applyUpdate(
  payment: PaymentRow,
  newStatus: string,
  refundExternalId: string | null,
  refundedAmount: number,
  refundedAt: Date | null,
  detail: string,
): Promise<ReconcileChange> {
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: newStatus as never,
      refundedAmount,
      ...(refundedAt ? { refundedAt } : {}),
      ...(refundExternalId ? { refundExternalId } : {}),
    },
  });

  return {
    paymentId: payment.id,
    externalPaymentId: payment.externalPaymentId,
    from: payment.status,
    to: newStatus,
    detail,
  };
}
