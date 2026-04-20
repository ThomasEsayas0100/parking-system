/**
 * Shared time formatting helpers for driver-facing pages.
 */

function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60000);
  const hrs  = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days > 0) {
    const remHrs = hrs % 24;
    return remHrs > 0 ? `${days}d ${remHrs}h` : `${days}d`;
  }
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  return `${mins}m`;
}

/** Human-readable time remaining until a future date. Returns "Expired" if past. */
export function timeRemaining(expectedEnd: string | Date): string {
  const diff = new Date(expectedEnd).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  return formatDuration(diff);
}

/** Human-readable time elapsed since a past date. Returns "0m" if future. */
export function timeOverdue(expectedEnd: string | Date): string {
  const diff = Date.now() - new Date(expectedEnd).getTime();
  if (diff <= 0) return "0m";
  return formatDuration(diff);
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
