"use client";

import React, { Suspense, useState, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useEditorReducer } from "@/components/lot/editor/useEditorReducer";
import { ENTRANCE } from "@/app/lot/pathfinding";

import type { SpotLayout } from "@/types/domain";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const LOT_BOUNDARY_PATH =
  "M -5,1210 L 1005,1210 L 1005,638 L 780,522 L 640,522 L 390,302 L 390,218 C 362,230 298,170 195,92 L -5,-5 Z";

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------
export default function SpotAssignedWrapper() {
  return (
    <Suspense
      fallback={
        <div style={{ height: "100vh", background: "#1C1C1E", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "#636366", fontSize: 13 }}>Loading...</span>
        </div>
      }
    >
      <SpotAssignedPage />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
function SpotAssignedPage() {
  const searchParams = useSearchParams();
  const spotId   = searchParams.get("spotId") ?? "";
  const driverName = searchParams.get("name") ?? "";
  const vehicle  = searchParams.get("vehicle") ?? "";
  const hours    = searchParams.get("hours") ?? "";

  // Use the same editor state so layout matches what the admin saved
  const editor = useEditorReducer();
  const allSpots = useMemo<SpotLayout[]>(
    () => Object.values(editor.state.spots),
    [editor.state.spots],
  );

  const assignedSpot = useMemo(
    () => allSpots.find((s) => s.id === spotId) ?? null,
    [allSpots, spotId],
  );

  // Ripple counter — remounts rings to restart animation
  const [pulseKey, setPulseKey] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPulseKey((k) => k + 1), 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      background: "#1C1C1E",
      overflow: "hidden",
      fontFamily: "var(--font-body)",
    }}>
      {/* Top banner */}
      <div style={{
        background: "linear-gradient(90deg, #0A2A50 0%, #061830 100%)",
        borderBottom: "1px solid #0A84FF33",
        padding: "12px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Pulsing dot */}
          <div style={{ position: "relative", width: 10, height: 10, flexShrink: 0 }}>
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#0A84FF" }} />
            <div className="demo-ping" style={{ position: "absolute", inset: -4, borderRadius: "50%", border: "2px solid #0A84FF" }} />
          </div>
          <div>
            <div style={{ color: "#F5F5F7", fontWeight: 700, fontSize: 15, fontFamily: "var(--font-display)", letterSpacing: "0.02em" }}>
              {assignedSpot ? `Spot ${assignedSpot.label}` : "Spot assigned"}
            </div>
            <div style={{ color: "#636366", fontSize: 12, marginTop: 1 }}>
              {driverName && <span>{driverName}</span>}
              {vehicle && <span style={{ marginLeft: 8 }}>· {vehicle}</span>}
              {hours && <span style={{ marginLeft: 8 }}>· {hours} hrs</span>}
            </div>
          </div>
        </div>

        {/* Direction chip */}
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#0A84FF",
          background: "#0A84FF15",
          border: "1px solid #0A84FF30",
          padding: "4px 12px",
          borderRadius: 20,
          letterSpacing: "0.05em",
          whiteSpace: "nowrap",
        }}>
          Find your spot
        </div>
      </div>

      {/* Map */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <svg
          viewBox="-200 -80 1500 1350"
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
          style={{ display: "block", background: "#1C1C1E" }}
        >
          {/* Lot boundary */}
          <path d={LOT_BOUNDARY_PATH} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />

          {/* Entrance marker */}
          <g>
            <circle cx={ENTRANCE[0]} cy={ENTRANCE[1]} r={8} fill="#0A84FF" opacity={0.9} />
            <circle cx={ENTRANCE[0]} cy={ENTRANCE[1]} r={14} fill="none" stroke="#0A84FF" strokeWidth="1.5" opacity={0.4} />
            <text
              x={ENTRANCE[0]} y={ENTRANCE[1] + 26}
              textAnchor="middle" fontSize={9}
              fill="#0A84FF" fontWeight="700"
              letterSpacing="0.08em" fontFamily="var(--font-body)"
            >
              ENTER
            </text>
          </g>

          {/* All spots — uniform grey first, assigned spot rendered last (on top) */}
          {allSpots.filter((s) => s.id !== spotId).map((spot) => {
            const transform = spot.rot !== 0 ? `rotate(${spot.rot}, ${spot.cx}, ${spot.cy})` : undefined;
            const fontSize = Math.max(10, Math.min(16, Math.min(spot.w, spot.h) * 0.75));
            return (
              <g key={spot.id} transform={transform}>
                <rect
                  x={spot.cx - spot.w / 2} y={spot.cy - spot.h / 2}
                  width={spot.w} height={spot.h} rx={1}
                  fill="#242424" stroke="#3A3A3C" strokeWidth={0.8}
                />
                <text
                  x={spot.cx} y={spot.cy + fontSize * 0.35}
                  fontSize={fontSize} fill="rgba(255,255,255,0.18)"
                  textAnchor="middle" fontFamily="var(--font-body)"
                  fontWeight="600" pointerEvents="none"
                >
                  {spot.label}
                </text>
              </g>
            );
          })}

          {/* Assigned spot — rendered last so it sits on top of all others */}
          {assignedSpot && (() => {
            const spot = assignedSpot;
            const transform = spot.rot !== 0 ? `rotate(${spot.rot}, ${spot.cx}, ${spot.cy})` : undefined;
            const fontSize = Math.max(10, Math.min(16, Math.min(spot.w, spot.h) * 0.75));
            return (
              <g key={spot.id} transform={transform}>
                <rect
                  key={`ring1-${pulseKey}`}
                  x={spot.cx - spot.w / 2} y={spot.cy - spot.h / 2}
                  width={spot.w} height={spot.h} rx={2}
                  fill="none" stroke="#0A84FF" strokeWidth="1.5"
                  className="spot-ring" style={{ animationDelay: "0s" }}
                />
                <rect
                  key={`ring2-${pulseKey}`}
                  x={spot.cx - spot.w / 2} y={spot.cy - spot.h / 2}
                  width={spot.w} height={spot.h} rx={2}
                  fill="none" stroke="#0A84FF" strokeWidth="1.5"
                  className="spot-ring" style={{ animationDelay: "0.4s" }}
                />
                <rect
                  x={spot.cx - spot.w / 2} y={spot.cy - spot.h / 2}
                  width={spot.w} height={spot.h} rx={1}
                  fill="#061830" stroke="#0A84FF" strokeWidth={2}
                  className="spot-assigned-blink"
                />
                <text
                  x={spot.cx} y={spot.cy + fontSize * 0.35}
                  fontSize={fontSize} fill="#60AAFF"
                  textAnchor="middle" fontFamily="var(--font-body)"
                  fontWeight="700" pointerEvents="none"
                >
                  {spot.label}
                </text>
              </g>
            );
          })()}
        </svg>
      </div>

      {/* Bottom strip */}
      <div style={{
        borderTop: "1px solid #2C2C2E",
        padding: "10px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        gap: 8,
      }}>
        <div style={{ width: 8, height: 8, borderRadius: 2, background: "#061830", border: "1px solid #0A84FF", flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: "#0A84FF", fontWeight: 600 }}>
          Your spot
        </span>
        <span style={{ color: "#3A3A3C", fontSize: 12 }}>·</span>
        <div style={{ width: 8, height: 8, borderRadius: 2, background: "#242424", border: "1px solid #3A3A3C", flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: "#636366" }}>
          Other spots
        </span>
      </div>

      {/* Navigation out */}
      <div style={{
        borderTop: "1px solid #2C2C2E",
        padding: "14px 20px",
        display: "flex",
        gap: 12,
        justifyContent: "center",
        flexShrink: 0,
      }}>
        <Link
          href="/lot"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#0A84FF",
            textDecoration: "none",
          }}
        >
          View full lot map
        </Link>
        <span style={{ color: "#3A3A3C" }}>·</span>
        <Link
          href="/scan"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#636366",
            textDecoration: "none",
          }}
        >
          Done
        </Link>
      </div>
    </div>
  );
}
