"use client";

import React, { useRef, useState, useCallback, useEffect, useMemo } from "react";
import type { EditorState, EditorAction, SpotGroup } from "./editor/types";
import { snapToGrid } from "./editor/geometry";

const LOT_BOUNDARY_PATH = "M -5,1210 L 1005,1210 L 1005,638 L 780,522 L 640,522 L 390,302 L 390,218 C 362,230 298,170 195,92 L -5,-5 Z";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
type Props = {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
};

// ---------------------------------------------------------------------------
// Group bounding box helper
// ---------------------------------------------------------------------------
type GroupBBox = {
  minX: number; minY: number;
  maxX: number; maxY: number;
  cx: number; cy: number;
};

function computeGroupBBox(
  group: SpotGroup,
  spots: EditorState["spots"],
): GroupBBox | null {
  const sps = group.spotIds.map((id) => spots[id]).filter(Boolean);
  if (sps.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of sps) {
    const hw = Math.max(s.w, s.h) / 2;
    minX = Math.min(minX, s.cx - hw);
    minY = Math.min(minY, s.cy - hw);
    maxX = Math.max(maxX, s.cx + hw);
    maxY = Math.max(maxY, s.cy + hw);
  }

  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function computeMultiGroupBBox(
  groups: SpotGroup[],
  spots: EditorState["spots"],
): GroupBBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let any = false;
  for (const g of groups) {
    const bb = computeGroupBBox(g, spots);
    if (!bb) continue;
    any = true;
    minX = Math.min(minX, bb.minX);
    minY = Math.min(minY, bb.minY);
    maxX = Math.max(maxX, bb.maxX);
    maxY = Math.max(maxY, bb.maxY);
  }
  if (!any) return null;
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function computeAddButtonPositions(
  group: SpotGroup,
  spots: EditorState["spots"],
): { start: { x: number; y: number } | null; end: { x: number; y: number } | null } {
  if (group.spotIds.length === 0) return { start: null, end: null };
  const first = spots[group.spotIds[0]];
  const last = spots[group.spotIds[group.spotIds.length - 1]];
  if (!first) return { start: null, end: null };

  let dirX = 0, dirY = -22.5;
  if (group.spotIds.length >= 2) {
    const second = spots[group.spotIds[1]];
    if (second) {
      dirX = second.cx - first.cx;
      dirY = second.cy - first.cy;
      const len = Math.sqrt(dirX * dirX + dirY * dirY);
      if (len > 0) { dirX /= len; dirY /= len; }
    }
  }

  const hw = Math.max(first.w, first.h) / 2;
  const btnOffset = hw + 14;

  return {
    start: { x: first.cx - dirX * btnOffset, y: first.cy - dirY * btnOffset },
    end: last ? { x: last.cx + dirX * btnOffset, y: last.cy + dirY * btnOffset } : null,
  };
}

function marqueeRect(a: { x: number; y: number }, b: { x: number; y: number }) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

function bboxOverlaps(
  rect: { x: number; y: number; w: number; h: number },
  bbox: GroupBBox,
): boolean {
  return (
    rect.x < bbox.maxX && rect.x + rect.w > bbox.minX &&
    rect.y < bbox.maxY && rect.y + rect.h > bbox.minY
  );
}

// ---------------------------------------------------------------------------
// Main SVG Editor
// ---------------------------------------------------------------------------
export default function LotMapEditor({ state, dispatch }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragAccum, setDragAccum] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  const [marqueeStart, setMarqueeStart] = useState<{ x: number; y: number } | null>(null);
  const [marqueeEnd, setMarqueeEnd] = useState<{ x: number; y: number } | null>(null);
  const isMarquee = marqueeStart !== null && marqueeEnd !== null;

  const [hoveredSpotId, setHoveredSpotId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  const [rotating, setRotating] = useState(false);
  const [rotateStart, setRotateStart] = useState<number>(0);
  const [rotateStartGroupAngle, setRotateStartGroupAngle] = useState<number>(0);
  const [rotatePreview, setRotatePreview] = useState<number | null>(null);


  const screenToSVG = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const inv = ctm.inverse();
      return {
        x: inv.a * clientX + inv.c * clientY + inv.e,
        y: inv.b * clientX + inv.d * clientY + inv.f,
      };
    },
    [],
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        dispatch({ type: "DESELECT_ALL" });
        setRotating(false);
        setRotatePreview(null);
        setMarqueeStart(null);
        setMarqueeEnd(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        dispatch({ type: "UNDO" });
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dispatch]);

  const findGroupForSpot = useCallback(
    (spotId: string) => state.groups.find((g) => g.spotIds.includes(spotId)),
    [state.groups],
  );

  const selectedGroups = useMemo(
    () => state.groups.filter((g) => state.selectedGroupIds.includes(g.id)),
    [state.groups, state.selectedGroupIds],
  );

  const isSingleGroupSelected = selectedGroups.length === 1;
  const singleSelectedGroup = isSingleGroupSelected ? selectedGroups[0] : null;

  const selectionBBox = useMemo(
    () => computeMultiGroupBBox(selectedGroups, state.spots),
    [selectedGroups, state.spots],
  );

  const isMouseInSelectionBBox = useMemo(() => {
    if (!mousePos || !selectionBBox || dragging || rotating) return false;
    const pad = 8;
    return (
      mousePos.x >= selectionBBox.minX - pad && mousePos.x <= selectionBBox.maxX + pad &&
      mousePos.y >= selectionBBox.minY - pad && mousePos.y <= selectionBBox.maxY + pad
    );
  }, [mousePos, selectionBBox, dragging, rotating]);

  const selectedSpotIds = useMemo(() => {
    const set = new Set<string>();
    for (const g of selectedGroups) {
      for (const id of g.spotIds) set.add(id);
    }
    return set;
  }, [selectedGroups]);

  const handleSpotClick = useCallback(
    (spotId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (state.tool === "select") {
        const group = findGroupForSpot(spotId);
        if (group) {
          dispatch({ type: "SELECT_GROUP", groupId: group.id, additive: e.shiftKey });
          dispatch({ type: "SELECT_SPOT", spotId });
        }
      }
    },
    [state.tool, findGroupForSpot, dispatch],
  );

  const handleBackgroundMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (state.tool === "create-group") return;
      if (state.tool === "select") {
        const pt = screenToSVG(e.clientX, e.clientY);
        if (!pt) return;
        if (selectionBBox) {
          const pad = 8;
          const inside =
            pt.x >= selectionBBox.minX - pad && pt.x <= selectionBBox.maxX + pad &&
            pt.y >= selectionBBox.minY - pad && pt.y <= selectionBBox.maxY + pad;
          if (inside) return;
        }
        setMarqueeStart(pt);
        setMarqueeEnd(pt);
      }
    },
    [state.tool, screenToSVG, selectionBBox],
  );

  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      if (state.tool === "create-group") {
        const pt = screenToSVG(e.clientX, e.clientY);
        if (!pt) return;
        const el = document.querySelector("[data-new-group-type]");
        const spotType = (el?.getAttribute("data-new-group-type") as "BOBTAIL" | "TRUCK_TRAILER") || "TRUCK_TRAILER";
        dispatch({ type: "CREATE_GROUP", spotType, cx: pt.x, cy: pt.y, angle: 0 });
      }
    },
    [state.tool, dispatch, screenToSVG],
  );

  const handleMouseDown = useCallback(
    (spotId: string, e: React.MouseEvent) => {
      if (state.tool !== "select") return;
      e.preventDefault();
      e.stopPropagation();
      const group = findGroupForSpot(spotId);
      if (!group) return;
      if (!state.selectedGroupIds.includes(group.id)) {
        dispatch({ type: "SELECT_GROUP", groupId: group.id, additive: e.shiftKey });
      }
      dispatch({ type: "SELECT_SPOT", spotId });
      const pt = screenToSVG(e.clientX, e.clientY);
      if (!pt) return;
      setDragging(true);
      setDragStart(pt);
      setDragAccum({ dx: 0, dy: 0 });
    },
    [state.tool, state.selectedGroupIds, findGroupForSpot, dispatch, screenToSVG],
  );

  const handleGroupAreaMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (state.tool !== "select" || selectedGroups.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const pt = screenToSVG(e.clientX, e.clientY);
      if (!pt) return;
      setDragging(true);
      setDragStart(pt);
      setDragAccum({ dx: 0, dy: 0 });
    },
    [state.tool, selectedGroups, screenToSVG],
  );

  const handleRotateStart = useCallback(
    (e: React.MouseEvent) => {
      if (!singleSelectedGroup || !selectionBBox) return;
      e.preventDefault();
      e.stopPropagation();
      const pt = screenToSVG(e.clientX, e.clientY);
      if (!pt) return;
      const angle = Math.atan2(pt.y - selectionBBox.cy, pt.x - selectionBBox.cx);
      setRotating(true);
      setRotateStart(angle);
      setRotateStartGroupAngle(singleSelectedGroup.angle);
      setRotatePreview(singleSelectedGroup.angle);
    },
    [singleSelectedGroup, selectionBBox, screenToSVG],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const pt = screenToSVG(e.clientX, e.clientY);
      if (pt) setMousePos(pt);
      if (marqueeStart && pt) { setMarqueeEnd(pt); return; }
      if (rotating && selectionBBox && pt) {
        const currentAngle = Math.atan2(pt.y - selectionBBox.cy, pt.x - selectionBBox.cx);
        const delta = ((currentAngle - rotateStart) * 180) / Math.PI;
        const snapped = Math.round((rotateStartGroupAngle + delta) / 0.5) * 0.5;
        setRotatePreview(snapped);
        return;
      }
      if (!dragging || !dragStart || !pt) return;
      setDragAccum({ dx: pt.x - dragStart.x, dy: pt.y - dragStart.y });
    },
    [dragging, dragStart, rotating, rotateStart, rotateStartGroupAngle, selectionBBox, marqueeStart, screenToSVG],
  );

  const handleMouseUp = useCallback(() => {
    if (marqueeStart && marqueeEnd) {
      const rect = marqueeRect(marqueeStart, marqueeEnd);
      if (rect.w > 5 || rect.h > 5) {
        const hitGroupIds: string[] = [];
        for (const group of state.groups) {
          const bbox = computeGroupBBox(group, state.spots);
          if (bbox && bboxOverlaps(rect, bbox)) hitGroupIds.push(group.id);
        }
        dispatch({ type: "SELECT_GROUPS", groupIds: hitGroupIds });
      } else {
        dispatch({ type: "DESELECT_ALL" });
      }
      setMarqueeStart(null);
      setMarqueeEnd(null);
      return;
    }
    if (rotating && singleSelectedGroup && rotatePreview !== null) {
      if (rotatePreview !== singleSelectedGroup.angle) {
        dispatch({ type: "ROTATE_GROUP", groupId: singleSelectedGroup.id, angle: rotatePreview });
      }
      setRotating(false);
      setRotatePreview(null);
      return;
    }
    if (!dragging || state.selectedGroupIds.length === 0) { setDragging(false); return; }
    const snappedDx = snapToGrid(dragAccum.dx);
    const snappedDy = snapToGrid(dragAccum.dy);
    if (snappedDx !== 0 || snappedDy !== 0) {
      dispatch({ type: "MOVE_GROUPS", groupIds: state.selectedGroupIds, dx: snappedDx, dy: snappedDy });
    }
    setDragging(false);
    setDragStart(null);
    setDragAccum({ dx: 0, dy: 0 });
  }, [dragging, dragAccum, rotating, rotatePreview, state.selectedGroupIds, state.groups, state.spots, singleSelectedGroup, marqueeStart, marqueeEnd, dispatch]);

  const getDragOffset = useCallback(
    (spotId: string): { dx: number; dy: number } => {
      if (!dragging || state.selectedGroupIds.length === 0) return { dx: 0, dy: 0 };
      if (!selectedSpotIds.has(spotId)) return { dx: 0, dy: 0 };
      return { dx: snapToGrid(dragAccum.dx), dy: snapToGrid(dragAccum.dy) };
    },
    [dragging, dragAccum, state.selectedGroupIds, selectedSpotIds],
  );

  const svgCursor = useMemo(() => {
    if (state.tool === "create-group") return "crosshair";
    if (dragging) return "grabbing";
    if (rotating) return "grabbing";
    if (isMarquee) return "crosshair";
    if (isMouseInSelectionBBox) return "move";
    return "default";
  }, [state.tool, dragging, rotating, isMarquee, isMouseInSelectionBBox]);

  const addBtnPositions = useMemo(() => {
    if (!singleSelectedGroup) return { start: null, end: null };
    return computeAddButtonPositions(singleSelectedGroup, state.spots);
  }, [singleSelectedGroup, state.spots]);

  const rotHandlePos = useMemo(() => {
    if (!selectionBBox || !singleSelectedGroup) return null;
    return {
      lineX: selectionBBox.cx,
      lineY: selectionBBox.minY - 8,
      handleX: selectionBBox.cx,
      handleY: selectionBBox.minY - 36,
    };
  }, [selectionBBox, singleSelectedGroup]);

  const rotationGhosts = useMemo(() => {
    if (!rotating || rotatePreview === null || !singleSelectedGroup || !selectionBBox) return [];
    const spotObjs = singleSelectedGroup.spotIds.map((id) => state.spots[id]).filter(Boolean);
    if (spotObjs.length === 0) return [];
    const gcx = spotObjs.reduce((s, sp) => s + sp.cx, 0) / spotObjs.length;
    const gcy = spotObjs.reduce((s, sp) => s + sp.cy, 0) / spotObjs.length;
    const oldAngle = (singleSelectedGroup.angle * Math.PI) / 180;
    const newAngle = (rotatePreview * Math.PI) / 180;
    const dAngle = newAngle - oldAngle;
    const cos = Math.cos(dAngle);
    const sin = Math.sin(dAngle);
    return spotObjs.map((sp) => {
      const rx = sp.cx - gcx;
      const ry = sp.cy - gcy;
      return { ...sp, cx: gcx + rx * cos - ry * sin, cy: gcy + rx * sin + ry * cos, rot: rotatePreview };
    });
  }, [rotating, rotatePreview, singleSelectedGroup, selectionBBox, state.spots]);

  useEffect(() => {
    if (state.errorFlash) {
      const t = setTimeout(() => dispatch({ type: "CLEAR_ERROR" }), 2000);
      return () => clearTimeout(t);
    }
  }, [state.errorFlash, dispatch]);

  const mRect = isMarquee ? marqueeRect(marqueeStart!, marqueeEnd!) : null;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }}>
      <svg
        ref={svgRef}
        viewBox="-200 -80 1500 1350"
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", background: "#1C1C1E", cursor: svgCursor, position: "absolute", inset: 0 }}
        onClick={handleBackgroundClick}
        onMouseDown={handleBackgroundMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <defs>
          <pattern id="editorGrid" width="50" height="50" patternUnits="userSpaceOnUse">
            <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
          </pattern>
          <pattern id="editorGridSmall" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.3" />
          </pattern>
          <style>{`
            @keyframes overlapPulse {
              0%, 100% { stroke-opacity: 1; }
              50% { stroke-opacity: 0.4; }
            }
            .overlap-spot { animation: overlapPulse 1s ease-in-out infinite; }
          `}</style>
        </defs>

        {/* Base + grid across everything */}
        <rect x="-500" y="-500" width="2500" height="2500" fill="#1C1C1E" />
        <rect x="-500" y="-500" width="2500" height="2500" fill="url(#editorGridSmall)" />
        <rect x="-500" y="-500" width="2500" height="2500" fill="url(#editorGrid)" />

        {/* Lot interior covers grid inside boundary */}
        <path d={LOT_BOUNDARY_PATH} fill="#1C1C1E" />
        <path d={LOT_BOUNDARY_PATH} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />


        {/* Spots */}
        {Object.values(state.spots).map((spot) => {
          const offset = getDragOffset(spot.id);
          const cx = spot.cx + offset.dx;
          const cy = spot.cy + offset.dy;

          const isInSelection = selectedSpotIds.has(spot.id);
          const isSpotSelected = state.selectedSpotId === spot.id;
          const isOverlap = state.overlaps.has(spot.id);
          const isHovered = hoveredSpotId === spot.id;
          const isTruck = spot.type === "TRUCK_TRAILER";

          let fill: string;
          let stroke: string;
          let sw: number;

          if (isOverlap) {
            fill = "#3B1818"; stroke = "#DC2626"; sw = 2;
          } else if (isSpotSelected) {
            fill = isTruck ? "#1A3A2A" : "#1A2A3A"; stroke = "#fff"; sw = 2;
          } else if (isInSelection) {
            fill = isTruck ? "#1A3A2A" : "#1A2A3A"; stroke = "#fff"; sw = 1.5;
          } else if (isHovered) {
            fill = isTruck ? "#162E22" : "#162230";
            stroke = isTruck ? "#4ADE80" : "#60A5FA";
            sw = 1;
          } else {
            fill = isTruck ? "#12261C" : "#121E2C";
            stroke = isTruck ? "#2D7A4A" : "#2563EB";
            sw = 0.7;
          }

          const transform = spot.rot !== 0 ? `rotate(${spot.rot}, ${cx}, ${cy})` : undefined;
          const fontSize = Math.max(10, Math.min(16, Math.min(spot.w, spot.h) * 0.75));

          return (
            <g
              key={spot.id}
              transform={transform}
              style={{ cursor: state.tool === "select" ? (dragging ? "grabbing" : "grab") : "pointer" }}
              onMouseEnter={() => setHoveredSpotId(spot.id)}
              onMouseLeave={() => setHoveredSpotId(null)}
              onClick={(e) => handleSpotClick(spot.id, e)}
              onMouseDown={(e) => handleMouseDown(spot.id, e)}
            >
              <rect
                x={cx - spot.w / 2} y={cy - spot.h / 2}
                width={spot.w} height={spot.h} rx={1}
                fill={fill} stroke={stroke} strokeWidth={sw}
                className={isOverlap ? "overlap-spot" : undefined}
              />
              <text
                x={cx} y={cy + fontSize * 0.35}
                fontSize={fontSize} fill={isOverlap ? "#F87171" : "rgba(255,255,255,0.5)"}
                textAnchor="middle" fontFamily="var(--font-body)"
                fontWeight="700" pointerEvents="none"
              >
                {spot.label}
              </text>
            </g>
          );
        })}

        {/* Rotation ghost preview */}
        {rotationGhosts.map((ghost) => {
          const transform = ghost.rot !== 0 ? `rotate(${ghost.rot}, ${ghost.cx}, ${ghost.cy})` : undefined;
          return (
            <g key={`ghost-${ghost.id}`} transform={transform} pointerEvents="none" opacity={0.3}>
              <rect
                x={ghost.cx - ghost.w / 2} y={ghost.cy - ghost.h / 2}
                width={ghost.w} height={ghost.h} rx={1}
                fill="none" stroke="#fff" strokeWidth="1" strokeDasharray="3 2"
              />
            </g>
          );
        })}

        {/* Selection bounding box */}
        {selectedGroups.length > 0 && selectionBBox && (() => {
          const bbox = dragging
            ? {
                ...selectionBBox,
                minX: selectionBBox.minX + snapToGrid(dragAccum.dx),
                minY: selectionBBox.minY + snapToGrid(dragAccum.dy),
                maxX: selectionBBox.maxX + snapToGrid(dragAccum.dx),
                maxY: selectionBBox.maxY + snapToGrid(dragAccum.dy),
                cx: selectionBBox.cx + snapToGrid(dragAccum.dx),
                cy: selectionBBox.cy + snapToGrid(dragAccum.dy),
              }
            : selectionBBox;
          const pad = 8;
          return (
            <>
              <rect
                x={bbox.minX - pad} y={bbox.minY - pad}
                width={bbox.maxX - bbox.minX + pad * 2}
                height={bbox.maxY - bbox.minY + pad * 2}
                fill="transparent" stroke="none"
                style={{ cursor: dragging ? "grabbing" : "move" }}
                onMouseDown={handleGroupAreaMouseDown}
              />
              <rect
                x={bbox.minX - pad} y={bbox.minY - pad}
                width={bbox.maxX - bbox.minX + pad * 2}
                height={bbox.maxY - bbox.minY + pad * 2}
                rx={2} fill="none" stroke="rgba(255,255,255,0.25)"
                strokeWidth="1" strokeDasharray="4 3"
                pointerEvents="none"
              />
              {selectedGroups.length > 1 && (
                <g pointerEvents="none">
                  <rect
                    x={bbox.maxX + pad + 4} y={bbox.minY - pad}
                    width={36} height={16} rx={3}
                    fill="rgba(255,255,255,0.12)"
                  />
                  <text
                    x={bbox.maxX + pad + 22} y={bbox.minY - pad + 11.5}
                    fontSize="8" fill="rgba(255,255,255,0.6)" textAnchor="middle"
                    fontFamily="var(--font-body)" fontWeight="600"
                  >
                    {selectedGroups.length} grps
                  </text>
                </g>
              )}
            </>
          );
        })()}

        {/* Rotation handle */}
        {singleSelectedGroup && rotHandlePos && !dragging && (() => {
          const pos = rotHandlePos;
          const displayAngle = rotatePreview ?? singleSelectedGroup.angle;
          return (
            <g>
              <line x1={pos.lineX} y1={pos.lineY} x2={pos.handleX} y2={pos.handleY}
                stroke="rgba(255,255,255,0.2)" strokeWidth="1" pointerEvents="none" />
              <circle cx={pos.handleX} cy={pos.handleY} r={6}
                fill="#2C2C2E" stroke="rgba(255,255,255,0.4)" strokeWidth="1"
                style={{ cursor: "grab" }}
                onMouseDown={(e) => { e.stopPropagation(); handleRotateStart(e); }}
                onClick={(e) => e.stopPropagation()} />
              {rotating && (
                <g pointerEvents="none">
                  <rect x={pos.handleX + 10} y={pos.handleY - 8} width={38} height={16} rx={2} fill="#2C2C2E" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
                  <text x={pos.handleX + 29} y={pos.handleY + 2} fontSize="8" fill="rgba(255,255,255,0.7)"
                    textAnchor="middle" fontFamily="var(--font-body)" fontWeight="500">
                    {displayAngle}°
                  </text>
                </g>
              )}
            </g>
          );
        })()}

        {/* Add spot buttons */}
        {singleSelectedGroup && !dragging && !rotating && (() => {
          const r = 8;
          const btns: React.ReactNode[] = [];
          const mkBtn = (key: string, pos: { x: number; y: number }, position: "start" | "end") => (
            <g key={key} style={{ cursor: "pointer" }}
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: "ADD_SPOT", groupId: singleSelectedGroup.id, position });
              }}>
              <circle cx={pos.x} cy={pos.y} r={r} fill="#2C2C2E" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
              <line x1={pos.x - 3.5} y1={pos.y} x2={pos.x + 3.5} y2={pos.y} stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" />
              <line x1={pos.x} y1={pos.y - 3.5} x2={pos.x} y2={pos.y + 3.5} stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" />
            </g>
          );
          if (addBtnPositions.start) btns.push(mkBtn("add-start", addBtnPositions.start, "start"));
          if (addBtnPositions.end) btns.push(mkBtn("add-end", addBtnPositions.end, "end"));
          return btns;
        })()}

        {/* Marquee */}
        {mRect && mRect.w > 2 && mRect.h > 2 && (
          <rect
            x={mRect.x} y={mRect.y} width={mRect.w} height={mRect.h}
            fill="rgba(255,255,255,0.03)"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth="1" strokeDasharray="4 2"
            pointerEvents="none" rx={1}
          />
        )}
      </svg>

      {/* Error flash */}
      {state.errorFlash && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "6px 16px",
            background: "#DC2626",
            color: "#fff",
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 500,
            fontFamily: "var(--font-body)",
            zIndex: 50,
            pointerEvents: "none",
          }}
        >
          {state.errorFlash}
        </div>
      )}
    </div>
  );
}
