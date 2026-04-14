"use client";

import React, { useState } from "react";
import type { SpotLayout, LotSpotStatus } from "@/types/domain";
import { LOT_STATUS_COLORS } from "@/types/domain";

/**
 * Read-only lot map SVG with live status coloring and click-to-select.
 *
 * Used by:
 *  - /lot page (status view mode)
 *  - /admin overview tab
 */

const LOT_BOUNDARY_PATH =
  "M -5,1210 L 1005,1210 L 1005,638 L 780,522 L 640,522 L 390,302 L 390,218 C 362,230 298,170 195,92 L -5,-5 Z";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export type LotMapViewerProps = {
  spots: SpotLayout[];
  statuses: Record<string, LotSpotStatus>;
  selectedSpotId: string | null;
  onSelectSpot: (id: string | null) => void;
  /** Optional: render extra SVG elements (e.g. demo path, entrance marker) */
  children?: React.ReactNode;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function LotMapViewer({
  spots,
  statuses,
  selectedSpotId,
  onSelectSpot,
  children,
}: LotMapViewerProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <svg
      viewBox="-200 -80 1500 1350"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: "block", background: "#1C1C1E" }}
    >
      {/* Lot boundary */}
      <path d={LOT_BOUNDARY_PATH} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />

      {/* Extra SVG content (demo markers, etc.) */}
      {children}

      {/* Spots — statuses keyed by label (bridges editor spots ↔ DB spots) */}
      {spots.map((spot) => {
        const status: LotSpotStatus = statuses[spot.label] ?? statuses[spot.id] ?? "VACANT";
        const isHovered = hoveredId === spot.id;
        const isSelected = selectedSpotId === spot.id;
        const colors = LOT_STATUS_COLORS[status];
        const fill = isHovered ? colors.fillHover : colors.fill;
        const sw = status === "OVERDUE" ? 1.5 : isSelected ? 2 : 1;
        const transform = spot.rot !== 0 ? `rotate(${spot.rot}, ${spot.cx}, ${spot.cy})` : undefined;
        const fontSize = Math.max(10, Math.min(16, Math.min(spot.w, spot.h) * 0.75));

        return (
          <g
            key={spot.id}
            transform={transform}
            onMouseEnter={() => setHoveredId(spot.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={() => onSelectSpot(isSelected ? null : spot.id)}
            style={{ cursor: "pointer" }}
          >
            <rect
              x={spot.cx - spot.w / 2} y={spot.cy - spot.h / 2}
              width={spot.w} height={spot.h} rx={1}
              fill={fill}
              stroke={isSelected ? "#F5F5F7" : colors.stroke}
              strokeWidth={sw}
              style={{ transition: "fill 0.3s, stroke 0.3s" }}
            />
            <text
              x={spot.cx} y={spot.cy + fontSize * 0.35}
              fontSize={fontSize}
              fill={colors.label}
              textAnchor="middle" fontFamily="var(--font-body)"
              fontWeight="700" pointerEvents="none"
            >
              {spot.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Status counts helper (shared between lot page and admin)
// ---------------------------------------------------------------------------
export function countStatuses(
  spots: SpotLayout[],
  statuses: Record<string, LotSpotStatus>,
  excludeId?: string | null,
) {
  let vacant = 0, reserved = 0, overdue = 0;
  for (const spot of spots) {
    if (spot.id === excludeId) continue;
    const s = statuses[spot.label] ?? statuses[spot.id];
    if (s === "RESERVED") reserved++;
    else if (s === "OVERDUE") overdue++;
    else vacant++;
  }
  return { total: spots.length, vacant, reserved, overdue };
}
