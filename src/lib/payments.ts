/**
 * Shared payment verification and reuse prevention.
 *
 * Used by sessions/route.ts (check-in), sessions/extend, sessions/exit.
 * Two flows to verify:
 *  - Invoice-based (hosted checkout) → verifyAndClaimInvoice
 *  - Charge-based (direct card tokenization) → verifyAndClaimPayment
 *
 * Idempotency is also enforced by the DB-level @@unique on
 * Payment.externalPaymentId — the findFirst check here is just a fast
 * path that turns a P2002 into a clean 409 before we do any writes.
 */
import { prisma } from "@/lib/prisma";
import { paymentRequired, conflict } from "@/lib/api-handler";
import { getCharge, getInvoiceStatus } from "@/lib/quickbooks";

async function assertNotReused(externalId: string): Promise<void> {
  const existing = await prisma.payment.findFirst({
    where: { externalPaymentId: externalId },
  });
  if (existing) throw conflict("This payment has already been used");
}

/**
 * Verify a QuickBooks **charge** (direct card path — extend, exit overstay).
 *
 * @throws paymentRequired — if charge is missing, not captured, or unverifiable
 * @throws conflict — if the same chargeId was already recorded
 */
export async function verifyAndClaimPayment(paymentId: string): Promise<void> {
  try {
    const charge = await getCharge(paymentId);
    if (charge.status !== "CAPTURED") {
      throw paymentRequired("Payment not confirmed");
    }
  } catch (err) {
    if (err instanceof Error && err.name === "ApiError") throw err;
    throw paymentRequired("Could not verify payment");
  }
  await assertNotReused(paymentId);
}

/**
 * Verify a QuickBooks **invoice** (hosted checkout path — check-in).
 *
 * Requires the invoice to be fully paid, not voided, and not partial.
 * This is the server-side defense-in-depth against a client bypassing
 * the partial/voided guards in payment-complete/page.tsx.
 *
 * @throws paymentRequired — for any state other than fully-paid
 * @throws conflict — if the invoice was already claimed
 */
export async function verifyAndClaimInvoice(invoiceId: string): Promise<void> {
  let status: Awaited<ReturnType<typeof getInvoiceStatus>>;
  try {
    status = await getInvoiceStatus(invoiceId);
  } catch (err) {
    if (err instanceof Error && err.name === "ApiError") throw err;
    throw paymentRequired("Could not verify invoice");
  }
  if (status.voided) throw paymentRequired("Invoice was voided");
  if (status.partial) throw paymentRequired("Invoice only partially paid");
  if (!status.paid) throw paymentRequired("Invoice not paid");
  await assertNotReused(invoiceId);
}
