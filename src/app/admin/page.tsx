"use client";

import { useEffect, useState, useCallback, useMemo } from "react";

import type { ApiSpotWithSessions, ApiAuditEntry, AppSettings, SpotLayout, LotSpotStatus, LotSpotDetail, ApiPaymentWithSession } from "@/types/domain";
import { apiFetch, apiPost } from "@/lib/fetch";
import { deriveLotStatus } from "@/lib/lot-status";
import { useIsMobile } from "@/lib/hooks";
import LotMapViewer, { countStatuses } from "@/components/lot/LotMapViewer";
import { useEditorReducer } from "@/components/lot/editor/useEditorReducer";
import SpotDetailPanel from "@/app/lot/SpotDetailPanel";
import PhoneInput, { digitsOnly } from "@/components/PhoneInput";

type Spot = ApiSpotWithSessions;
type AuditEntry = ApiAuditEntry;
type Settings = AppSettings;

// ---------------------------------------------------------------------------
// Sessions tab types
// ---------------------------------------------------------------------------
type SessionRow = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  expectedEnd: string;
  status: "ACTIVE" | "COMPLETED" | "OVERSTAY";
  driver: { id: string; name: string; email: string; phone: string };
  vehicle: { id: string; unitNumber: string | null; licensePlate: string | null; type: "BOBTAIL" | "TRUCK_TRAILER"; nickname: string | null };
  spot: { id: string; label: string; type: "BOBTAIL" | "TRUCK_TRAILER" };
  payments: { id: string; type: string; amount: number; hours: number | null; createdAt: string }[];
};

