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

/** Lightweight session with spot + vehicle (from GET /api/drivers activeSessions). */
export type DriverActiveSession = {
  id: string;
  status: "ACTIVE" | "OVERSTAY";
  expectedEnd: string;
  startedAt: string;
  spot: { label: string; type: string };
  vehicle: {
    licensePlate: string | null;
    unitNumber: string | null;
    type: string;
    nickname: string | null;
  };
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
  bobtailOverflow: boolean;
  paymentRequired: boolean;
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

// ---------------------------------------------------------------------------
// Lot map display types (view layer — NOT the Prisma SpotStatus enum)
// ---------------------------------------------------------------------------

/** Visual status for a spot on the lot map SVG. */
export type LotSpotStatus = "VACANT" | "RESERVED" | "OVERDUE" | "COMPANY";

/** Session info attached to a lot spot, with Date objects (not ISO strings). */
export type LotSpotSession = {
  id: string;
  driver: { name: string; email: string; phone: string };
  vehicle: {
    unitNumber: string | null;
    licensePlate: string | null;
    type: "BOBTAIL" | "TRUCK_TRAILER";
    nickname: string | null;
  };
  startedAt: Date;
  expectedEnd: Date;
  endedAt: Date | null;
  sessionStatus: "ACTIVE" | "COMPLETED" | "OVERSTAY";
  reminderSent: boolean;
  payments: { id: string; type: string; amount: number; hours: number | null; createdAt: Date }[];
};

/** Full spot detail for the SpotDetailPanel (map click → slide-out). */
export type LotSpotDetail = {
  spotId: string;
  spotLabel: string;
  status: LotSpotStatus;
  session: LotSpotSession | null;
};

/** Lot map spot color palette per status. */
export type LotSpotColors = {
  fill: string;
  fillHover: string;
  stroke: string;
  label: string;
};

export const LOT_STATUS_COLORS: Record<LotSpotStatus, LotSpotColors> = {
  VACANT:   { fill: "#12261C", fillHover: "#1A3324", stroke: "#2D7A4A", label: "rgba(255,255,255,0.5)" },
  RESERVED: { fill: "#1A1A2E", fillHover: "#24244A", stroke: "#6366F1", label: "rgba(99,102,241,0.7)" },
  OVERDUE:  { fill: "#2C1810", fillHover: "#3D2218", stroke: "#DC2626", label: "rgba(220,38,38,0.7)" },
  COMPANY:  { fill: "#1C1A10", fillHover: "#2A2716", stroke: "#CA8A04", label: "rgba(202,138,4,0.7)" },
};
