import { z } from "zod";
import { prisma } from "@/lib/prisma";
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
});

export const POST = handler(
  { body: CheckoutSchema, rateLimit: RATE_LIMITS.auth },
  async ({ body }) => {
    const { driverName, driverPhone, driverEmail, amount, description } = body;
    // Normalize phone to digits-only once — DB stores digits-only, QB uses
    // the same format in the display name. Without this, updateMany could
    // silently match 0 rows and we'd create duplicate QB customers.
    const phone = driverPhone.replace(/\D/g, "");

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
