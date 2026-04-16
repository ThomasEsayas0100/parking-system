import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { findOrCreateCustomer, createInvoiceCheckout } from "@/lib/quickbooks";
import { handler, json, tooManyRequests } from "@/lib/api-handler";
import { RATE_LIMITS, checkRateLimit } from "@/lib/rate-limit";

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
});

// Per-phone limit. The outer RATE_LIMITS.auth (IP-based) is the first ring;
// this one stops a bad actor from burning through our QB invoice quota with a
// single phone number across IPs, and stops a single honest driver stuck in
// a retry loop from accidentally spamming QB. 3 per 10 min is loose enough
// that a driver correcting a typo and retrying won't hit it.
const PER_PHONE_CHECKOUT_LIMIT = { windowMs: 10 * 60_000, max: 3 };

export const POST = handler(
  { body: CheckoutSchema, rateLimit: RATE_LIMITS.auth },
  async ({ body }) => {
    const { driverName, driverPhone, driverEmail, amount, description } = body;
    // Normalize phone to digits-only once — DB stores digits-only, QB uses
    // the same format in the display name. Without this, updateMany could
    // silently match 0 rows and we'd create duplicate QB customers.
    const phone = driverPhone.replace(/\D/g, "");

    // Defense-in-depth: per-phone rate limit (IP limit applied by the wrapper).
    const phoneRate = checkRateLimit(`checkout:phone:${phone}`, PER_PHONE_CHECKOUT_LIMIT);
    if (!phoneRate.allowed) {
      throw tooManyRequests(
        "Too many checkout attempts for this phone number. Please wait a few minutes.",
        phoneRate.retryAfterSec,
      );
    }

    const customer = await findOrCreateCustomer({
      name: driverName,
      phone,
      email: driverEmail,
    });

    // Store QB customer ID on the driver for future cross-referencing
    await prisma.driver.updateMany({
      where: { phone },
      data: { qbCustomerId: customer.Id },
    });

    const { invoiceId, checkoutUrl } = await createInvoiceCheckout({
      customerId: customer.Id,
      amount,
      description,
      driverEmail,
    });

    return json({
      invoiceId,
      checkoutUrl,
      customerId: customer.Id,
    });
  },
);
