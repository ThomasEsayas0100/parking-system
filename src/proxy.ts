import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// ---------------------------------------------------------------------------
// Route protection via JWT cookie
//
// Runs on the Edge runtime — keep imports Edge-compatible (no `next/headers`,
// no Node-only modules). `jose` is Edge-compatible.
// ---------------------------------------------------------------------------

const AUTH_COOKIE = "parking_auth";
const ISSUER = "parking-system";
const ALGORITHM = "HS256";

// Pull the secret directly from process.env here; we can't import the env
// validation module because it runs server-only code.
const secret = new TextEncoder().encode(process.env.AUTH_SECRET || "");

async function isAdmin(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      algorithms: [ALGORITHM],
    });
    return payload.role === "admin";
  } catch {
    return false;
  }
}

// Paths that require admin auth
const PROTECTED_PAGE_PREFIXES = ["/admin", "/lot", "/lot-editor"];
const PROTECTED_API_PREFIXES = ["/api/admin", "/api/dev"];
const PROTECTED_API_PATHS = ["/api/spots/seed"];
// /api/settings PUT is admin-only; GET is public-ish (used by checkin for rates)
const PROTECTED_API_METHOD_RULES: { path: string; methods: string[] }[] = [
  { path: "/api/settings", methods: ["PUT"] },
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;
  const isApi = pathname.startsWith("/api/");

  // Determine if path needs protection
  let needsAuth = false;
  if (isApi) {
    if (PROTECTED_API_PREFIXES.some((p) => pathname.startsWith(p))) {
      needsAuth = true;
    } else if (PROTECTED_API_PATHS.includes(pathname)) {
      needsAuth = true;
    } else {
      for (const rule of PROTECTED_API_METHOD_RULES) {
        if (pathname === rule.path && rule.methods.includes(method)) {
          needsAuth = true;
          break;
        }
      }
    }
  } else {
    needsAuth = PROTECTED_PAGE_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(p + "/"),
    );
  }

  if (!needsAuth) return NextResponse.next();

  const authed = await isAdmin(request);
  if (authed) return NextResponse.next();

  // Unauthorized
  if (isApi) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  // Redirect page request to login with `next` param
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // All admin/lot/lot-editor pages
    "/admin/:path*",
    "/admin",
    "/lot/:path*",
    "/lot",
    "/lot-editor/:path*",
    "/lot-editor",
    // Protected API prefixes
    "/api/admin/:path*",
    "/api/dev/:path*",
    "/api/spots/seed",
    "/api/settings",
  ],
};
