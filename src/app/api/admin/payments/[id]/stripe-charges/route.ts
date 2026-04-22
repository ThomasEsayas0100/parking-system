import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { handler, json, notFound } from "@/lib/api-handler";
import { getStripe, stripeConfigured } from "@/lib/stripe";

export const GET = handler(
  {},
  async ({ params }) => {
    await requireAdmin();

    const id = params.id;
    if (!id) throw notFound("Payment not found");

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { refunds: true },
    });
    if (!payment) throw notFound("Payment not found");

    if (!stripeConfigured() || (!payment.stripeChargeId && !payment.stripePaymentIntentId)) {
      return json({
        stripeRefunds: payment.refunds.map(r => ({
          id: r.stripeRefundId,
          amount: r.amount,
          createdAt: r.createdAt,
          status: null,
          reason: null,
        })),
        dbRefunds: payment.refunds.map(r => ({
          stripeRefundId: r.stripeRefundId,
          qbRefundReceiptId: r.qbRefundReceiptId,
        })),
      });
    }

    const stripe = getStripe();
    let chargeId = payment.stripeChargeId;
    if (!chargeId && payment.stripePaymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId, { expand: ["latest_charge"] });
      chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : (pi.latest_charge as { id: string } | null)?.id ?? null;
    }
    if (!chargeId) {
      return json({ stripeRefunds: [], dbRefunds: payment.refunds.map(r => ({ stripeRefundId: r.stripeRefundId, qbRefundReceiptId: r.qbRefundReceiptId })) });
    }
    const charge = await stripe.charges.retrieve(chargeId, {
      expand: ["refunds"],
    });

    const stripeRefunds = (charge.refunds?.data ?? []).map((r) => ({
      id: r.id,
      amount: r.amount / 100,
      createdAt: new Date(r.created * 1000).toISOString(),
      status: r.status,
      reason: r.reason,
    }));

    const dbRefunds = payment.refunds.map((r) => ({
      stripeRefundId: r.stripeRefundId,
      qbRefundReceiptId: r.qbRefundReceiptId,
    }));

    return json({ stripeRefunds, dbRefunds });
  },
);
