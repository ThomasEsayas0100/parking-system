import { prisma } from "@/lib/prisma";
import {
  getOrCreateStripeCustomer,
  createPaymentCheckoutSession,
  createSubscriptionCheckoutSession,
  stripeConfigured,
} from "@/lib/stripe";
import { handler, json, notFound, conflict } from "@/lib/api-handler";
import { CheckoutCreateSchema } from "@/lib/schemas";

/**
 * POST /api/payments/checkout — create a Stripe Checkout session.
 *
 * One route handles all four purposes. Dispatch is by `sessionPurpose`:
 *
 *   CHECKIN / EXTENSION / OVERSTAY → payment mode (one-time PaymentIntent).
 *   MONTHLY_CHECKIN → subscription mode (recurring monthly invoice).
 *
 * The returned `checkoutUrl` is a Stripe-hosted page the client redirects
 * to. On success, Stripe redirects back to `/payment-complete?cs={id}`.
 * The webhook (triggered independently) writes the Payment + Session rows
 * before the client's redirect polling catches up; see the Stripe webhook
 * handler for the atomic creation path.
 *
 * We never create Payment or Session rows here — this route only produces
 * a Stripe URL. Our DB becomes consistent via webhook.
 */
export const POST = handler(
  { body: CheckoutCreateSchema },
  async ({ body, req }) => {
    if (!stripeConfigured()) {
      throw conflict("Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.");
    }

    const {
      driverId, sessionPurpose, vehicleId, sessionId,
      amount, description, hours, months, termsVersion, overstayAuthorized,
    } = body;

    // Per-purpose validation — catch misuse early so we don't create a
    // Checkout session that the webhook can't process.
    if ((sessionPurpose === "CHECKIN" || sessionPurpose === "MONTHLY_CHECKIN") && !vehicleId) {
      return json({ error: "vehicleId is required for check-in purposes" }, { status: 400 });
    }
    if ((sessionPurpose === "EXTENSION" || sessionPurpose === "OVERSTAY") && !sessionId) {
      return json({ error: "sessionId is required for extension/overstay" }, { status: 400 });
    }
    if ((sessionPurpose === "CHECKIN" || sessionPurpose === "EXTENSION") && !hours) {
      return json({ error: "hours is required for CHECKIN/EXTENSION" }, { status: 400 });
    }
    if (sessionPurpose === "MONTHLY_CHECKIN" && !months) {
      return json({ error: "months is required for MONTHLY_CHECKIN" }, { status: 400 });
    }

    const driver = await prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw notFound("Driver not found");

    // Verify the referenced session exists + belongs to this driver for
    // EXTENSION/OVERSTAY flows.
    if (sessionId) {
      const session = await prisma.session.findUnique({ where: { id: sessionId } });
      if (!session || session.driverId !== driverId) {
        throw notFound("Session not found");
      }
      if (sessionPurpose === "EXTENSION") {
        const isMonthly = await prisma.payment.findFirst({ where: { sessionId, type: "MONTHLY_CHECKIN" } });
        if (isMonthly) {
          return json(
            { error: "Monthly subscriptions renew automatically — extensions are not available." },
            { status: 400 },
          );
        }
      }
    }
    if (vehicleId) {
      const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
      if (!vehicle || vehicle.driverId !== driverId) {
        throw notFound("Vehicle not found");
      }
    }

    const customerId = await getOrCreateStripeCustomer(driver);

    const metadata = {
      driverId,
      ...(vehicleId ? { vehicleId } : {}),
      ...(sessionId ? { sessionId } : {}),
      sessionPurpose,
      ...(hours !== undefined ? { hours: String(hours) } : {}),
      ...(months !== undefined ? { months: String(months) } : {}),
      ...(termsVersion ? { termsVersion } : {}),
      ...(overstayAuthorized !== undefined ? { overstayAuthorized: String(overstayAuthorized) } : {}),
    };

    // Resolve success/cancel URLs against the incoming request origin so
    // localhost and deployed URLs both work without env-var coordination.
    const origin = new URL(req.url).origin;
    const successUrl = `${origin}/payment-complete?cs={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/checkin`;

    const result = sessionPurpose === "MONTHLY_CHECKIN"
      ? await createSubscriptionCheckoutSession({
          monthlyAmount: amount,
          productName: description,
          customerId,
          successUrl,
          cancelUrl,
          metadata,
        })
      : await createPaymentCheckoutSession({
          amount,
          description,
          customerId,
          successUrl,
          cancelUrl,
          metadata,
        });

    return json(result);
  },
);
