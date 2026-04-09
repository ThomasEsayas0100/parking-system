/**
 * Single source of truth for driver identity in localStorage.
 *
 * Every driver-facing page must use these helpers — never read/write
 * localStorage directly with string keys.
 */
import type { SavedDriver } from "@/types/domain";

const KEY = "parking_driver";

export function loadDriver(): SavedDriver | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Validate shape — reject corrupted data
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.id === "string" &&
      typeof parsed.name === "string" &&
      typeof parsed.phone === "string"
    ) {
      return parsed as SavedDriver;
    }
    // Corrupted — clear it
    localStorage.removeItem(KEY);
    return null;
  } catch {
    localStorage.removeItem(KEY);
    return null;
  }
}

export function saveDriver(d: SavedDriver): void {
  localStorage.setItem(KEY, JSON.stringify(d));
}

export function clearDriver(): void {
  localStorage.removeItem(KEY);
  // Clean up legacy keys from older versions
  localStorage.removeItem("driverId");
  localStorage.removeItem("driverInfo");
  // NOTE: device ID is NOT cleared here — it persists across driver resets
}

// ---------------------------------------------------------------------------
// Device ID — anonymous, persistent, survives driver resets
// ---------------------------------------------------------------------------
const DEVICE_KEY = "parking_device_id";

/**
 * Get or create a stable device identifier.
 *
 * Generated once per browser on first visit. Persists indefinitely —
 * not tied to any driver identity. Used to detect multi-device access
 * patterns on gate scans.
 */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    // Private browsing or localStorage disabled — generate ephemeral ID
    return crypto.randomUUID();
  }
}
