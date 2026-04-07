"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type State =
  | "init"          // mounting — checking localStorage
  | "recognized"    // saved driver found → "Welcome back!"
  | "ask_type"      // no saved driver → "New or existing?"
  | "enter_phone"   // existing user, enter phone number
  | "checking"      // API in flight
  | "confirm"       // phone found → "Are you [name]?"
  | "not_found";    // phone not in DB

type Driver = { id: string; name: string; phone: string };

const STORAGE_KEY = "parking_driver";

function saveDriver(d: Driver) {
  if (!d?.id) return;
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
  const [state, setState] = useState<State>("init");
  const [driver, setDriver] = useState<Driver | null>(null);
  const [phone, setPhone] = useState("");
  const [foundDriver, setFoundDriver] = useState<Driver | null>(null);
  const [error, setError] = useState("");
  const phoneRef = useRef<HTMLInputElement>(null);

  // On mount: check localStorage, then verify against server
  useEffect(() => {
    const saved = loadDriver();
    if (!saved) {
      setState("ask_type");
      return;
    }
    setState("checking");
    fetch(`/api/drivers?phone=${saved.phone.replace(/\D/g, "")}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.driver?.id === saved.id) {
          const fresh: Driver = { id: data.driver.id, name: data.driver.name, phone: data.driver.phone };
          saveDriver(fresh);
          setDriver(fresh);
          setState("recognized");
        } else {
          clearDriver();
          setState("ask_type");
        }
      })
      .catch(() => {
        clearDriver();
        setState("ask_type");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state === "enter_phone") {
      setTimeout(() => phoneRef.current?.focus(), 120);
    }
  }, [state]);

  async function lookupPhone() {
    setError("");
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7) { setError("Enter a valid phone number"); return; }
    setState("checking");
    try {
      const res = await fetch(`/api/drivers?phone=${digits}`);
      const data = await res.json();
      if (!data.driver) {
        setState("not_found");
        return;
      }
      setFoundDriver({ id: data.driver.id, name: data.driver.name, phone: data.driver.phone });
      setState("confirm");
    } catch {
      setError("Connection error. Try again.");
      setState("enter_phone");
    }
  }

  function confirmIdentity() {
    if (!foundDriver) return;
    saveDriver(foundDriver);
    setDriver(foundDriver);
    router.push("/checkin?locked=true");
  }

  function proceedAsRecognized() {
    router.push("/checkin?locked=true");
  }

  function reset() {
    clearDriver();
    setDriver(null);
    setFoundDriver(null);
    setPhone("");
    setError("");
    setState("ask_type");
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .g {
          min-height: 100dvh;
          background: #0D0C0E;
          color: #F2F0EB;
          font-family: 'DM Sans', sans-serif;
          display: flex;
          flex-direction: column;
        }

        /* ── Top bar ── */
        .g-bar {
          padding: 18px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid rgba(242,240,235,0.07);
        }
        .g-bar-name {
          font-family: 'Syne', sans-serif;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.04em;
          color: rgba(242,240,235,0.55);
        }
        .g-bar-status {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 500;
          color: rgba(242,240,235,0.35);
        }
        .g-bar-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
        }
        .g-bar-dot.green { color: #34C759; }
        .g-bar-dot.blue  { color: #4A9EFF; }
        .g-bar-dot.amber { color: #F59E0B; }

        /* ── Content ── */
        .g-body {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 40px 28px 60px;
          max-width: 420px;
          width: 100%;
          margin: 0 auto;
          animation: g-in 0.25s ease both;
        }
        @keyframes g-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* ── Eyebrow label ── */
        .g-eyebrow {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: rgba(242,240,235,0.35);
          margin-bottom: 12px;
        }

        /* ── Headings ── */
        .g-h1 {
          font-family: 'Syne', sans-serif;
          font-size: clamp(32px, 8vw, 42px);
          font-weight: 800;
          line-height: 1.05;
          letter-spacing: -0.02em;
          color: #F2F0EB;
          margin-bottom: 10px;
        }
        .g-h1 span { color: #E05228; }

        .g-sub {
          font-size: 15px;
          color: rgba(242,240,235,0.45);
          line-height: 1.55;
          margin-bottom: 36px;
        }

        /* ── Divider ── */
        .g-divider {
          height: 1px;
          background: rgba(242,240,235,0.07);
          margin: 0 0 28px;
        }

        /* ── Buttons ── */
        .g-btn {
          width: 100%;
          padding: 16px 20px;
          border-radius: 10px;
          border: none;
          font-family: 'DM Sans', sans-serif;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.1s;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .g-btn:active { transform: scale(0.985); }

        .g-btn-primary {
          background: #E05228;
          color: #fff;
          margin-bottom: 10px;
        }
        .g-btn-primary:hover { opacity: 0.9; }

        .g-btn-success {
          background: #1A3D26;
          color: #34C759;
          border: 1px solid rgba(52,199,89,0.2);
          margin-bottom: 10px;
        }
        .g-btn-success:hover { opacity: 0.85; }

        .g-btn-ghost {
          background: rgba(242,240,235,0.05);
          color: rgba(242,240,235,0.6);
          border: 1px solid rgba(242,240,235,0.1);
        }
        .g-btn-ghost:hover { background: rgba(242,240,235,0.08); }

        /* ── Menu rows (ask_type) ── */
        .g-menu {
          border: 1px solid rgba(242,240,235,0.08);
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 16px;
        }
        .g-menu-row {
          width: 100%;
          padding: 18px 20px;
          background: rgba(242,240,235,0.025);
          border: none;
          cursor: pointer;
          text-align: left;
          display: flex;
          align-items: center;
          justify-content: space-between;
          transition: background 0.15s;
          font-family: 'DM Sans', sans-serif;
          color: #F2F0EB;
        }
        .g-menu-row + .g-menu-row {
          border-top: 1px solid rgba(242,240,235,0.07);
        }
        .g-menu-row:hover { background: rgba(242,240,235,0.06); }
        .g-menu-row:active { background: rgba(242,240,235,0.09); }
        .g-menu-row-text {}
        .g-menu-row-label {
          font-size: 15px;
          font-weight: 600;
          color: #F2F0EB;
          display: block;
          margin-bottom: 2px;
        }
        .g-menu-row-sub {
          font-size: 13px;
          color: rgba(242,240,235,0.38);
        }
        .g-menu-arrow {
          color: rgba(242,240,235,0.3);
          font-size: 18px;
          flex-shrink: 0;
          margin-left: 12px;
        }

        /* ── Input ── */
        .g-input-wrap { margin-bottom: 6px; }
        .g-input-label {
          display: block;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: rgba(242,240,235,0.4);
          margin-bottom: 10px;
        }
        .g-input {
          width: 100%;
          background: rgba(242,240,235,0.04);
          border: 1px solid rgba(242,240,235,0.1);
          border-radius: 10px;
          padding: 16px 18px;
          color: #F2F0EB;
          font-family: 'DM Sans', sans-serif;
          font-size: 20px;
          font-weight: 500;
          outline: none;
          transition: border-color 0.15s, background 0.15s;
          text-align: center;
          letter-spacing: 0.05em;
          margin-bottom: 14px;
        }
        .g-input::placeholder { color: rgba(242,240,235,0.18); letter-spacing: 0; }
        .g-input:focus {
          border-color: rgba(242,240,235,0.25);
          background: rgba(242,240,235,0.06);
        }

        .g-error {
          font-size: 13px;
          color: #F87171;
          min-height: 20px;
          margin-bottom: 14px;
          text-align: center;
        }

        /* ── Identity block ── */
        .g-identity {
          padding: 20px;
          border-radius: 10px;
          background: rgba(242,240,235,0.04);
          border: 1px solid rgba(242,240,235,0.09);
          margin-bottom: 24px;
        }
        .g-identity-name {
          font-family: 'Syne', sans-serif;
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: #F2F0EB;
          margin-bottom: 4px;
        }
        .g-identity-phone {
          font-size: 14px;
          color: rgba(242,240,235,0.4);
          letter-spacing: 0.04em;
        }

        /* ── Verified badge ── */
        .g-verified {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 600;
          color: #34C759;
          background: rgba(52,199,89,0.1);
          border: 1px solid rgba(52,199,89,0.18);
          border-radius: 6px;
          padding: 4px 10px;
          margin-bottom: 20px;
        }

        /* ── Secondary action ── */
        .g-secondary {
          text-align: center;
          margin-top: 20px;
        }
        .g-secondary button {
          background: none;
          border: none;
          font-family: 'DM Sans', sans-serif;
          font-size: 13px;
          color: rgba(242,240,235,0.28);
          cursor: pointer;
          letter-spacing: 0.01em;
          transition: color 0.15s;
        }
        .g-secondary button:hover { color: rgba(242,240,235,0.5); }

        /* ── Back link ── */
        .g-back {
          background: none;
          border: none;
          font-family: 'DM Sans', sans-serif;
          font-size: 13px;
          color: rgba(242,240,235,0.3);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 8px 0;
          margin-top: 4px;
          transition: color 0.15s;
        }
        .g-back:hover { color: rgba(242,240,235,0.55); }

        /* ── Loading dots ── */
        .g-dots {
          display: flex;
          gap: 6px;
          margin-bottom: 28px;
        }
        .g-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: rgba(242,240,235,0.2);
          animation: g-pulse 1.2s ease-in-out infinite;
        }
        .g-dot:nth-child(2) { animation-delay: 0.2s; }
        .g-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes g-pulse {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.9); }
          40% { opacity: 1; transform: scale(1); }
        }

        /* ── Not found icon ── */
        .g-icon-wrap {
          width: 52px;
          height: 52px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          margin-bottom: 20px;
        }
      `}</style>

      <div className="g">

        {/* ── Top bar ── */}
        <div className="g-bar">
          <span className="g-bar-name">Parking Gate</span>
          <span className="g-bar-status">
            <span className={`g-bar-dot ${state === "recognized" || state === "confirm" ? "green" : state === "not_found" ? "amber" : "blue"}`} />
            {state === "init" || state === "checking"
              ? "Checking…"
              : state === "recognized"
              ? "Pass active"
              : state === "confirm"
              ? "Found"
              : state === "not_found"
              ? "Not found"
              : "Gate access"}
          </span>
        </div>

        {/* ── CHECKING ── */}
        {(state === "init" || state === "checking") && (
          <div className="g-body">
            <div className="g-dots">
              <div className="g-dot" />
              <div className="g-dot" />
              <div className="g-dot" />
            </div>
            <p className="g-eyebrow">Please wait</p>
            <h1 className="g-h1">Verifying<br />your pass…</h1>
          </div>
        )}

        {/* ── RECOGNIZED ── */}
        {state === "recognized" && driver && (
          <div className="g-body">
            <div className="g-verified">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M2 5.5l2.5 2.5 4.5-5" stroke="#34C759" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Device verified
            </div>
            <p className="g-eyebrow">Welcome back</p>
            <h1 className="g-h1"><span>{driver.name.split(" ")[0]}</span>.</h1>
            <p className="g-sub">Your information is saved on this device.</p>
            <div className="g-divider" />
            <button className="g-btn g-btn-success" onClick={proceedAsRecognized}>
              Continue to check in
              <span>→</span>
            </button>
            <div className="g-secondary">
              <button onClick={reset}>Not you? Reset device</button>
            </div>
          </div>
        )}

        {/* ── ASK TYPE ── */}
        {state === "ask_type" && (
          <div className="g-body">
            <p className="g-eyebrow">Gate access</p>
            <h1 className="g-h1">How can<br />we help?</h1>
            <p className="g-sub" style={{ marginBottom: 28 }}>Select an option to continue.</p>
            <div className="g-menu">
              <button className="g-menu-row" onClick={() => router.push("/checkin?new=true")}>
                <span className="g-menu-row-text">
                  <span className="g-menu-row-label">New driver</span>
                  <span className="g-menu-row-sub">First time at this facility</span>
                </span>
                <span className="g-menu-arrow">›</span>
              </button>
              <button className="g-menu-row" onClick={() => setState("enter_phone")}>
                <span className="g-menu-row-text">
                  <span className="g-menu-row-label">Returning driver</span>
                  <span className="g-menu-row-sub">I&apos;ve parked here before</span>
                </span>
                <span className="g-menu-arrow">›</span>
              </button>
            </div>
          </div>
        )}

        {/* ── ENTER PHONE ── */}
        {state === "enter_phone" && (
          <div className="g-body">
            <p className="g-eyebrow">Returning driver</p>
            <h1 className="g-h1">Enter your<br />phone number</h1>
            <p className="g-sub">We&apos;ll look up your account.</p>
            <div className="g-input-wrap">
              <label className="g-input-label">Phone number</label>
              <input
                ref={phoneRef}
                className="g-input"
                type="tel"
                placeholder="(555) 000-0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && lookupPhone()}
              />
            </div>
            <div className="g-error">{error}</div>
            <button className="g-btn g-btn-primary" onClick={lookupPhone}>
              Look up account
              <span>→</span>
            </button>
            <button className="g-back" onClick={() => { setError(""); setState("ask_type"); }}>
              ← Back
            </button>
          </div>
        )}

        {/* ── CONFIRM IDENTITY ── */}
        {state === "confirm" && foundDriver && (
          <div className="g-body">
            <p className="g-eyebrow">Confirm identity</p>
            <h1 className="g-h1">Is this<br />you?</h1>
            <p className="g-sub" style={{ marginBottom: 20 }}>We found a match for that number.</p>
            <div className="g-identity">
              <div className="g-identity-name">{foundDriver.name}</div>
              <div className="g-identity-phone">{foundDriver.phone}</div>
            </div>
            <button className="g-btn g-btn-success" onClick={confirmIdentity}>
              Yes, that&apos;s me
              <span>→</span>
            </button>
            <button className="g-btn g-btn-ghost" style={{ marginTop: 8 }} onClick={() => { setFoundDriver(null); setPhone(""); setState("enter_phone"); }}>
              No, try a different number
              <span />
            </button>
          </div>
        )}

        {/* ── NOT FOUND ── */}
        {state === "not_found" && (
          <div className="g-body">
            <div className="g-icon-wrap" style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.18)" }}>
              <span style={{ fontSize: 22 }}>?</span>
            </div>
            <p className="g-eyebrow">No account found</p>
            <h1 className="g-h1">Number<br />not on file</h1>
            <p className="g-sub">
              We couldn&apos;t find an account for{" "}
              <span style={{ color: "#F2F0EB", fontWeight: 500 }}>{phone}</span>.
            </p>
            <div className="g-divider" />
            <button className="g-btn g-btn-primary" onClick={() => router.push(`/checkin?new=true&prefillPhone=${encodeURIComponent(phone.replace(/\D/g, ""))}`)}>
              Sign up as new driver
              <span>→</span>
            </button>
            <button className="g-btn g-btn-ghost" style={{ marginTop: 8 }} onClick={() => { setPhone(""); setState("enter_phone"); }}>
              Try a different number
              <span />
            </button>
          </div>
        )}

      </div>
    </>
  );
}
