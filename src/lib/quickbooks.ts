/**
 * QuickBooks Online integration.
 *
 * Two payment paths:
 *
 * 1. HOSTED CHECKOUT (preferred for driver UX):
 *    - Server creates a QB invoice with line items
 *    - Gets the invoiceLink (hosted checkout URL)
 *    - Driver is redirected to QB's hosted page (Apple Pay, PayPal, Venmo, cards)
 *    - After payment, driver is redirected back to our confirmation page
 *    - Server polls invoice status to confirm payment
 *
 * 2. DIRECT CHARGE (card-only, for API-level integration):
 *    - Client tokenizes card via QB Payments API
 *    - Server creates charge with token
 *
 * QB API base URLs:
 *   Sandbox:    https://sandbox-quickbooks.api.intuit.com
 *   Production: https://quickbooks.api.intuit.com
 */

const SANDBOX_BASE = "https://sandbox-quickbooks.api.intuit.com";
const PROD_BASE = "https://quickbooks.api.intuit.com";

const isProd = process.env.NODE_ENV === "production";
const API_BASE = isProd ? PROD_BASE : SANDBOX_BASE;

/**
 * Validate that QB credentials match the current environment.
 * Prevents sandbox credentials in production (charges succeed in sandbox
 * but no real money moves — catastrophic for the business).
 */
function validateEnvironment(realmId: string): void {
  if (!isProd) return; // No validation in dev/test — sandbox is expected

  // QB sandbox realm IDs are typically numeric and short (e.g. "123456789")
  // Production realm IDs are also numeric but we check the client ID instead:
  // Sandbox client IDs from Intuit start with "ABEI" prefix
  const clientId = process.env.QB_CLIENT_ID ?? "";
  if (clientId.startsWith("ABEI")) {
    throw new Error(
      "CRITICAL: QuickBooks sandbox credentials detected in production! " +
      "Update QB_CLIENT_ID and QB_CLIENT_SECRET to production keys. " +
      "No real payments will be processed until this is fixed."
    );
  }

  if (!realmId) {
    throw new Error("QB_REALM_ID is empty. Connect QuickBooks in Admin → Settings.");
  }
}

// ---------------------------------------------------------------------------
// Auth — tokens stored in DB, refreshed automatically when expired
// ---------------------------------------------------------------------------
import { prisma } from "./prisma";

