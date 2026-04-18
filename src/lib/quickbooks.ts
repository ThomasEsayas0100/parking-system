/**
 * QuickBooks Online integration — accounting output only.
 *
 * After the Stripe rewrite, QB is no longer a payment processor. This module
 * keeps OAuth + customer lookup + two write functions:
 *   - writeSalesReceipt() — called from the Stripe webhook after every
 *     successful charge (one-time or subscription renewal).
 *   - writeRefundReceipt() — called from the Stripe webhook after every
 *     refund is captured.
 *
 * Payment state of record lives in our `Payment` table, driven by Stripe
 * webhooks. We never read payment state back from QB.
 *
 * QB API base URLs:
 *   Sandbox:    https://sandbox-quickbooks.api.intuit.com
 *   Production: https://quickbooks.api.intuit.com
 */

const SANDBOX_BASE = "https://sandbox-quickbooks.api.intuit.com";
const PROD_BASE = "https://quickbooks.api.intuit.com";

/**
 * Thrown when QB is unreachable or tokens can't be acquired/refreshed.
 * Callers should catch this and audit SALES_RECEIPT_FAILED so the admin
 * knows to reconcile manually.
 */
export class QBAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QBAuthError";
  }
}

const isProd = process.env.NODE_ENV === "production";
const API_BASE = isProd ? PROD_BASE : SANDBOX_BASE;

/**
 * Fail loud if sandbox credentials are used in production. Catastrophic
 * miss-config: Sales Receipts would be written to a sandbox company file
 * and dad's books would silently drift from reality.
 */
function validateEnvironment(realmId: string): void {
  if (!isProd) return;

  const clientId = process.env.QB_CLIENT_ID ?? "";
  if (clientId.startsWith("ABEI")) {
    throw new Error(
      "CRITICAL: QuickBooks sandbox credentials detected in production! " +
      "Update QB_CLIENT_ID and QB_CLIENT_SECRET to production keys.",
    );
  }

  if (!realmId) {
    throw new QBAuthError("QB_REALM_ID is empty. Connect QuickBooks in Admin → Settings.");
  }
}

// ---------------------------------------------------------------------------
// Auth — tokens stored in DB, refreshed automatically when expired
// ---------------------------------------------------------------------------
import { prisma } from "./prisma";

async function getTokens(): Promise<{ accessToken: string; realmId: string }> {
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  if (!settings?.qbAccessToken || !settings?.qbRealmId) {
    throw new QBAuthError("QuickBooks not connected. Go to Admin → Settings to connect.");
  }

  validateEnvironment(settings.qbRealmId);

  if (settings.qbTokenExpiresAt && settings.qbRefreshToken) {
    const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
    if (settings.qbTokenExpiresAt < fiveMinFromNow) {
      return refreshAccessToken(settings.qbRefreshToken, settings.qbRealmId);
    }
  }

  return { accessToken: settings.qbAccessToken, realmId: settings.qbRealmId };
}

async function refreshAccessToken(
  refreshToken: string,
  realmId: string,
): Promise<{ accessToken: string; realmId: string }> {
  const clientId = process.env.QB_CLIENT_ID;
  const clientSecret = process.env.QB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new QBAuthError("QB_CLIENT_ID/QB_CLIENT_SECRET not configured");

  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    throw new QBAuthError(`QB token refresh failed (${res.status}). Reconnect in Admin → Settings.`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  await prisma.settings.update({
    where: { id: "default" },
    data: {
      qbAccessToken: data.access_token,
      qbRefreshToken: data.refresh_token,
      qbTokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
    },
  });

  return { accessToken: data.access_token, realmId };
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------
async function qbFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const { accessToken, realmId } = await getTokens();
  const url = `${API_BASE}/v3/company/${realmId}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "Accept": "application/json",
      ...(opts?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `QuickBooks API error (${res.status})`;
    try {
      const body = await res.json();
      if (body.Fault?.Error?.[0]?.Detail) {
        message = body.Fault.Error[0].Detail;
      }
    } catch { /* not JSON */ }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Customer lookup (used by Sales Receipt + Refund Receipt writes)
// ---------------------------------------------------------------------------
type QBCustomer = { Id: string; DisplayName: string };

/**
 * Find or create a QB customer by phone number. Cached on Driver.qbCustomerId
 * the first time we write a receipt for them, so subsequent receipts skip
 * this round-trip.
 */
export async function findOrCreateCustomer(opts: {
  name: string;
  phone: string;
  email?: string;
}): Promise<QBCustomer> {
  const digits = opts.phone.replace(/\D/g, "");
  const displayName = `${opts.name} (${digits})`;
  const searchRes = await qbFetch<{ QueryResponse: { Customer?: QBCustomer[] } }>(
    `/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${displayName}' MAXRESULTS 1`)}`,
  );

  if (searchRes.QueryResponse.Customer?.length) {
    return searchRes.QueryResponse.Customer[0];
  }

  const createRes = await qbFetch<{ Customer: QBCustomer }>(
    "/customer",
    {
      method: "POST",
      body: JSON.stringify({
        DisplayName: displayName,
        PrimaryPhone: { FreeFormNumber: digits },
        PrimaryEmailAddr: opts.email ? { Address: opts.email } : undefined,
      }),
    },
  );

  return createRes.Customer;
}

