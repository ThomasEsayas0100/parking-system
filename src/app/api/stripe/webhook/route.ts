import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { constructWebhookEvent, getStripe, StripeConfigError } from "@/lib/stripe";
import {
  findOrCreateCustomer,
  writeSalesReceipt,
  writeRefundReceipt,
  QBAuthError,
} from "@/lib/quickbooks";
import { assignSpot } from "@/lib/spots";
import { addDays, addMonths, ceilDays } from "@/lib/rates";
import { log as audit } from "@/lib/audit";

/**
 * Stripe webhook — the authoritative driver for payment state.
 *
 * Every incoming event is:
 *   1. Signature-verified (signed with STRIPE_WEBHOOK_SECRET).
 *   2. Idempotency-checked via the StripeEvent table (duplicate event.id
 *      short-circuits with STRIPE_WEBHOOK_REPLAYED audit).
 *   3. Dispatched to a handler that writes our Payment row, creates/updates
 *      the Session, and mirrors the outcome to QuickBooks as a Sales Receipt
 *      or Refund Receipt.
 *
 * Handler failures throw; the request returns 500 so Stripe retries. The
 * StripeEvent row is NOT written until all side effects succeed — a partial
 * failure shouldn't block a subsequent retry from completing the work.
 *
 * QB auth failures (QBAuthError — QB not connected) are caught and audited
 * without failing the webhook. All other QB errors propagate so the webhook
 * returns 500 and Stripe retries the event — the StripeEvent row is not
 * written until all side effects succeed, so the retry is safe.
 */
