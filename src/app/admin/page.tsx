"use client";

import { useEffect, useState, useCallback } from "react";

import type { ApiSpotWithSessions, ApiAuditEntry, AppSettings } from "@/types/domain";
import { apiFetch } from "@/lib/fetch";

type Spot = ApiSpotWithSessions;
type AuditEntry = ApiAuditEntry;
type Settings = AppSettings;

type LogFilter = "ALL" | "ENTRY" | "EXIT" | "EXTEND" | "OVERSTAY" | "GATE" | "ADMIN" | "NOTIFICATION";

const LOG_CATEGORIES: { key: LogFilter; label: string; actions: string[] }[] = [
  { key: "ALL", label: "All", actions: [] },
  { key: "ENTRY", label: "Entry", actions: ["CHECKIN"] },
  { key: "EXIT", label: "Exit", actions: ["CHECKOUT"] },
  { key: "EXTEND", label: "Extension", actions: ["EXTEND"] },
  { key: "OVERSTAY", label: "Overstay", actions: ["OVERSTAY_START", "OVERSTAY_PAYMENT"] },
  { key: "GATE", label: "Gate", actions: ["GATE_OPEN"] },
  { key: "ADMIN", label: "Admin", actions: ["SPOT_FREED"] },
  { key: "NOTIFICATION", label: "Notification", actions: ["REMINDER_SENT", "OVERSTAY_ALERT"] },
];

const ACTION_BADGE: Record<string, { color: string; bg: string; label: string }> = {
  CHECKIN:          { color: "#34C759", bg: "#12261C", label: "Check-in" },
  CHECKOUT:         { color: "#0A84FF", bg: "#0A1A30", label: "Check-out" },
  EXTEND:           { color: "#F59E0B", bg: "#2A1F0A", label: "Extension" },
  OVERSTAY_START:   { color: "#DC2626", bg: "#2C1810", label: "Overstay" },
  OVERSTAY_PAYMENT: { color: "#EF4444", bg: "#2C1810", label: "Overstay paid" },
  GATE_OPEN:        { color: "#8E8E93", bg: "#2C2C2E", label: "Gate" },
  SPOT_FREED:       { color: "#D4500A", bg: "#2A1508", label: "Override" },
  REMINDER_SENT:    { color: "#14B8A6", bg: "#0A2421", label: "Reminder" },
  OVERSTAY_ALERT:   { color: "#F87171", bg: "#2C1810", label: "Alert" },
};

