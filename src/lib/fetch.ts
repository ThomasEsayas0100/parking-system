/**
 * Typed fetch wrapper for client-side API calls.
 *
 * - Checks res.ok (throws on 4xx/5xx)
 * - Parses JSON response body
 * - Extracts server error messages when available
 * - Provides a typed ApiError class for catch blocks
 * - On 401 for /api/admin/* routes, redirects to the admin login page
 *   so an expired JWT doesn't show up as a silent empty UI
 */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Fetch a JSON API endpoint with automatic error handling.
 *
 * @throws {ApiError} on non-2xx responses
 * @throws {TypeError} on network failures (fetch itself throws)
 */
export async function apiFetch<T = unknown>(
  url: string,
  opts?: RequestInit,
): Promise<T> {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.error && typeof body.error === "string") {
        message = body.error;
      }
    } catch {
      // response wasn't JSON — use status-based message
    }

    // Admin JWT expired (or not present). Force a re-login on the browser
    // side so the admin doesn't see every tab silently emptied. The proxy
    // middleware already redirects page navigations to /login, but XHR
    // calls from an open admin page just get 401 JSON — this closes that gap.
    if (res.status === 401 && typeof window !== "undefined") {
      const isAdminRoute =
        url.startsWith("/api/admin/") ||
        url.startsWith("/api/dev/") ||
        window.location.pathname.startsWith("/admin");
      if (isAdminRoute && !window.location.pathname.startsWith("/login")) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?next=${next}&sessionExpired=1`;
      }
    }

    throw new ApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

/** Convenience for JSON POST/PUT/PATCH requests. */
export function apiPost<T = unknown>(url: string, body: unknown): Promise<T> {
  return apiFetch<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
