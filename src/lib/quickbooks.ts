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

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
function getAccessToken(): string {
  const token = process.env.QB_ACCESS_TOKEN;
  if (!token) throw new Error("QB_ACCESS_TOKEN not configured");
  return token;
}

function getRealmId(): string {
  const id = process.env.QB_REALM_ID;
  if (!id) throw new Error("QB_REALM_ID not configured");
  return id;
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------
async function qbFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const url = `${API_BASE}/v3/company/${getRealmId()}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getAccessToken()}`,
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
  // Search by phone first
  const digits = opts.phone.replace(/\D/g, "");
  const searchRes = await qbFetch<{ QueryResponse: { Customer?: QBCustomer[] } }>(
    `/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE PrimaryPhone = '${digits}' MAXRESULTS 1`)}`,
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
  Balance: number;
  InvoiceLink?: string;
  EmailStatus: string;
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
  // Create invoice
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
        // Allow online payment
        AllowOnlineACHPayment: true,
        AllowOnlineCreditCardPayment: true,
        CustomerMemo: { value: opts.description },
        BillEmail: opts.driverEmail ? { Address: opts.driverEmail } : undefined,
      }),
    },
  );

  const invoice = invoiceRes.Invoice;
  if (!invoice.InvoiceLink) {
    throw new Error("Invoice created but no checkout link returned. Ensure QB Payments is enabled.");
  }

  return {
    invoiceId: invoice.Id,
    checkoutUrl: invoice.InvoiceLink,
  };
}

/**
 * Check if an invoice has been paid.
 */
export async function getInvoiceStatus(invoiceId: string): Promise<{
  paid: boolean;
  balance: number;
}> {
  const res = await qbFetch<{ Invoice: QBInvoice }>(`/invoice/${invoiceId}`);
  return {
    paid: res.Invoice.Balance === 0,
    balance: res.Invoice.Balance,
  };
}

// ---------------------------------------------------------------------------
// Direct charges (card-only, kept for API-level use)
// ---------------------------------------------------------------------------
const PAYMENTS_SANDBOX = "https://sandbox.api.intuit.com";
const PAYMENTS_PROD = "https://api.intuit.com";
const PAYMENTS_BASE = isProd ? PAYMENTS_PROD : PAYMENTS_SANDBOX;

async function paymentsFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const url = `${PAYMENTS_BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getAccessToken()}`,
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

export async function refundCharge(chargeId: string, amount: number, description?: string) {
  return paymentsFetch(`/quickbooks/v4/payments/charges/${chargeId}/refunds`, {
    method: "POST",
    headers: { "Request-Id": `refund_${Date.now()}_${Math.random().toString(36).slice(2)}` },
    body: JSON.stringify({ amount: amount.toFixed(2), description }),
  });
}
