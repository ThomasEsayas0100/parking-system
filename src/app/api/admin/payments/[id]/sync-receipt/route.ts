import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { handler, json, notFound, conflict } from "@/lib/api-handler";
import { writeSalesReceipt, findOrCreateCustomer, QBAuthError } from "@/lib/quickbooks";
import { log as audit } from "@/lib/audit";

async function resolveChargeId(
  stripe: ReturnType<typeof getStripe>,
  payment: {
    stripeChargeId: string | null;
    stripePaymentIntentId: string | null;
    stripeInvoiceId: string | null;
  },
): Promise<string | null> {
  // 1. Already on the row
  if (payment.stripeChargeId) return payment.stripeChargeId;

  // 2. One-time payment: PI → latest_charge
  if (payment.stripePaymentIntentId) {
    const pi = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
    const c = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null;
    if (c) return c;
  }

  // 3. Subscription invoice: use InvoicePayments API (clover removed invoice.charge
  //    and invoice.payment_intent from the Invoice object; they live under
  //    InvoicePayment.payment now). Each row has its own stripeInvoiceId so this
  //    correctly targets the charge for that specific billing period.
  if (payment.stripeInvoiceId) {
    const invoicePayments = await stripe.invoicePayments.list({ invoice: payment.stripeInvoiceId, limit: 1 });
    const invoicePayment = invoicePayments.data[0];
    if (invoicePayment) {
      const piRef = invoicePayment.payment?.payment_intent;
      const piId = typeof piRef === "string" ? piRef : piRef?.id ?? null;
      if (piId) {
        const pi = await stripe.paymentIntents.retrieve(piId);
        const c = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null;
        if (c) return c;
      }
    }
  }

  return null;
}

/**
 * POST /api/admin/payments/[id]/sync-receipt
 * Manually write (or re-write) the QB Sales Receipt for a payment.
 * Tries: stripeChargeId → PI → invoice.charge → invoice.payment_intent → subscription.latest_invoice.
 * Updates stripeChargeId on the payment row when resolved so future calls are instant.
 */
export const POST = handler({}, async ({ params }) => {
  await requireAdmin();
  if (!stripeConfigured()) throw conflict("Stripe is not configured");

  const id = params.id;
  if (!id) throw notFound("Payment not found");

  const payment = await prisma.payment.findUnique({
    where: { id },
    include: { session: { include: { driver: true, vehicle: true } } },
  });
  if (!payment) throw notFound("Payment not found");

  // Idempotency guard: return the stored receipt ID without touching QB.
  // writeSalesReceipt() also queries QB by charge ID, but this short-circuits
  // the full Stripe + QB round-trip for the common case.
  if (payment.qbSalesReceiptId) {
    return json({ ok: true, qbSalesReceiptId: payment.qbSalesReceiptId, alreadySynced: true });
  }

  const driver = payment.session?.driver;
  if (!driver) throw conflict("No driver associated with this payment");

  const stripe = getStripe();
  const chargeId = await resolveChargeId(stripe, payment);

  if (chargeId && !payment.stripeChargeId) {
    await prisma.payment.update({ where: { id }, data: { stripeChargeId: chargeId } });
  }

  if (!chargeId) throw conflict("Cannot resolve a Stripe charge ID for this payment — the charge may not have settled yet. Try again in a moment.");

  let customerId = driver.qbCustomerId;
  if (!customerId) {
    const customer = await findOrCreateCustomer({
      name: driver.name,
      phone: driver.phone,
      email: driver.email ?? undefined,
    });
    customerId = customer.Id;
    await prisma.driver.update({ where: { id: driver.id }, data: { qbCustomerId: customerId } });
  }

  const vehicle = payment.session?.vehicle;
  const vt = vehicle?.type === "BOBTAIL" ? "Bobtail" : "Truck/trailer";
  const plate = vehicle?.licensePlate ? ` · Plate ${vehicle.licensePlate}` : "";

  let description: string;
  if (payment.type === "MONTHLY_CHECKIN" || payment.type === "MONTHLY_RENEWAL") {
    const stripe = getStripe();
    const allMonthly = await prisma.payment.findMany({
      where: { sessionId: payment.sessionId, type: { in: ["MONTHLY_CHECKIN", "MONTHLY_RENEWAL"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const position = allMonthly.findIndex(p => p.id === payment.id) + 1;
    let totalMonths = allMonthly.length;
    if (payment.stripeSubscriptionId) {
      const sub = await stripe.subscriptions.retrieve(payment.stripeSubscriptionId);
      totalMonths = parseInt(sub.metadata?.months ?? String(allMonthly.length), 10);
    }
    description = `${vt} parking — monthly, month ${position} of ${totalMonths}${plate}`;
  } else {
    const typeMap: Record<string, string> = {
      CHECKIN: `${vt} parking — check-in, ${payment.days ?? "?"}d${plate}`,
      EXTENSION: `${vt} parking — extension, ${payment.days ?? "?"}d${plate}`,
      OVERSTAY: `${vt} parking — overstay, ${payment.days ?? "?"}d${plate}`,
    };
    description = typeMap[payment.type] ?? `${vt} parking — ${payment.type.toLowerCase()}${plate}`;
  }

  try {
    const receipt = await writeSalesReceipt({
      customerId,
      amount: payment.amount,
      description,
      stripeEventId: `admin_sync_${id}`,
      stripeChargeId: chargeId,
    });

    await prisma.payment.update({ where: { id }, data: { qbSalesReceiptId: receipt.Id } });

    await audit({
      action: "SALES_RECEIPT_WRITTEN",
      driverId: driver.id,
      details: `Manual QB Sales Receipt sync: ${receipt.DocNumber} (id ${receipt.Id}) for $${payment.amount.toFixed(2)} (charge ${chargeId})`,
    });

    return json({ ok: true, qbSalesReceiptId: receipt.Id });
  } catch (err) {
    const message = err instanceof QBAuthError
      ? `QB not connected: ${err.message}`
      : err instanceof Error ? err.message : "Unknown error";
    throw conflict(message);
  }
});
