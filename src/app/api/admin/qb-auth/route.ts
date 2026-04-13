import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

/**
 * GET: Redirect admin to QuickBooks OAuth authorization page.
 *
 * After the admin authorizes, QB redirects to /api/admin/qb-auth/callback
 * with an authorization code that we exchange for access + refresh tokens.
 */
export async function GET() {
  await requireAdmin();

  const clientId = process.env.QB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "QB_CLIENT_ID not configured" }, { status: 500 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  const redirectUri = `${baseUrl}/api/admin/qb-auth/callback`;

  // QB OAuth 2.0 scopes — we need Payments and Accounting (for invoices)
  const scopes = [
    "com.intuit.quickbooks.accounting",
    "com.intuit.quickbooks.payment",
  ].join(" ");

  const state = Math.random().toString(36).slice(2); // CSRF protection

  const authUrl = new URL("https://appcenter.intuit.com/connect/oauth2");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl.toString());
}
