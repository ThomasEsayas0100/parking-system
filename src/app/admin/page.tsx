"use client";

import { useEffect, useState, useCallback } from "react";

type Spot = {
  id: string;
  label: string;
  type: string;
  status: string;
  sessions: {
    id: string;
    startedAt: string;
    expectedEnd: string;
    status: string;
    driver: { name: string; email: string; phone: string };
    vehicle: { licensePlate: string; type: string; nickname: string | null };
  }[];
};

type AuditEntry = {
  id: string;
  action: string;
  details: string | null;
  createdAt: string;
  driver: { name: string; phone: string } | null;
  vehicle: { licensePlate: string; type: string } | null;
  spot: { label: string } | null;
};

type Settings = {
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

export default function AdminDashboard() {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsForm, setSettingsForm] = useState<Settings | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [tab, setTab] = useState<"overview" | "audit" | "settings">("overview");
  const [overrideSpotId, setOverrideSpotId] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  const loadData = useCallback(() => {
    fetch("/api/spots").then((r) => r.json()).then((d) => setSpots(d.spots || []));
    fetch("/api/settings").then((r) => r.json()).then((d) => {
      setSettings(d.settings);
      setSettingsForm(d.settings);
    });
  }, []);

  const loadAudit = useCallback(() => {
    fetch("/api/audit?limit=100").then((r) => r.json()).then((d) => setAuditLogs(d.logs || []));
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    if (tab === "audit") loadAudit();
  }, [tab, loadAudit]);

  const now = new Date();

  const occupiedSpots = spots.filter((s) => s.status === "OCCUPIED");
  const availableBobtail = spots.filter((s) => s.type === "BOBTAIL" && s.status === "AVAILABLE").length;
  const availableTruck = spots.filter((s) => s.type === "TRUCK_TRAILER" && s.status === "AVAILABLE").length;

  const overstayedSessions = occupiedSpots
    .flatMap((s) => s.sessions.map((sess) => ({ ...sess, spotLabel: s.label })))
    .filter((s) => new Date(s.expectedEnd) < now);

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
        <button onClick={() => setTab("audit")}>Audit Log</button>
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

      {tab === "audit" && (
        <div>
          <h2>Audit Log</h2>
          <button onClick={loadAudit}>Refresh</button>
          {auditLogs.length === 0 ? (
            <p>No audit entries.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Driver</th>
                  <th>Plate</th>
                  <th>Spot</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.createdAt).toLocaleString()}</td>
                    <td>{entry.action}</td>
                    <td>{entry.driver?.name || "—"}</td>
                    <td>{entry.vehicle?.licensePlate || "—"}</td>
                    <td>{entry.spot?.label || "—"}</td>
                    <td>{entry.details || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
