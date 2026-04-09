/**
 * Shared time formatting helpers for driver-facing pages.
 */

/** Human-readable time remaining until a future date. Returns "Expired" if past. */
export function timeRemaining(expectedEnd: string | Date): string {
  const diff = new Date(expectedEnd).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

/** Human-readable time elapsed since a past date. Returns "0m" if future. */
export function timeOverdue(expectedEnd: string | Date): string {
  const diff = Date.now() - new Date(expectedEnd).getTime();
  if (diff <= 0) return "0m";
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

/** Format a vehicle label from unit number and/or plate. */
export function vehicleLabel(v: {
  unitNumber: string | null;
  licensePlate: string | null;
}): string {
  if (v.unitNumber && v.licensePlate) return `#${v.unitNumber} · ${v.licensePlate}`;
  if (v.unitNumber) return `#${v.unitNumber}`;
  return v.licensePlate || "—";
}
