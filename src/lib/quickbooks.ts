/**
 * QuickBooks Payments integration.
 *
 * Replaces Stripe for payment processing. Handles:
 * - Card tokenization (client-side calls QB directly)
 * - Charge creation (server-side)
 * - Charge verification
 * - Refunds
 * - OAuth token management
 *
 * QuickBooks Payments API:
 *   Sandbox: https://sandbox.api.intuit.com
 *   Production: https://api.intuit.com
 *
 * Tokens endpoint (client-side, no auth): POST /quickbooks/v4/payments/tokens
 * Charges endpoint (server-side, OAuth): POST /quickbooks/v4/payments/charges
 * Refunds endpoint: POST /quickbooks/v4/payments/charges/{chargeId}/refunds
 */

const SANDBOX_BASE = "https://sandbox.api.intuit.com";
const PROD_BASE = "https://api.intuit.com";

const isProd = process.env.NODE_ENV === "production";
const BASE_URL = isProd ? PROD_BASE : SANDBOX_BASE;

// ---------------------------------------------------------------------------
// OAuth token management
// ---------------------------------------------------------------------------
// QB OAuth tokens expire every hour. Refresh tokens last 100 days.
// We store them in env vars for now; a production system would persist
// them in the database and refresh automatically.

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
// API helpers
// ---------------------------------------------------------------------------
async function qbFetch<T = unknown>(
  path: string,
  opts?: RequestInit,
): Promise<T> {
  const url = `${BASE_URL}${path}`;
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
      if (body.errors?.[0]?.message) {
        message = body.errors[0].message;
      }
    } catch { /* response wasn't JSON */ }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Card tokenization (called from client-side — no OAuth needed)
// This is the URL the client POSTs card details to directly.
// We export it so the frontend knows where to send card data.
// ---------------------------------------------------------------------------
export function getTokenizeUrl(): string {
  return `${BASE_URL}/quickbooks/v4/payments/tokens`;
}

// ---------------------------------------------------------------------------
// Charges
// ---------------------------------------------------------------------------
type ChargeResponse = {
  id: string;
  status: string; // "CAPTURED", "DECLINED", etc.
  amount: string;
  currency: string;
  created: string;
};

/**
 * Create a charge using a card token.
 * Called server-side after the client tokenizes the card.
 */
export async function createCharge(opts: {
  token: string;
  amount: number;
  currency?: string;
  description?: string;
}): Promise<ChargeResponse> {
  return qbFetch<ChargeResponse>(
    "/quickbooks/v4/payments/charges",
    {
      method: "POST",
      headers: {
        "Request-Id": `charge_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      },
      body: JSON.stringify({
        amount: opts.amount.toFixed(2),
        currency: opts.currency ?? "USD",
        token: opts.token,
        context: {
          ecommerce: true,
        },
        description: opts.description,
      }),
    },
  );
}

/**
 * Retrieve a charge by ID to verify its status.
 */
export async function getCharge(chargeId: string): Promise<ChargeResponse> {
  return qbFetch<ChargeResponse>(
    `/quickbooks/v4/payments/charges/${chargeId}`,
  );
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------
type RefundResponse = {
  id: string;
  status: string;
  amount: string;
  created: string;
};

/**
 * Issue a full or partial refund on a charge.
 */
export async function refundCharge(
  chargeId: string,
  amount: number,
  description?: string,
): Promise<RefundResponse> {
  return qbFetch<RefundResponse>(
    `/quickbooks/v4/payments/charges/${chargeId}/refunds`,
    {
      method: "POST",
      headers: {
        "Request-Id": `refund_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      },
      body: JSON.stringify({
        amount: amount.toFixed(2),
        description,
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// Payment verification (replaces Stripe's verifyAndClaimPayment)
// ---------------------------------------------------------------------------
import { prisma } from "./prisma";
import { paymentRequired, conflict } from "./api-handler";

/**
 * Verify that a QuickBooks charge was captured successfully,
 * and that the charge ID hasn't already been used for a session.
 */
export async function verifyAndClaimQBPayment(chargeId: string): Promise<void> {
  // 1. Verify charge status with QuickBooks
  try {
    const charge = await getCharge(chargeId);
    if (charge.status !== "CAPTURED") {
      throw paymentRequired("Payment not captured");
    }
  } catch (err) {
    if (err instanceof Error && err.name === "ApiError") throw err;
    throw paymentRequired("Could not verify payment with QuickBooks");
  }

  // 2. Prevent reuse
  const existing = await prisma.payment.findFirst({
    where: { stripePaymentId: chargeId }, // reusing the field for QB charge IDs
  });
  if (existing) {
    throw conflict("This payment has already been used");
  }
}
