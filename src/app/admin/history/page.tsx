"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types (mirror the API response shape)
// ---------------------------------------------------------------------------
type SessionRow = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  expectedEnd: string;
  status: "ACTIVE" | "COMPLETED" | "OVERSTAY";
  driver: { id: string; name: string; email: string; phone: string };
  vehicle: {
    id: string;
    unitNumber: string | null;
    licensePlate: string | null;
    type: "BOBTAIL" | "TRUCK_TRAILER";
    nickname: string | null;
  };
  spot: { id: string; label: string; type: "BOBTAIL" | "TRUCK_TRAILER" };
  payments: {
    id: string;
    type: "CHECKIN" | "EXTENSION" | "OVERSTAY";
    amount: number;
    hours: number | null;
    createdAt: string;
  }[];
};

type HistoryResponse = {
  sessions: SessionRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

type StatusFilter = "" | "ACTIVE" | "COMPLETED" | "OVERSTAY";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function duration(start: string, end: string | null): string {
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  const mins = Math.round((b - a) / 60_000);
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return hrs > 0 ? `${hrs}h ${rem}m` : `${rem}m`;
}

function total(payments: SessionRow["payments"]): number {
  return payments.reduce((s, p) => s + p.amount, 0);
}

const STATUS_COLORS: Record<SessionRow["status"], string> = {
  ACTIVE: "#2D7A4A",
  COMPLETED: "#636366",
  OVERSTAY: "#DC2626",
};

const STATUS_BG: Record<SessionRow["status"], string> = {
  ACTIVE: "#12261C",
  COMPLETED: "#2C2C2E",
  OVERSTAY: "#2C1810",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function HistoryPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [limit] = useState(50);

  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (status) p.set("status", status);
    if (from) p.set("from", new Date(from).toISOString());
    if (to) p.set("to", new Date(to + "T23:59:59").toISOString());
    p.set("limit", String(limit));
    p.set("offset", String(offset));
    return p.toString();
  }, [q, status, from, to, limit, offset]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/sessions/history?${queryString}`)
      .then(async (r) => {
        if (!r.ok) {
          const b = await r.json().catch(() => ({}));
          throw new Error(b.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((d: HistoryResponse) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [queryString]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [q, status, from, to]);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#1C1C1E",
      fontFamily: "var(--font-body)",
      color: "#F5F5F7",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 20px",
        borderBottom: "1px solid #2C2C2E",
      }}>
        <h1 style={{
          fontSize: 16,
          fontWeight: 600,
          margin: 0,
          letterSpacing: "-0.01em",
        }}>
          Session History
        </h1>
        <a href="/admin" style={{
          fontSize: 11,
          color: "#98989D",
          textDecoration: "none",
          padding: "5px 12px",
          border: "1px solid #3A3A3C",
          borderRadius: 6,
        }}>
          ← Admin
        </a>
      </div>

      {/* Filters */}
      <div style={{
        padding: "14px 20px",
        borderBottom: "1px solid #2C2C2E",
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        alignItems: "center",
      }}>
        <input
          type="text"
          placeholder="Search by name, plate, phone, unit, or spot…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={inputStyle(280)}
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          style={inputStyle(140)}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="COMPLETED">Completed</option>
          <option value="OVERSTAY">Overstay</option>
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          style={inputStyle(140)}
          placeholder="From"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          style={inputStyle(140)}
          placeholder="To"
        />
        {(q || status || from || to) && (
          <button
            onClick={() => { setQ(""); setStatus(""); setFrom(""); setTo(""); }}
            style={{
              padding: "6px 12px",
              fontSize: 11,
              fontWeight: 500,
              border: "1px solid #3A3A3C",
              borderRadius: 6,
              background: "transparent",
              color: "#AEAEB2",
              cursor: "pointer",
              fontFamily: "var(--font-body)",
            }}
          >
            Clear
          </button>
        )}
        <div style={{ flex: 1 }} />
        {data && (
          <span style={{ fontSize: 11, color: "#636366" }}>
            {data.total.toLocaleString()} result{data.total === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Table */}
      <div style={{ padding: "0 20px" }}>
        {error && (
          <div style={{
            padding: "16px 0",
            color: "#DC2626",
            fontSize: 12,
          }}>
            Error: {error}
          </div>
        )}

        {loading && !data && (
          <div style={{ padding: "40px 0", color: "#636366", fontSize: 12 }}>
            Loading…
          </div>
        )}

        {data && data.sessions.length === 0 && !loading && (
          <div style={{ padding: "40px 0", color: "#636366", fontSize: 12 }}>
            No sessions match these filters.
          </div>
        )}

        {data && data.sessions.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12,
            }}>
              <thead>
                <tr style={{
                  textAlign: "left",
                  color: "#636366",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  fontWeight: 600,
                }}>
                  <th style={thStyle}>Spot</th>
                  <th style={thStyle}>Driver</th>
                  <th style={thStyle}>Vehicle</th>
                  <th style={thStyle}>Started</th>
                  <th style={thStyle}>Duration</th>
                  <th style={thStyle}>Status</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((s) => {
                  const isOpen = expanded === s.id;
                  return (
                    <Fragment key={s.id}>
                      <tr
                        onClick={() => setExpanded(isOpen ? null : s.id)}
                        style={{
                          cursor: "pointer",
                          borderTop: "1px solid #2C2C2E",
                          background: isOpen ? "#2C2C2E" : undefined,
                        }}
                      >
                        <td style={tdStyle}>
                          <span style={{ fontWeight: 600 }}>{s.spot.label}</span>
                        </td>
                        <td style={tdStyle}>
                          <div>{s.driver.name}</div>
                          <div style={{ fontSize: 10, color: "#636366" }}>{s.driver.phone}</div>
                        </td>
                        <td style={tdStyle}>
                          <div>{s.vehicle.licensePlate || "—"}</div>
                          <div style={{ fontSize: 10, color: "#636366" }}>
                            {s.vehicle.unitNumber ? `#${s.vehicle.unitNumber}` : ""}
                            {s.vehicle.nickname ? ` · ${s.vehicle.nickname}` : ""}
                          </div>
                        </td>
                        <td style={tdStyle}>
                          <div>{formatDateTime(s.startedAt)}</div>
                        </td>
                        <td style={tdStyle}>
                          {duration(s.startedAt, s.endedAt)}
                        </td>
                        <td style={tdStyle}>
                          <span style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: 4,
                            background: STATUS_BG[s.status],
                            color: STATUS_COLORS[s.status],
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                          }}>
                            {s.status}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                          ${total(s.payments).toFixed(2)}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr style={{ background: "#2C2C2E" }}>
                          <td colSpan={7} style={{ padding: "12px 12px 16px" }}>
                            <SessionDetail session={s} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data && data.total > limit && (
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 0",
            borderTop: "1px solid #2C2C2E",
            marginTop: 4,
            fontSize: 11,
            color: "#98989D",
          }}>
            <span>
              Showing {offset + 1}–{Math.min(offset + limit, data.total)} of {data.total}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0}
                style={pagerBtn(offset === 0)}
              >
                ← Previous
              </button>
              <button
                onClick={() => setOffset(offset + limit)}
                disabled={!data.hasMore}
                style={pagerBtn(!data.hasMore)}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row-detail sub-component
