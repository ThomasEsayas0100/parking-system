import { NextResponse } from "next/server";
import { log as audit } from "@/lib/audit";
import {
  QBAuthError,
  getUnpaidParkingInvoicesOlderThan,
  voidInvoice,
} from "@/lib/quickbooks";

/**
 * Invoice TTL cron — voids QB parking invoices that have sat unpaid for
 * more than 30 minutes. Run every 15 minutes (Vercel Cron or external).
 *
 * Why: `pending_session` in the driver's browser expires at 30 min
 * (see src/app/payment-complete/page.tsx::PENDING_SESSION_MAX_AGE_MS).
 * Without this cron, abandoned checkouts would leave QB invoices lingering
 * forever — cluttering the admin's QB dashboard in production and piling
 * up test invoices in sandbox.
 *
 * We query QB directly rather than our Payment table because Payment rows
 * only exist AFTER a driver confirms a successful payment. An abandoned
 * invoice never produces a Payment row — the QB invoice is the only
 * record.
 *
 * Filter is `DocNumber LIKE 'PRK-%'` (see PARKING_INVOICE_DOCNUMBER_PREFIX)
 * so non-parking QB activity in the same company is never touched.
 */
const TTL_MINUTES = 30;

export async function GET() {
  const started = Date.now();
  let voided = 0;
  const errors: { invoiceId: string; error: string }[] = [];

  try {
    const stale = await getUnpaidParkingInvoicesOlderThan(TTL_MINUTES);

    for (const inv of stale) {
      try {
        await voidInvoice(inv.id);
        voided++;
        await audit({
          action: "PAYMENT_EXPIRED",
          details: `Voided abandoned invoice ${inv.docNumber} (id ${inv.id}), ${TTL_MINUTES}+ min old, $${inv.totalAmount.toFixed(2)}`,
        });
      } catch (err) {
        errors.push({
          invoiceId: inv.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      checked: stale.length,
      voided,
      errors,
      ms: Date.now() - started,
    });
  } catch (err) {
    // QB not connected / token failure — return 503-ish response but don't
    // 500 (the cron scheduler will retry next interval either way).
    if (err instanceof QBAuthError) {
      return NextResponse.json(
        { ok: false, skipped: "quickbooks-not-connected" },
        { status: 200 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Invoice cleanup failed",
      },
      { status: 500 },
    );
  }
}
