/**
 * Shared payment verification and reuse prevention.
 *
 * Used by sessions/route.ts (check-in), sessions/extend, sessions/exit.
 */
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { paymentRequired, conflict } from "@/lib/api-handler";

/**
 * Verify that a Stripe payment intent succeeded, and that it hasn't
 * already been used for another payment record.
 *
 * @throws paymentRequired — if intent is missing, not succeeded, or unverifiable
 * @throws conflict — if the same paymentId was already recorded
 */
export async function verifyAndClaimPayment(stripePaymentId: string): Promise<void> {
  // 1. Verify payment intent status with Stripe
  try {
    const pi = await stripe.paymentIntents.retrieve(stripePaymentId);
    if (pi.status !== "succeeded") {
      throw paymentRequired("Payment not confirmed");
    }
  } catch (err) {
    if (err instanceof Error && err.name === "ApiError") throw err;
    throw paymentRequired("Could not verify payment");
  }

  // 2. Prevent reuse — same paymentId can't be used twice
  const existing = await prisma.payment.findFirst({
    where: { stripePaymentId },
  });
  if (existing) {
    throw conflict("This payment has already been used");
  }
}
