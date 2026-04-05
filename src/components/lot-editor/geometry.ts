// ---------------------------------------------------------------------------
// Lot Editor — Geometry helpers
// ---------------------------------------------------------------------------

import type { EditorSpot, SpotGroup } from "./types";

/** Snap a value to a grid of the given size */
export function snapToGrid(value: number, gridSize: number = 10): number {
  return Math.round(value / gridSize) * gridSize;
}

/** Snap dx/dy deltas to grid */
export function snapDelta(dx: number, dy: number, gridSize: number = 10): { dx: number; dy: number } {
  return {
    dx: snapToGrid(dx, gridSize),
    dy: snapToGrid(dy, gridSize),
  };
}

/** Compute the direction vector between two spots */
export function directionVector(
  a: EditorSpot,
  b: EditorSpot,
): { dx: number; dy: number } {
  return { dx: b.cx - a.cx, dy: b.cy - a.cy };
}

/** Compute distance between two spot centers */
export function spotDistance(a: EditorSpot, b: EditorSpot): number {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Compute spacing and direction from a group's first two spots */
export function computeGroupSpacing(
  group: SpotGroup,
  spots: Record<string, EditorSpot>,
): { spacing: number; dirX: number; dirY: number } {
  if (group.spotIds.length < 2) {
    // Default: place along the Y axis for vertical groups
    return { spacing: 22.5, dirX: 0, dirY: -22.5 };
  }

  const first = spots[group.spotIds[0]];
  const second = spots[group.spotIds[1]];

  if (!first || !second) {
    return { spacing: 22.5, dirX: 0, dirY: -22.5 };
  }

  const dist = spotDistance(first, second);
  const dx = second.cx - first.cx;
  const dy = second.cy - first.cy;

  // Normalize direction
  if (dist === 0) return { spacing: 22.5, dirX: 0, dirY: -22.5 };

  return {
    spacing: dist,
    dirX: dx / dist * dist,
    dirY: dy / dist * dist,
  };
}

/** Compute the position for a new spot at the start or end of a group */
export function computeNewSpotPosition(
  group: SpotGroup,
  spots: Record<string, EditorSpot>,
  position: "start" | "end",
): { cx: number; cy: number } {
  const { dirX, dirY } = computeGroupSpacing(group, spots);

  if (position === "end") {
    const lastId = group.spotIds[group.spotIds.length - 1];
    const last = spots[lastId];
    if (!last) return { cx: 500, cy: 500 };
    return {
      cx: last.cx + dirX,
      cy: last.cy + dirY,
    };
  } else {
    const firstId = group.spotIds[0];
    const first = spots[firstId];
    if (!first) return { cx: 500, cy: 500 };
    return {
      cx: first.cx - dirX,
      cy: first.cy - dirY,
    };
  }
}

/** Get a template spot from the group (w, h, rot, type) */
export function getGroupTemplate(
  group: SpotGroup,
  spots: Record<string, EditorSpot>,
): { w: number; h: number; rot: number; type: EditorSpot["type"] } {
  const firstId = group.spotIds[0];
  const first = spots[firstId];
  if (!first) {
    return {
      w: group.type === "BOBTAIL" ? 74.5 : 149.1,
      h: 19.6,
      rot: 0,
      type: group.type,
    };
  }
  return { w: first.w, h: first.h, rot: first.rot, type: first.type };
}
