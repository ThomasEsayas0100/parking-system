import { z } from "zod";
import { createCharge, getTokenizeUrl } from "@/lib/quickbooks";
import { handler, json } from "@/lib/api-handler";
import { RATE_LIMITS } from "@/lib/rate-limit";

const PaymentSchema = z.object({
  amount: z.number().min(0.01),
  description: z.string().optional(),
  // QB card token from client-side tokenization
  cardToken: z.string().min(1).optional(),
});

export const POST = handler(
  { body: PaymentSchema, rateLimit: RATE_LIMITS.auth },
  async ({ body }) => {
    const { amount, description, cardToken } = body;

    // If no card token provided, return the tokenize URL for the client
    // to collect card details and tokenize directly with QuickBooks
    if (!cardToken) {
      return json({
        tokenizeUrl: getTokenizeUrl(),
        requiresToken: true,
      });
    }

    // Create the charge using the card token
    const charge = await createCharge({
      token: cardToken,
      amount,
      description: description || "Parking payment",
    });

    if (charge.status !== "CAPTURED") {
      return json(
        { error: "Payment was not captured. Please try again." },
        { status: 402 },
      );
    }

    return json({
      paymentIntentId: charge.id, // keeping this field name for compatibility
      chargeId: charge.id,
      status: charge.status,
    });
  },
);
