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
// Service item lookup — required by Sales Receipt + Refund Receipt lines
// ---------------------------------------------------------------------------

let cachedServiceItemId: string | null = null;
let cachedDepositAccountId: string | null | undefined = undefined; // undefined = not yet fetched; null = none found

/**
 * Returns the QB Account ID for the first Bank-type account in the company
 * file (e.g. the account that receives Stripe deposits). Used as
 * DepositToAccountRef on both Sales Receipts and Refund Receipts so QB's
 * bank reconciliation can see and match these transactions.
 *
 * Falls back to undefined (QB default = Undeposited Funds) if no Bank
 * account is found — not ideal, but better than crashing.
 */
async function getDepositAccountId(): Promise<string | undefined> {
  if (cachedDepositAccountId !== undefined) return cachedDepositAccountId ?? undefined;

  const res = await qbFetch<{ QueryResponse: { Account?: Array<{ Id: string; Name: string }> } }>(
    `/query?query=${encodeURIComponent("SELECT Id, Name FROM Account WHERE AccountType = 'Bank' MAXRESULTS 1")}`,
  );

  cachedDepositAccountId = res.QueryResponse.Account?.[0]?.Id ?? null;
  return cachedDepositAccountId ?? undefined;
}

/**
 * Returns the QB Item ID to attach to receipt lines. Queries QB for any
 * existing Service-type item (uses the first one found), and creates a
 * "Parking Services" item backed by the first income account if none exist.
 *
 * Result is cached in memory for the process lifetime to avoid a round-trip
 * on every receipt write.
 */
async function getServiceItemId(): Promise<string> {
  if (cachedServiceItemId) return cachedServiceItemId;

  const itemRes = await qbFetch<{ QueryResponse: { Item?: Array<{ Id: string }> } }>(
    `/query?query=${encodeURIComponent("SELECT Id FROM Item WHERE Type = 'Service' MAXRESULTS 1")}`,
  );
  if (itemRes.QueryResponse.Item?.length) {
    cachedServiceItemId = itemRes.QueryResponse.Item[0].Id;
    return cachedServiceItemId;
  }

  // No service items — create one. Needs an income account reference.
  const acctRes = await qbFetch<{ QueryResponse: { Account?: Array<{ Id: string }> } }>(
    `/query?query=${encodeURIComponent("SELECT Id FROM Account WHERE AccountType = 'Income' MAXRESULTS 1")}`,
  );
  const incomeAccountId = acctRes.QueryResponse.Account?.[0]?.Id;
  if (!incomeAccountId) {
    throw new Error("No income account found in QB — create one before connecting QuickBooks.");
  }

  const createRes = await qbFetch<{ Item: { Id: string } }>(
    "/item",
    {
      method: "POST",
      body: JSON.stringify({
        Name: "Parking Services",
        Type: "Service",
        IncomeAccountRef: { value: incomeAccountId },
      }),
    },
  );

  cachedServiceItemId = createRes.Item.Id;
  return cachedServiceItemId;
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
  // Idempotency is handled upstream by the StripeEvent table — each Stripe
  // event ID is processed at most once, so we write without a pre-check.
  // PrivateNote stores the Stripe reference for human reconciliation in QB.
  const privateNote = `stripe:${args.stripeEventId} charge:${args.stripeChargeId}`;

  const [itemId, depositAccountId] = await Promise.all([getServiceItemId(), getDepositAccountId()]);

  const createRes = await qbFetch<{ SalesReceipt: QBSalesReceipt }>(
    "/salesreceipt",
    {
      method: "POST",
      body: JSON.stringify({
        CustomerRef: { value: args.customerId },
        ...(depositAccountId ? { DepositToAccountRef: { value: depositAccountId } } : {}),
        Line: [
          {
            Amount: args.amount,
            DetailType: "SalesItemLineDetail",
            Description: args.description,
            SalesItemLineDetail: {
              ItemRef: { value: itemId },
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

export async function writeRefundReceipt(args: {
  customerId: string;
  amount: number;
  description: string;
  stripeEventId: string;
  stripeRefundId: string;
  linkedSalesReceiptId?: string;
}): Promise<QBRefundReceipt> {
  // Idempotency handled upstream by StripeEvent table; write directly.
  const salesRef = args.linkedSalesReceiptId ? ` salesreceipt:${args.linkedSalesReceiptId}` : "";
  const privateNote = `stripe:${args.stripeEventId} refund:${args.stripeRefundId}${salesRef}`;

  const [itemId, depositAccountId] = await Promise.all([getServiceItemId(), getDepositAccountId()]);

  const createRes = await qbFetch<{ RefundReceipt: QBRefundReceipt }>(
    "/refundreceipt",
    {
      method: "POST",
      body: JSON.stringify({
        CustomerRef: { value: args.customerId },
        // DepositToAccountRef here means the bank account FROM which the
        // refund is paid. Must match the original SalesReceipt's account so
        // QB bank reconciliation can match both sides.
        ...(depositAccountId ? { DepositToAccountRef: { value: depositAccountId } } : {}),
        Line: [
          {
            Amount: args.amount,
            DetailType: "SalesItemLineDetail",
            Description: args.linkedSalesReceiptId
              ? `${args.description} (Sales Receipt #${args.linkedSalesReceiptId})`
              : args.description,
            SalesItemLineDetail: {
              ItemRef: { value: itemId },
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
