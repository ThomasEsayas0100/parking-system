"use client";

import { useEffect, useState, useCallback, useMemo } from "react";

import type { ApiSpotWithSessions, ApiAuditEntry, AppSettings, SpotLayout, LotSpotStatus, LotSpotDetail } from "@/types/domain";
import { apiFetch } from "@/lib/fetch";
import { useIsMobile } from "@/lib/hooks";
import LotMapViewer, { countStatuses } from "@/components/lot/LotMapViewer";
import { useEditorReducer } from "@/components/lot/editor/useEditorReducer";
import SpotDetailPanel from "@/app/lot/SpotDetailPanel";

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
  { key: "SECURITY", label: "Security", actions: ["SUSPICIOUS_ENTRY", "GATE_DENIED"] },
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

// ---------------------------------------------------------------------------
// Shared inline style constants
// ---------------------------------------------------------------------------
const DARK_BG = "#1C1C1E";
const CARD_BG = "#2C2C2E";
const BORDER = "#3A3A3C";
const FG = "#F5F5F7";
const FG_MUTED = "#8E8E93";
const FG_DIM = "#636366";
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
  const [tab, setTab] = useState<"overview" | "sessions" | "log" | "settings">("overview");
  const [overrideSpotId, setOverrideSpotId] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

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
  }, [tab, loadSessions]);

  useEffect(() => {
    if (tab === "log") loadLog(logFilter, logOffset);
  }, [tab, logFilter, logOffset, loadLog]);

  // Reset offset when filters change
  useEffect(() => { setSessOffset(0); }, [sessSearch, sessStatus]);

  // ── Derived state ──
  const lotStatuses = useMemo<Record<string, LotSpotStatus>>(() => {
    const map: Record<string, LotSpotStatus> = {};
    for (const spot of spots) {
      const session = spot.sessions?.[0];
      if (!session) map[spot.label] = "VACANT";
      else if (session.status === "OVERSTAY") map[spot.label] = "OVERDUE";
      else map[spot.label] = "RESERVED";
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
  async function handleSeedSpots() {
    const res = await fetch("/api/spots/seed", { method: "POST" });
    if (res.ok) loadData();
    else { const d = await res.json(); alert(d.error || "Failed to seed spots"); }
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

  // ═════════════════════════════════════════════════════════════════════════
  // Render
  // ═════════════════════════════════════════════════════════════════════════
  const tabs: { key: typeof tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "sessions", label: "Sessions" },
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

              {spots.length === 0 && (
                <button onClick={handleSeedSpots} style={{ padding: "8px 16px", background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 6, color: FG, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  Seed Spots
                </button>
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
                                    {p.type === "CHECKIN" ? "Check-in" : p.type === "EXTENSION" ? "Extension" : "Overstay"}
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
              <button type="submit" style={{ padding: "12px 24px", background: FG, color: DARK_BG, border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", alignSelf: "flex-start" }}>
                Save Settings
              </button>
            </form>
          </div>
        )}

      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

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

