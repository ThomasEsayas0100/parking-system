import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, json } from "@/lib/api-handler";

const LookupQuery = z.object({
  cs: z.string().min(1).max(200),
});

/**
 * GET /api/payments/lookup?cs=cs_...
 *
 * Polled by /payment-complete after a Stripe Checkout redirect. Returns
 * the Payment row written by the webhook — along with the resolved Session
 * ID so the client can redirect to /welcome or /exit without a second fetch.
 *
 * Returns 404 until the webhook has fired. The client polls every 500ms
 * and gives up after ~10s with a "still processing" fallback screen.
 */
export const GET = handler(
  { query: LookupQuery },
  async ({ query }) => {
    const payment = await prisma.payment.findFirst({
      where: { stripeCheckoutSessionId: query.cs },
      include: {
        session: {
          select: { id: true, driverId: true, status: true },
        },
      },
    });
    if (!payment) return json({ status: "pending" }, { status: 404 });

    return json({
      status: "ready",
      payment: {
        id: payment.id,
        type: payment.type,
        amount: payment.amount,
        stripePaymentIntentId: payment.stripePaymentIntentId,
        stripeChargeId: payment.stripeChargeId,
      },
      session: payment.session,
    });
  },
);
