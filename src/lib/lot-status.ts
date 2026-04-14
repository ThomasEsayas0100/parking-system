import type { LotSpotStatus, ApiSessionWithRelations } from "@/types/domain";

/**
 * Derive the lot-map display status for a spot from its active session.
 * Single source of truth — used by both /admin and /lot pages.
 */
export function deriveLotStatus(session: ApiSessionWithRelations | null | undefined): LotSpotStatus {
  if (!session) return "VACANT";
  if (session.status === "OVERSTAY") return "OVERDUE";
  return "RESERVED";
}