export async function POST(req: NextRequest) {
  // Stripe requires the raw request body for signature verification. Next's
  // NextRequest.text() gives us the unparsed body.
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch (err) {
    if (err instanceof StripeConfigError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    // Signature verification failed — 400 per Stripe docs (don't retry).
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Idempotency: if we've already processed this event, short-circuit with
  // a replayed audit. We don't fail — Stripe expects 2xx so it stops retrying.
  const existing = await prisma.stripeEvent.findUnique({ where: { id: event.id } });
  if (existing) {
    await audit({
      action: "STRIPE_WEBHOOK_REPLAYED",
      details: `${event.type} event ${event.id} — already processed at ${existing.processedAt.toISOString()}`,
    });
    await prisma.settings.update({
      where: { id: "default" },
      data: { lastStripeWebhookAt: new Date() },
    });
    return NextResponse.json({ received: true, replayed: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event);
        break;
      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(event);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event);
        break;
      case "charge.refunded":
        await handleChargeRefunded(event);
        break;
      case "charge.dispute.created":
        await handleChargeDisputed(event);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event);
        break;
      default:
        // Unhandled event types are still recorded so the replay-check works.
        // No side effect beyond the audit + event row.
        break;
    }

    await prisma.stripeEvent.upsert({
      where: { id: event.id },
      create: { id: event.id, type: event.type, payload: event as unknown as object },
      update: {},
    });

    await prisma.settings.update({
      where: { id: "default" },
      data: { lastStripeWebhookAt: new Date() },
    });

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[stripe-webhook] handler failed:", event.type, event.id, err);
    // Return 500 so Stripe retries. StripeEvent row is not written, so the
    // retry will re-run the handler.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "handler failed" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

type SessionPurpose = "CHECKIN" | "MONTHLY_CHECKIN" | "EXTENSION" | "OVERSTAY";

type CheckoutMetadata = {
  driverId?: string;
  vehicleId?: string;
  sessionId?: string;
  sessionPurpose?: SessionPurpose;
  durationType?: "DAILY" | "MONTHLY";
  days?: string;
  months?: string;
  termsVersion?: string;
  overstayAuthorized?: string;
  licensePlate?: string;
  vehicleType?: string;
};

/**
 * Primary creation event for all four session purposes. Stripe fires this
 * once the Checkout UI reports success, regardless of mode (payment or
 * subscription).
 *
 * For one-time (mode=payment): the PaymentIntent carries the charge; we
 * dispatch by metadata.sessionPurpose.
 * For subscription (mode=subscription): the subscription's first invoice
 * is already paid when this fires; we treat it as MONTHLY_CHECKIN and
 * subsequent renewals come in via `invoice.payment_succeeded`.
 */
/**
 * Process a completed Stripe Checkout Session — called from both the webhook
 * handler and the /api/payments/lookup fallback (when the webhook hasn't
 * arrived yet). Idempotent: no-ops if the Payment row already exists for
 * this checkout session.
 */
export async function processCheckoutSession(
  session: Stripe.Checkout.Session,
  eventId: string,
): Promise<void> {
  // Parse metadata early — needed for the QB retry in the idempotency path.
  const metadata = (session.metadata ?? {}) as CheckoutMetadata;
  const purpose = metadata.sessionPurpose as SessionPurpose | undefined;

  // Idempotency: if the Payment row already exists the DB write succeeded.
  // Re-attempt the QB receipt write if it's still missing — this handles the
  // case where a prior run wrote the Payment but QB failed; Stripe retried the
  // webhook, and we retry just the QB write.
  const existing = await prisma.payment.findFirst({
    where: { stripeCheckoutSessionId: session.id },
  });
  if (existing) {
    if (!existing.qbSalesReceiptId && existing.stripeChargeId && metadata.driverId && purpose) {
      await writeSalesReceiptSafe({
        driverId: metadata.driverId,
        amount: existing.amount,
        description: salesReceiptDescription(purpose, metadata),
        stripeEventId: eventId,
        stripeChargeId: existing.stripeChargeId,
      });
    }
    return;
  }

  if (!metadata.driverId) {
    throw new Error(`checkout.session missing driverId metadata (cs=${session.id})`);
  }
  if (!purpose) {
    throw new Error(`checkout.session missing sessionPurpose metadata (cs=${session.id})`);
  }

  const stripe = getStripe();

  let paymentIntentId: string | null = null;
  let chargeId: string | null = null;
  let subscriptionId: string | null = null;
  let invoiceId: string | null = null;

  if (session.mode === "payment") {
    paymentIntentId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;
    if (paymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null;
    }
  } else if (session.mode === "subscription") {
    subscriptionId = typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id ?? null;
    if (subscriptionId) {
      const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice"] });
      const latestInvoice = sub.latest_invoice as Stripe.Invoice | null;
      invoiceId = latestInvoice?.id ?? null;
      // In the clover API, invoice.payment_intent is gone. Use InvoicePayments API.
      if (invoiceId) {
        const invoicePayments = await stripe.invoicePayments.list({ invoice: invoiceId, limit: 1 });
        const invoicePayment = invoicePayments.data[0];
        if (invoicePayment) {
          const piRef = invoicePayment.payment?.payment_intent;
          paymentIntentId = typeof piRef === "string" ? piRef : piRef?.id ?? null;
          if (paymentIntentId) {
            const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
            chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null;
          }
        }
      }
    }
  }

  const amountCents = session.amount_total ?? 0;
  const amountDollars = amountCents / 100;

  switch (purpose) {
    case "CHECKIN":
      await handleCheckin({ metadata, checkoutSessionId: session.id, paymentIntentId, chargeId, amount: amountDollars });
      break;
    case "MONTHLY_CHECKIN":
      await handleMonthlyCheckin({ metadata, checkoutSessionId: session.id, paymentIntentId, chargeId, subscriptionId, invoiceId, amount: amountDollars });
      break;
    case "EXTENSION":
      await handleExtension({ metadata, checkoutSessionId: session.id, paymentIntentId, chargeId, amount: amountDollars });
      break;
    case "OVERSTAY":
      await handleOverstay({ metadata, checkoutSessionId: session.id, paymentIntentId, chargeId, amount: amountDollars });
      break;
  }

  if (chargeId) {
    await writeSalesReceiptSafe({
      driverId: metadata.driverId,
      amount: amountDollars,
      description: salesReceiptDescription(purpose, metadata),
      stripeEventId: eventId,
      stripeChargeId: chargeId,
    });
  }
}

async function handleCheckoutSessionCompleted(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session;
  await processCheckoutSession(session, event.id);
}

async function handleCheckin(args: {
  metadata: CheckoutMetadata;
  checkoutSessionId: string;
  paymentIntentId: string | null;
  chargeId: string | null;
  amount: number;
}) {
  const { metadata, checkoutSessionId, paymentIntentId, chargeId, amount } = args;
  if (!metadata.driverId || !metadata.vehicleId || !metadata.days || !metadata.termsVersion) {
    throw new Error("CHECKIN metadata incomplete");
  }
  const days = parseInt(metadata.days, 10);
  if (!Number.isFinite(days) || days <= 0) throw new Error("CHECKIN invalid days");

  const vehicle = await prisma.vehicle.findUnique({ where: { id: metadata.vehicleId } });
  if (!vehicle) throw new Error(`CHECKIN vehicle ${metadata.vehicleId} not found`);

  const existingActive = await prisma.session.findFirst({
    where: { vehicleId: vehicle.id, status: { in: ["ACTIVE", "OVERSTAY"] } },
  });
  if (existingActive) {
    // Race: driver already has a session. Don't create another, but do write
    // the Payment row so the refund path has a handle.
    await prisma.payment.create({
      data: {
        sessionId: existingActive.id,
        type: "CHECKIN",
        amount,
        days,
        stripeCheckoutSessionId: checkoutSessionId,
        stripePaymentIntentId: paymentIntentId,
        stripeChargeId: chargeId,
      },
    });
    return;
  }

  const now = new Date();
  const expectedEnd = addDays(now, days);

  // Atomic: FOR UPDATE SKIP LOCKED in assignSpot locks the spot row; session.create
  // claims it — both inside the same transaction so no concurrent check-in can race.
  const txResult = await prisma.$transaction(async (tx) => {
    const spot = await assignSpot(vehicle.type, tx);
    if (!spot) return null;
    const created = await tx.session.create({
      data: {
        driverId: metadata.driverId!,
        vehicleId: vehicle.id,
        spotId: spot.id,
        expectedEnd,
        termsVersion: metadata.termsVersion,
        overstayAuthorized: metadata.overstayAuthorized === "true",
        payments: {
          create: {
            type: "CHECKIN",
            amount,
            days,
            stripeCheckoutSessionId: checkoutSessionId,
            stripePaymentIntentId: paymentIntentId,
            stripeChargeId: chargeId,
          },
        },
      },
    });
    return { session: created, spotLabel: spot.label };
  });

  if (!txResult) {
    await audit({
      action: "SALES_RECEIPT_FAILED",
      driverId: metadata.driverId,
      details: `No spot available after CHECKIN payment captured. cs=${checkoutSessionId}, amount=$${amount.toFixed(2)}. Manual refund required.`,
    });
    throw new Error("No spot available after successful payment — admin must refund");
  }
  const { session, spotLabel } = txResult;

  await audit({
    action: "CHECKIN",
    sessionId: session.id,
    driverId: session.driverId,
    vehicleId: session.vehicleId,
    spotId: session.spotId,
    details: `Checked in for ${days}d, paid $${amount.toFixed(2)}, spot: ${spotLabel}, plate: ${vehicle.licensePlate ?? "–"}, terms:v${metadata.termsVersion}`,
  });
}

async function handleMonthlyCheckin(args: {
  metadata: CheckoutMetadata;
  checkoutSessionId: string;
  paymentIntentId: string | null;
  chargeId: string | null;
  subscriptionId: string | null;
  invoiceId: string | null;
  amount: number;
}) {
  const { metadata, checkoutSessionId, paymentIntentId, chargeId, subscriptionId, invoiceId, amount } = args;
  if (!metadata.driverId || !metadata.vehicleId || !metadata.termsVersion) {
    throw new Error("MONTHLY_CHECKIN metadata incomplete");
  }
  if (!subscriptionId) throw new Error("MONTHLY_CHECKIN missing subscriptionId");

  const vehicle = await prisma.vehicle.findUnique({ where: { id: metadata.vehicleId } });
  if (!vehicle) throw new Error(`MONTHLY_CHECKIN vehicle ${metadata.vehicleId} not found`);

  const existingActive = await prisma.session.findFirst({
    where: { vehicleId: vehicle.id, status: { in: ["ACTIVE", "OVERSTAY"] } },
  });
  if (existingActive) {
    await prisma.payment.create({
      data: {
        sessionId: existingActive.id,
        type: "MONTHLY_CHECKIN",
        amount,
        stripeCheckoutSessionId: checkoutSessionId,
        stripePaymentIntentId: paymentIntentId,
        stripeChargeId: chargeId,
        stripeSubscriptionId: subscriptionId,
        stripeInvoiceId: invoiceId,
      },
    });
    return;
  }

  const now = new Date();
  const initialMonths = metadata.months ? parseInt(metadata.months, 10) : 1;
  const expectedEnd = addMonths(now, initialMonths);

  const txResult = await prisma.$transaction(async (tx) => {
    const spot = await assignSpot(vehicle.type, tx);
    if (!spot) return null;
    const created = await tx.session.create({
      data: {
        driverId: metadata.driverId!,
        vehicleId: vehicle.id,
        spotId: spot.id,
        expectedEnd,
        termsVersion: metadata.termsVersion,
        overstayAuthorized: metadata.overstayAuthorized === "true",
        payments: {
          create: {
            type: "MONTHLY_CHECKIN",
            amount,
            stripeCheckoutSessionId: checkoutSessionId,
            stripePaymentIntentId: paymentIntentId,
            stripeChargeId: chargeId,
            stripeSubscriptionId: subscriptionId,
            stripeInvoiceId: invoiceId,
          },
        },
      },
    });
    return { session: created, spotLabel: spot.label };
  });

  if (!txResult) {
    await audit({
      action: "SALES_RECEIPT_FAILED",
      driverId: metadata.driverId,
      details: `No spot available after MONTHLY_CHECKIN payment. sub=${subscriptionId}, cs=${checkoutSessionId}. Manual refund + subscription cancel required.`,
    });
    throw new Error("No spot available after successful monthly signup");
  }
  const { session, spotLabel } = txResult;

  // Set cancel_at on the subscription so Stripe auto-cancels after the
  // pre-selected period and stops charging the driver.
  const cancelAt = Math.floor(expectedEnd.getTime() / 1000);
  await getStripe().subscriptions.update(subscriptionId, { cancel_at: cancelAt });

  await audit({
    action: "SUBSCRIPTION_CREATED",
    sessionId: session.id,
    driverId: session.driverId,
    details: `Monthly subscription created: sub=${subscriptionId}, first month $${amount.toFixed(2)}, cancel_at=${expectedEnd.toISOString()}`,
  });
  await audit({
    action: "CHECKIN",
    sessionId: session.id,
    driverId: session.driverId,
    vehicleId: session.vehicleId,
    spotId: session.spotId,
    details: `Monthly checkin, spot: ${spotLabel}, plate: ${vehicle.licensePlate ?? "–"}, terms:v${metadata.termsVersion}`,
  });
}

async function handleExtension(args: {
  metadata: CheckoutMetadata;
  checkoutSessionId: string;
  paymentIntentId: string | null;
  chargeId: string | null;
  amount: number;
}) {
  const { metadata, checkoutSessionId, paymentIntentId, chargeId, amount } = args;
  if (!metadata.sessionId || !metadata.days) {
    throw new Error("EXTENSION metadata incomplete");
  }
  const days = parseInt(metadata.days, 10);
  if (!Number.isFinite(days) || days <= 0) throw new Error("EXTENSION invalid days");

  const session = await prisma.session.findUnique({ where: { id: metadata.sessionId } });
  if (!session) throw new Error(`EXTENSION session ${metadata.sessionId} not found`);

  const newExpectedEnd = addDays(session.expectedEnd, days);
  const newStatus = session.status === "OVERSTAY" ? "ACTIVE" : session.status;

  await prisma.$transaction([
    prisma.session.update({
      where: { id: session.id },
      data: {
        expectedEnd: newExpectedEnd,
        status: newStatus,
        reminderSent: false,
      },
    }),
    prisma.payment.create({
      data: {
        sessionId: session.id,
        type: "EXTENSION",
        amount,
        days,
        stripeCheckoutSessionId: checkoutSessionId,
        stripePaymentIntentId: paymentIntentId,
        stripeChargeId: chargeId,
      },
    }),
  ]);

  await audit({
    action: "EXTEND",
    sessionId: session.id,
    driverId: session.driverId,
    details: `Extended ${days}d, paid $${amount.toFixed(2)}, new expiry: ${newExpectedEnd.toISOString()}`,
  });
}

async function handleOverstay(args: {
  metadata: CheckoutMetadata;
  checkoutSessionId: string;
  paymentIntentId: string | null;
  chargeId: string | null;
  amount: number;
}) {
  const { metadata, checkoutSessionId, paymentIntentId, chargeId, amount } = args;
  if (!metadata.sessionId) throw new Error("OVERSTAY metadata incomplete");

  const session = await prisma.session.findUnique({
    where: { id: metadata.sessionId },
    include: { vehicle: true, spot: true },
  });
  if (!session) throw new Error(`OVERSTAY session ${metadata.sessionId} not found`);

  const now = new Date();
  const daysOverstay = ceilDays(session.expectedEnd, now);

  await prisma.$transaction([
    prisma.session.update({
      where: { id: session.id },
      data: { status: "COMPLETED", endedAt: now },
    }),
    prisma.payment.create({
      data: {
        sessionId: session.id,
        type: "OVERSTAY",
        amount,
        days: daysOverstay > 0 ? daysOverstay : null,
        stripeCheckoutSessionId: checkoutSessionId,
        stripePaymentIntentId: paymentIntentId,
        stripeChargeId: chargeId,
      },
    }),
  ]);

  await audit({
    action: "OVERSTAY_PAYMENT",
    sessionId: session.id,
    driverId: session.driverId,
    vehicleId: session.vehicleId,
    details: `Overstay ${daysOverstay}d, paid $${amount.toFixed(2)}, plate: ${session.vehicle.licensePlate}`,
  });
  await audit({
    action: "CHECKOUT",
    sessionId: session.id,
    driverId: session.driverId,
    vehicleId: session.vehicleId,
    spotId: session.spotId,
    details: `Checked out from spot ${session.spot.label}, plate: ${session.vehicle.licensePlate}`,
  });
}

/**
 * Fires for every paid subscription invoice — both the first
 * (billing_reason="subscription_create") and all renewals.
 *
 * For subscription_create: the Payment + Session rows were already written by
 * checkout.session.completed, so we skip those writes. However, the charge
 * may not have been resolved when that event fired, so we use this event
 * (where the charge is always present) to write the QB Sales Receipt if still
 * missing.
 *
 * For renewals: advance expectedEnd, create MONTHLY_RENEWAL Payment, write QB receipt.
 */
async function handleInvoicePaymentSucceeded(event: Stripe.Event) {
  // `invoice.subscription` and `invoice.payment_intent` were removed from
  // the Stripe.Invoice base type in SDK v20. Cast to access.
  const invoice = event.data.object as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
    payment_intent?: string | Stripe.PaymentIntent | null;
  };

  const subscriptionId = typeof invoice.subscription === "string"
    ? invoice.subscription
    : invoice.subscription?.id ?? null;
  if (!subscriptionId) return;

  // Resolve chargeId via the InvoicePayments API.
  // In the clover API (2025-09-30), invoice.charge and invoice.payment_intent
  // were removed from the Invoice object and moved to InvoicePayment.payment.
  const stripe = getStripe();
  let chargeId: string | null = null;
  let paymentIntentId: string | null = null;
  const invoicePayments = await stripe.invoicePayments.list({ invoice: invoice.id, limit: 1 });
  const invoicePayment = invoicePayments.data[0];
  if (invoicePayment) {
    const piRef = invoicePayment.payment?.payment_intent;
    paymentIntentId = typeof piRef === "string" ? piRef : piRef?.id ?? null;
    if (paymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null;
    }
  }

  const amount = (invoice.amount_paid ?? 0) / 100;

  // Fetch subscription metadata to get the contracted total months (N).
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const totalMonths = parseInt(sub.metadata?.months ?? "1", 10);

  if (invoice.billing_reason === "subscription_create") {
    // Payment + Session already created by checkout.session.completed.
    // Write the QB receipt now using the invoice payment row (lookup by invoiceId).
    if (!chargeId) return;
    const payment = await prisma.payment.findFirst({
      where: { stripeInvoiceId: invoice.id },
      include: { session: { include: { vehicle: true } } },
    });
    if (!payment || payment.qbSalesReceiptId) return; // already written or not found

    // Backfill stripeChargeId — it was null at checkout time (charge hadn't settled yet).
    // Do this before writeSalesReceiptSafe so the updateMany({ where: stripeChargeId }) finds the row.
    if (!payment.stripeChargeId) {
      await prisma.payment.update({ where: { id: payment.id }, data: { stripeChargeId: chargeId } });
    }

    const vt0 = vehicleTypeLabel(payment.session.vehicle.type);
    const plate0 = plateSuffix(payment.session.vehicle.licensePlate ?? undefined);
    await writeSalesReceiptSafe({
      driverId: payment.session.driverId,
      amount: payment.amount,
      description: `${vt0} parking — monthly, month 1 of ${totalMonths}${plate0}`,
      stripeEventId: event.id,
      stripeChargeId: chargeId,
    });
    return;
  }

  // Renewal path — find the session via the first subscription payment.
  const firstPayment = await prisma.payment.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
    orderBy: { createdAt: "asc" },
    include: { session: { include: { vehicle: true } } },
  });
  if (!firstPayment) {
    console.warn(`[stripe-webhook] invoice.payment_succeeded for unknown subscription ${subscriptionId}`);
    return;
  }

  const session = firstPayment.session;

  // Skip if the session was already admin-cancelled — the subscription should have been
  // cancelled in Stripe at the same time, but this guards against race conditions.
  if (session.status === "CANCELLED" || session.status === "COMPLETED") return;

  // Count existing monthly payments to determine position before creating the new one.
  const existingMonthlyCount = await prisma.payment.count({
    where: { sessionId: session.id, type: { in: ["MONTHLY_CHECKIN", "MONTHLY_RENEWAL"] } },
  });
  const renewalPosition = existingMonthlyCount + 1; // new payment will be this position

  // Idempotency: if the Payment row already exists, the DB write succeeded on
  // a prior delivery. Re-attempt the QB receipt write if it's still missing.
  const existingRenewal = await prisma.payment.findFirst({
    where: { stripeInvoiceId: invoice.id, type: "MONTHLY_RENEWAL" },
  });
  if (existingRenewal) {
    if (chargeId && !existingRenewal.qbSalesReceiptId) {
      const vtR2 = vehicleTypeLabel(firstPayment.session.vehicle.type);
      const plateR2 = plateSuffix(firstPayment.session.vehicle.licensePlate ?? undefined);
      // existingMonthlyCount includes the already-created renewal, so it equals the position.
      await writeSalesReceiptSafe({
        driverId: session.driverId,
        amount: existingRenewal.amount,
        description: `${vtR2} parking — monthly, month ${existingMonthlyCount} of ${totalMonths}${plateR2}`,
        stripeEventId: event.id,
        stripeChargeId: chargeId,
      });
    }
    return;
  }

  // expectedEnd was set to the full contracted period at session creation — do NOT advance it.
  // Each MONTHLY_RENEWAL is a payment milestone within that period; the slot was already reserved.
  await prisma.$transaction([
    prisma.session.update({
      where: { id: session.id },
      data: { reminderSent: false, billingStatus: "CURRENT" },
    }),
    prisma.payment.create({
      data: {
        sessionId: session.id,
        type: "MONTHLY_RENEWAL",
        amount,
        stripePaymentIntentId: paymentIntentId,
        stripeChargeId: chargeId,
        stripeSubscriptionId: subscriptionId,
        stripeInvoiceId: invoice.id,
      },
    }),
  ]);

  if (chargeId) {
    const vtR = vehicleTypeLabel(firstPayment.session.vehicle.type);
    const plateR = plateSuffix(firstPayment.session.vehicle.licensePlate ?? undefined);
    await writeSalesReceiptSafe({
      driverId: session.driverId,
      amount,
      description: `${vtR} parking — monthly, month ${renewalPosition} of ${totalMonths}${plateR}`,
      stripeEventId: event.id,
      stripeChargeId: chargeId,
    });
  }
}