type SessionsResponse = {
  sessions: SessionRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

type StatusFilter = "" | "ACTIVE" | "COMPLETED" | "OVERSTAY";

// ---------------------------------------------------------------------------
// Log tab config
// ---------------------------------------------------------------------------
type LogFilter = "ALL" | "ENTRY" | "EXIT" | "EXTEND" | "OVERSTAY" | "GATE" | "ADMIN" | "NOTIFICATION" | "SECURITY";

const LOG_CATEGORIES: { key: LogFilter; label: string; actions: string[] }[] = [
  { key: "ALL", label: "All", actions: [] },
  { key: "ENTRY", label: "Entry", actions: ["CHECKIN"] },
  { key: "EXIT", label: "Exit", actions: ["CHECKOUT"] },
  { key: "EXTEND", label: "Extension", actions: ["EXTEND"] },
  { key: "OVERSTAY", label: "Overstay", actions: ["OVERSTAY_START", "OVERSTAY_PAYMENT"] },
  { key: "GATE", label: "Gate", actions: ["GATE_OPEN"] },
  { key: "ADMIN", label: "Admin", actions: ["SPOT_FREED"] },
  { key: "NOTIFICATION", label: "Notification", actions: ["REMINDER_SENT", "OVERSTAY_ALERT"] },
  { key: "SECURITY", label: "Security", actions: ["SUSPICIOUS_ENTRY", "GATE_DENIED", "ALLOWLIST_ENTRY"] },
];

const ACTION_BADGE: Record<string, { color: string; bg: string; label: string }> = {
  CHECKIN:          { color: "#34C759", bg: "#12261C", label: "Check-in" },
  CHECKOUT:         { color: "#0A84FF", bg: "#0A1A30", label: "Check-out" },
  EXTEND:           { color: "#F59E0B", bg: "#2A1F0A", label: "Extension" },
  OVERSTAY_START:   { color: "#DC2626", bg: "#2C1810", label: "Overstay" },
  OVERSTAY_PAYMENT: { color: "#EF4444", bg: "#2C1810", label: "Overstay paid" },
  GATE_OPEN:        { color: "#8E8E93", bg: "#2C2C2E", label: "Gate" },
  SPOT_FREED:       { color: "#F59E0B", bg: "#2A1F0A", label: "Override" },
  REMINDER_SENT:    { color: "#14B8A6", bg: "#0A2421", label: "Reminder" },
  OVERSTAY_ALERT:   { color: "#F87171", bg: "#2C1810", label: "Alert" },
  SUSPICIOUS_ENTRY: { color: "#FBBF24", bg: "#2A1F0A", label: "Suspicious" },
  GATE_DENIED:      { color: "#F87171", bg: "#2C1810", label: "Denied" },
  ALLOWLIST_ENTRY:  { color: "#60A5FA", bg: "#0A1A30", label: "Allow list" },
};

const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  ACTIVE:    { color: "#2D7A4A", bg: "#12261C" },
  COMPLETED: { color: "#636366", bg: "#2C2C2E" },
  OVERSTAY:  { color: "#DC2626", bg: "#2C1810" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function calcDuration(start: string, end: string | null): string {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const hrs = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function sumPayments(payments: { amount: number }[]): number {
  return payments.reduce((s, p) => s + p.amount, 0);
}

/**
 * Generate deep-links into QuickBooks for various entity types.
 * Returns null for free/test payments that don't exist in QB.
 */
// Use sandbox QB dashboard links in dev/test; production links in prod.
// process.env.NODE_ENV is inlined by Next.js at build time — safe client-side.
const QB_BASE = process.env.NODE_ENV !== "production"
  ? "https://app.sandbox.qbo.intuit.com"
  : "https://app.qbo.intuit.com";

const qbLinks = {
  invoice: (id: string) => `${QB_BASE}/app/invoice?txnId=${id}`,
  payment: (id: string) => `${QB_BASE}/app/recvpayment?txnId=${id}`,
  customer: (id: string) => `${QB_BASE}/app/customerdetail?nameId=${id}`,
  refundReceipt: (id: string) => `${QB_BASE}/app/refundreceipt?txnId=${id}`,
  creditMemo: (customerId: string) => `${QB_BASE}/app/creditmemo/create?customerId=${customerId}`,
  dashboard: () => `${QB_BASE}/app/homepage`,
};

// Stripe dashboard deep links. Uses the live dashboard; for test mode the
// URL pattern is the same but the route is /test/... — harmless in practice
// because Stripe serves the right mode based on the API key used.
const STRIPE_DASHBOARD = "https://dashboard.stripe.com";
const stripeLinks = {
  paymentIntent: (id: string) => `${STRIPE_DASHBOARD}/payments/${id}`,
  charge: (id: string) => `${STRIPE_DASHBOARD}/payments/${id}`,
  customer: (id: string) => `${STRIPE_DASHBOARD}/customers/${id}`,
  subscription: (id: string) => `${STRIPE_DASHBOARD}/subscriptions/${id}`,
  refund: (id: string) => `${STRIPE_DASHBOARD}/refunds/${id}`,
};

/**
 * A "real" payment is one where actual money moved — either through Stripe
 * (any stripe* ID present) or via a legacy QB invoice/charge. Rows flagged
 * `free_*` in legacyQbReference are payments-disabled dev sessions.
 */
type PaymentRowRefs = {
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  stripeSubscriptionId: string | null;
  stripeRefundId: string | null;
  legacyQbReference: string | null;
};
function isRealPayment(p: PaymentRowRefs): boolean {
  if (p.stripePaymentIntentId || p.stripeChargeId || p.stripeSubscriptionId) return true;
  const legacy = p.legacyQbReference;
  return !!(legacy && !legacy.startsWith("free_") && !legacy.startsWith("dev_seed_"));
}

/** Canonical Stripe deep link for a payment row, if any Stripe IDs are set. */
function stripeDashboardUrl(p: PaymentRowRefs): string | null {
  if (p.stripePaymentIntentId) return stripeLinks.paymentIntent(p.stripePaymentIntentId);
  if (p.stripeChargeId) return stripeLinks.charge(p.stripeChargeId);
  if (p.stripeSubscriptionId) return stripeLinks.subscription(p.stripeSubscriptionId);
  return null;
}

// ---------------------------------------------------------------------------
// Shared inline style constants
// ---------------------------------------------------------------------------
const DARK_BG = "#1C1C1E";
const CARD_BG = "#2C2C2E";
const BORDER = "#3A3A3C";
const FG = "#F5F5F7";
const FG_MUTED = "#8E8E93";
const FG_DIM = "#636366";
const ACCENT = "#2D7A4A";
const RADIUS = 12;

const chip = (active: boolean, mobile: boolean): React.CSSProperties => ({
  padding: mobile ? "10px 16px" : "6px 14px", borderRadius: 20,
  border: active ? "1px solid #F5F5F740" : `1px solid ${BORDER}`,
  background: active ? BORDER : "transparent",
  color: active ? FG : FG_MUTED,
  fontSize: mobile ? 13 : 12, fontWeight: 600,
  cursor: "pointer", letterSpacing: "0.02em",
});

const inputStyle: React.CSSProperties = {
  padding: "10px 12px", fontSize: 14, background: CARD_BG, border: `1px solid ${BORDER}`,
  borderRadius: 6, color: FG, outline: "none", width: "100%",
};

const paginationBtn = (disabled: boolean, mobile: boolean): React.CSSProperties => ({
  padding: mobile ? "10px 18px" : "6px 16px", borderRadius: 6, border: `1px solid ${BORDER}`,
  background: disabled ? "transparent" : CARD_BG,
  color: disabled ? "#48484A" : FG,
  fontSize: mobile ? 13 : 12, fontWeight: 600, cursor: disabled ? "default" : "pointer",
});

// ═══════════════════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════════════════
export default function AdminDashboard() {
  const mobile = useIsMobile();
  const [spots, setSpots] = useState<Spot[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsForm, setSettingsForm] = useState<Settings | null>(null);
  const [tab, setTab] = useState<"overview" | "sessions" | "payments" | "drivers" | "log" | "settings">("overview");
  const [overrideSpotId, setOverrideSpotId] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  // ── Drivers tab state ──
  type DriverRow = {
    id: string;
    name: string;
    email: string;
    phone: string;
    vehicles: { id: string; licensePlate: string | null; unitNumber: string | null; type: string; nickname: string | null }[];
    sessions: { id: string; status: string; spot: { label: string } }[];
    _count: { sessions: number };
  };
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [driversTotal, setDriversTotal] = useState(0);
  const [driversSearch, setDriversSearch] = useState("");
  const [driversOffset, setDriversOffset] = useState(0);
  const [driversLoading, setDriversLoading] = useState(false);
  const [editingDriver, setEditingDriver] = useState<DriverRow | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", phone: "" });
  const [editErrors, setEditErrors] = useState<{ name?: string; email?: string; phone?: string }>({});
  const DRIVERS_LIMIT = 30;

  // ── Session actions state ──
  const [sessionAction, setSessionAction] = useState<{ id: string; type: "extend" | "cancel" | "close" } | null>(null);
  const [sessionActionHours, setSessionActionHours] = useState(4);
  const [sessionActionReason, setSessionActionReason] = useState("");
  const [sessionActionEndedAt, setSessionActionEndedAt] = useState("");
  const [sessionActionLoading, setSessionActionLoading] = useState(false);

  // ── New session modal ────────────────────────────────────────────────────
  type NsForm = {
    name: string; phone: string; email: string;
    vehicleType: "BOBTAIL" | "TRUCK_TRAILER";
    licensePlate: string; unitNumber: string; nickname: string;
    durationType: "HOURLY" | "MONTHLY";
    hours: number; months: number;
    spotMode: "auto" | "manual"; spotId: string;
    invoiceId: string;
  };
  const NS_DEFAULT: NsForm = {
    name: "", phone: "", email: "",
    vehicleType: "TRUCK_TRAILER",
    licensePlate: "", unitNumber: "", nickname: "",
    durationType: "HOURLY", hours: 4, months: 1,
    spotMode: "auto", spotId: "",
    invoiceId: "",
  };
  const [nsOpen, setNsOpen] = useState(false);
  const [nsForm, setNsForm] = useState<NsForm>(NS_DEFAULT);
  const [nsErrors, setNsErrors] = useState<Record<string, string>>({});
  const [nsSubmitting, setNsSubmitting] = useState(false);
  type InvoiceVerify = { status: "idle" | "checking" | "ok" | "error"; message: string };
  const [nsInvoice, setNsInvoice] = useState<InvoiceVerify>({ status: "idle", message: "" });

  // ── Overview / lot map state ──
  const editor = useEditorReducer();
  const allSpots = useMemo<SpotLayout[]>(
    () => Object.values(editor.state.spots),
    [editor.state.spots],
  );
  const [selectedSpotId, setSelectedSpotId] = useState<string | null>(null);

  // ── Sessions tab state ──
  const [sessionsData, setSessionsData] = useState<SessionsResponse | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessSearch, setSessSearch] = useState("");
  const [sessStatus, setSessStatus] = useState<StatusFilter>("");
  const [sessOffset, setSessOffset] = useState(0);
  const [sessExpanded, setSessExpanded] = useState<string | null>(null);
  const SESS_LIMIT = 30;

  // ── Log tab state ──
  const [logEntries, setLogEntries] = useState<AuditEntry[]>([]);
  const [logFilter, setLogFilter] = useState<LogFilter>("ALL");
  const [logOffset, setLogOffset] = useState(0);
  const [logTotal, setLogTotal] = useState(0);
  const [logLoading, setLogLoading] = useState(false);
  const LOG_LIMIT = 30;

  // ── Data loaders ──
  const loadData = useCallback(() => {
    fetch("/api/spots").then((r) => r.json()).then((d) => setSpots(d.spots || []));
    fetch("/api/settings").then((r) => r.json()).then((d) => {
      setSettings(d.settings);
      setSettingsForm(d.settings);
    });
  }, []);

  const sessQueryStr = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", String(SESS_LIMIT));
    p.set("offset", String(sessOffset));
    if (sessSearch.trim()) p.set("q", sessSearch.trim());
    if (sessStatus) p.set("status", sessStatus);
    return p.toString();
  }, [sessSearch, sessStatus, sessOffset]);

  const loadSessions = useCallback(() => {
    setSessionsLoading(true);
    apiFetch<SessionsResponse>(`/api/sessions/history?${sessQueryStr}`)
      .then((d) => setSessionsData(d))
      .catch(() => setSessionsData(null))
      .finally(() => setSessionsLoading(false));
  }, [sessQueryStr]);

  const driversQueryStr = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", String(DRIVERS_LIMIT));
    p.set("offset", String(driversOffset));
    if (driversSearch.trim()) p.set("q", driversSearch.trim());
    return p.toString();
  }, [driversSearch, driversOffset]);

  const loadDrivers = useCallback(() => {
    setDriversLoading(true);
    apiFetch<{ drivers: DriverRow[]; total: number }>(`/api/admin/drivers?${driversQueryStr}`)
      .then((d) => { setDrivers(d.drivers); setDriversTotal(d.total); })
      .catch(() => setDrivers([]))
      .finally(() => setDriversLoading(false));
  }, [driversQueryStr]);

  const loadLog = useCallback((filter: LogFilter, offset: number) => {
    setLogLoading(true);
    const category = LOG_CATEGORIES.find((c) => c.key === filter);
    const actionParam = category && category.actions.length === 1 ? `&action=${category.actions[0]}` : "";
    apiFetch<{ logs: AuditEntry[]; total: number }>(
      `/api/audit?limit=${LOG_LIMIT}&offset=${offset}${actionParam}`
    )
      .then((d) => {
        let filtered = d.logs;
        if (category && category.actions.length > 1) {
          filtered = d.logs.filter((l) => category.actions.includes(l.action));
        }
        setLogEntries(filtered);
        setLogTotal(d.total);
      })
      .catch(() => setLogEntries([]))
      .finally(() => setLogLoading(false));
  }, []);

  // ── Effects ──
  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    if (tab === "sessions") loadSessions();
    if (tab === "drivers") loadDrivers();
  }, [tab, loadSessions, loadDrivers]);

  useEffect(() => {
    if (tab === "log") loadLog(logFilter, logOffset);
  }, [tab, logFilter, logOffset, loadLog]);

  // Reset offset when filters change
  useEffect(() => { setSessOffset(0); }, [sessSearch, sessStatus]);
  useEffect(() => { setDriversOffset(0); }, [driversSearch]);

  // ── Derived state ──
  const lotStatuses = useMemo<Record<string, LotSpotStatus>>(() => {
    const map: Record<string, LotSpotStatus> = {};
    for (const spot of spots) {
      map[spot.label] = deriveLotStatus(spot.sessions?.[0]);
    }
    return map;
  }, [spots]);

  const lotCounts = useMemo(() => countStatuses(allSpots, lotStatuses), [allSpots, lotStatuses]);

  const spotDetails = useMemo<Record<string, LotSpotDetail>>(() => {
    const map: Record<string, LotSpotDetail> = {};
    for (const spot of spots) {
      const session = spot.sessions?.[0] ?? null;
      const status = lotStatuses[spot.label] ?? "VACANT";
      map[spot.label] = {
        spotId: spot.id,
        spotLabel: spot.label,
        status,
        session: session
          ? {
              id: session.id,
              driver: session.driver,
              vehicle: session.vehicle,
              startedAt: new Date(session.startedAt),
              expectedEnd: new Date(session.expectedEnd),
              endedAt: session.endedAt ? new Date(session.endedAt) : null,
              sessionStatus: session.status,
              reminderSent: session.reminderSent,
              payments: [],
            }
          : null,
      };
    }
    return map;
  }, [spots, lotStatuses]);

  // ── Handlers ──
  async function handleSeedTestData() {
    const res = await fetch("/api/dev/seed", { method: "POST" });
    const d = await res.json();
    if (res.ok) { loadData(); console.log("Dev seed:", d); }
    else alert(d.error || "Failed to seed test data");
  }

  async function handleClearTestData() {
    if (!confirm("Clear all drivers, vehicles, sessions, and payments?")) return;
    const res = await fetch("/api/dev/clear", { method: "POST" });
    const d = await res.json();
    if (res.ok) loadData();
    else alert(d.error || "Failed to clear data");
  }

  async function handleOverride(spotId: string) {
    if (!overrideReason.trim()) { alert("Provide a reason for the override."); return; }
    const res = await fetch("/api/admin/spots/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spotId, action: "free", reason: overrideReason }),
    });
    if (res.ok) { setOverrideSpotId(null); setOverrideReason(""); loadData(); loadSessions(); }
    else { const d = await res.json(); alert(d.error || "Override failed"); }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!settingsForm) return;
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settingsForm),
    });
    loadData();
  }

  // ── Available spots (for new session modal) ────────────────────────────
  const availableSpots = useMemo(
    () => spots.filter((s) => s.sessions.length === 0),
    [spots]
  );

  // ── New session handlers ────────────────────────────────────────────────
  function nsSetField<K extends keyof NsForm>(k: K, v: NsForm[K]) {
    setNsForm((f) => ({ ...f, [k]: v }));
    if (k === "invoiceId") setNsInvoice({ status: "idle", message: "" });
    setNsErrors((e) => { const next = { ...e }; delete next[k]; return next; });
  }

  async function handleVerifyInvoice() {
    const id = nsForm.invoiceId.trim();
    if (!id) return;
    setNsInvoice({ status: "checking", message: "" });
    try {
      const data = await apiFetch<{
        paid: boolean; voided: boolean; partial: boolean;
        totalAmount: number; amountPaid: number;
      }>(`/api/payments/status?invoiceId=${encodeURIComponent(id)}`);
      if (data.voided) {
        setNsInvoice({ status: "error", message: "Invoice was voided" });
      } else if (data.partial) {
        setNsInvoice({ status: "error", message: `Partial only — $${data.amountPaid.toFixed(2)} of $${data.totalAmount.toFixed(2)}` });
      } else if (data.paid) {
        setNsInvoice({ status: "ok", message: `Paid — $${data.totalAmount.toFixed(2)}` });
      } else {
        setNsInvoice({ status: "error", message: "Invoice not yet paid in QB" });
      }
    } catch {
      setNsInvoice({ status: "error", message: "Could not verify — check the invoice ID" });
    }
  }

  const nsPaymentRequired = settingsForm?.paymentRequired ?? true;

  function validateNs(): boolean {
    const errs: Record<string, string> = {};
    const digits = digitsOnly(nsForm.phone);
    if (!nsForm.name.trim()) errs.name = "Required";
    if (digits.length !== 10) errs.phone = "Must be 10 digits";
    if (nsForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nsForm.email)) errs.email = "Invalid email";
    if (!nsForm.licensePlate.trim() && !nsForm.unitNumber.trim()) errs.licensePlate = "Provide plate or unit number";
    if (nsForm.durationType === "HOURLY" && (nsForm.hours < 1 || nsForm.hours > 72)) errs.hours = "1–72 hours";
    if (nsForm.durationType === "MONTHLY" && (nsForm.months < 1 || nsForm.months > 12)) errs.months = "1–12 months";
    if (nsForm.spotMode === "manual" && !nsForm.spotId) errs.spotId = "Select a spot";
    // Invoice only required when payments are enabled
    if (nsPaymentRequired) {
      if (!nsForm.invoiceId.trim()) errs.invoiceId = "Required";
      else if (nsInvoice.status !== "ok") errs.invoiceId = "Must be verified before submitting";
    }
    setNsErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleNewSession() {
    if (!validateNs() || nsSubmitting) return;
    setNsSubmitting(true);
    setNsErrors({});
    try {
      await apiPost("/api/admin/sessions", {
        name: nsForm.name.trim(),
        phone: digitsOnly(nsForm.phone),
        email: nsForm.email.trim() || undefined,
        vehicleType: nsForm.vehicleType,
        licensePlate: nsForm.licensePlate.trim() || undefined,
        unitNumber: nsForm.unitNumber.trim() || undefined,
        nickname: nsForm.nickname.trim() || undefined,
        durationType: nsForm.durationType,
        hours: nsForm.durationType === "HOURLY" ? nsForm.hours : undefined,
        months: nsForm.durationType === "MONTHLY" ? nsForm.months : undefined,
        spotId: nsForm.spotMode === "manual" ? nsForm.spotId : undefined,
        invoiceId: nsPaymentRequired ? nsForm.invoiceId.trim() : undefined,
      });
      setNsOpen(false);
      setNsForm(NS_DEFAULT);
      setNsInvoice({ status: "idle", message: "" });
      loadSessions();
    } catch (err) {
      setNsErrors({ _: err instanceof Error ? err.message : "Something went wrong" });
    } finally {
      setNsSubmitting(false);
    }
  }

  // ── Session actions ──
  async function handleSessionAction() {
    if (!sessionAction) return;
    setSessionActionLoading(true);
    try {
      const payload: Record<string, unknown> = {
        sessionId: sessionAction.id,
        action: sessionAction.type,
      };
      if (sessionAction.type === "extend") {
        payload.hours = sessionActionHours;
      } else {
        payload.reason = sessionActionReason;
      }
      if (sessionAction.type === "close" && sessionActionEndedAt) {
        payload.endedAt = new Date(sessionActionEndedAt).toISOString();
      }
      await fetch("/api/admin/sessions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setSessionAction(null);
      setSessionActionHours(4);
      setSessionActionReason("");
      setSessionActionEndedAt("");
      loadSessions();
      loadData();
    } catch { /* silent */ }
    finally { setSessionActionLoading(false); }
  }

  // ── Driver update ──
  async function handleSaveDriver() {
    if (!editingDriver) return;

    const errors: typeof editErrors = {};
    if (!editForm.name.trim()) errors.name = "Name is required";
    const phoneDigits = digitsOnly(editForm.phone);
    if (phoneDigits.length < 10) errors.phone = "Enter a valid 10-digit phone number";
    if (editForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.email)) errors.email = "Enter a valid email address";
    if (Object.keys(errors).length > 0) { setEditErrors(errors); return; }
    setEditErrors({});

    const body: Record<string, string> = { id: editingDriver.id };
    if (editForm.name)  body.name  = editForm.name.trim();
    if (editForm.phone) body.phone = editForm.phone;
    if (editForm.email) body.email = editForm.email;
    const res = await fetch("/api/admin/drivers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const d = await res.json(); alert(d.error || "Failed to save driver"); return; }
    setEditingDriver(null);
    loadDrivers();
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Render
  // ═════════════════════════════════════════════════════════════════════════
  const tabs: { key: typeof tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "sessions", label: "Sessions" },
    { key: "payments", label: "Payments" },
    { key: "drivers", label: "Drivers" },
    { key: "log", label: "Log" },
    { key: "settings", label: "Settings" },
  ];

  return (
    <div style={{ background: DARK_BG, minHeight: "100vh", color: FG, fontFamily: "system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ padding: mobile ? "16px 16px 0" : "20px 24px 0", borderBottom: `1px solid ${BORDER}` }}>
        <h1 style={{ fontSize: mobile ? 17 : 20, fontWeight: 700, letterSpacing: "0.04em", marginBottom: 12 }}>
          Parking Admin
        </h1>
        <div style={{ display: "flex", gap: 0 }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: mobile ? "10px 12px" : "10px 20px",
                background: "transparent",
                border: "none",
                borderBottom: tab === t.key ? `2px solid ${FG}` : "2px solid transparent",
                color: tab === t.key ? FG : FG_DIM,
                fontSize: mobile ? 12 : 13,
                fontWeight: 600,
                cursor: "pointer",
                letterSpacing: "0.02em",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: mobile ? "16px 16px 32px" : "24px 24px 40px" }}>

        {/* ═══ OVERVIEW (Lot Map) ═══ */}
        {tab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", minHeight: mobile ? "auto" : "calc(100vh - 120px)" }}>
            {/* Compact stats bar */}
            <div style={{ display: "flex", alignItems: "center", gap: mobile ? 12 : 20, marginBottom: 12, fontSize: mobile ? 13 : 12, flexShrink: 0, flexWrap: "wrap" }}>
              <span style={{ color: FG_MUTED }}>
                <span style={{ color: "#2D7A4A", fontWeight: 700 }}>{lotCounts.vacant}</span> vacant
              </span>
              <span style={{ color: FG_MUTED }}>
                <span style={{ color: "#6366F1", fontWeight: 700 }}>{lotCounts.reserved}</span> reserved
              </span>
              <span style={{ color: FG_MUTED }}>
                <span style={{ color: "#DC2626", fontWeight: 700 }}>{lotCounts.overdue}</span> overdue
              </span>
              <span style={{ color: FG_MUTED }}>
                <span style={{ color: FG, fontWeight: 700 }}>{lotCounts.total}</span> total
              </span>

              {process.env.NODE_ENV !== "production" && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={handleSeedTestData} style={{ padding: "8px 16px", background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 6, color: "#f59e0b", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    Seed Test Data
                  </button>
                  <button onClick={handleClearTestData} style={{ padding: "8px 16px", background: CARD_BG, border: `1px solid #ef4444`, borderRadius: 6, color: "#ef4444", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    Clear Data
                  </button>
                </div>
              )}
            </div>

            {/* Lot map + detail panel */}
            <div style={{ flex: mobile ? "none" : 1, height: mobile ? "60vh" : undefined, display: "flex", flexDirection: mobile ? "column" : "row", overflow: "hidden", borderRadius: RADIUS, border: `1px solid ${BORDER}`, position: "relative" }}>
              <div style={{ flex: 1, overflow: "hidden" }}>
                <LotMapViewer
                  spots={allSpots}
                  statuses={lotStatuses}
                  selectedSpotId={selectedSpotId}
                  onSelectSpot={setSelectedSpotId}
                />
              </div>

              <SpotDetailPanel
                detail={selectedSpotId ? spotDetails[allSpots.find(s => s.id === selectedSpotId)?.label ?? ""] ?? null : null}
                open={selectedSpotId !== null}
                onClose={() => setSelectedSpotId(null)}
                mobile={mobile}
              />
            </div>
          </div>
        )}

        {/* ═══ SESSIONS ═══ */}
        {tab === "sessions" && (
          <div>
            {/* Filters */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
              {(["", "ACTIVE", "OVERSTAY", "COMPLETED"] as StatusFilter[]).map((s) => {
                const active = sessStatus === s;
                const label = s || "All";
                return (
                  <button key={label} onClick={() => setSessStatus(s)} style={chip(active, mobile)}>
                    {label}
                  </button>
                );
              })}

              <div style={{ flex: 1, minWidth: mobile ? "100%" : 180, maxWidth: mobile ? "100%" : 300 }}>
                <input
                  type="text"
                  placeholder="Search name, plate, spot…"
                  value={sessSearch}
                  onChange={(e) => setSessSearch(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <button
                onClick={() => { setNsForm(NS_DEFAULT); setNsErrors({}); setNsInvoice({ status: "idle", message: "" }); setNsOpen(true); }}
                style={{ padding: "8px 16px", background: ACCENT, color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
              >
                + New Session
              </button>
            </div>

            {/* Results */}
            {sessionsLoading ? (
              <p style={{ color: FG_DIM, textAlign: "center", padding: 40 }}>Loading…</p>
            ) : !sessionsData || sessionsData.sessions.length === 0 ? (
              <p style={{ color: FG_DIM, textAlign: "center", padding: 40 }}>No sessions found.</p>
            ) : (
              <>
                {/* Count */}
                <div style={{ fontSize: 11, color: FG_DIM, marginBottom: 12 }}>
                  Showing {sessOffset + 1}–{Math.min(sessOffset + SESS_LIMIT, sessionsData.total)} of {sessionsData.total} sessions
                </div>

                {/* Session rows */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {sessionsData.sessions.map((s) => {
                    const isExpanded = sessExpanded === s.id;
                    const st = STATUS_STYLE[s.status] || STATUS_STYLE.COMPLETED;
                    const total = sumPayments(s.payments);
                    const vLabel = s.vehicle.unitNumber
                      ? `#${s.vehicle.unitNumber}` + (s.vehicle.licensePlate ? ` · ${s.vehicle.licensePlate}` : "")
                      : s.vehicle.licensePlate || "—";

                    return (
                      <div key={s.id}>
                        {/* Row */}
                        <div
                          onClick={() => setSessExpanded(isExpanded ? null : s.id)}
                          style={{
                            display: "grid",
                            gridTemplateColumns: mobile ? "auto 1fr auto" : "60px 1fr 1fr auto auto",
                            gap: mobile ? 8 : 12,
                            alignItems: "center",
                            padding: mobile ? "12px 14px" : "14px 16px",
                            background: isExpanded ? "#343436" : CARD_BG,
                            borderRadius: isExpanded ? `${RADIUS}px ${RADIUS}px 0 0` : RADIUS,
                            cursor: "pointer",
                            transition: "background 0.1s",
                          }}
                        >
                          {/* Spot */}
                          <div>
                            <div style={{ fontSize: mobile ? 14 : 15, fontWeight: 700, color: FG }}>{s.spot.label}</div>
                            <div style={{ fontSize: mobile ? 10 : 10, color: FG_DIM, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                              {s.spot.type === "BOBTAIL" ? "Bob" : "Truck"}
                            </div>
                          </div>

                          {/* Driver + vehicle */}
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: FG, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {s.driver.name}
                            </div>
                            <div style={{ fontSize: 12, color: FG_DIM, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {mobile ? (s.vehicle.licensePlate || vLabel) : vLabel}
                            </div>
                            {mobile && (
                              <div style={{ fontSize: 11, color: FG_DIM, marginTop: 2 }}>
                                {fmtDate(s.startedAt)} · {calcDuration(s.startedAt, s.endedAt)} · ${total.toFixed(2)}
                              </div>
                            )}
                          </div>

                          {/* Time — desktop only */}
                          {!mobile && (
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12, color: FG_MUTED }}>{fmtDate(s.startedAt)}</div>
                              <div style={{ fontSize: 11, color: FG_DIM }}>{calcDuration(s.startedAt, s.endedAt)}</div>
                            </div>
                          )}

                          {/* Status badge */}
                          <span style={{
                            fontSize: mobile ? 9 : 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
                            padding: mobile ? "3px 8px" : "4px 10px", borderRadius: 4, background: st.bg, color: st.color,
                            whiteSpace: "nowrap",
                          }}>
                            {s.status}
                          </span>

                          {/* Total — desktop only */}
                          {!mobile && (
                            <div style={{ fontSize: 13, fontWeight: 600, color: FG, fontVariantNumeric: "tabular-nums", textAlign: "right", minWidth: 60 }}>
                              ${total.toFixed(2)}
                            </div>
                          )}
                        </div>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div style={{
                            background: "#343436", borderRadius: `0 0 ${RADIUS}px ${RADIUS}px`,
                            padding: mobile ? "12px 14px 14px" : "0 16px 16px",
                            display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr 1fr 1fr", gap: mobile ? 16 : 20,
                          }}>
                            {/* Driver */}
                            <DetailCol title="Driver">
                              <DetailRow label="Name" value={s.driver.name} />
                              <DetailRow label="Email" value={s.driver.email} />
                              <DetailRow label="Phone" value={s.driver.phone} />
                            </DetailCol>

                            {/* Vehicle */}
                            <DetailCol title="Vehicle">
                              <DetailRow label="Type" value={s.vehicle.type === "BOBTAIL" ? "Bobtail" : "Truck/Trailer"} />
                              <DetailRow label="Unit #" value={s.vehicle.unitNumber || "—"} />
                              <DetailRow label="Plate" value={s.vehicle.licensePlate || "—"} />
                              {s.vehicle.nickname && <DetailRow label="Nickname" value={s.vehicle.nickname} />}
                            </DetailCol>

                            {/* Timing */}
                            <DetailCol title="Timing">
                              <DetailRow label="Started" value={fmtDate(s.startedAt)} />
                              <DetailRow label="Expected" value={fmtDate(s.expectedEnd)} />
                              <DetailRow label="Ended" value={fmtDate(s.endedAt)} />
                              <DetailRow label="Duration" value={calcDuration(s.startedAt, s.endedAt)} />
                            </DetailCol>

                            {/* Payments */}
                            <DetailCol title="Payments">
                              {s.payments.map((p) => (
                                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                                  <span style={{ color: p.type === "OVERSTAY" ? "#DC2626" : FG_MUTED }}>
                                    {p.type === "CHECKIN" || p.type === "MONTHLY_CHECKIN" ? "Check-in" : p.type === "EXTENSION" ? "Extension" : "Overstay"}
                                    {p.hours ? ` (${p.hours}h)` : ""}
                                  </span>
                                  <span style={{ color: FG, fontVariantNumeric: "tabular-nums" }}>${p.amount.toFixed(2)}</span>
                                </div>
                              ))}
                              <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 6, paddingTop: 6, display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                                <span style={{ color: FG, fontWeight: 600 }}>Total</span>
                                <span style={{ color: FG, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>${total.toFixed(2)}</span>
                              </div>
                            </DetailCol>

                            {/* View in QB link — only show if payments tab exists */}
                            <div style={{ gridColumn: mobile ? undefined : "1 / -1", display: "flex", gap: 8, marginTop: 4 }}>
                              <a
                                href={`/admin?tab=payments&q=${encodeURIComponent(s.driver.name)}`}
                                style={{ fontSize: 11, color: "#60A5FA", textDecoration: "none" }}
                              >
                                View in Payments →
                              </a>
                            </div>

                            {/* Admin actions */}
                            {s.status !== "COMPLETED" && (
                              <div style={{ gridColumn: mobile ? undefined : "1 / -1", borderTop: `1px solid ${BORDER}`, paddingTop: 12, marginTop: 4 }}>
                                {sessionAction?.id === s.id ? (
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                    {sessionAction.type === "extend" && (
                                      <>
                                        <span style={{ fontSize: 12, color: FG_MUTED }}>Add hours:</span>
                                        <input type="number" min={1} max={720} value={sessionActionHours} onChange={(e) => setSessionActionHours(Number(e.target.value))} style={{ ...inputStyle, width: 70 }} />
                                      </>
                                    )}
                                    {sessionAction.type === "cancel" && (
                                      <>
                                        <span style={{ fontSize: 12, color: FG_MUTED }}>Reason:</span>
                                        <input type="text" value={sessionActionReason} onChange={(e) => setSessionActionReason(e.target.value)} placeholder="Required" style={{ ...inputStyle, flex: 1, minWidth: 120 }} />
                                      </>
                                    )}
                                    {sessionAction.type === "close" && (() => {
                                      const started = new Date(s.startedAt);
                                      const minDt = started.toISOString().slice(0, 16);
                                      const maxDt = new Date().toISOString().slice(0, 16);
                                      return (
                                        <>
                                          <span style={{ fontSize: 12, color: FG_MUTED }}>Driver left on:</span>
                                          <input
                                            type="datetime-local"
                                            value={sessionActionEndedAt}
                                            onChange={(e) => setSessionActionEndedAt(e.target.value)}
                                            min={minDt}
                                            max={maxDt}
                                            style={{ ...inputStyle, width: mobile ? "100%" : 220 }}
                                          />
                                          <span style={{ fontSize: 10, color: FG_DIM, width: "100%" }}>
                                            Between {started.toLocaleString()} and now
                                          </span>
                                          <span style={{ fontSize: 12, color: FG_MUTED }}>Reason:</span>
                                          <input type="text" value={sessionActionReason} onChange={(e) => setSessionActionReason(e.target.value)} placeholder="e.g. Driver called — left last Tuesday" style={{ ...inputStyle, flex: 1, minWidth: 120 }} />
                                          <div style={{ width: "100%", fontSize: 11, color: "#F59E0B", marginTop: 2 }}>
                                            Overstay payments after this date will be removed.
                                          </div>
                                        </>
                                      );
                                    })()}
                                    <button
                                      onClick={handleSessionAction}
                                      disabled={sessionActionLoading}
                                      style={{
                                        padding: "6px 14px", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#fff",
                                        background: sessionAction.type === "cancel" ? "#DC2626" : sessionAction.type === "close" ? "#F59E0B" : "#2D7A4A",
                                      }}
                                    >
                                      {sessionActionLoading ? "..." : sessionAction.type === "extend" ? "Extend" : sessionAction.type === "close" ? "Close & Backdate" : "Cancel Session"}
                                    </button>
                                    <button onClick={() => { setSessionAction(null); setSessionActionEndedAt(""); setSessionActionReason(""); }} style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${BORDER}`, background: "transparent", color: FG_MUTED, fontSize: 12, cursor: "pointer" }}>
                                      Back
                                    </button>
                                  </div>
                                ) : (
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    <button onClick={() => setSessionAction({ id: s.id, type: "extend" })} style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${BORDER}`, background: "transparent", color: FG, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                                      Extend Time
                                    </button>
                                    <button onClick={() => setSessionAction({ id: s.id, type: "close" })} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #F59E0B40", background: "transparent", color: "#F59E0B", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                                      Close &amp; Backdate
                                    </button>
                                    <button onClick={() => setSessionAction({ id: s.id, type: "cancel" })} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #DC262640", background: "transparent", color: "#DC2626", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                                      Cancel Session
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Pagination */}
                {sessionsData.total > SESS_LIMIT && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                    <button onClick={() => setSessOffset(Math.max(0, sessOffset - SESS_LIMIT))} disabled={sessOffset === 0} style={paginationBtn(sessOffset === 0, mobile)}>
                      ← Newer
                    </button>
                    <span style={{ fontSize: 11, color: FG_DIM }}>
                      {sessOffset + 1}–{Math.min(sessOffset + SESS_LIMIT, sessionsData.total)} of {sessionsData.total}
                    </span>
                    <button onClick={() => setSessOffset(sessOffset + SESS_LIMIT)} disabled={!sessionsData.hasMore} style={paginationBtn(!sessionsData.hasMore, mobile)}>
                      Older →
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ═══ PAYMENTS ═══ */}
        {tab === "payments" && <PaymentsTab mobile={mobile} />}

        {/* ═══ DRIVERS ═══ */}
        {tab === "drivers" && (
          <div>
            {/* Search */}
            <div style={{ marginBottom: 16 }}>
              <input
                type="text"
                placeholder="Search by name, phone, email, plate, unit #…"
                value={driversSearch}
                onChange={(e) => setDriversSearch(e.target.value)}
                style={{ ...inputStyle, maxWidth: mobile ? "100%" : 400 }}
              />
            </div>

            {/* Driver edit modal */}
            {editingDriver && (
              <div style={{ background: CARD_BG, borderRadius: RADIUS, border: `1px solid ${BORDER}`, padding: 20, marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: FG_DIM, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
                  Edit Driver
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, color: FG_DIM, display: "block", marginBottom: 4 }}>Name</label>
                    <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} style={{ ...inputStyle, borderColor: editErrors.name ? "#ef4444" : undefined }} />
                    {editErrors.name && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 3 }}>{editErrors.name}</div>}
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: FG_DIM, display: "block", marginBottom: 4 }}>Email <span style={{ color: FG_MUTED, fontWeight: 400 }}>(optional)</span></label>
                    <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} style={{ ...inputStyle, borderColor: editErrors.email ? "#ef4444" : undefined }} />
                    {editErrors.email && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 3 }}>{editErrors.email}</div>}
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: FG_DIM, display: "block", marginBottom: 4 }}>Phone</label>
                    <PhoneInput value={editForm.phone} onChange={(v) => setEditForm({ ...editForm, phone: v })} style={{ ...inputStyle, borderColor: editErrors.phone ? "#ef4444" : undefined }} />
                    {editErrors.phone && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 3 }}>{editErrors.phone}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <button onClick={handleSaveDriver} style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: "#2D7A4A", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      Save
                    </button>
                    <button onClick={() => setEditingDriver(null)} style={{ padding: "8px 18px", borderRadius: 6, border: `1px solid ${BORDER}`, background: "transparent", color: FG_MUTED, fontSize: 13, cursor: "pointer" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Driver list */}
            {driversLoading ? (
              <p style={{ color: FG_DIM, textAlign: "center", padding: 40 }}>Loading…</p>
            ) : drivers.length === 0 ? (
              <p style={{ color: FG_DIM, textAlign: "center", padding: 40 }}>No drivers found.</p>
            ) : (
              <>
                <div style={{ fontSize: 11, color: FG_DIM, marginBottom: 10 }}>
                  {driversOffset + 1}–{Math.min(driversOffset + DRIVERS_LIMIT, driversTotal)} of {driversTotal} drivers
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {drivers.map((d) => {
                    const activeSession = d.sessions[0];
                    return (
                      <div
                        key={d.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: mobile ? "1fr auto" : "1fr 1fr auto auto",
                          gap: mobile ? 8 : 16,
                          alignItems: "center",
                          padding: mobile ? "12px 14px" : "14px 16px",
                          background: CARD_BG,
                          borderRadius: RADIUS,
                        }}
                      >
                        {/* Name + phone */}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: FG, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {d.name}
                          </div>
                          <div style={{ fontSize: 12, color: FG_DIM }}>
                            {d.phone} {d.email && <span style={{ color: FG_DIM }}>· {d.email}</span>}
                          </div>
                          {mobile && (
                            <div style={{ fontSize: 11, color: FG_DIM, marginTop: 2 }}>
                              {d.vehicles.length} vehicle{d.vehicles.length !== 1 ? "s" : ""} · {d._count.sessions} session{d._count.sessions !== 1 ? "s" : ""}
                              {activeSession && <span style={{ color: "#2D7A4A" }}> · Active @ {activeSession.spot.label}</span>}
                            </div>
                          )}
                        </div>

                        {/* Vehicles + sessions — desktop */}
                        {!mobile && (
                          <div style={{ fontSize: 12, color: FG_MUTED, minWidth: 0 }}>
                            <div>{d.vehicles.map((v) => v.licensePlate || v.unitNumber || "—").join(", ")}</div>
                            <div style={{ color: FG_DIM }}>{d._count.sessions} session{d._count.sessions !== 1 ? "s" : ""}</div>
                          </div>
                        )}

                        {/* Status */}
                        {!mobile && (
                          activeSession ? (
                            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", padding: "4px 10px", borderRadius: 4, background: "#12261C", color: "#2D7A4A", whiteSpace: "nowrap" }}>
                              Active · {activeSession.spot.label}
                            </span>
                          ) : (
                            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", padding: "4px 10px", borderRadius: 4, background: CARD_BG, color: FG_DIM }}>
                              Inactive
                            </span>
                          )
                        )}

                        {/* Edit button */}
                        <button
                          onClick={() => {
                            setEditingDriver(d);
                            setEditForm({ name: d.name, email: d.email, phone: d.phone });
                            setEditErrors({});
                          }}
                          style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${BORDER}`, background: "transparent", color: FG_MUTED, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                        >
                          Edit
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination */}
                {driversTotal > DRIVERS_LIMIT && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                    <button onClick={() => setDriversOffset(Math.max(0, driversOffset - DRIVERS_LIMIT))} disabled={driversOffset === 0} style={paginationBtn(driversOffset === 0, mobile)}>
                      ← Prev
                    </button>
                    <span style={{ fontSize: 11, color: FG_DIM }}>
                      {driversOffset + 1}–{Math.min(driversOffset + DRIVERS_LIMIT, driversTotal)} of {driversTotal}
                    </span>
                    <button onClick={() => setDriversOffset(driversOffset + DRIVERS_LIMIT)} disabled={driversOffset + DRIVERS_LIMIT >= driversTotal} style={paginationBtn(driversOffset + DRIVERS_LIMIT >= driversTotal, mobile)}>
                      Next →
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ═══ LOG ═══ */}
        {tab === "log" && (
          <div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
              {LOG_CATEGORIES.map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => { setLogFilter(cat.key); setLogOffset(0); }}
                  style={chip(logFilter === cat.key, mobile)}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {logLoading ? (
              <p style={{ color: FG_DIM, textAlign: "center", padding: 40 }}>Loading…</p>
            ) : logEntries.length === 0 ? (
              <p style={{ color: FG_DIM, textAlign: "center", padding: 40 }}>No log entries.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {logEntries.map((entry) => {
                  const badge = ACTION_BADGE[entry.action] || { color: FG_MUTED, bg: CARD_BG, label: entry.action };
                  const timeStr = new Date(entry.createdAt).toLocaleString("en-US", {
                    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
                  });
                  return (
                    <div key={entry.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", borderRadius: 8, background: CARD_BG }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
                        padding: "3px 8px", borderRadius: 4, background: badge.bg, color: badge.color,
                        whiteSpace: "nowrap", flexShrink: 0, marginTop: 2,
                      }}>
                        {badge.label}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: FG, lineHeight: 1.4 }}>{entry.details || "—"}</div>
                        <div style={{ fontSize: 11, color: FG_DIM, marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
                          <span>{timeStr}</span>
                          {entry.driver && <span>{entry.driver.name}</span>}
                          {entry.vehicle && <span>{entry.vehicle.licensePlate}</span>}
                          {entry.spot && <span>Spot {entry.spot.label}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {logTotal > LOG_LIMIT && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                <button onClick={() => setLogOffset(Math.max(0, logOffset - LOG_LIMIT))} disabled={logOffset === 0} style={paginationBtn(logOffset === 0, mobile)}>← Newer</button>
                <span style={{ fontSize: 11, color: FG_DIM }}>{logOffset + 1}–{Math.min(logOffset + LOG_LIMIT, logTotal)} of {logTotal}</span>
                <button onClick={() => setLogOffset(logOffset + LOG_LIMIT)} disabled={logOffset + LOG_LIMIT >= logTotal} style={paginationBtn(logOffset + LOG_LIMIT >= logTotal, mobile)}>Older →</button>
              </div>
            )}
          </div>
        )}

        {/* ═══ SETTINGS ═══ */}
        {tab === "settings" && settingsForm && (
          <div style={{ maxWidth: mobile ? "100%" : 560 }}>
            <form onSubmit={handleSaveSettings} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <SettingsGroup title="Payment">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="checkbox"
                    id="paymentRequired"
                    checked={settingsForm.paymentRequired ?? true}
                    onChange={(e) => setSettingsForm({ ...settingsForm, paymentRequired: e.target.checked })}
                    style={{ width: 16, height: 16, accentColor: FG }}
                  />
                  <label htmlFor="paymentRequired" style={{ fontSize: 12, color: FG_MUTED, cursor: "pointer" }}>
                    Require payment at check-in (disable for testing)
                  </label>
                </div>
              </SettingsGroup>
              <SettingsGroup title="QuickBooks Connection">
                <QBConnectionStatus />
              </SettingsGroup>
              <SettingsGroup title="Hourly Rates">
                <SettingsField label="Bobtail ($/hr)" value={settingsForm.hourlyRateBobtail} onChange={(v) => setSettingsForm({ ...settingsForm, hourlyRateBobtail: v })} step="0.01" />
                <SettingsField label="Truck/Trailer ($/hr)" value={settingsForm.hourlyRateTruck} onChange={(v) => setSettingsForm({ ...settingsForm, hourlyRateTruck: v })} step="0.01" />
              </SettingsGroup>
              <SettingsGroup title="Monthly Rates">
                <SettingsField label="Bobtail ($/month)" value={settingsForm.monthlyRateBobtail} onChange={(v) => setSettingsForm({ ...settingsForm, monthlyRateBobtail: v })} step="0.01" />
                <SettingsField label="Truck/Trailer ($/month)" value={settingsForm.monthlyRateTruck} onChange={(v) => setSettingsForm({ ...settingsForm, monthlyRateTruck: v })} step="0.01" />
              </SettingsGroup>
              <SettingsGroup title="Overstay Rates (Premium)">
                <SettingsField label="Bobtail ($/hr)" value={settingsForm.overstayRateBobtail} onChange={(v) => setSettingsForm({ ...settingsForm, overstayRateBobtail: v })} step="0.01" />
                <SettingsField label="Truck/Trailer ($/hr)" value={settingsForm.overstayRateTruck} onChange={(v) => setSettingsForm({ ...settingsForm, overstayRateTruck: v })} step="0.01" />
              </SettingsGroup>
              <SettingsGroup title="Notifications">
                <SettingsField label="Reminder before expiry (min)" value={settingsForm.reminderMinutesBefore} onChange={(v) => setSettingsForm({ ...settingsForm, reminderMinutesBefore: v })} />
                <SettingsField label="Grace period (min)" value={settingsForm.gracePeriodMinutes} onChange={(v) => setSettingsForm({ ...settingsForm, gracePeriodMinutes: v })} />
                <div>
                  <label style={{ fontSize: 12, color: FG_DIM, display: "block", marginBottom: 4 }}>Manager Email</label>
                  <input type="email" value={settingsForm.managerEmail} onChange={(e) => setSettingsForm({ ...settingsForm, managerEmail: e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: FG_DIM, display: "block", marginBottom: 4 }}>Manager Phone</label>
                  <input type="tel" value={settingsForm.managerPhone} onChange={(e) => setSettingsForm({ ...settingsForm, managerPhone: e.target.value })} style={inputStyle} />
                </div>
              </SettingsGroup>
              <SettingsGroup title="Spot Configuration">
                <SettingsField label="Total Bobtail Spots" value={settingsForm.totalSpotsBobtail} onChange={(v) => setSettingsForm({ ...settingsForm, totalSpotsBobtail: v })} />
                <SettingsField label="Total Truck/Trailer Spots" value={settingsForm.totalSpotsTruck} onChange={(v) => setSettingsForm({ ...settingsForm, totalSpotsTruck: v })} />
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                  <input
                    type="checkbox"
                    id="bobtailOverflow"
                    checked={settingsForm.bobtailOverflow ?? true}
                    onChange={(e) => setSettingsForm({ ...settingsForm, bobtailOverflow: e.target.checked })}
                    style={{ width: 16, height: 16, accentColor: FG }}
                  />
                  <label htmlFor="bobtailOverflow" style={{ fontSize: 12, color: FG_MUTED, cursor: "pointer" }}>
                    Allow bobtails in truck spots when bobtail spots are full
                  </label>
                </div>
              </SettingsGroup>

              <SettingsGroup title="Parking Terms (Clickwrap)">
                <div>
                  <label style={{ fontSize: 12, color: FG_DIM, display: "block", marginBottom: 4 }}>Version</label>
                  <input
                    type="text"
                    value={settingsForm.termsVersion ?? ""}
                    onChange={(e) => setSettingsForm({ ...settingsForm, termsVersion: e.target.value })}
                    style={inputStyle}
                    placeholder="1.0"
                  />
                  <div style={{ fontSize: 10, color: FG_DIM, marginTop: 4 }}>
                    Bump this whenever you change the terms text below. Existing sessions stay bound to their original version.
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: FG_DIM, display: "block", marginBottom: 4 }}>Terms body (shown to driver at check-in)</label>
                  <textarea
                    value={settingsForm.termsBody ?? ""}
                    onChange={(e) => setSettingsForm({ ...settingsForm, termsBody: e.target.value })}
                    style={{ ...inputStyle, minHeight: 220, fontFamily: "inherit", resize: "vertical" as const, lineHeight: 1.5 }}
                    placeholder="Enter the terms drivers must accept to check in..."
                  />
                  <div style={{ fontSize: 10, color: "#F59E0B", marginTop: 6 }}>
                    ⚠ Have a Texas attorney review this text before production. Clickwrap consent is only enforceable if the terms are clear and the driver actively agrees.
                  </div>
                </div>
              </SettingsGroup>

              <button type="submit" style={{ padding: "12px 24px", background: FG, color: DARK_BG, border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", alignSelf: "flex-start" }}>
                Save Settings
              </button>
            </form>

            {/* Allow list management */}
            <AllowListManager mobile={mobile} />
          </div>
        )}

      </div>

      {/* ═══ NEW SESSION MODAL ═══ */}
      {nsOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setNsOpen(false); }}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.72)",
            zIndex: 200,
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            padding: "24px 16px 40px",
            overflowY: "auto",
          }}
        >
          <div style={{
            width: "100%", maxWidth: 560,
            background: DARK_BG,
            border: `1px solid ${BORDER}`,
            borderRadius: 16,
            overflow: "hidden",
            flexShrink: 0,
          }}>
            {/* Header */}
            <div style={{ padding: "18px 24px", borderBottom: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ fontSize: 12, color: FG_DIM, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>Admin</p>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: FG, margin: 0 }}>New Session</h2>
              </div>
              <button onClick={() => setNsOpen(false)} style={{ background: "none", border: "none", color: FG_DIM, fontSize: 22, cursor: "pointer", padding: "2px 6px", lineHeight: 1 }}>×</button>
            </div>

            <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>

              {/* ── Driver ── */}
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: FG_DIM, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 12 }}>Driver</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ gridColumn: "1/-1" }}>
                    <label style={{ fontSize: 12, color: FG_DIM, display: "block", marginBottom: 4 }}>
                      Full Name <span style={{ color: "#EF4444" }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={nsForm.name}
                      onChange={(e) => nsSetField("name", e.target.value)}
                      placeholder="John Doe"
                      style={{ ...inputStyle, ...(nsErrors.name ? { borderColor: "#EF4444" } : {}) }}
                    />
                    {nsErrors.name && <p style={{ fontSize: 11, color: "#EF4444", marginTop: 3 }}>{nsErrors.name}</p>}
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: FG_DIM, display: "block", marginBottom: 4 }}>
                      Phone <span style={{ color: "#EF4444" }}>*</span>
                    </label>
                    <PhoneInput
                      value={nsForm.phone}
                      onChange={(v) => nsSetField("phone", v)}
                      placeholder="(555) 867-5309"
                      style={{ ...inputStyle, ...(nsErrors.phone ? { borderColor: "#EF4444" } : {}) }}
                    />
                    {nsErrors.phone && <p style={{ fontSize: 11, color: "#EF4444", marginTop: 3 }}>{nsErrors.phone}</p>}
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: FG_DIM, display: "block", marginBottom: 4 }}>Email</label>
                    <input
                      type="email"
                      value={nsForm.email}
                      onChange={(e) => nsSetField("email", e.target.value)}
                      placeholder="driver@example.com"
                      style={{ ...inputStyle, ...(nsErrors.email ? { borderColor: "#EF4444" } : {}) }}
                    />
                    {nsErrors.email && <p style={{ fontSize: 11, color: "#EF4444", marginTop: 3 }}>{nsErrors.email}</p>}
                  </div>
                </div>
              </div>

              <div style={{ height: 1, background: BORDER }} />

              {/* ── Vehicle ── */}
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: FG_DIM, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 12 }}>Vehicle</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ gridColumn: "1/-1" }}>
                    <label style={{ fontSize: 12, color: FG_DIM, display: "block", marginBottom: 6 }}>Type <span style={{ color: "#EF4444" }}>*</span></label>
                    <div style={{ display: "flex", gap: 8 }}>
                      {(["TRUCK_TRAILER", "BOBTAIL"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => nsSetField("vehicleType", t)}
                          style={{
                            flex: 1, padding: "8px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
                            border: `1px solid ${nsForm.vehicleType === t ? ACCENT : BORDER}`,
                            background: nsForm.vehicleType === t ? "rgba(45,122,74,0.18)" : "transparent",
                            color: nsForm.vehicleType === t ? ACCENT : FG_DIM,
                          }}
                        >
                          {t === "TRUCK_TRAILER" ? "Truck / Trailer" : "Bobtail"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: FG_DIM, display: "block", marginBottom: 4 }}>License Plate†</label>
                    <input
                      type="text"
                      value={nsForm.licensePlate}
                      onChange={(e) => nsSetField("licensePlate", e.target.value.toUpperCase())}
                      placeholder="ABC-1234"
                      style={{ ...inputStyle, ...(nsErrors.licensePlate ? { borderColor: "#EF4444" } : {}) }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: FG_DIM, display: "block", marginBottom: 4 }}>Unit Number†</label>
                    <input
                      type="text"
                      value={nsForm.unitNumber}
                      onChange={(e) => nsSetField("unitNumber", e.target.value)}
                      placeholder="UNIT-001"
                      style={inputStyle}
                    />
                  </div>
                  {nsErrors.licensePlate && (
                    <p style={{ fontSize: 11, color: "#EF4444", gridColumn: "1/-1", marginTop: -6 }}>{nsErrors.licensePlate}</p>
                  )}
                  <div style={{ gridColumn: "1/-1" }}>
                    <label style={{ fontSize: 12, color: FG_DIM, display: "block", marginBottom: 4 }}>Nickname <span style={{ color: FG_DIM, fontWeight: 400 }}>(optional)</span></label>
                    <input
                      type="text"
                      value={nsForm.nickname}
                      onChange={(e) => nsSetField("nickname", e.target.value)}
                      placeholder="e.g. Red Kenworth"
                      style={inputStyle}
                    />
                  </div>
                  <p style={{ fontSize: 10, color: FG_DIM, gridColumn: "1/-1", marginTop: -4 }}>
                    † At least one of license plate or unit number is required.
                  </p>
                </div>
              </div>

              <div style={{ height: 1, background: BORDER }} />

              {/* ── Duration ── */}
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: FG_DIM, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 12 }}>Duration</p>
                <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                  {(["HOURLY", "MONTHLY"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => nsSetField("durationType", t)}
                      style={{
                        flex: 1, padding: "8px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
                        border: `1px solid ${nsForm.durationType === t ? ACCENT : BORDER}`,
                        background: nsForm.durationType === t ? "rgba(45,122,74,0.18)" : "transparent",
                        color: nsForm.durationType === t ? ACCENT : FG_DIM,
                      }}
                    >
                      {t === "HOURLY" ? "Hourly (1–72h)" : "Monthly (1–12mo)"}
                    </button>
                  ))}
                </div>
                {nsForm.durationType === "HOURLY" ? (
                  <div>
                    <label style={{ fontSize: 12, color: FG_DIM, display: "block", marginBottom: 4 }}>Hours <span style={{ color: "#EF4444" }}>*</span></label>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <button type="button" onClick={() => nsSetField("hours", Math.max(1, nsForm.hours - 1))}
                        style={{ width: 36, height: 36, borderRadius: 8, border: `1px solid ${BORDER}`, background: "transparent", color: FG, fontSize: 18, cursor: "pointer" }}>−</button>
                      <input
                        type="number" min={1} max={72}
                        value={nsForm.hours}
                        onChange={(e) => nsSetField("hours", Math.min(72, Math.max(1, Number(e.target.value) || 1)))}
                        style={{ ...inputStyle, width: 70, textAlign: "center" }}
                      />
                      <button type="button" onClick={() => nsSetField("hours", Math.min(72, nsForm.hours + 1))}
                        style={{ width: 36, height: 36, borderRadius: 8, border: `1px solid ${BORDER}`, background: "transparent", color: FG, fontSize: 18, cursor: "pointer" }}>+</button>
                      <span style={{ fontSize: 13, color: FG_DIM }}>hours</span>
                    </div>
                    {nsErrors.hours && <p style={{ fontSize: 11, color: "#EF4444", marginTop: 4 }}>{nsErrors.hours}</p>}
                  </div>
                ) : (
                  <div>
                    <label style={{ fontSize: 12, color: FG_DIM, display: "block", marginBottom: 4 }}>Months <span style={{ color: "#EF4444" }}>*</span></label>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <button type="button" onClick={() => nsSetField("months", Math.max(1, nsForm.months - 1))}
                        style={{ width: 36, height: 36, borderRadius: 8, border: `1px solid ${BORDER}`, background: "transparent", color: FG, fontSize: 18, cursor: "pointer" }}>−</button>
                      <input
                        type="number" min={1} max={12}
                        value={nsForm.months}
                        onChange={(e) => nsSetField("months", Math.min(12, Math.max(1, Number(e.target.value) || 1)))}
                        style={{ ...inputStyle, width: 70, textAlign: "center" }}
                      />
                      <button type="button" onClick={() => nsSetField("months", Math.min(12, nsForm.months + 1))}
                        style={{ width: 36, height: 36, borderRadius: 8, border: `1px solid ${BORDER}`, background: "transparent", color: FG, fontSize: 18, cursor: "pointer" }}>+</button>
                      <span style={{ fontSize: 13, color: FG_DIM }}>months</span>
                    </div>
                    {nsErrors.months && <p style={{ fontSize: 11, color: "#EF4444", marginTop: 4 }}>{nsErrors.months}</p>}
                  </div>
                )}
              </div>

              <div style={{ height: 1, background: BORDER }} />

              {/* ── Spot ── */}
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: FG_DIM, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 12 }}>Spot Assignment</p>
                <div style={{ display: "flex", gap: 8, marginBottom: nsForm.spotMode === "manual" ? 12 : 0 }}>
                  {(["auto", "manual"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => nsSetField("spotMode", m)}
                      style={{
                        flex: 1, padding: "8px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
                        border: `1px solid ${nsForm.spotMode === m ? ACCENT : BORDER}`,
                        background: nsForm.spotMode === m ? "rgba(45,122,74,0.18)" : "transparent",
                        color: nsForm.spotMode === m ? ACCENT : FG_DIM,
                      }}
                    >
                      {m === "auto" ? "Auto-assign" : "Select spot"}
                    </button>
                  ))}
                </div>
                {nsForm.spotMode === "manual" && (
                  <div>
                    <label style={{ fontSize: 12, color: FG_DIM, display: "block", marginBottom: 4 }}>Available Spot <span style={{ color: "#EF4444" }}>*</span></label>
                    <select
                      value={nsForm.spotId}
                      onChange={(e) => nsSetField("spotId", e.target.value)}
                      style={{ ...inputStyle, width: "100%", cursor: "pointer", ...(nsErrors.spotId ? { borderColor: "#EF4444" } : {}) }}
                    >
                      <option value="">— Select a spot —</option>
                      {availableSpots
                        .filter((s) =>
                          nsForm.vehicleType === "BOBTAIL"
                            ? true // bobtails can overflow to truck spots
                            : s.type === "TRUCK_TRAILER"
                        )
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label} ({s.type === "TRUCK_TRAILER" ? "Truck" : "Bobtail"})
                          </option>
                        ))}
                    </select>
                    {nsErrors.spotId && <p style={{ fontSize: 11, color: "#EF4444", marginTop: 3 }}>{nsErrors.spotId}</p>}
                    {availableSpots.length === 0 && (
                      <p style={{ fontSize: 11, color: "#F59E0B", marginTop: 4 }}>No available spots — all spots occupied.</p>
                    )}
                  </div>
                )}
              </div>

              <div style={{ height: 1, background: BORDER }} />

              {/* ── QB Invoice ── */}
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: FG_DIM, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 4 }}>QuickBooks Invoice</p>
                {!nsPaymentRequired && (
                  <p style={{ fontSize: 11, color: "#F59E0B", marginBottom: 12 }}>
                    Payments are disabled — invoice is optional. A free session will be created.
                  </p>
                )}
                {nsPaymentRequired && (
                  <p style={{ fontSize: 11, color: FG_DIM, marginBottom: 12 }}>
                    The invoice must exist and be fully paid in QB before submitting. Verify it here first.
                  </p>
                )}
                <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <input
                    type="text"
                    value={nsForm.invoiceId}
                    onChange={(e) => nsSetField("invoiceId", e.target.value.trim())}
                    placeholder="QB invoice ID (e.g. 150)"
                    style={{ ...inputStyle, flex: 1, ...(nsErrors.invoiceId ? { borderColor: "#EF4444" } : {}) }}
                  />
                  <button
                    type="button"
                    onClick={handleVerifyInvoice}
                    disabled={!nsForm.invoiceId.trim() || nsInvoice.status === "checking"}
                    style={{
                      padding: "0 18px", borderRadius: 8, border: `1px solid ${BORDER}`,
                      background: "transparent", color: FG, fontSize: 13, fontWeight: 600,
                      cursor: !nsForm.invoiceId.trim() || nsInvoice.status === "checking" ? "default" : "pointer",
                      opacity: !nsForm.invoiceId.trim() ? 0.5 : 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {nsInvoice.status === "checking" ? "Checking…" : "Verify"}
                  </button>
                </div>
                {nsInvoice.status === "ok" && (
                  <p style={{ fontSize: 12, color: "#30D158", fontWeight: 600 }}>✓ {nsInvoice.message}</p>
                )}
                {nsInvoice.status === "error" && (
                  <p style={{ fontSize: 12, color: "#EF4444" }}>✕ {nsInvoice.message}</p>
                )}
                {nsErrors.invoiceId && nsInvoice.status !== "ok" && (
                  <p style={{ fontSize: 11, color: "#EF4444", marginTop: 2 }}>{nsErrors.invoiceId}</p>
                )}
              </div>

              {/* ── Submit ── */}
              {nsErrors._ && (
                <p style={{ fontSize: 13, color: "#EF4444", padding: "10px 14px", background: "rgba(239,68,68,0.1)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.25)" }}>
                  {nsErrors._}
                </p>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={handleNewSession}
                  disabled={nsSubmitting}
                  style={{
                    flex: 1, padding: "14px 20px", background: nsSubmitting ? FG_DIM : ACCENT, color: "#fff",
                    border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15,
                    cursor: nsSubmitting ? "default" : "pointer",
                  }}
                >
                  {nsSubmitting ? "Creating session…" : "Create Session"}
                </button>
                <button
                  type="button"
                  onClick={() => setNsOpen(false)}
                  style={{ padding: "14px 18px", background: "transparent", color: FG_DIM, border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 14, cursor: "pointer" }}
                >
                  Cancel
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// Payments Tab — internal records + QB cross-reference
// ═══════════════════════════════════════════════════════════════════════════
type PaymentRow = ApiPaymentWithSession;
type PaymentSummary = {
  totalRevenue: number;
  checkinRevenue: number;
  monthlyRevenue: number;
  extensionRevenue: number;
  overstayRevenue: number;
  transactionCount: number;
};
type QBPaymentRecord = { id: string; date: string; amount: number; customerName: string; memo: string; method: string };
type QBProfitLoss = { totalIncome: number; totalExpenses: number; netIncome: number } | null;

function PaymentsTab({ mobile }: { mobile: boolean }) {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [dailyRevenue, setDailyRevenue] = useState<{ date: string; amount: number }[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const LIMIT = 30;

  // Stripe reconciliation (read-only divergence check — never mutates DB)
  const [qbPayments, setQbPayments] = useState<QBPaymentRecord[]>([]);
  const [qbPL, setQbPL] = useState<QBProfitLoss>(null);
  const [qbConnected, setQbConnected] = useState(false);
  const [qbLoading, setQbLoading] = useState(true);
  const [lastStripeWebhookAt, setLastStripeWebhookAt] = useState<string | null>(null);
  const [flaggedStripeIds, setFlaggedStripeIds] = useState<string[]>([]);

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    stripeChargesChecked: number;
    dbPaymentsChecked: number;
    inStripeNotDb: string[];
    inDbNotStripe: string[];
    flaggedCount: number;
  } | null>(null);

  const syncWithQB = useCallback(() => {
    setSyncing(true);
    setSyncResult(null);
    fetch("/api/admin/stripe-reconcile", { method: "POST" })
      .then((r) => r.json())
      .then((d) => setSyncResult(d))
      .catch(() => setSyncResult({
        stripeChargesChecked: 0,
        dbPaymentsChecked: 0,
        inStripeNotDb: [],
        inDbNotStripe: [],
        flaggedCount: -1,
      }))
      .finally(() => setSyncing(false));
  }, []);

  // Load internal payments
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
    if (typeFilter) params.set("type", typeFilter);
    if (search.trim()) params.set("q", search.trim());
    fetch(`/api/admin/payments?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setPayments(d.payments ?? []);
        setSummary(d.summary ?? null);
        setTotal(d.total ?? 0);
        if (d.dailyRevenue) setDailyRevenue(d.dailyRevenue);
      })
      .finally(() => setLoading(false));
  }, [offset, typeFilter, search]);

  // Surface QB connection + Stripe webhook status (Sales Receipt writes
  // depend on QB; reconciliation status depends on webhook heartbeat).
  useEffect(() => {
    setQbLoading(true);
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        setQbConnected(!!d.settings?.qbConnected);
        setLastStripeWebhookAt(d.settings?.lastStripeWebhookAt ?? null);
        setFlaggedStripeIds(d.settings?.stripeReconcileFlaggedIds ?? []);
        setQbPayments([]);
        setQbPL(null);
      })
      .catch(() => setQbConnected(false))
      .finally(() => setQbLoading(false));
  }, [syncResult]);

  const stripeWebhookStatus = lastStripeWebhookAt
    ? `Last Stripe webhook: ${new Date(lastStripeWebhookAt).toLocaleString()}`
    : "No Stripe webhooks received yet";

  // Reset offset on filter change
  useEffect(() => { setOffset(0); }, [typeFilter, search]);

  // Legacy QB reconciliation is retired — Stripe is the source of truth.
  // A Stripe divergence check runs from the Sync button (see task #36).
  // These two references are kept to avoid breaking the unused old UI
  // fragments below; they produce an empty set.
  const internalPaymentIds = new Set<string>();
  const unmatchedQB: typeof qbPayments = [];

  const typeLabels: Record<string, string> = {
    CHECKIN: "Check-in",
    MONTHLY_CHECKIN: "Monthly",
    EXTENSION: "Extension",
    OVERSTAY: "Overstay",
  };

  return (
    <div>
      {/* Summary cards */}
      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(5, 1fr)", gap: 10, marginBottom: 20 }}>
          {[
            { label: "Total Revenue", value: `$${summary.totalRevenue.toFixed(2)}`, color: FG },
            { label: "Check-ins", value: `$${summary.checkinRevenue.toFixed(2)}` },
            { label: "Monthly", value: `$${summary.monthlyRevenue.toFixed(2)}` },
            { label: "Extensions", value: `$${summary.extensionRevenue.toFixed(2)}` },
            { label: "Overstay", value: `$${summary.overstayRevenue.toFixed(2)}`, color: "#DC2626" },
          ].map((c) => (
            <div key={c.label} style={{ background: CARD_BG, borderRadius: 10, padding: "14px 16px", border: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 10, color: FG_DIM, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 4 }}>{c.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: c.color ?? FG_MUTED, fontVariantNumeric: "tabular-nums" }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* QB quick link */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <a href={qbLinks.dashboard()} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#60A5FA", textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
          Open QuickBooks ↗
        </a>
      </div>

      {/* Revenue chart — last 30 days */}
      {dailyRevenue.length > 0 && (() => {
        const maxAmt = Math.max(...dailyRevenue.map((d) => d.amount), 1);
        const chartW = 100; // percentage-based
        const chartH = 120;
        const barW = chartW / dailyRevenue.length;
        return (
          <div style={{ background: CARD_BG, borderRadius: 10, padding: "16px 16px 10px", border: `1px solid ${BORDER}`, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: FG_DIM, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Daily Revenue — Last 30 Days
              </span>
              <span style={{ fontSize: 12, color: FG_MUTED }}>
                Peak: ${maxAmt.toFixed(0)}/day
              </span>
            </div>
            <svg width="100%" height={chartH} viewBox={`0 0 ${dailyRevenue.length} ${chartH}`} preserveAspectRatio="none" style={{ display: "block" }}>
              {dailyRevenue.map((d, i) => {
                const h = (d.amount / maxAmt) * (chartH - 20);
                const isToday = i === dailyRevenue.length - 1;
                return (
                  <g key={d.date}>
                    <rect
                      x={i + 0.1}
                      y={chartH - h}
                      width={0.8}
                      height={h}
                      rx={0.2}
                      fill={d.amount === 0 ? `${BORDER}` : isToday ? "#2D7A4A" : "#2D7A4A80"}
                    />
                    {/* Show amount on hover via title */}
                    <title>{`${d.date}: $${d.amount.toFixed(2)}`}</title>
                    <rect x={i} y={0} width={1} height={chartH} fill="transparent" />
                  </g>
                );
              })}
            </svg>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <span style={{ fontSize: 9, color: FG_DIM }}>{dailyRevenue[0]?.date.slice(5)}</span>
              <span style={{ fontSize: 9, color: FG_DIM }}>Today</span>
            </div>
          </div>
        );
      })()}

      {/* QB reconciliation banner */}
      {qbConnected && !qbLoading && (
        <div style={{ background: CARD_BG, borderRadius: 10, padding: "14px 16px", border: `1px solid ${BORDER}`, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: FG_DIM, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                Stripe Reconciliation
              </div>
              <div style={{ fontSize: 12, color: FG_MUTED }}>
                {stripeWebhookStatus}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {flaggedStripeIds.length > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 4, background: "#2A1F0A", color: "#F59E0B" }}>
                  {flaggedStripeIds.length} flagged
                </span>
              )}
              <button
                onClick={syncWithQB}
                disabled={syncing}
                style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: `1px solid ${BORDER}`, background: "transparent", color: syncing ? FG_DIM : FG_MUTED, cursor: syncing ? "default" : "pointer" }}
              >
                {syncing ? "Checking…" : "Run Stripe reconcile"}
              </button>
            </div>
          </div>
          {/* Reconcile result summary */}
          {syncResult && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDER}`, fontSize: 12 }}>
              {syncResult.flaggedCount < 0 ? (
                <span style={{ color: "#DC2626" }}>
                  Stripe reconcile failed — check that STRIPE_SECRET_KEY is set.
                </span>
              ) : syncResult.flaggedCount === 0 ? (
                <span style={{ color: "#2D7A4A" }}>
                  All {syncResult.stripeChargesChecked} Stripe charge{syncResult.stripeChargesChecked !== 1 ? "s" : ""} in last 90 days match our DB.
                </span>
              ) : (
                <span style={{ color: "#F59E0B" }}>
                  {syncResult.inStripeNotDb.length} in Stripe but not our DB
                  {" · "}
                  {syncResult.inDbNotStripe.length} in our DB but not Stripe
                  {" · "}check logs + reach out to support if this persists
                </span>
              )}
            </div>
          )}
        </div>
      )}
      {!qbConnected && !qbLoading && (
        <div style={{ fontSize: 12, color: FG_DIM, marginBottom: 16, padding: "10px 14px", background: CARD_BG, borderRadius: 8, border: `1px solid ${BORDER}` }}>
          QuickBooks not connected — Sales Receipts won't be written to QB.
          Stripe continues to work for payments; once QB is connected (Settings → QuickBooks Connection), new charges will mirror to QB automatically.
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        {["", "CHECKIN", "MONTHLY_CHECKIN", "EXTENSION", "OVERSTAY"].map((t) => (
          <button key={t || "ALL"} onClick={() => setTypeFilter(t)} style={chip(typeFilter === t, mobile)}>
            {t ? typeLabels[t] : "All"}
          </button>
        ))}
        <div style={{ flex: 1, minWidth: mobile ? "100%" : 180, maxWidth: mobile ? "100%" : 300 }}>
          <input type="text" placeholder="Search driver, plate, payment ID…" value={search} onChange={(e) => setSearch(e.target.value)} style={inputStyle} />
        </div>
      </div>

      {/* Payment list */}
      {loading ? (
        <p style={{ color: FG_DIM, textAlign: "center", padding: 40 }}>Loading…</p>
      ) : payments.length === 0 ? (
        <p style={{ color: FG_DIM, textAlign: "center", padding: 40 }}>No payments found.</p>
      ) : (
        <>
          <div style={{ fontSize: 11, color: FG_DIM, marginBottom: 10 }}>
            {offset + 1}–{Math.min(offset + LIMIT, total)} of {total} payments
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {payments.map((p) => {
              const real = isRealPayment(p);
              const stripeCustId = p.session?.driver?.stripeCustomerId;
              const stripeUrl = stripeDashboardUrl(p);
              const isRefunded = p.status === "REFUNDED";
              const statusColor = isRefunded ? "#F59E0B" : p.status === "VOIDED" ? "#DC2626" : p.status === "DISPUTED" ? "#EF4444" : undefined;

              return (
                <div key={p.id} style={{
                  background: CARD_BG, borderRadius: 8, padding: mobile ? "10px 12px" : "12px 16px",
                  opacity: isRefunded ? 0.7 : 1,
                }}>
                  {/* Main row */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: mobile ? "1fr auto" : "auto 1fr auto auto",
                    gap: mobile ? 6 : 12,
                    alignItems: "center",
                  }}>
                    {/* Type badge + status */}
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
                        padding: "3px 8px", borderRadius: 4, whiteSpace: "nowrap",
                        background: p.type === "OVERSTAY" ? "#2C1810" : p.type === "MONTHLY_CHECKIN" ? "#0A1A30" : "#12261C",
                        color: p.type === "OVERSTAY" ? "#DC2626" : p.type === "MONTHLY_CHECKIN" ? "#60A5FA" : "#2D7A4A",
                      }}>
                        {typeLabels[p.type] ?? p.type}
                      </span>
                      {statusColor && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: statusColor, textTransform: "uppercase" }}>
                          {p.status}
                        </span>
                      )}
                    </div>

                    {/* Driver + vehicle + date */}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: FG, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.session?.driver?.name ?? "—"}
                      </div>
                      <div style={{ fontSize: 11, color: FG_DIM }}>
                        {p.session?.vehicle?.licensePlate ?? "—"} · {p.session?.spot?.label ?? "—"} · {fmtDate(p.createdAt)}
                      </div>
                    </div>

                    {/* Deep links — Stripe for new rows, QB for legacy */}
                    {!mobile && (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 10 }}>
                        {real && stripeUrl && (
                          <a href={stripeUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#635BFF", textDecoration: "none", whiteSpace: "nowrap" }}>
                            Stripe ↗
                          </a>
                        )}
                        {real && stripeCustId && (
                          <a href={stripeLinks.customer(stripeCustId)} target="_blank" rel="noopener noreferrer" style={{ color: "#635BFF", textDecoration: "none", whiteSpace: "nowrap" }}>
                            Customer ↗
                          </a>
                        )}
                        {real && p.stripeRefundId && (
                          <a href={stripeLinks.refund(p.stripeRefundId)} target="_blank" rel="noopener noreferrer" style={{ color: "#F59E0B", textDecoration: "none", whiteSpace: "nowrap" }}>
                            Refund ↗
                          </a>
                        )}
                        {real && !stripeUrl && p.legacyQbReference && (
                          <a href={qbLinks.invoice(p.legacyQbReference)} target="_blank" rel="noopener noreferrer" style={{ color: "#60A5FA", textDecoration: "none", whiteSpace: "nowrap" }}>
                            QB (legacy) ↗
                          </a>
                        )}
                        {!real && (
                          <span style={{ color: FG_DIM }}>
                            {p.legacyQbReference?.startsWith("free_") ? "Free" : "Test"}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Amount */}
                    <div style={{ textAlign: "right" }}>
                      <div style={{
                        fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums",
                        color: isRefunded ? "#F59E0B" : p.type === "OVERSTAY" ? "#DC2626" : FG,
                        textDecoration: isRefunded ? "line-through" : undefined,
                      }}>
                        ${p.amount.toFixed(2)}
                      </div>
                      {p.refundedAmount > 0 && (
                        <div style={{ fontSize: 10, color: "#F59E0B" }}>
                          -${p.refundedAmount.toFixed(2)} refunded
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Mobile actions row */}
                  {mobile && real && (
                    <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 10 }}>
                      {stripeUrl && <a href={stripeUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#635BFF", textDecoration: "none" }}>Stripe ↗</a>}
                      {stripeCustId && <a href={stripeLinks.customer(stripeCustId)} target="_blank" rel="noopener noreferrer" style={{ color: "#635BFF", textDecoration: "none" }}>Customer ↗</a>}
                      {p.stripeRefundId && <a href={stripeLinks.refund(p.stripeRefundId)} target="_blank" rel="noopener noreferrer" style={{ color: "#F59E0B", textDecoration: "none" }}>Refund ↗</a>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Unmatched QB payments */}
          {unmatchedQB.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#F59E0B", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                Unmatched QuickBooks Payments
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {unmatchedQB.map((qb) => (
                  <div key={qb.id} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 14px", background: "#2A1F0A", borderRadius: 8, border: "1px solid #F59E0B30",
                    gap: 12,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "#F59E0B", fontWeight: 600 }}>{qb.customerName}</div>
                      <div style={{ fontSize: 11, color: FG_DIM }}>{qb.date} · {qb.method}</div>
                    </div>
                    <a
                      href={qbLinks.payment(qb.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 11, color: "#60A5FA", textDecoration: "none", whiteSpace: "nowrap" }}
                    >
                      View in QB ↗
                    </a>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#F59E0B", fontVariantNumeric: "tabular-nums" }}>
                      ${qb.amount.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pagination */}
          {total > LIMIT && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
              <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} style={paginationBtn(offset === 0, mobile)}>← Newer</button>
              <span style={{ fontSize: 11, color: FG_DIM }}>{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
              <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= total} style={paginationBtn(offset + LIMIT >= total, mobile)}>Older →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function QBConnectionStatus() {
  const [status, setStatus] = useState<"loading" | "connected" | "disconnected">("loading");
  const [realmId, setRealmId] = useState("");
  const [tokenExpiringSoon, setTokenExpiringSoon] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => {
      if (d.settings?.qbConnected) {
        setStatus("connected");
        setRealmId(d.settings.qbRealmId ?? "");
        setTokenExpiringSoon(d.settings.qbTokenExpiringSoon ?? false);
      } else {
        setStatus("disconnected");
      }
    }).catch(() => setStatus("disconnected"));

    // Check URL params for connection result
    const params = new URLSearchParams(window.location.search);
    if (params.get("qb_connected") === "true") {
      setStatus("connected");
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("qb_error")) {
      alert(`QuickBooks connection failed: ${params.get("qb_error")}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  if (status === "loading") {
    return <div style={{ fontSize: 12, color: FG_DIM }}>Checking connection…</div>;
  }

  if (status === "connected") {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#2D7A4A" }} />
          <span style={{ fontSize: 13, color: "#2D7A4A", fontWeight: 600 }}>Connected</span>
        </div>
        <div style={{ fontSize: 11, color: FG_DIM }}>
          Company ID: {realmId}
        </div>
        {tokenExpiringSoon && (
          <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 6, background: "#3D2800", border: "1px solid #C07000", fontSize: 12, color: "#FFAB00" }}>
            ⚠ QB token expires within 14 days — reconnect soon to avoid payment failures.
          </div>
        )}
        <button
          onClick={() => window.location.href = "/api/admin/qb-auth"}
          style={{ marginTop: 10, padding: "6px 14px", borderRadius: 6, border: `1px solid ${BORDER}`, background: "transparent", color: FG_MUTED, fontSize: 12, cursor: "pointer" }}
        >
          Reconnect
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: FG_MUTED, marginBottom: 12 }}>
        Connect your QuickBooks account to process payments. Drivers can pay with Apple Pay, PayPal, Venmo, or card.
      </div>
      <button
        onClick={() => window.location.href = "/api/admin/qb-auth"}
        style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#2CA01C", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
      >
        Connect to QuickBooks
      </button>
    </div>
  );
}

function AllowListManager({ mobile }: { mobile: boolean }) {
  type Entry = { id: string; phone: string; name: string; label: string; active: boolean };
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [addName, setAddName] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addLabel, setAddLabel] = useState<"EMPLOYEE" | "FAMILY" | "VENDOR" | "CONTRACTOR">("EMPLOYEE");

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/allowlist").then((r) => r.json())
      .then((d) => setEntries(d.entries ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  async function handleAdd() {
    if (!addName.trim() || !addPhone.trim()) return;
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/allowlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: addName, phone: addPhone, label: addLabel }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Add failed" }));
        setFeedback({ msg: body.error ?? "Add failed", ok: false });
        return;
      }
      setAddName(""); setAddPhone(""); setAddLabel("EMPLOYEE");
      setFeedback({ msg: "Added", ok: true });
      load();
    } catch {
      setFeedback({ msg: "Network error — try again", ok: false });
    }
  }

  async function handleToggle(id: string, active: boolean) {
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/allowlist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, active: !active }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Update failed" }));
        setFeedback({ msg: body.error ?? "Update failed", ok: false });
        return;
      }
      load();
    } catch {
      setFeedback({ msg: "Network error — try again", ok: false });
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this person from the allow list?")) return;
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/allowlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Delete failed" }));
        setFeedback({ msg: body.error ?? "Delete failed", ok: false });
        return;
      }
      setFeedback({ msg: "Removed", ok: true });
      load();
    } catch {
      setFeedback({ msg: "Network error — try again", ok: false });
    }
  }

  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: FG_DIM, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 16 }}>
        Allow List (Employees, Family, etc.)
      </div>

      {feedback && (
        <p style={{ fontSize: 12, color: feedback.ok ? "#30D158" : "#EF4444", marginBottom: 12 }}>
          {feedback.msg}
        </p>
      )}

      {/* Add form */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <input placeholder="Name" value={addName} onChange={(e) => setAddName(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 120 }} />
        <input placeholder="Phone" value={addPhone} onChange={(e) => setAddPhone(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 120 }} />
        <select value={addLabel} onChange={(e) => setAddLabel(e.target.value as typeof addLabel)} style={{ ...inputStyle, width: mobile ? "100%" : 130 }}>
          <option value="EMPLOYEE">Employee</option>
          <option value="FAMILY">Family</option>
          <option value="VENDOR">Vendor</option>
          <option value="CONTRACTOR">Contractor</option>
        </select>
        <button onClick={handleAdd} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#2D7A4A", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
          Add
        </button>
      </div>

      {/* List */}
      {loading ? (
        <p style={{ color: FG_DIM, fontSize: 13 }}>Loading…</p>
      ) : entries.length === 0 ? (
        <p style={{ color: FG_DIM, fontSize: 13 }}>No entries. Add employees or family above.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {entries.map((e) => (
            <div
              key={e.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                background: CARD_BG,
                borderRadius: 8,
                opacity: e.active ? 1 : 0.5,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: FG }}>{e.name}</div>
                <div style={{ fontSize: 11, color: FG_DIM }}>{e.phone} · {e.label.charAt(0) + e.label.slice(1).toLowerCase()}</div>
              </div>
              <button
                onClick={() => handleToggle(e.id, e.active)}
                style={{ padding: "4px 10px", borderRadius: 4, border: `1px solid ${BORDER}`, background: "transparent", color: e.active ? "#2D7A4A" : FG_DIM, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
              >
                {e.active ? "Active" : "Disabled"}
              </button>
              <button
                onClick={() => handleDelete(e.id)}
                style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #DC262640", background: "transparent", color: "#DC2626", fontSize: 11, cursor: "pointer" }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: FG_DIM, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ fontSize: 12, marginBottom: 4 }}>
      <span style={{ color: FG_DIM }}>{label}: </span>
      <span style={{ color: FG }}>{value}</span>
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: CARD_BG, borderRadius: RADIUS, padding: "18px 20px", border: `1px solid ${BORDER}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: FG_DIM, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {children}
      </div>
    </div>
  );
}

function SettingsField({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: string }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: FG_DIM, display: "block", marginBottom: 4 }}>{label}</label>
      <input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={inputStyle} />
    </div>
  );
}

