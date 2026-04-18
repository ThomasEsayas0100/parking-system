import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { refundPaymentIntent, stripeConfigured } from "@/lib/stripe";
import { log as audit } from "@/lib/audit";
import { handler, json, notFound, conflict } from "@/lib/api-handler";
import { AdminRefundSchema } from "@/lib/schemas";

/**
 * POST /api/admin/refund — admin-initiated Stripe refund.
 *
 * This route does NOT mutate the `Payment` row. It only calls Stripe's
 * Refund API. The `charge.refunded` webhook is the single writer of
 * `stripeRefundId`, `refundedAmount`, `refundedAt`, and `status`, and is
 * also responsible for writing the QB Refund Receipt. Keeping that writer
 * single-threaded through the webhook is what makes partial refunds +
 * Stripe-initiated refunds (e.g. from the dashboard) behave the same way
 * as admin-initiated ones.
 *
 * The admin UI polls the Payment row for `refundedAt` to update.
 */
export const POST = handler(
  { body: AdminRefundSchema },
  async ({ body }) => {
    await requireAdmin();
    if (!stripeConfigured()) {
      throw conflict("Stripe is not configured");
    }

    const payment = await prisma.payment.findUnique({
      where: { id: body.paymentId },
    });
    if (!payment) throw notFound("Payment not found");

    if (!payment.stripePaymentIntentId) {
      // Legacy QB payments have no PI to refund via Stripe. Admin must
      // handle those from QB directly.
      throw conflict(
        "This payment predates the Stripe rewrite. Refund it from QuickBooks directly.",
      );
    }

    if (payment.status === "REFUNDED") {
      throw conflict("This payment is already fully refunded");
    }
    if (payment.status === "DISPUTED") {
      throw conflict(
        "This payment is in dispute — respond via Stripe dashboard before refunding",
      );
    }

    const refund = await refundPaymentIntent({
      paymentIntentId: payment.stripePaymentIntentId,
      amount: body.amount,
      reason: body.reason,
    });

    // Audit now; the webhook will fire shortly and update the Payment row +
    // write the QB Refund Receipt.
    await audit({
      action: "REFUND_ISSUED",
      sessionId: payment.sessionId,
      details: `ADMIN initiated refund ${refund.id} for $${(body.amount ?? payment.amount).toFixed(2)} on payment ${payment.id} (PI ${payment.stripePaymentIntentId})${body.reason ? ` — reason: ${body.reason}` : ""}`,
    });

    return json({
      refundId: refund.id,
      status: refund.status,
      amount: refund.amount / 100,
    });
  },
);
