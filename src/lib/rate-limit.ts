// ---------------------------------------------------------------------------
// In-memory rate limiter — fixed-window counters keyed by IP + route.
//
// Suitable for single-process dev/staging and for initial production.
// Replace with Redis when you run multiple instances.
// ---------------------------------------------------------------------------

type WindowEntry = {
  count: number;
  resetAt: number; // epoch ms
};

const store = new Map<string, WindowEntry>();

// Periodically prune expired entries to prevent unbounded growth.
const PRUNE_INTERVAL_MS = 60_000;
let lastPrune = Date.now();
function maybePrune(): void {
  const now = Date.now();
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}

export type RateLimitConfig = {
  windowMs: number;
  max: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSec: number;
};

export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): RateLimitResult {
  maybePrune();
  const now = Date.now();
  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + config.windowMs;
    store.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: config.max - 1,
      resetAt,
      retryAfterSec: 0,
    };
  }

  existing.count++;
  const allowed = existing.count <= config.max;
  return {
    allowed,
    remaining: Math.max(0, config.max - existing.count),
    resetAt: existing.resetAt,
    retryAfterSec: allowed
      ? 0
      : Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

// Pull a sensible client IP from headers (works behind reverse proxies / Vercel)
export function getClientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? "unknown";
  return (
    headers.get("x-real-ip") ||
    headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

// Presets
export const RATE_LIMITS = {
  // tight limits on auth / money endpoints
  strict: { windowMs: 60_000, max: 5 } satisfies RateLimitConfig,
  auth: { windowMs: 60_000, max: 10 } satisfies RateLimitConfig,
  // general API default
  default: { windowMs: 60_000, max: 100 } satisfies RateLimitConfig,
};