// ---------------------------------------------------------------------------
// Sales Receipt write — called from Stripe webhook on successful charge
// ---------------------------------------------------------------------------

type QBSalesReceipt = { Id: string; DocNumber: string; TotalAmt: number };

/**
 * Write a Sales Receipt to QB. Idempotent by Stripe event ID — the event ID
 * is stored in `PrivateNote` so replayed webhooks are detectable (we query
 * first, write only if not found).
 *
 * Returns the QB Sales Receipt ID so callers can store it on the Payment row
 * for admin deep-linking.
 */
export async function writeSalesReceipt(args: {
  customerId: string;
  amount: number;
  description: string;
  stripeEventId: string;
  stripeChargeId: string;
}): Promise<QBSalesReceipt> {
  // Idempotency check — search for an existing receipt with this event ID in
  // its PrivateNote. If found, short-circuit without writing a duplicate.
  const privateNote = `stripe:${args.stripeEventId} charge:${args.stripeChargeId}`;
  const searchRes = await qbFetch<{ QueryResponse: { SalesReceipt?: QBSalesReceipt[] } }>(
    `/query?query=${encodeURIComponent(
      `SELECT Id, DocNumber, TotalAmt FROM SalesReceipt WHERE PrivateNote = '${privateNote}' MAXRESULTS 1`,
    )}`,
  );
  if (searchRes.QueryResponse.SalesReceipt?.length) {
    return searchRes.QueryResponse.SalesReceipt[0];
  }

  const createRes = await qbFetch<{ SalesReceipt: QBSalesReceipt }>(
    "/salesreceipt",
    {
      method: "POST",
      body: JSON.stringify({
        CustomerRef: { value: args.customerId },
        Line: [
          {
            Amount: args.amount,
            DetailType: "SalesItemLineDetail",
            Description: args.description,
            SalesItemLineDetail: {
              // Using SalesItemRef: ItemId 1 is a common default "Services" item;
              // admin should configure this on first QB connect. For now we
              // rely on QB's default item — will surface in reconciliation
              // if it's wrong.
              ItemRef: { value: "1" },
              UnitPrice: args.amount,
              Qty: 1,
            },
          },
        ],
        PrivateNote: privateNote,
      }),
    },
  );

  return createRes.SalesReceipt;
}

// ---------------------------------------------------------------------------
// Refund Receipt write — called from Stripe webhook on charge.refunded
// ---------------------------------------------------------------------------

type QBRefundReceipt = { Id: string; DocNumber: string; TotalAmt: number };

/**
 * Write a Refund Receipt to QB. Same idempotency pattern as Sales Receipt:
 * we stash the Stripe event ID in PrivateNote and query for it first.
 */
export async function writeRefundReceipt(args: {
  customerId: string;
  amount: number;
  description: string;
  stripeEventId: string;
  stripeRefundId: string;
}): Promise<QBRefundReceipt> {
  const privateNote = `stripe:${args.stripeEventId} refund:${args.stripeRefundId}`;
  const searchRes = await qbFetch<{ QueryResponse: { RefundReceipt?: QBRefundReceipt[] } }>(
    `/query?query=${encodeURIComponent(
      `SELECT Id, DocNumber, TotalAmt FROM RefundReceipt WHERE PrivateNote = '${privateNote}' MAXRESULTS 1`,
    )}`,
  );
  if (searchRes.QueryResponse.RefundReceipt?.length) {
    return searchRes.QueryResponse.RefundReceipt[0];
  }

  const createRes = await qbFetch<{ RefundReceipt: QBRefundReceipt }>(
    "/refundreceipt",
    {
      method: "POST",
      body: JSON.stringify({
        CustomerRef: { value: args.customerId },
        Line: [
          {
            Amount: args.amount,
            DetailType: "SalesItemLineDetail",
            Description: args.description,
            SalesItemLineDetail: {
              ItemRef: { value: "1" },
              UnitPrice: args.amount,
              Qty: 1,
            },
          },
        ],
        PrivateNote: privateNote,
      }),
    },
  );

  return createRes.RefundReceipt;
}