async function handleInvoicePaymentFailed(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
  };
  const subscriptionId = typeof invoice.subscription === "string"
    ? invoice.subscription
    : invoice.subscription?.id ?? null;
  if (!subscriptionId) return;

  const firstPayment = await prisma.payment.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
    include: { session: true },
  });
  if (!firstPayment) return;

  await prisma.session.update({
    where: { id: firstPayment.session.id },
    data: { billingStatus: "PAYMENT_FAILED" },
  });

  await audit({
    action: "RECURRING_CHARGE_FAILED",
    sessionId: firstPayment.session.id,
    driverId: firstPayment.session.driverId,
    details: `Invoice ${invoice.id} payment failed — subscription ${subscriptionId}. Stripe will retry per its dunning schedule.`,
  });
}

/**
 * Process a Stripe Charge refund — called from both the `charge.refunded`
 * webhook and the admin refund endpoint (fallback when webhook is delayed).
 * Idempotent: `PaymentRefund.upsert` on `stripeRefundId` is safe to call
 * twice; the Payment status update is a no-op if already at REFUNDED.
 */
export async function processChargeRefund(charge: Stripe.Charge, eventId: string): Promise<void> {
  let payment = await prisma.payment.findFirst({
    where: { stripeChargeId: charge.id },
    include: { session: { include: { driver: true, vehicle: true } } },
  });
  // Fallback: if stripeChargeId wasn't written (missed checkout webhook), try PI.
  if (!payment && charge.payment_intent) {
    const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent.id;
    payment = await prisma.payment.findFirst({
      where: { stripePaymentIntentId: piId },
      include: { session: { include: { driver: true, vehicle: true } } },
    });
    if (payment) {
      await prisma.payment.update({ where: { id: payment.id }, data: { stripeChargeId: charge.id } });
    }
  }
  if (!payment) {
    console.warn(`[stripe] processChargeRefund: unknown charge ${charge.id} (PI: ${charge.payment_intent})`);
    return;
  }

  const totalRefundedCents = charge.amount_refunded;
  const totalRefunded = totalRefundedCents / 100;
  const allRefunds = charge.refunds?.data ?? [];

  const newStatus = totalRefundedCents >= charge.amount
    ? "REFUNDED"
    : totalRefundedCents > 0
      ? "PARTIALLY_REFUNDED"
      : payment.status;

  await prisma.payment.update({
    where: { id: payment.id },
    data: { refundedAmount: totalRefunded, refundedAt: new Date(), status: newStatus },
  });

  // Upsert a PaymentRefund row for every refund on this charge so we never
  // miss one regardless of how many times this function is called.
  for (const r of allRefunds) {
    await prisma.paymentRefund.upsert({
      where: { stripeRefundId: r.id },
      update: {},
      create: { paymentId: payment.id, amount: r.amount / 100, stripeRefundId: r.id },
    });
  }

  await audit({
    action: "REFUND_ISSUED",
    sessionId: payment.sessionId,
    driverId: payment.session.driverId,
    details: `Charge ${charge.id} — total refunded: $${totalRefunded.toFixed(2)} across ${allRefunds.length} refund(s)`,
  });

  // Write a QB Refund Receipt for each refund that doesn't have one yet.
  for (const r of allRefunds) {
    const existing = await prisma.paymentRefund.findUnique({ where: { stripeRefundId: r.id } });
    if (existing?.qbRefundReceiptId) continue; // already written
    await writeRefundReceiptSafe({
      driverId: payment.session.driverId,
      amount: r.amount / 100,
      description: refundDescription(payment),
      stripeEventId: eventId,
      stripeRefundId: r.id,
      stripeChargeId: charge.id,
      qbSalesReceiptId: payment.qbSalesReceiptId ?? undefined,
    });
  }
}