// ---------------------------------------------------------------------------
function SessionDetail({ session }: { session: SessionRow }) {
  return (
    <div style={{ display: "flex", gap: 32, fontSize: 11 }}>
      <div style={{ flex: 1 }}>
        <SectionTitle>Driver</SectionTitle>
        <DetailRow label="Name" value={session.driver.name} />
        <DetailRow label="Email" value={session.driver.email} />
        <DetailRow label="Phone" value={session.driver.phone} />
        <DetailRow label="Driver ID" value={session.driver.id.slice(0, 8) + "…"} mono />
      </div>
      <div style={{ flex: 1 }}>
        <SectionTitle>Vehicle</SectionTitle>
        <DetailRow label="Type" value={session.vehicle.type === "TRUCK_TRAILER" ? "Truck + Trailer" : "Bobtail"} />
        {session.vehicle.unitNumber && <DetailRow label="Truck #" value={session.vehicle.unitNumber} />}
        {session.vehicle.licensePlate && <DetailRow label="Plate" value={session.vehicle.licensePlate} />}
        {session.vehicle.nickname && <DetailRow label="Nickname" value={session.vehicle.nickname} />}
      </div>
      <div style={{ flex: 1 }}>
        <SectionTitle>Timing</SectionTitle>
        <DetailRow label="Started" value={formatDateTime(session.startedAt)} />
        <DetailRow label="Expected end" value={formatDateTime(session.expectedEnd)} />
        <DetailRow label="Ended" value={formatDateTime(session.endedAt)} />
        <DetailRow label="Duration" value={duration(session.startedAt, session.endedAt)} />
      </div>
      <div style={{ flex: 1.2 }}>
        <SectionTitle>Payments</SectionTitle>
        {session.payments.map((p) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "3px 0",
              color: p.type === "OVERSTAY" ? "#DC2626" : "#E5E5EA",
            }}
          >
            <span>
              {p.type === "CHECKIN" ? "Check-in" : p.type === "EXTENSION" ? "Extension" : "Overstay"}
              {p.hours ? ` (${p.hours}h)` : ""}
            </span>
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
              ${p.amount.toFixed(2)}
            </span>
          </div>
        ))}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "6px 0 0",
          marginTop: 4,
          borderTop: "1px solid #3A3A3C",
          fontWeight: 700,
        }}>
          <span>Total</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            ${total(session.payments).toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9,
      fontWeight: 600,
      color: "#48484A",
      textTransform: "uppercase",
      letterSpacing: "0.06em",
      marginBottom: 6,
    }}>
      {children}
    </div>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
      <span style={{ color: "#636366" }}>{label}</span>
      <span style={{
        color: "#E5E5EA",
        fontFamily: mono ? "monospace" : undefined,
      }}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------
const inputStyle = (width: number): React.CSSProperties => ({
  padding: "6px 10px",
  fontSize: 12,
  fontFamily: "var(--font-body)",
  background: "#2C2C2E",
  border: "1px solid #3A3A3C",
  borderRadius: 6,
  color: "#F5F5F7",
  outline: "none",
  width,
});

const thStyle: React.CSSProperties = {
  padding: "10px 12px 10px 0",
  fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px 10px 0",
  color: "#E5E5EA",
};

const pagerBtn = (disabled: boolean): React.CSSProperties => ({
  padding: "5px 12px",
  fontSize: 11,
  fontWeight: 500,
  border: "1px solid #3A3A3C",
  borderRadius: 6,
  background: "transparent",
  color: disabled ? "#48484A" : "#AEAEB2",
  cursor: disabled ? "not-allowed" : "pointer",
  fontFamily: "var(--font-body)",
});