export default function AdminDashboard() {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsForm, setSettingsForm] = useState<Settings | null>(null);
  const [tab, setTab] = useState<"overview" | "log" | "settings">("overview");
  const [overrideSpotId, setOverrideSpotId] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  // Log tab state
  const [logEntries, setLogEntries] = useState<AuditEntry[]>([]);
  const [logFilter, setLogFilter] = useState<LogFilter>("ALL");
  const [logOffset, setLogOffset] = useState(0);
  const [logTotal, setLogTotal] = useState(0);
  const [logLoading, setLogLoading] = useState(false);
  const LOG_LIMIT = 30;

  const loadData = useCallback(() => {
    fetch("/api/spots").then((r) => r.json()).then((d) => setSpots(d.spots || []));
    fetch("/api/settings").then((r) => r.json()).then((d) => {
      setSettings(d.settings);
      setSettingsForm(d.settings);
    });
  }, []);

  const loadLog = useCallback((filter: LogFilter, offset: number) => {
    setLogLoading(true);
    const category = LOG_CATEGORIES.find((c) => c.key === filter);
    const actionParam = category && category.actions.length === 1 ? `&action=${category.actions[0]}` : "";
    apiFetch<{ logs: AuditEntry[]; total: number }>(
      `/api/audit?limit=${LOG_LIMIT}&offset=${offset}${actionParam}`
    )
      .then((d) => {
        let filtered = d.logs;
        // Client-side filter for multi-action categories (OVERSTAY, NOTIFICATION)
        if (category && category.actions.length > 1) {
          filtered = d.logs.filter((l) => category.actions.includes(l.action));
        }
        setLogEntries(filtered);
        setLogTotal(d.total);
      })
      .catch(() => setLogEntries([]))
      .finally(() => setLogLoading(false));
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    if (tab === "log") loadLog(logFilter, logOffset);
  }, [tab, logFilter, logOffset, loadLog]);

  const now = new Date();

  const occupiedSpots = spots.filter((s) => s.status === "OCCUPIED");
  const availableBobtail = spots.filter((s) => s.type === "BOBTAIL" && s.status === "AVAILABLE").length;
  const availableTruck = spots.filter((s) => s.type === "TRUCK_TRAILER" && s.status === "AVAILABLE").length;

  const overstayedSessions = occupiedSpots
    .flatMap((s) => s.sessions.map((sess) => ({ ...sess, spotLabel: s.label })))
    // Use status as primary signal; time-check catches sessions past expectedEnd
    // that haven't been marked by cron yet (within the grace period window)
    .filter((s) => s.status === "OVERSTAY" || new Date(s.expectedEnd) < now);

  async function handleSeedSpots() {
    const res = await fetch("/api/spots/seed", { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      loadData();
    } else {
      alert(data.error || "Failed to seed spots");
    }
  }

  async function handleOverride(spotId: string) {
    if (!overrideReason.trim()) {
      alert("Please provide a reason for the override.");
      return;
    }

    const res = await fetch("/api/admin/spots/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spotId, action: "free", reason: overrideReason }),
    });

    if (res.ok) {
      setOverrideSpotId(null);
      setOverrideReason("");
      loadData();
    } else {
      const data = await res.json();
      alert(data.error || "Override failed");
    }
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

  return (
    <div>
      <h1>Parking Admin</h1>

      <nav>
        <button onClick={() => setTab("overview")}>Overview</button>
        <button onClick={() => setTab("log")}>Log</button>
        <button onClick={() => setTab("settings")}>Settings</button>
      </nav>

      {tab === "overview" && (
        <div>
          <section>
            <h2>Lot Summary</h2>
            <div>
              <div>
                <strong>Bobtail</strong>
                <p>{availableBobtail} available</p>
              </div>
              <div>
                <strong>Truck/Trailer</strong>
                <p>{availableTruck} available</p>
              </div>
              <div>
                <strong>Occupied</strong>
                <p>{occupiedSpots.length} spots</p>
              </div>
              <div>
                <strong>Overstayed</strong>
                <p>{overstayedSessions.length} vehicles</p>
              </div>
            </div>

            {spots.length === 0 && (
              <div>
                <p>No spots found.</p>
                <button onClick={handleSeedSpots}>Seed Spots</button>
              </div>
            )}
          </section>

          {overstayedSessions.length > 0 && (
            <section>
              <h2>Overstayed Vehicles</h2>
              <table>
                <thead>
                  <tr>
                    <th>Spot</th>
                    <th>Driver</th>
                    <th>Phone</th>
                    <th>Plate</th>
                    <th>Expected End</th>
                    <th>Overstay</th>
                  </tr>
                </thead>
                <tbody>
                  {overstayedSessions.map((s) => {
                    const overMs = now.getTime() - new Date(s.expectedEnd).getTime();
                    const overHours = Math.ceil(overMs / (1000 * 60 * 60));
                    return (
                      <tr key={s.id}>
                        <td>{s.spotLabel}</td>
                        <td>{s.driver.name}</td>
                        <td>{s.driver.phone}</td>
                        <td>{s.vehicle.licensePlate}</td>
                        <td>{new Date(s.expectedEnd).toLocaleString()}</td>
                        <td>{overHours}h</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          <section>
            <h2>Active Sessions</h2>
            {occupiedSpots.length === 0 ? (
              <p>No active sessions.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Spot</th>
                    <th>Type</th>
                    <th>Driver</th>
                    <th>Phone</th>
                    <th>Plate</th>
                    <th>Started</th>
                    <th>Expires</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {occupiedSpots.flatMap((spot) =>
                    spot.sessions.map((s) => (
                      <tr key={s.id}>
                        <td>{spot.label}</td>
                        <td>{s.vehicle.type === "BOBTAIL" ? "Bobtail" : "Truck/Trailer"}</td>
                        <td>{s.driver.name}</td>
                        <td>{s.driver.phone}</td>
                        <td>{s.vehicle.licensePlate}</td>
                        <td>{new Date(s.startedAt).toLocaleString()}</td>
                        <td>{new Date(s.expectedEnd).toLocaleString()}</td>
                        <td>
                          {overrideSpotId === spot.id ? (
                            <span>
                              <input
                                type="text"
                                placeholder="Reason for override"
                                value={overrideReason}
                                onChange={(e) => setOverrideReason(e.target.value)}
                              />
                              <button onClick={() => handleOverride(spot.id)}>Confirm</button>
                              <button onClick={() => { setOverrideSpotId(null); setOverrideReason(""); }}>Cancel</button>
                            </span>
                          ) : (
                            <button onClick={() => setOverrideSpotId(spot.id)}>Free Spot</button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}

      {tab === "log" && (
        <div style={{ background: "#1C1C1E", minHeight: "60vh", borderRadius: 12, padding: "24px 20px" }}>
          {/* Filter chips */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
            {LOG_CATEGORIES.map((cat) => {
              const active = logFilter === cat.key;
              return (
                <button
                  key={cat.key}
                  onClick={() => { setLogFilter(cat.key); setLogOffset(0); }}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 20,
                    border: active ? "1px solid #F5F5F740" : "1px solid #3A3A3C",
                    background: active ? "#3A3A3C" : "transparent",
                    color: active ? "#F5F5F7" : "#8E8E93",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    letterSpacing: "0.02em",
                  }}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>

          {/* Log entries */}
          {logLoading ? (
            <p style={{ color: "#636366", fontSize: 13, textAlign: "center", padding: 40 }}>Loading…</p>
          ) : logEntries.length === 0 ? (
            <p style={{ color: "#636366", fontSize: 13, textAlign: "center", padding: 40 }}>No log entries.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {logEntries.map((entry) => {
                const badge = ACTION_BADGE[entry.action] || { color: "#8E8E93", bg: "#2C2C2E", label: entry.action };
                const ts = new Date(entry.createdAt);
                const timeStr = ts.toLocaleString("en-US", {
                  month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
                });
                return (
                  <div
                    key={entry.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      padding: "12px 14px",
                      borderRadius: 8,
                      background: "#2C2C2E",
                    }}
                  >
                    {/* Badge */}
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        padding: "3px 8px",
                        borderRadius: 4,
                        background: badge.bg,
                        color: badge.color,
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      {badge.label}
                    </span>

                    {/* Body */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "#F5F5F7", lineHeight: 1.4 }}>
                        {entry.details || "—"}
                      </div>
                      <div style={{ fontSize: 11, color: "#636366", marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
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

          {/* Pagination */}
          {logTotal > LOG_LIMIT && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, padding: "0 4px" }}>
              <button
                onClick={() => setLogOffset(Math.max(0, logOffset - LOG_LIMIT))}
                disabled={logOffset === 0}
                style={{
                  padding: "6px 16px", borderRadius: 6, border: "1px solid #3A3A3C",
                  background: logOffset === 0 ? "transparent" : "#2C2C2E",
                  color: logOffset === 0 ? "#3A3A3C" : "#F5F5F7",
                  fontSize: 12, fontWeight: 600, cursor: logOffset === 0 ? "default" : "pointer",
                }}
              >
                ← Newer
              </button>
              <span style={{ fontSize: 11, color: "#636366" }}>
                {logOffset + 1}–{Math.min(logOffset + LOG_LIMIT, logTotal)} of {logTotal}
              </span>
              <button
                onClick={() => setLogOffset(logOffset + LOG_LIMIT)}
                disabled={logOffset + LOG_LIMIT >= logTotal}
                style={{
                  padding: "6px 16px", borderRadius: 6, border: "1px solid #3A3A3C",
                  background: logOffset + LOG_LIMIT >= logTotal ? "transparent" : "#2C2C2E",
                  color: logOffset + LOG_LIMIT >= logTotal ? "#3A3A3C" : "#F5F5F7",
                  fontSize: 12, fontWeight: 600, cursor: logOffset + LOG_LIMIT >= logTotal ? "default" : "pointer",
                }}
              >
                Older →
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "settings" && settingsForm && (
        <div>
          <h2>Settings</h2>
          <form onSubmit={handleSaveSettings}>
            <fieldset>
              <legend>Hourly Rates</legend>
              <div>
                <label>Bobtail ($/hr)</label>
                <input
                  type="number"
                  step="0.01"
                  value={settingsForm.hourlyRateBobtail}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, hourlyRateBobtail: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <label>Truck/Trailer ($/hr)</label>
                <input
                  type="number"
                  step="0.01"
                  value={settingsForm.hourlyRateTruck}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, hourlyRateTruck: Number(e.target.value) })
                  }
                />
              </div>
            </fieldset>

            <fieldset>
              <legend>Overstay Rates (Premium)</legend>
              <div>
                <label>Bobtail ($/hr)</label>
                <input
                  type="number"
                  step="0.01"
                  value={settingsForm.overstayRateBobtail}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, overstayRateBobtail: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <label>Truck/Trailer ($/hr)</label>
                <input
                  type="number"
                  step="0.01"
                  value={settingsForm.overstayRateTruck}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, overstayRateTruck: Number(e.target.value) })
                  }
                />
              </div>
            </fieldset>

            <fieldset>
              <legend>Notifications</legend>
              <div>
                <label>Reminder before expiry (minutes)</label>
                <input
                  type="number"
                  value={settingsForm.reminderMinutesBefore}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, reminderMinutesBefore: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <label>Grace period before overstay alert (minutes)</label>
                <input
                  type="number"
                  value={settingsForm.gracePeriodMinutes}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, gracePeriodMinutes: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <label>Manager Email</label>
                <input
                  type="email"
                  value={settingsForm.managerEmail}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, managerEmail: e.target.value })
                  }
                />
              </div>
              <div>
                <label>Manager Phone</label>
                <input
                  type="tel"
                  value={settingsForm.managerPhone}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, managerPhone: e.target.value })
                  }
                />
              </div>
            </fieldset>

            <fieldset>
              <legend>Spot Configuration</legend>
              <div>
                <label>Total Bobtail Spots</label>
                <input
                  type="number"
                  value={settingsForm.totalSpotsBobtail}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, totalSpotsBobtail: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <label>Total Truck/Trailer Spots</label>
                <input
                  type="number"
                  value={settingsForm.totalSpotsTruck}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, totalSpotsTruck: Number(e.target.value) })
                  }
                />
              </div>
            </fieldset>

            <button type="submit">Save Settings</button>
          </form>
        </div>
      )}
    </div>
  );
}