async function handleChargeRefunded(event: Stripe.Event) {
  const charge = event.data.object as Stripe.Charge;
  await processChargeRefund(charge, event.id);
}

async function handleChargeDisputed(event: Stripe.Event) {
  const dispute = event.data.object as Stripe.Dispute;
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;

  const payment = await prisma.payment.findFirst({
    where: { stripeChargeId: chargeId },
    include: { session: true },
  });
  if (!payment) return;

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "DISPUTED" },
  });

  await audit({
    action: "PAYMENT_DISPUTED",
    sessionId: payment.sessionId,
    driverId: payment.session.driverId,
    details: `Dispute opened on charge ${chargeId}: ${dispute.reason}. Respond via https://dashboard.stripe.com/disputes/${dispute.id}`,
  });
}

async function handleSubscriptionDeleted(event: Stripe.Event) {
  const sub = event.data.object as Stripe.Subscription;

  const firstPayment = await prisma.payment.findFirst({
    where: { stripeSubscriptionId: sub.id },
    include: { session: true },
  });
  if (!firstPayment) return;

  const session = firstPayment.session;

  // If the admin already cancelled this session in the DB (and Stripe is confirming
  // the subscription is gone), treat as a no-op — billing status is already handled.
  if (session.status === "CANCELLED") return;

  const now = new Date();

  // Clamp session end to now for immediate mid-period cancellations.
  // For period-end cancellations, expectedEnd was already set correctly by the
  // last invoice.payment_succeeded renewal webhook, so this is a no-op.
  const newEnd = session.expectedEnd < now ? session.expectedEnd : now;

  await prisma.session.update({
    where: { id: session.id },
    data: {
      billingStatus: "DELINQUENT",
      ...(newEnd < session.expectedEnd ? { expectedEnd: newEnd } : {}),
    },
  });

  await audit({
    action: "SUBSCRIPTION_CANCELED",
    sessionId: session.id,
    driverId: session.driverId,
    details: `Subscription ${sub.id} canceled — access ends ${newEnd.toISOString()}. If driver is on property, cron will detect overstay on next run.`,
  });
}

