import type { LotSpotStatus, SessionStatus } from "@/types/domain";

/**
 * Derive the lot-map display status for a spot from its active session.
 * Single source of truth — used by both /admin and /lot pages.
 *
 * Accepts any session-shaped object — we only read `status`, so the
 * narrow `ApiSpotNestedSession` shape from /api/spots also works.
 */
export function deriveLotStatus(
  session: { status: SessionStatus } | null | undefined,
): LotSpotStatus {
  if (!session) return "VACANT";
  if (session.status === "OVERSTAY") return "OVERDUE";
  return "RESERVED";
}
