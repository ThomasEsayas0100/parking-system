/**
 * Prefer the immutable spot-label snapshot captured at session creation;
 * fall back to the live spot row when the snapshot is empty (legacy data)
 * or missing.
 *
 * Why: `Spot.label` is mutable via the lot editor. Without a snapshot,
 * renaming "A-12" → "B-5" retroactively rewrites every historical session
 * that ever parked there — silently corrupting audit history, SMS logs,
 * and admin reports.
 */
export function getSessionSpotLabel(
  session: {
    spotLabelSnapshot?: string | null;
    spot?: { label?: string | null } | null;
  } | null | undefined,
): string {
  if (!session) return "—";
  const snap = session.spotLabelSnapshot;
  if (typeof snap === "string" && snap.length > 0) return snap;
  return session.spot?.label ?? "—";
}