// ---------------------------------------------------------------------------
// QB receipt writes — wrapped so failures don't break the webhook
// ---------------------------------------------------------------------------

async function writeSalesReceiptSafe(args: {
  driverId: string;
  amount: number;
  description: string;
  stripeEventId: string;
  stripeChargeId: string;
}) {
  try {
    const driver = await prisma.driver.findUnique({ where: { id: args.driverId } });
    if (!driver) throw new Error(`Driver ${args.driverId} not found for Sales Receipt`);

    let customerId = driver.qbCustomerId;
    if (!customerId) {
      const customer = await findOrCreateCustomer({
        name: driver.name,
        phone: driver.phone,
        email: driver.email ?? undefined,
      });
      customerId = customer.Id;
      await prisma.driver.update({
        where: { id: driver.id },
        data: { qbCustomerId: customerId },
      });
    }

    const receipt = await writeSalesReceipt({
      customerId,
      amount: args.amount,
      description: args.description,
      stripeEventId: args.stripeEventId,
      stripeChargeId: args.stripeChargeId,
    });

    // Store the QB receipt ID so the admin can deep-link to it.
    await prisma.payment.updateMany({
      where: { stripeChargeId: args.stripeChargeId },
      data: { qbSalesReceiptId: receipt.Id },
    });

    await audit({
      action: "SALES_RECEIPT_WRITTEN",
      driverId: args.driverId,
      details: `QB Sales Receipt ${receipt.DocNumber} (id ${receipt.Id}) for $${args.amount.toFixed(2)} (charge ${args.stripeChargeId})`,
    });
  } catch (err) {
    const isAuthError = err instanceof QBAuthError;
    const message = isAuthError
      ? `QB not connected: ${err.message}`
      : err instanceof Error ? err.message : "unknown error";
    console.error("[QB] Sales Receipt write failed:", err);
    await audit({
      action: "SALES_RECEIPT_FAILED",
      driverId: args.driverId,
      details: `QB write failed for charge ${args.stripeChargeId}: ${message}. Reconcile manually.`,
    });
    // QBAuthError means QB isn't connected — retrying won't help, swallow it.
    // Any other error is unexpected; rethrow so webhook returns 500 and Stripe retries.
    if (!isAuthError) throw err;
  }
}

