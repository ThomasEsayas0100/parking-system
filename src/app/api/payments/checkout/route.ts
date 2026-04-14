import { z } from "zod";
import { findOrCreateCustomer, createInvoiceCheckout } from "@/lib/quickbooks";
import { handler, json } from "@/lib/api-handler";
import { RATE_LIMITS } from "@/lib/rate-limit";

/**
 * POST: Create a QB invoice and return the hosted checkout URL.
 *
 * The client redirects the driver to this URL. After payment,
 * the driver returns to our confirmation page. The server polls
 * the invoice to verify payment before creating the session.
 */
const CheckoutSchema = z.object({
  driverName: z.string().min(1),
  driverPhone: z.string().min(4),
  driverEmail: z.string().email().optional(),
  amount: z.number().min(0.01),
  description: z.string().min(1),
  /** Unique key to prevent duplicate invoices on retry */
  idempotencyKey: z.string().optional(),
});

export const POST = handler(
  { body: CheckoutSchema, rateLimit: RATE_LIMITS.auth },
  async ({ body }) => {
    const { driverName, driverPhone, driverEmail, amount, description, idempotencyKey } = body;

    const customer = await findOrCreateCustomer({
      name: driverName,
      phone: driverPhone,
      email: driverEmail,
    });

    const { invoiceId, checkoutUrl } = await createInvoiceCheckout({
      customerId: customer.Id,
      amount,
      description,
      driverEmail,
      idempotencyKey,
    });

    return json({
      invoiceId,
      checkoutUrl,
      customerId: customer.Id,
    });
  },
);
