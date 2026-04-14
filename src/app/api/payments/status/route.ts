import { z } from "zod";
import { getInvoiceStatus } from "@/lib/quickbooks";
import { handler, json } from "@/lib/api-handler";

const StatusQuery = z.object({
  invoiceId: z.string().min(1),
});

export const GET = handler(
  { query: StatusQuery },
  async ({ query }) => {
    const status = await getInvoiceStatus(query.invoiceId);
    return json(status);
  },
);