async function writeRefundReceiptSafe(args: {
  driverId: string;
  amount: number;
  description: string;
  stripeEventId: string;
  stripeRefundId: string;
  stripeChargeId?: string;
  qbSalesReceiptId?: string;
}) {
  try {
    const driver = await prisma.driver.findUnique({ where: { id: args.driverId } });
    if (!driver) throw new Error(`Driver ${args.driverId} not found for Refund Receipt`);

    let customerId = driver.qbCustomerId;
    if (!customerId) {
      const customer = await findOrCreateCustomer({
        name: driver.name,
        phone: driver.phone,
        email: driver.email ?? undefined,
      });
      customerId = customer.Id;
      await prisma.driver.update({
        where: { id: driver.id },
        data: { qbCustomerId: customerId },
      });
    }

    const receipt = await writeRefundReceipt({
      customerId,
      amount: args.amount,
      description: args.description,
      stripeEventId: args.stripeEventId,
      stripeRefundId: args.stripeRefundId,
      stripeChargeId: args.stripeChargeId,
      linkedSalesReceiptId: args.qbSalesReceiptId,
    });

    // Store the QB receipt ID on the PaymentRefund row for deep-linking.
    await prisma.paymentRefund.updateMany({
      where: { stripeRefundId: args.stripeRefundId },
      data: { qbRefundReceiptId: receipt.Id },
    });

    const salesRef = args.qbSalesReceiptId ? ` for Sales Receipt ${args.qbSalesReceiptId}` : "";
    await audit({
      action: "REFUND_ISSUED",
      driverId: args.driverId,
      details: `QB Refund Receipt ${receipt.DocNumber} (id ${receipt.Id}) for $${args.amount.toFixed(2)} (refund ${args.stripeRefundId})${salesRef}`,
    });
  } catch (err) {
    const isAuthError = err instanceof QBAuthError;
    const message = isAuthError
      ? `QB not connected: ${err.message}`
      : err instanceof Error ? err.message : "unknown error";
    console.error("[QB] Refund Receipt write failed:", err);
    await audit({
      action: "SALES_RECEIPT_FAILED",
      driverId: args.driverId,
      details: `QB Refund Receipt failed for refund ${args.stripeRefundId}: ${message}. Reconcile manually.`,
    });
    // QBAuthError means QB isn't connected — retrying won't help, swallow it.
    // Any other error is unexpected; rethrow so webhook returns 500 and Stripe retries.
    if (!isAuthError) throw err;
  }
}

