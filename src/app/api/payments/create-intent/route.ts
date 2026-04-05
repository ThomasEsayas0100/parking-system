import { stripe } from "@/lib/stripe";
import { handler, json } from "@/lib/api-handler";
import { PaymentIntentCreateSchema } from "@/lib/schemas";
import { RATE_LIMITS } from "@/lib/rate-limit";

export const POST = handler(
  { body: PaymentIntentCreateSchema, rateLimit: RATE_LIMITS.auth },
  async ({ body }) => {
    const { amount, description } = body;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Stripe expects cents
      currency: "usd",
      description: description || "Parking payment",
      automatic_payment_methods: { enabled: true },
    });

    return json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  },
);
