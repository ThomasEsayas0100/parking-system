"use client";

import { useState } from "react";
import ReconcileTab from "./ReconcileTab";
import ChargesReceiptsTab from "./ChargesReceiptsTab";

const BORDER = "#E5E5EA";
const FG_MUTED = "#636366";
const FG_DIM = "#8E8E93";
const ACCENT = "#2D7A4A";
const ACCENT_LIGHT = "#EDF7F1";

type SubTab = "sessions" | "charges-receipts";

const SUBTABS: { key: SubTab; label: string; description: string }[] = [
  { key: "sessions",          label: "Sessions",           description: "Payment chain integrity" },
  { key: "charges-receipts",  label: "Charges & Receipts", description: "Stripe ↔ QuickBooks" },
];

export default function ReconcileView({ mobile }: { mobile: boolean }) {
  const [subTab, setSubTab] = useState<SubTab>("sessions");

  if (mobile) {
    // Mobile: horizontal top bar, same as before
    return (
      <div>
        <div style={{
          display: "flex",
          borderBottom: `1px solid ${BORDER}`,
          background: "#FAFAFA",
          paddingLeft: 12,
          paddingTop: 14,
        }}>
          {SUBTABS.map(({ key, label }) => {
            const active = subTab === key;
            return (
              <button
                key={key}
                onClick={() => setSubTab(key)}
                style={{
                  padding: "8px 14px",
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  color: active ? ACCENT : FG_MUTED,
                  background: "transparent",
                  border: "none",
                  borderBottom: active ? `2px solid ${ACCENT}` : "2px solid transparent",
                  cursor: "pointer",
                  marginBottom: -1,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {subTab === "sessions"         && <ReconcileTab mobile />}
        {subTab === "charges-receipts" && <ChargesReceiptsTab mobile />}
      </div>
    );
  }

  // Desktop: left sidebar + content
  return (
    <div style={{ display: "flex", flex: 1 }}>

      {/* Sidebar */}
      <nav style={{
        width: 200,
        flexShrink: 0,
        borderRight: `1px solid ${BORDER}`,
        background: "#FAFAFA",
        paddingTop: 24,
        paddingBottom: 24,
      }}>
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: FG_DIM,
          padding: "0 16px 10px",
        }}>
          Reconcile
        </div>

        {SUBTABS.map(({ key, label, description }) => {
          const active = subTab === key;
          return (
            <button
              key={key}
              onClick={() => setSubTab(key)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "9px 16px",
                background: active ? ACCENT_LIGHT : "transparent",
                border: "none",
                borderLeft: active ? `3px solid ${ACCENT}` : "3px solid transparent",
                cursor: "pointer",
                transition: "background 0.1s",
              }}
            >
              <div style={{
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                color: active ? ACCENT : FG_MUTED,
                lineHeight: 1.3,
              }}>
                {label}
              </div>
              <div style={{
                fontSize: 11,
                color: active ? ACCENT : FG_DIM,
                marginTop: 1,
                opacity: active ? 0.8 : 1,
              }}>
                {description}
              </div>
            </button>
          );
        })}
      </nav>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {subTab === "sessions"         && <ReconcileTab mobile={false} />}
        {subTab === "charges-receipts" && <ChargesReceiptsTab mobile={false} />}
      </div>

    </div>
  );
}
