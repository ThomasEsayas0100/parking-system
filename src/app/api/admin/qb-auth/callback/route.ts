import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

/**
 * GET: OAuth callback from QuickBooks.
 *
 * QB redirects here with ?code=X&realmId=Y after the admin authorizes.
 * We exchange the code for access + refresh tokens and store them in Settings.
 */
export async function GET(request: NextRequest) {
  await requireAdmin();
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const realmId = searchParams.get("realmId");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/admin?qb_error=${encodeURIComponent(error)}`, request.url),
    );
  }

  if (!code || !realmId) {
    return NextResponse.redirect(
      new URL("/admin?qb_error=Missing+authorization+code", request.url),
    );
  }

  const clientId = process.env.QB_CLIENT_ID;
  const clientSecret = process.env.QB_CLIENT_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL("/admin?qb_error=QB+credentials+not+configured", request.url),
    );
  }

  const redirectUri = `${baseUrl}/api/admin/qb-auth/callback`;

  // Exchange authorization code for tokens
  const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error("QB token exchange failed:", body);
    return NextResponse.redirect(
      new URL("/admin?qb_error=Token+exchange+failed", request.url),
    );
  }

  const tokens = await tokenRes.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number; // seconds (typically 3600)
    x_refresh_token_expires_in: number; // seconds (typically ~100 days)
  };

  // Store tokens in Settings
  await prisma.settings.upsert({
    where: { id: "default" },
    create: {
      qbAccessToken: tokens.access_token,
      qbRefreshToken: tokens.refresh_token,
      qbRealmId: realmId,
      qbTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
    update: {
      qbAccessToken: tokens.access_token,
      qbRefreshToken: tokens.refresh_token,
      qbRealmId: realmId,
      qbTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
  });

  // Redirect back to admin settings with success indicator
  return NextResponse.redirect(
    new URL("/admin?qb_connected=true", request.url),
  );
}
