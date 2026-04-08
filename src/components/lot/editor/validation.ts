// ---------------------------------------------------------------------------
// Lot Editor — Collision / overlap detection (AABB + SAT)
// ---------------------------------------------------------------------------

import type { EditorSpot } from "./types";

type Vec2 = { x: number; y: number };

/** Compute the 4 corners of a (possibly rotated) spot */
export function getCorners(spot: EditorSpot): [Vec2, Vec2, Vec2, Vec2] {
  const hw = spot.w / 2;
  const hh = spot.h / 2;

  if (spot.rot === 0) {
    return [
      { x: spot.cx - hw, y: spot.cy - hh },
      { x: spot.cx + hw, y: spot.cy - hh },
      { x: spot.cx + hw, y: spot.cy + hh },
      { x: spot.cx - hw, y: spot.cy + hh },
    ];
  }

  const rad = (spot.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const offsets: [number, number][] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];

  return offsets.map(([ox, oy]) => ({
    x: spot.cx + ox * cos - oy * sin,
    y: spot.cy + ox * sin + oy * cos,
  })) as [Vec2, Vec2, Vec2, Vec2];
}

/** Check AABB overlap (fast path for axis-aligned spots) */
function aabbOverlap(a: EditorSpot, b: EditorSpot): boolean {
  const aLeft = a.cx - a.w / 2;
  const aRight = a.cx + a.w / 2;
  const aTop = a.cy - a.h / 2;
  const aBottom = a.cy + a.h / 2;

  const bLeft = b.cx - b.w / 2;
  const bRight = b.cx + b.w / 2;
  const bTop = b.cy - b.h / 2;
  const bBottom = b.cy + b.h / 2;

  return aLeft < bRight && aRight > bLeft && aTop < bBottom && aBottom > bTop;
}

/** Project corners onto an axis, return min/max */
function project(corners: Vec2[], axis: Vec2): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const c of corners) {
    const dot = c.x * axis.x + c.y * axis.y;
    if (dot < min) min = dot;
    if (dot > max) max = dot;
  }
  return { min, max };
}

/** Get the 2 unique edge normals of a rectangle (4 edges, but parallel pairs share normals) */
function getAxes(corners: Vec2[]): Vec2[] {
  const axes: Vec2[] = [];
  for (let i = 0; i < 2; i++) {
    const edge = {
      x: corners[i + 1].x - corners[i].x,
      y: corners[i + 1].y - corners[i].y,
    };
    // Normal (perpendicular)
    const len = Math.sqrt(edge.x * edge.x + edge.y * edge.y);
    if (len === 0) continue;
    axes.push({ x: -edge.y / len, y: edge.x / len });
  }
  return axes;
}

/** SAT overlap test for two OBBs */
function satOverlap(a: EditorSpot, b: EditorSpot): boolean {
  const cornersA = getCorners(a);
  const cornersB = getCorners(b);

  const axes = [...getAxes(cornersA), ...getAxes(cornersB)];

  for (const axis of axes) {
    const projA = project(cornersA, axis);
    const projB = project(cornersB, axis);
    if (projA.max <= projB.min || projB.max <= projA.min) {
      return false; // Separating axis found
    }
  }

  return true; // No separating axis → overlapping
}

/** Check if two spots overlap, choosing the right algorithm */
export function spotsOverlap(a: EditorSpot, b: EditorSpot): boolean {
  // Shrink by 1 unit on each side to allow touching but not overlapping
  const shrink = 1;
  const aShrunk = { ...a, w: a.w - shrink * 2, h: a.h - shrink * 2 };
  const bShrunk = { ...b, w: b.w - shrink * 2, h: b.h - shrink * 2 };

  if (aShrunk.rot === 0 && bShrunk.rot === 0) {
    return aabbOverlap(aShrunk, bShrunk);
  }
  return satOverlap(aShrunk, bShrunk);
}

/** Check if any spots in `changed` overlap with spots in `all` (excluding themselves) */
export function wouldOverlap(
  changedIds: string[],
  proposed: Record<string, EditorSpot>,
  allSpots: Record<string, EditorSpot>,
): boolean {
  const allIds = Object.keys(allSpots);
  for (const cid of changedIds) {
    const cSpot = proposed[cid];
    if (!cSpot) continue;
    for (const aid of allIds) {
      if (aid === cid) continue;
      if (changedIds.includes(aid)) {
        // Both changed — check proposed vs proposed
        const aSpot = proposed[aid];
        if (aSpot && spotsOverlap(cSpot, aSpot)) return true;
      } else {
        const aSpot = allSpots[aid];
        if (aSpot && spotsOverlap(cSpot, aSpot)) return true;
      }
    }
  }
  return false;
}

/** Find all overlapping spot IDs in the full set */
export function findOverlaps(spots: Record<string, EditorSpot>): Set<string> {
  const ids = Object.keys(spots);
  const overlapping = new Set<string>();

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (spotsOverlap(spots[ids[i]], spots[ids[j]])) {
        overlapping.add(ids[i]);
        overlapping.add(ids[j]);
      }
    }
  }

  return overlapping;
}
