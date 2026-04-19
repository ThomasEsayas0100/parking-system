"use client";

import React, { useEffect, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import type { AppSettings } from "@/types/domain";
import { hourlyRate } from "@/lib/rates";

// ─── Types ────────────────────────────────────────────────────────────────────

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
    type: string;
    amount: number;
    hours: number | null;
    createdAt: string;
    stripePaymentIntentId?: string | null;
    refundedAmount?: number;
    status?: string;
  }[];
};

type Props = {
  session: SessionRow;
  settings: AppSettings | null;
  onClose: () => void;
  onSuccess: () => void;
};

type Tab = "adjust" | "refund";

// ─── Constants ────────────────────────────────────────────────────────────────

const SNAP_MINS = 15;
const ACCENT = "#2D7A4A";
const DANGER = "#DC2626";
const BORDER = "#E5E5EA";
const FG = "#1C1C1E";
const MUTED = "#636366";
const CARD_BG = "#FFFFFF";
const INPUT_BG = "#F2F2F7";

// ─── Time options (every 15 min, 12-hour) ────────────────────────────────────

const TIME_OPTIONS: { value: string; label: string }[] = (() => {
  const opts = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += SNAP_MINS) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const ampm = h < 12 ? "AM" : "PM";
      const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const label = `${displayH}:${String(m).padStart(2, "0")} ${ampm}`;
      opts.push({ value, label });
    }
  }
  return opts;
})();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

function snapToQuarter(d: Date): Date {
  return new Date(Math.round(d.getTime() / (SNAP_MINS * 60_000)) * (SNAP_MINS * 60_000));
}

function toDateParts(d: Date): { date: Date; time: string } {
  const snapped = snapToQuarter(d);
  return {
    date: new Date(snapped.getFullYear(), snapped.getMonth(), snapped.getDate()),
    time: `${pad(snapped.getHours())}:${pad(snapped.getMinutes())}`,
  };
}

function combineDateAndTime(date: Date, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m);
}

function fmtShortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtTime(time: string): string {
  return TIME_OPTIONS.find((o) => o.value === time)?.label ?? time;
}

