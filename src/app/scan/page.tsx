"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type State =
  | "identifying"   // enter phone
  | "naming"        // phone not found → enter name
  | "checking"      // API in flight
  | "gate_open"     // active session found → gate triggered
  | "no_session";   // driver found but no active session

type Driver = { id: string; name: string; phone: string };

const STORAGE_KEY = "parking_driver";

function saveDriver(d: Driver) {
  if (!d || !d.id) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
}
function loadDriver(): Driver | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || raw === "undefined" || raw === "null") return null;
    const parsed = JSON.parse(raw);
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}
function clearDriver() {
  localStorage.removeItem(STORAGE_KEY);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function ScanPage() {
  const router = useRouter();
  const [state, setState] = useState<State>("checking");
  const [driver, setDriver] = useState<Driver | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [openedAt, setOpenedAt] = useState("");
  const phoneRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // On mount: check localStorage
  useEffect(() => {
    const saved = loadDriver();
    if (saved) {
      setDriver(saved);
      checkSession(saved);
    } else {
      setState("identifying");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Side effects per state
  useEffect(() => {
    if (state === "identifying") setTimeout(() => phoneRef.current?.focus(), 120);
    if (state === "naming") setTimeout(() => nameRef.current?.focus(), 120);
    if (state === "gate_open") {
      const t = setTimeout(() => router.push("/"), 8000);
      return () => clearTimeout(t);
    }
    if (state === "no_session") {
      const t = setTimeout(() => router.push("/checkin"), 4000);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  async function checkSession(d: Driver) {
    setState("checking");
    try {
      const res = await fetch(`/api/sessions?driverId=${d.id}`);
      const data = await res.json();
      if (data.session) {
        await openGate(d, data.session.id);
      } else {
        setState("no_session");
      }
    } catch {
      setState("no_session");
    }
  }

  async function openGate(d: Driver, sid?: string) {
    try {
      const res = await fetch("/api/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId: d.id, sessionId: sid }),
      });
      const data = await res.json();
      setOpenedAt(data.openedAt ? new Date(data.openedAt).toLocaleTimeString() : "");
    } catch {
      // Virtual signal — show success regardless
    }
    setState("gate_open");
  }

  async function submitPhone() {
    setError("");
    const cleaned = phone.replace(/\s/g, "");
    if (cleaned.length < 7) { setError("Enter a valid phone number"); return; }
    setState("checking");
    try {
      const res = await fetch("/api/driver-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleaned }),
      });
      const data = await res.json();
      if (data.needsName) {
        setState("naming");
        return;
      }
      const d: Driver = data.driver;
      setDriver(d);
      saveDriver(d);
      await checkSession(d);
    } catch {
      setError("Connection error. Try again.");
      setState("identifying");
    }
  }

  async function submitName() {
    setError("");
    if (name.trim().length < 2) { setError("Enter your full name"); return; }
    setState("checking");
    const cleaned = phone.replace(/\s/g, "");
    try {
      const res = await fetch("/api/driver-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleaned, name: name.trim() }),
      });
      const data = await res.json();
      const d: Driver = data.driver;
      setDriver(d);
      saveDriver(d);
      setState("no_session");
    } catch {
      setError("Connection error. Try again.");
      setState("naming");
    }
  }

  function reset() {
    clearDriver();
    setDriver(null);
    setPhone("");
    setName("");
    setError("");
    setState("identifying");
  }

  // ---------------------------------------------------------------------------
  // Pill text/color helpers
  // ---------------------------------------------------------------------------
  const pillText = {
    checking: "Scanning...",
    gate_open: "Access Granted",
    no_session: "No Session",
    naming: "Register",
    identifying: "Identify",
  }[state];

  const accent = {
    gate_open: "#30D158",
    no_session: "#FF9F0A",
    checking: "#0A84FF",
    identifying: "#0A84FF",
    naming: "#0A84FF",
  }[state];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;600;700&family=IBM+Plex+Sans:wght@400;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .sr { min-height:100vh; background:#060608; display:flex; flex-direction:column; align-items:center; justify-content:center; font-family:'IBM Plex Mono',monospace; color:#fff; position:relative; overflow:hidden; padding:24px; }

        .sr::before { content:''; position:fixed; width:700px; height:700px; border-radius:50%; top:50%; left:50%; transform:translate(-50%,-50%); pointer-events:none; transition:background 0.9s ease; background:var(--sr-glow,radial-gradient(circle,rgba(10,132,255,0.07) 0%,transparent 70%)); }

        .sr-topbar { position:fixed; top:0; left:0; right:0; padding:16px 24px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.06); background:rgba(6,6,8,0.85); backdrop-filter:blur(12px); z-index:10; }
        .sr-logo { font-size:11px; font-weight:600; letter-spacing:0.18em; text-transform:uppercase; color:rgba(255,255,255,0.3); }
        .sr-pill { font-size:10px; font-weight:600; letter-spacing:0.14em; text-transform:uppercase; padding:4px 11px; border-radius:20px; border:1px solid; transition:all 0.4s; }

        .sr-card { width:100%; max-width:360px; position:relative; z-index:1; }

        .sr-circle { width:116px; height:116px; border-radius:50%; border:2px solid; display:flex; align-items:center; justify-content:center; margin:0 auto 32px; position:relative; transition:border-color 0.6s,background 0.6s; }
        .sr-circle::after { content:''; position:absolute; inset:-10px; border-radius:50%; border:1px solid rgba(255,255,255,0.06); animation:sr-rot 6s linear infinite; }
        @keyframes sr-rot { to { transform:rotate(360deg); } }

        .sr-spinner { width:116px; height:116px; border-radius:50%; border:1.5px solid rgba(10,132,255,0.12); border-top-color:#0A84FF; animation:sr-spin 0.9s linear infinite; margin:0 auto 32px; }
        @keyframes sr-spin { to { transform:rotate(360deg); } }

        .sr-ring { position:absolute; inset:0; border-radius:50%; border:1px solid #30D158; animation:sr-ripple 2.2s ease-out infinite; }
        .sr-ring:nth-child(2) { animation-delay:0.55s; }
        .sr-ring:nth-child(3) { animation-delay:1.1s; }
        @keyframes sr-ripple { 0%{transform:scale(1);opacity:0.55} 100%{transform:scale(2.8);opacity:0} }

        .sr-icon { font-size:42px; line-height:1; }

        .sr-label { text-align:center; font-size:10px; font-weight:700; letter-spacing:0.22em; text-transform:uppercase; margin-bottom:10px; opacity:0.5; }
        .sr-heading { text-align:center; font-size:25px; font-weight:700; letter-spacing:0.02em; margin-bottom:8px; line-height:1.2; }
        .sr-sub { text-align:center; font-size:13px; color:rgba(255,255,255,0.38); font-family:'IBM Plex Sans',sans-serif; margin-bottom:32px; line-height:1.6; }

        .sr-input { width:100%; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:14px 16px; color:#fff; font-family:'IBM Plex Mono',monospace; font-size:18px; letter-spacing:0.06em; outline:none; transition:border-color 0.2s,background 0.2s; margin-bottom:10px; text-align:center; }
        .sr-input::placeholder { color:rgba(255,255,255,0.18); }
        .sr-input:focus { border-color:#0A84FF; background:rgba(10,132,255,0.05); }

        .sr-btn { width:100%; padding:14px; border-radius:10px; border:none; font-family:'IBM Plex Mono',monospace; font-size:12px; font-weight:700; letter-spacing:0.16em; text-transform:uppercase; cursor:pointer; transition:opacity 0.2s,transform 0.1s; margin-bottom:10px; background:#0A84FF; color:#fff; }
        .sr-btn:hover { opacity:0.85; }
        .sr-btn:active { transform:scale(0.98); }

        .sr-error { text-align:center; font-size:11px; color:#FF453A; letter-spacing:0.04em; min-height:18px; margin-top:2px; }

        .sr-chip { display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:10px 14px; margin-bottom:24px; }
        .sr-chip-label { font-size:11px; color:rgba(255,255,255,0.35); margin-bottom:2px; }
        .sr-chip-val { font-size:14px; color:rgba(255,255,255,0.75); font-weight:600; }
        .sr-chip-btn { background:none; border:none; color:rgba(255,255,255,0.25); font-family:'IBM Plex Mono',monospace; font-size:10px; cursor:pointer; letter-spacing:0.1em; text-transform:uppercase; }
        .sr-chip-btn:hover { color:rgba(255,255,255,0.5); }

        .sr-ts { font-size:10px; color:rgba(255,255,255,0.2); text-align:center; letter-spacing:0.1em; margin-top:10px; }

        .sr-notme { text-align:center; margin-top:18px; }
        .sr-notme button { background:none; border:none; color:rgba(255,255,255,0.2); font-family:'IBM Plex Mono',monospace; font-size:10px; cursor:pointer; letter-spacing:0.1em; text-transform:uppercase; }
        .sr-notme button:hover { color:rgba(255,255,255,0.4); }

        .sr-progress { position:fixed; bottom:0; left:0; height:2px; animation:sr-prog linear forwards; }
        @keyframes sr-prog { from{width:100%} to{width:0%} }
      `}</style>

      {/* Dynamic CSS variable for glow */}
      <style>{`
        .sr { --sr-glow: radial-gradient(circle,${
          state === "gate_open" ? "rgba(48,209,88,0.10)" :
          state === "no_session" ? "rgba(255,159,10,0.08)" :
          "rgba(10,132,255,0.07)"
        } 0%,transparent 70%); }
      `}</style>

      <div className="sr">
        {/* Top bar */}
        <div className="sr-topbar">
          <span className="sr-logo">Parking Gate</span>
          <span className="sr-pill" style={{
            color: accent,
            borderColor: `${accent}33`,
            background: `${accent}0D`,
          }}>
            {pillText}
          </span>
        </div>

        <div className="sr-card">

          {/* ── CHECKING ── */}
          {state === "checking" && (
            <>
              <div className="sr-spinner" />
              <p className="sr-label">Verifying</p>
              <h1 className="sr-heading">Please wait</h1>
              <p className="sr-sub">Checking your access…</p>
            </>
          )}

          {/* ── GATE OPEN ── */}
          {state === "gate_open" && (
            <>
              <div className="sr-circle" style={{ borderColor: "#30D158", background: "rgba(48,209,88,0.07)" }}>
                <div className="sr-ring" /><div className="sr-ring" /><div className="sr-ring" />
                <span className="sr-icon" style={{ color: "#30D158" }}>✓</span>
              </div>
              <p className="sr-label" style={{ color: "#30D158" }}>Access Granted</p>
              <h1 className="sr-heading" style={{ color: "#30D158" }}>Gate Opening</h1>
              <p className="sr-sub">
                {driver?.name ? `Welcome back, ${driver.name.split(" ")[0]}.` : "Welcome back."}<br />
                Drive through when the gate opens.
              </p>
              {openedAt && <p className="sr-ts">Signal sent · {openedAt}</p>}
              <div className="sr-notme"><button onClick={reset}>Not you?</button></div>
              <div className="sr-progress" style={{ background: "#30D158", animationDuration: "8s" }} />
            </>
          )}

          {/* ── NO SESSION ── */}
          {state === "no_session" && (
            <>
              <div className="sr-circle" style={{ borderColor: "rgba(255,159,10,0.5)", background: "rgba(255,159,10,0.05)" }}>
                <span className="sr-icon" style={{ fontSize: 36, color: "#FF9F0A" }}>⊘</span>
              </div>
              <p className="sr-label" style={{ color: "#FF9F0A" }}>No Active Session</p>
              <h1 className="sr-heading">Check In First</h1>
              <p className="sr-sub">
                {driver?.name ? `Hi ${driver.name.split(" ")[0]}, you ` : "You "}
                don&apos;t have an active parking session.<br />
                Redirecting to check-in…
              </p>
              <div className="sr-notme"><button onClick={reset}>Not you?</button></div>
              <div className="sr-progress" style={{ background: "#FF9F0A", animationDuration: "4s" }} />
            </>
          )}

          {/* ── IDENTIFY ── */}
          {state === "identifying" && (
            <>
              <div className="sr-circle" style={{ borderColor: "rgba(10,132,255,0.4)", background: "rgba(10,132,255,0.05)" }}>
                <span className="sr-icon" style={{ fontSize: 36 }}>📱</span>
              </div>
              <p className="sr-label" style={{ color: "#0A84FF" }}>Gate Access</p>
              <h1 className="sr-heading">Enter your phone</h1>
              <p className="sr-sub">Your number identifies you at the gate.</p>
              <input
                ref={phoneRef}
                className="sr-input"
                type="tel"
                placeholder="555 000 0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitPhone()}
              />
              <p className="sr-error">{error}</p>
              <button className="sr-btn" onClick={submitPhone}>Continue →</button>
            </>
          )}

          {/* ── NAMING ── */}
          {state === "naming" && (
            <>
              <div className="sr-circle" style={{ borderColor: "rgba(10,132,255,0.4)", background: "rgba(10,132,255,0.05)" }}>
                <span className="sr-icon" style={{ fontSize: 36 }}>👤</span>
              </div>
              <p className="sr-label" style={{ color: "#0A84FF" }}>First Visit</p>
              <h1 className="sr-heading">What&apos;s your name?</h1>
              <p className="sr-sub">We&apos;ll remember you next time.</p>
              <div className="sr-chip">
                <div>
                  <p className="sr-chip-label">Phone</p>
                  <p className="sr-chip-val">{phone}</p>
                </div>
                <button className="sr-chip-btn" onClick={() => setState("identifying")}>Change</button>
              </div>
              <input
                ref={nameRef}
                className="sr-input"
                type="text"
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitName()}
              />
              <p className="sr-error">{error}</p>
              <button className="sr-btn" onClick={submitName}>Register →</button>
            </>
          )}

        </div>
      </div>
    </>
  );
}
