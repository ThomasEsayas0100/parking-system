import { z } from "zod";
import { getInvoiceStatus } from "@/lib/quickbooks";
import { handler, json } from "@/lib/api-handler";

/**
 * GET: Check if a QB invoice has been paid.
 * Used by the confirmation/callback page to poll for payment completion.
 */
const StatusQuery = z.object({
  invoiceId: z.string().min(1),
});

export const GET = handler(
  { query: StatusQuery },
  async ({ query }) => {
    const { invoiceId } = query;
    const status = await getInvoiceStatus(invoiceId);
    return json(status);
  },
);