function fmtDateTime(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtDuration(mins: number): string {
  const total = Math.round(mins);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function snapCost(settings: AppSettings | null, vehicleType: "BOBTAIL" | "TRUCK_TRAILER", durationMins: number): number {
  if (!settings) return 0;
  const blocks = Math.ceil(Math.max(0, durationMins) / SNAP_MINS);
  return blocks * (hourlyRate(settings, vehicleType) / 4);
}

function refundablePayments(payments: SessionRow["payments"]) {
  return payments.filter(
    (p) =>
      (p.type === "CHECKIN" || p.type === "EXTENSION") &&
      (p.status === "COMPLETED" || p.status === "PARTIALLY_REFUNDED") &&
      p.stripePaymentIntentId,
  );
}

function totalPaid(payments: SessionRow["payments"]): number {
  return refundablePayments(payments).reduce((s, p) => s + p.amount - (p.refundedAmount ?? 0), 0);
}

function hasMonthly(payments: SessionRow["payments"]): boolean {
  return payments.some((p) => p.type === "MONTHLY_CHECKIN");
}

// ─── DateTimePicker ───────────────────────────────────────────────────────────

function DateTimePicker({
  value,
  onChange,
  invalid,
}: {
  value: Date;
  onChange: (d: Date) => void;
  invalid?: boolean;
}) {
  const [calOpen, setCalOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const calRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);

  const { date: selectedDate, time: selectedTime } = toDateParts(value);

  // Close dropdowns on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (calRef.current && !calRef.current.contains(e.target as Node)) setCalOpen(false);
      if (timeRef.current && !timeRef.current.contains(e.target as Node)) setTimeOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Scroll selected time into view when list opens
  const timeListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!timeOpen || !timeListRef.current) return;
    const active = timeListRef.current.querySelector("[data-selected='true']") as HTMLElement | null;
    active?.scrollIntoView({ block: "center" });
  }, [timeOpen]);

  const chipStyle = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 5,
    padding: "5px 10px", borderRadius: 6,
    border: `1px solid ${invalid ? DANGER : active ? ACCENT : BORDER}`,
    background: active ? ACCENT + "10" : CARD_BG,
    color: active ? ACCENT : FG,
    fontSize: 12, fontWeight: 500,
    cursor: "pointer", userSelect: "none",
    whiteSpace: "nowrap",
  });

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {/* Date chip + calendar popover */}
      <div ref={calRef} style={{ position: "relative" }}>
        <div onClick={() => { setCalOpen((v) => !v); setTimeOpen(false); }} style={chipStyle(calOpen)}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="3" width="14" height="12" rx="1.5" />
            <path d="M1 7h14M5 1v4M11 1v4" />
          </svg>
          {fmtShortDate(selectedDate)}
        </div>
        {calOpen && (
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 300,
            background: CARD_BG, border: `1px solid ${BORDER}`,
            borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            padding: "4px 4px 8px",
          }}>
            <DayPicker
              mode="single"
              selected={selectedDate}
              defaultMonth={selectedDate}
              onSelect={(d) => {
                if (!d) return;
                onChange(combineDateAndTime(d, selectedTime));
                setCalOpen(false);
              }}
              styles={{
                root: { fontFamily: "var(--font-body)", fontSize: 12, margin: 0 },
                month_caption: { fontSize: 12, fontWeight: 600, color: FG },
                nav: {},
                weekday: { color: MUTED, fontSize: 11, fontWeight: 500 },
                day: { width: 30, height: 30, borderRadius: 6 },
              }}
              modifiersStyles={{
                selected: { background: ACCENT, color: "#fff", fontWeight: 600 },
                today: { color: ACCENT, fontWeight: 700 },
              }}
            />
          </div>
        )}
      </div>

      {/* Time chip + scrollable list */}
      <div ref={timeRef} style={{ position: "relative" }}>
        <div onClick={() => { setTimeOpen((v) => !v); setCalOpen(false); }} style={chipStyle(timeOpen)}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="6.5" />
            <path d="M8 5v3.5L10.5 10" strokeLinecap="round" />
          </svg>
          {fmtTime(selectedTime)}
        </div>
        {timeOpen && (
          <div
            ref={timeListRef}
            style={{
              position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 300,
              background: CARD_BG, border: `1px solid ${BORDER}`,
              borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              overflowY: "auto", maxHeight: 220, minWidth: 120,
              padding: "4px 0",
            }}
          >
            {TIME_OPTIONS.map((opt) => {
              const isSelected = opt.value === selectedTime;
              return (
                <div
                  key={opt.value}
                  data-selected={isSelected}
                  onClick={() => {
                    onChange(combineDateAndTime(selectedDate, opt.value));
                    setTimeOpen(false);
                  }}
                  style={{
                    padding: "6px 14px", fontSize: 12, cursor: "pointer",
                    background: isSelected ? ACCENT : "transparent",
                    color: isSelected ? "#fff" : FG,
                    fontWeight: isSelected ? 600 : 400,
                  }}
                >
                  {opt.label}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Shared row ───────────────────────────────────────────────────────────────

function SessionRow_({
  label,
  start,
  end,
  durationMins,
  endPicker,
}: {
  label: string;
  start: Date;
  end?: Date;
  durationMins?: number;
  endPicker?: React.ReactNode;
}) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "56px 1fr 1fr 70px",
      gap: "0 10px",
      alignItems: "center",
      padding: "12px 0",
    }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <span style={{ fontSize: 12, color: FG }}>{fmtDateTime(start)}</span>
      {endPicker ?? <span style={{ fontSize: 12, color: FG }}>{end ? fmtDateTime(end) : "—"}</span>}
      <span style={{ fontSize: 12, color: MUTED, textAlign: "right" }}>
        {durationMins != null ? fmtDuration(Math.max(0, durationMins)) : "—"}
      </span>
    </div>
  );
}

// ─── Tab: Adjust & Refund ─────────────────────────────────────────────────────

function AdjustTab({
  session,
  settings,
  onSubmit,
  loading,
}: {
  session: SessionRow;
  settings: AppSettings | null;
  onSubmit: (effectiveEnd: Date, refundAmount: number) => void;
  loading: boolean;
}) {
  const startedAt = new Date(session.startedAt);
  const originalEnd = new Date(session.expectedEnd);
  const originalMins = (originalEnd.getTime() - startedAt.getTime()) / 60_000;

  const defaultEnd = session.endedAt ? new Date(session.endedAt) : originalEnd;
  const [newEnd, setNewEnd] = useState<Date>(snapToQuarter(defaultEnd));

  const newMins = (newEnd.getTime() - startedAt.getTime()) / 60_000;
  const isLonger = newEnd > originalEnd;
  const paid = totalPaid(session.payments);
  const monthly = hasMonthly(session.payments);
  const recomputedCharge = snapCost(settings, session.vehicle.type, newMins);
  const refund = Math.max(0, Math.round((paid - recomputedCharge) * 100) / 100);
  const canSubmit = newEnd > startedAt && !isLonger && !loading;

  return (
    <div>
      {monthly && (
        <div style={{
          fontSize: 11, color: "#92400E", background: "#FEF3C7",
          border: "1px solid #D97706", borderRadius: 6, padding: "8px 12px", marginBottom: 16,
        }}>
          Monthly subscription excluded from refund calculation.
        </div>
      )}

      {/* Column headers */}
      <div style={{
        display: "grid", gridTemplateColumns: "56px 1fr 1fr 70px", gap: "0 10px",
        paddingBottom: 8, borderBottom: `1px solid ${BORDER}`, marginBottom: 4,
      }}>
        {["", "Start", "End", "Duration"].map((h, i) => (
          <span key={h} style={{
            fontSize: 10, fontWeight: 600, color: MUTED,
            textTransform: "uppercase", letterSpacing: "0.05em",
            textAlign: i === 3 ? "right" : "left",
          }}>{h}</span>
        ))}
      </div>

      <SessionRow_ label="Original" start={startedAt} end={originalEnd} durationMins={originalMins} />
      <div style={{ borderBottom: `1px solid ${BORDER}`, margin: "2px 0" }} />
      <SessionRow_
        label="Adjusted"
        start={startedAt}
        durationMins={newMins}
        endPicker={<DateTimePicker value={newEnd} onChange={setNewEnd} invalid={isLonger} />}
      />

      {isLonger && (
        <div style={{
          fontSize: 11, color: "#991B1B", background: "#FEE2E2",
          border: "1px solid #DC2626", borderRadius: 6, padding: "8px 12px", marginTop: 12,
        }}>
          New end is later than original — use <strong>Extend Time</strong> on the driver's session instead.
        </div>
      )}

      {!isLonger && (
        <div style={{
          background: INPUT_BG, borderRadius: 8, padding: "14px 16px", fontSize: 13, marginTop: 20,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ color: MUTED }}>Original charge (paid)</span>
            <span style={{ fontWeight: 600, color: FG }}>${paid.toFixed(2)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ color: MUTED }}>Recomputed charge</span>
            <span style={{ fontWeight: 600, color: FG }}>${recomputedCharge.toFixed(2)}</span>
          </div>
          <div style={{
            display: "flex", justifyContent: "space-between",
            paddingTop: 6, borderTop: `1px solid ${BORDER}`,
          }}>
            <span style={{ fontWeight: 600, color: refund > 0 ? DANGER : MUTED }}>
              {refund > 0 ? "Refund" : "No refund"}
            </span>
            <span style={{ fontWeight: 700, color: refund > 0 ? DANGER : MUTED }}>
              {refund > 0 ? `$${refund.toFixed(2)}` : "—"}
            </span>
          </div>
        </div>
      )}

      {session.status === "OVERSTAY" && (
        <p style={{ fontSize: 11, color: MUTED, marginTop: 10 }}>
          Looking for overstay payment?{" "}
          <a href="#payments" style={{ color: ACCENT }}>Go to Payments tab ↗</a>
        </p>
      )}

      <button
        onClick={() => canSubmit && onSubmit(newEnd, refund)}
        disabled={!canSubmit}
        style={{
          width: "100%", padding: "12px 0", borderRadius: 8, border: "none",
          background: canSubmit ? ACCENT : "#C7C7CC",
          color: "#fff", fontSize: 14, fontWeight: 600,
          cursor: canSubmit ? "pointer" : "not-allowed",
          marginTop: 20,
        }}
      >
        {loading ? "Saving…" : refund > 0 ? `Apply & Refund $${refund.toFixed(2)}` : "Apply New End Time"}
      </button>
    </div>
  );
}

// ─── Tab: Refund by $ ─────────────────────────────────────────────────────────

function RefundTab({
  session,
  onSubmit,
  loading,
}: {
  session: SessionRow;
  onSubmit: (refundAmount: number, voidSession: boolean) => void;
  loading: boolean;
}) {
  const paid = totalPaid(session.payments);
  const monthly = hasMonthly(session.payments);
  const [amount, setAmount] = useState("");
  const [voidSession, setVoidSession] = useState(false);
  const isActive = session.status === "ACTIVE" || session.status === "OVERSTAY";

  const parsed = parseFloat(amount);
  const valid = !isNaN(parsed) && parsed > 0.005 && parsed <= paid + 0.001;

  return (
    <div>
      {monthly && (
        <div style={{
          fontSize: 11, color: "#92400E", background: "#FEF3C7",
          border: "1px solid #D97706", borderRadius: 6, padding: "8px 12px", marginBottom: 16,
        }}>
          Monthly subscription excluded from refund.
        </div>
      )}

      {paid <= 0 ? (
        <p style={{ fontSize: 13, color: MUTED, textAlign: "center", marginTop: 24 }}>No refundable payments.</p>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: MUTED }}>Max refundable</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: FG }}>${paid.toFixed(2)}</span>
              <button
                onClick={() => setAmount(paid.toFixed(2))}
                style={{
                  fontSize: 11, padding: "3px 8px", borderRadius: 4,
                  border: `1px solid ${BORDER}`, background: "transparent",
                  color: MUTED, cursor: "pointer",
                }}
              >
                Full
              </button>
            </div>
          </div>

          <div style={{ position: "relative", marginBottom: 16 }}>
            <span style={{
              position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
              fontSize: 14, color: MUTED,
            }}>$</span>
            <input
              type="number"
              min="0.01"
              max={paid}
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
              style={{
                width: "100%", padding: "9px 10px 9px 24px", fontSize: 14,
                border: `1px solid ${BORDER}`, borderRadius: 6,
                background: CARD_BG, color: FG, outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {isActive && (
            <label style={{
              display: "flex", alignItems: "center", gap: 8,
              fontSize: 13, color: FG, cursor: "pointer", marginBottom: 16,
            }}>
              <input
                type="checkbox"
                checked={voidSession}
                onChange={(e) => setVoidSession(e.target.checked)}
                style={{ width: 15, height: 15, accentColor: DANGER, cursor: "pointer" }}
              />
              Void active session?
            </label>
          )}

          <button
            onClick={() => valid && onSubmit(parsed, voidSession)}
            disabled={loading || !valid}
            style={{
              width: "100%", padding: "12px 0", borderRadius: 8, border: "none",
              background: loading || !valid ? "#C7C7CC" : DANGER,
              color: "#fff", fontSize: 14, fontWeight: 600,
              cursor: loading || !valid ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Refunding…" : valid ? `Refund $${parsed.toFixed(2)}` : "Enter an amount"}
          </button>
        </>
      )}
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export default function ManageSessionModal({ session, settings, onClose, onSuccess }: Props) {
  const [tab, setTab] = useState<Tab>("adjust");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function callAdjust(effectiveEnd?: Date, refundAmount?: number) {
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { sessionId: session.id, action: "adjust" };
      if (effectiveEnd) body.effectiveEnd = effectiveEnd.toISOString();
      if (refundAmount && refundAmount > 0.005) body.refundAmount = refundAmount;

      const res = await fetch("/api/admin/sessions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Request failed");
      }
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
    }
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "adjust", label: "Adjust & Refund" },
    { key: "refund", label: "Refund by $" },
  ];

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.4)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: CARD_BG, borderRadius: 12,
        width: "calc(100vw - 32px)", maxWidth: 960,
        height: "calc(100vh - 32px)", overflow: "hidden",
        display: "flex", flexDirection: "column",
        fontFamily: "var(--font-body)",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px", borderBottom: `1px solid ${BORDER}`, flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: FG }}>
              Manage Session — {session.spot.label}
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>
              {session.driver.name} · {session.vehicle.type === "TRUCK_TRAILER" ? "Truck + Trailer" : "Bobtail"}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", fontSize: 20, color: MUTED, cursor: "pointer", lineHeight: 1, padding: "0 4px" }}
          >
            &times;
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setError(null); }}
              style={{
                flex: "1 1 0", padding: "12px 0",
                fontSize: 12, fontWeight: tab === t.key ? 600 : 400,
                color: tab === t.key ? ACCENT : MUTED,
                background: "transparent", border: "none",
                borderBottom: tab === t.key ? `2px solid ${ACCENT}` : "2px solid transparent",
                cursor: "pointer", fontFamily: "var(--font-body)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          {error && (
            <div style={{
              fontSize: 11, color: "#991B1B", background: "#FEE2E2",
              border: "1px solid #DC2626", borderRadius: 6, padding: "8px 12px", marginBottom: 16,
            }}>
              {error}
            </div>
          )}

          {tab === "adjust" && (
            <AdjustTab
              session={session}
              settings={settings}
              onSubmit={(end, refund) => callAdjust(end, refund)}
              loading={loading}
            />
          )}

          {tab === "refund" && (
            <RefundTab
              session={session}
              onSubmit={(refund, shouldVoid) => callAdjust(shouldVoid ? new Date() : undefined, refund)}
              loading={loading}
            />
          )}
        </div>
      </div>
    </div>
  );
}
