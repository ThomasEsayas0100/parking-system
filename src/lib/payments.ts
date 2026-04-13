/**
 * Shared payment verification and reuse prevention.
 *
 * Used by sessions/route.ts (check-in), sessions/extend, sessions/exit.
 * Supports both QuickBooks Payments and Stripe (payment provider is
 * determined by the charge ID prefix or env config).
 */
import { prisma } from "@/lib/prisma";
import { paymentRequired, conflict } from "@/lib/api-handler";
import { getCharge } from "@/lib/quickbooks";

/**
 * Verify that a payment was captured successfully, and that the
 * charge ID hasn't already been used for another payment record.
 *
 * Works with QuickBooks Payments charge IDs. The field is named
 * externalPaymentId in the DB for backward compatibility but stores
 * any payment provider's charge/intent ID.
 *
 * @throws paymentRequired — if charge is missing, not captured, or unverifiable
 * @throws conflict — if the same paymentId was already recorded
 */
export async function verifyAndClaimPayment(paymentId: string): Promise<void> {
  // 1. Verify charge status with QuickBooks Payments
  try {
    const charge = await getCharge(paymentId);
    if (charge.status !== "CAPTURED") {
      throw paymentRequired("Payment not confirmed");
    }
  } catch (err) {
    if (err instanceof Error && err.name === "ApiError") throw err;
    throw paymentRequired("Could not verify payment");
  }

  // 2. Prevent reuse — same paymentId can't be used twice
  const existing = await prisma.payment.findFirst({
    where: { externalPaymentId: paymentId },
  });
  if (existing) {
    throw conflict("This payment has already been used");
  }
}
