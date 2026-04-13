import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { getQBPayments, getProfitAndLoss } from "@/lib/quickbooks";
import { handler, json } from "@/lib/api-handler";

const QBDataQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const GET = handler({ query: QBDataQuery }, async ({ query }) => {
  await requireAdmin();

  const from = query.from ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = query.to ?? new Date().toISOString().slice(0, 10);

  try {
    const [qbPayments, profitLoss] = await Promise.all([
      getQBPayments({ from, to, limit: 200 }),
      getProfitAndLoss(from, to),
    ]);

    return json({ qbPayments, profitLoss, connected: true });
  } catch (err) {
    // QB not connected or API error — return empty with flag
    return json({
      qbPayments: [],
      profitLoss: null,
      connected: false,
      error: err instanceof Error ? err.message : "QuickBooks not connected",
    });
  }
});