function vehicleTypeLabel(type: string | undefined): string {
  return type === "BOBTAIL" ? "Bobtail" : "Truck/trailer";
}

function refundDescription(payment: { type: string; days: number | null; session: { vehicle: { type: string; licensePlate: string | null } } }): string {
  const vt = vehicleTypeLabel(payment.session.vehicle.type);
  const plate = plateSuffix(payment.session.vehicle.licensePlate ?? undefined);
  const typeMap: Record<string, string> = {
    CHECKIN: `check-in, ${payment.days ?? "?"}d`,
    EXTENSION: `extension, ${payment.days ?? "?"}d`,
    OVERSTAY: `overstay, ${payment.days ?? "?"}d`,
    MONTHLY_CHECKIN: "monthly",
    MONTHLY_RENEWAL: "monthly renewal",
  };
  const detail = typeMap[payment.type] ?? payment.type.toLowerCase();
  return `Refund — ${vt} parking, ${detail}${plate}`;
}

function plateSuffix(plate: string | undefined): string {
  return plate ? ` · Plate ${plate}` : "";
}

function salesReceiptDescription(purpose: SessionPurpose, metadata: CheckoutMetadata): string {
  const vt = vehicleTypeLabel(metadata.vehicleType);
  const plate = plateSuffix(metadata.licensePlate);
  switch (purpose) {
    case "CHECKIN":
      return `${vt} parking — check-in, ${metadata.days ?? "?"}d${plate}`;
    case "MONTHLY_CHECKIN":
      return `${vt} parking — monthly, month 1 of ${metadata.months ?? "?"}${plate}`;
    case "EXTENSION":
      return `${vt} parking — extension, ${metadata.days ?? "?"}d${plate}`;
    case "OVERSTAY":
      return `${vt} parking — overstay, ${metadata.days ?? "?"}d${plate}`;
  }
}