async function getTokens(): Promise<{ accessToken: string; realmId: string }> {
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  if (!settings?.qbAccessToken || !settings?.qbRealmId) {
    throw new Error("QuickBooks not connected. Go to Admin → Settings to connect.");
  }

  // Fail loud if sandbox credentials are used in production
  validateEnvironment(settings.qbRealmId);

  // Check if token needs refresh (expires every hour, refresh 5 min early)
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
  if (!clientId || !clientSecret) throw new Error("QB_CLIENT_ID/QB_CLIENT_SECRET not configured");

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
    throw new Error(`QB token refresh failed (${res.status}). Reconnect in Admin → Settings.`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number; // seconds
  };

  // Store new tokens in DB
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
// Customer management (QB requires a customer for invoices)
// ---------------------------------------------------------------------------
type QBCustomer = { Id: string; DisplayName: string };

/**
 * Find or create a QB customer by phone number.
 * Maps our driver to a QB customer record.
 */
export async function findOrCreateCustomer(opts: {
  name: string;
  phone: string;
  email?: string;
}): Promise<QBCustomer> {
  // Search by DisplayName — QB doesn't support querying on nested objects like PrimaryPhone
  const digits = opts.phone.replace(/\D/g, "");
  const displayName = `${opts.name} (${digits})`;
  const searchRes = await qbFetch<{ QueryResponse: { Customer?: QBCustomer[] } }>(
    `/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${displayName}' MAXRESULTS 1`)}`,
  );

  if (searchRes.QueryResponse.Customer?.length) {
    return searchRes.QueryResponse.Customer[0];
  }

  // Create new customer
  const createRes = await qbFetch<{ Customer: QBCustomer }>(
    "/customer",
    {
      method: "POST",
      body: JSON.stringify({
        DisplayName: `${opts.name} (${digits})`,
        PrimaryPhone: { FreeFormNumber: digits },
        PrimaryEmailAddr: opts.email ? { Address: opts.email } : undefined,
      }),
    },
  );

  return createRes.Customer;
}

// ---------------------------------------------------------------------------
// Invoice-based hosted checkout
// ---------------------------------------------------------------------------
type QBInvoice = {
  Id: string;
  TotalAmt: number;
  Balance: number;
  InvoiceLink?: string;
  EmailStatus: string;
  /** QB marks voided invoices with this metadata */
  PrivateNote?: string;
  MetaData?: { LastUpdatedTime: string };
};

/**
 * Create a QB invoice and get the hosted checkout URL.
 *
 * The invoiceLink is a hosted page where the customer can pay via
 * Apple Pay, PayPal, Venmo, credit/debit card, or ACH.
 */
export async function createInvoiceCheckout(opts: {
  customerId: string;
  amount: number;
  description: string;
  driverEmail?: string;
}): Promise<{ invoiceId: string; checkoutUrl: string }> {
  const invoiceRes = await qbFetch<{ Invoice: QBInvoice }>(
    "/invoice?include=invoiceLink",
    {
      method: "POST",
      body: JSON.stringify({
        CustomerRef: { value: opts.customerId },
        Line: [
          {
            Amount: opts.amount,
            DetailType: "SalesItemLineDetail",
            Description: opts.description,
            SalesItemLineDetail: {
              UnitPrice: opts.amount,
              Qty: 1,
            },
          },
        ],
        // Explicitly suppress tax — our amount IS the total; no tax line.
        // Without this, QB may silently apply a state tax rate and cause
        // reconciliation drift between Payment.amount and QB TotalAmt.
        GlobalTaxCalculation: "NotApplicable",
        AllowOnlineACHPayment: true,
        AllowOnlineCreditCardPayment: true,
        CustomerMemo: { value: opts.description },
        BillEmail: opts.driverEmail ? { Address: opts.driverEmail } : undefined,
      }),
    },
  );

  const invoice = invoiceRes.Invoice;
  console.log("[QB] Invoice created:", invoice.Id, "InvoiceLink:", invoice.InvoiceLink);

  if (!invoice.InvoiceLink) {
    throw new Error("Invoice created but no checkout link returned. Ensure QB Payments is enabled on this company.");
  }

  return {
    invoiceId: invoice.Id,
    checkoutUrl: invoice.InvoiceLink,
  };
}

/**
 * Check if an invoice has been paid.
 */
export type InvoiceStatus = {
  paid: boolean;
  voided: boolean;
  partial: boolean;
  balance: number;
  totalAmount: number;
  amountPaid: number;
};

export async function getInvoiceStatus(invoiceId: string): Promise<InvoiceStatus> {
  let invoice: QBInvoice;
  try {
    const res = await qbFetch<{ Invoice: QBInvoice }>(`/invoice/${invoiceId}`);
    invoice = res.Invoice;
  } catch (err) {
    // Invoice not found or deleted — treat as voided
    if (err instanceof Error && err.message.includes("404")) {
      return { paid: false, voided: true, partial: false, balance: 0, totalAmount: 0, amountPaid: 0 };
    }
    throw err;
  }

  console.log("[QB] Invoice raw response:", JSON.stringify({
    Id: invoice.Id,
    TotalAmt: invoice.TotalAmt,
    Balance: invoice.Balance,
    EmailStatus: invoice.EmailStatus,
    PrivateNote: invoice.PrivateNote,
    MetaData: invoice.MetaData,
  }));

  const totalAmount = invoice.TotalAmt ?? 0;
  const balance = invoice.Balance ?? 0;
  const amountPaid = totalAmount - balance;

  // QB doesn't have a "voided" field on the API — a voided invoice has
  // Balance === 0 AND TotalAmt === 0 (amounts zeroed out on void)
  const voided = totalAmount === 0 && balance === 0;

  return {
    paid: !voided && balance === 0,
    voided,
    partial: !voided && amountPaid > 0 && balance > 0,
    balance,
    totalAmount,
    amountPaid,
  };
}

// ---------------------------------------------------------------------------
// Direct charges (card-only, kept for API-level use)
// ---------------------------------------------------------------------------
const PAYMENTS_SANDBOX = "https://sandbox.api.intuit.com";
const PAYMENTS_PROD = "https://api.intuit.com";
const PAYMENTS_BASE = isProd ? PAYMENTS_PROD : PAYMENTS_SANDBOX;

async function paymentsFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const { accessToken } = await getTokens();
  const url = `${PAYMENTS_BASE}${path}`;
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
    let message = `QB Payments error (${res.status})`;
    try { const b = await res.json(); if (b.errors?.[0]?.message) message = b.errors[0].message; } catch {}
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

type ChargeResponse = { id: string; status: string; amount: string; currency: string };

export function getTokenizeUrl(): string {
  return `${PAYMENTS_BASE}/quickbooks/v4/payments/tokens`;
}

export async function createCharge(opts: {
  token: string;
  amount: number;
  currency?: string;
  description?: string;
}): Promise<ChargeResponse> {
  return paymentsFetch<ChargeResponse>("/quickbooks/v4/payments/charges", {
    method: "POST",
    headers: { "Request-Id": `charge_${Date.now()}_${Math.random().toString(36).slice(2)}` },
    body: JSON.stringify({
      amount: opts.amount.toFixed(2),
      currency: opts.currency ?? "USD",
      token: opts.token,
      context: { ecommerce: true },
      description: opts.description,
    }),
  });
}

export async function getCharge(chargeId: string): Promise<ChargeResponse> {
  return paymentsFetch<ChargeResponse>(`/quickbooks/v4/payments/charges/${chargeId}`);
}

export type ChargeRefund = { id: string; amount: number; created: string };

/**
 * Fetch a charge and any refunds issued against it in a single function.
 * Used by the QB reconciliation endpoint to detect voided/refunded charges.
 */
export async function getChargeWithRefunds(chargeId: string): Promise<{
  status: string;
  amount: number;
  refunds: ChargeRefund[];
}> {
  const [chargeResult, refundsResult] = await Promise.allSettled([
    paymentsFetch<ChargeResponse>(`/quickbooks/v4/payments/charges/${chargeId}`),
    paymentsFetch<{ refunds?: Array<{ id: string; amount: string; created: string }> }>(
      `/quickbooks/v4/payments/charges/${chargeId}/refunds`,
    ),
  ]);

  const charge = chargeResult.status === "fulfilled" ? chargeResult.value : null;
  const rawRefunds =
    refundsResult.status === "fulfilled" ? (refundsResult.value.refunds ?? []) : [];

  return {
    status: charge?.status ?? "UNKNOWN",
    amount: charge ? parseFloat(charge.amount) : 0,
    refunds: rawRefunds.map((r) => ({
      id: r.id,
      amount: parseFloat(r.amount),
      created: r.created,
    })),
  };
}

export async function refundCharge(chargeId: string, amount: number, description?: string) {
  return paymentsFetch(`/quickbooks/v4/payments/charges/${chargeId}/refunds`, {
    method: "POST",
    headers: { "Request-Id": `refund_${Date.now()}_${Math.random().toString(36).slice(2)}` },
    body: JSON.stringify({ amount: amount.toFixed(2), description }),
  });
}

// ---------------------------------------------------------------------------
// QB Reports — for reconciliation with internal records
// ---------------------------------------------------------------------------
export type QBPaymentRecord = {
  id: string;
  date: string;
  amount: number;
  customerName: string;
  memo: string;
  method: string; // "Credit Card", "ACH", etc.
};

/**
 * Fetch recent payments from QuickBooks for reconciliation.
 * Uses the Payment entity query, not reports — gives individual transactions.
 */
export async function getQBPayments(opts?: {
  from?: string; // ISO date
  to?: string;
  limit?: number;
}): Promise<QBPaymentRecord[]> {
  const conditions = ["TotalAmt > '0'"];
  if (opts?.from) conditions.push(`TxnDate >= '${opts.from.slice(0, 10)}'`);
  if (opts?.to) conditions.push(`TxnDate <= '${opts.to.slice(0, 10)}'`);

  const query = `SELECT * FROM Payment WHERE ${conditions.join(" AND ")} ORDERBY TxnDate DESC MAXRESULTS ${opts?.limit ?? 100}`;

  const res = await qbFetch<{
    QueryResponse: {
      Payment?: Array<{
        Id: string;
        TxnDate: string;
        TotalAmt: number;
        CustomerRef: { name: string };
        PrivateNote?: string;
        PaymentMethodRef?: { name: string };
        Line?: Array<{ LinkedTxn?: Array<{ TxnId: string; TxnType: string }> }>;
      }>;
    };
  }>(`/query?query=${encodeURIComponent(query)}`);

  const payments = res.QueryResponse.Payment ?? [];
  return payments.map((p) => ({
    id: p.Id,
    date: p.TxnDate,
    amount: p.TotalAmt,
    customerName: p.CustomerRef?.name ?? "Unknown",
    memo: p.PrivateNote ?? "",
    method: p.PaymentMethodRef?.name ?? "Unknown",
  }));
}

/**
 * Fetch profit/loss summary from QB Reports API.
 */
export type QBProfitLoss = {
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
  period: { from: string; to: string };
};

export async function getProfitAndLoss(from: string, to: string): Promise<QBProfitLoss> {
  const res = await qbFetch<{
    Header: { StartPeriod: string; EndPeriod: string };
    Rows: {
      Row: Array<{
        Summary?: { ColData: Array<{ value: string }> };
        group?: string;
        type?: string;
      }>;
    };
  }>(`/reports/ProfitAndLoss?start_date=${from}&end_date=${to}&minorversion=65`);

  let totalIncome = 0;
  let totalExpenses = 0;
  let netIncome = 0;

  for (const row of res.Rows?.Row ?? []) {
    if (row.Summary) {
      const val = parseFloat(row.Summary.ColData?.[1]?.value ?? "0");
      if (row.group === "Income") totalIncome = val;
      else if (row.group === "Expenses") totalExpenses = val;
      else if (row.type === "Section" && row.group === "NetIncome") netIncome = val;
    }
  }

  // NetIncome might be in a different structure — fall back to calculation
  if (netIncome === 0) netIncome = totalIncome - totalExpenses;

  return {
    totalIncome,
    totalExpenses,
    netIncome,
    period: { from: res.Header.StartPeriod, to: res.Header.EndPeriod },
  };
}
