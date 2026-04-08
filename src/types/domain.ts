/**
 * Shared domain types for API responses and localStorage.
 *
 * These represent JSON-serialized shapes returned by Next.js API routes
 * (dates are ISO strings, not Date objects). Prisma model types live in
 * src/generated/prisma — these are for the client/page layer.
 */

// Re-export Prisma enums so pages don't need two imports
export type { VehicleType, SpotStatus, SessionStatus, PaymentType, AuditAction } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Core entities (JSON-serialized API response shapes)
// ---------------------------------------------------------------------------

export type ApiDriver = {
  id: string;
  name: string;
  email: string;
  phone: string;
};

export type ApiVehicle = {
  id: string;
  unitNumber: string | null;
  licensePlate: string | null;
  type: "BOBTAIL" | "TRUCK_TRAILER";
  nickname: string | null;
};

export type ApiPayment = {
  id: string;
  type: "CHECKIN" | "EXTENSION" | "OVERSTAY";
  amount: number;
  hours: number | null;
  createdAt: string;
};

export type ApiSpot = {
  id: string;
  label: string;
  type: "BOBTAIL" | "TRUCK_TRAILER";
  status: "AVAILABLE" | "OCCUPIED";
};

/** Spot with nested active sessions (from GET /api/spots) */
export type ApiSpotWithSessions = ApiSpot & {
  sessions: ApiSessionWithRelations[];
};

export type ApiSession = {
  id: string;
  status: "ACTIVE" | "COMPLETED" | "OVERSTAY";
  startedAt: string;
  expectedEnd: string;
  endedAt: string | null;
  reminderSent: boolean;
};

/** Session with all included relations (from most GET endpoints) */
export type ApiSessionWithRelations = ApiSession & {
  driver: ApiDriver;
  vehicle: ApiVehicle;
  spot: ApiSpot;
  payments: ApiPayment[];
};

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type ApiAuditEntry = {
  id: string;
  action: string;
  details: string | null;
  createdAt: string;
  driver: { name: string; phone: string } | null;
  vehicle: { licensePlate: string; type: string } | null;
  spot: { label: string } | null;
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type AppSettings = {
  hourlyRateBobtail: number;
  hourlyRateTruck: number;
  overstayRateBobtail: number;
  overstayRateTruck: number;
  gracePeriodMinutes: number;
  reminderMinutesBefore: number;
  totalSpotsBobtail: number;
  totalSpotsTruck: number;
  managerEmail: string;
  managerPhone: string;
};

// ---------------------------------------------------------------------------
// Overstay (returned by POST /api/sessions/exit when payment required)
// ---------------------------------------------------------------------------

export type OverstayInfo = {
  requiresPayment: true;
  overstayHours: number;
  overstayAmount: number;
  overstayRate: number;
  sessionId: string;
};

// ---------------------------------------------------------------------------
// localStorage
// ---------------------------------------------------------------------------

export type SavedDriver = {
  id: string;
  name: string;
  phone: string;
};

// ---------------------------------------------------------------------------
// Lot layout (SVG spot positioning — used by LotMap components)
// ---------------------------------------------------------------------------

export type SpotLayout = {
  id: string;
  label: string;
  type: "BOBTAIL" | "TRUCK_TRAILER";
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
};
