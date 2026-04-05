"use client";

import React, { useState } from "react";
import type { EditorState, EditorAction, EditorTool, SpotType } from "./types";

type Props = {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  onReset: () => void;
  onExport: () => string;
  saved: boolean;
};

export default function EditorSidebar({ state, dispatch, onReset, onExport, saved }: Props) {
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newGroupType, setNewGroupType] = useState<SpotType>("TRUCK_TRAILER");

  const selectedGroupIds = state.selectedGroupIds;
  const isSingleSelected = selectedGroupIds.length === 1;
  const overlapCount = state.overlaps.size;

  function commitRename() {
    if (renamingGroupId && renameValue.trim()) {
      dispatch({ type: "RENAME_GROUP", groupId: renamingGroupId, name: renameValue.trim() });
    }
    setRenamingGroupId(null);
  }

  return (
    <div
      style={{
        width: 260,
        minWidth: 260,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#2C2C2E",
        borderRight: "1px solid #3A3A3C",
        fontFamily: "var(--font-body)",
        overflow: "hidden",
        color: "#E5E5E5",
      }}
    >
      {/* Header */}
      <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid #3A3A3C" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#E5E5E5" }}>Lot Editor</span>
          {saved && (
            <span style={{ fontSize: 10, fontWeight: 500, color: "#30D158" }}>Saved</span>
          )}
        </div>
        <span style={{ fontSize: 11, color: "#98989D", marginTop: 2, display: "block" }}>
          {Object.keys(state.spots).length} spots · {state.groups.length} groups
        </span>
      </div>

      {/* Tools */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid #3A3A3C", display: "flex", gap: 1 }}>
        {(["select", "create-group"] as EditorTool[]).map((tool) => {
          const active = state.tool === tool;
          const label = tool === "select" ? "Select" : "New Group";
          return (
            <button
              key={tool}
              onClick={() => dispatch({ type: "SET_TOOL", tool })}
              style={{
                flex: 1,
                padding: "6px 0",
                fontSize: 11,
                fontWeight: 500,
                fontFamily: "var(--font-body)",
                border: "none",
                borderRadius: 4,
                background: active ? "#48484A" : "transparent",
                color: active ? "#fff" : "#98989D",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* New Group type picker */}
      {state.tool === "create-group" && (
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #3A3A3C" }}>
          <p style={{ fontSize: 11, color: "#98989D", margin: "0 0 8px" }}>
            Click on the map to place.
          </p>
          <div style={{ display: "flex", gap: 1, background: "#1C1C1E", borderRadius: 4, padding: 1 }}>
            {(["TRUCK_TRAILER", "BOBTAIL"] as SpotType[]).map((t) => {
              const active = newGroupType === t;
              return (
                <button
                  key={t}
                  onClick={() => setNewGroupType(t)}
                  style={{
                    flex: 1,
                    padding: "5px 0",
                    fontSize: 11,
                    fontWeight: 500,
                    fontFamily: "var(--font-body)",
                    border: "none",
                    borderRadius: 3,
                    background: active ? "#48484A" : "transparent",
                    color: active ? "#fff" : "#98989D",
                    cursor: "pointer",
                  }}
                >
                  {t === "TRUCK_TRAILER" ? "Truck" : "Bobtail"}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Overlap warning */}
      {overlapCount > 0 && (
        <div style={{ padding: "6px 16px", borderBottom: "1px solid #3A3A3C", background: "#3B1818" }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: "#F87171" }}>
            {overlapCount} spot{overlapCount !== 1 ? "s" : ""} overlapping
          </span>
        </div>
      )}

      {/* Groups */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
        <p style={{ fontSize: 10, fontWeight: 600, color: "#636366", margin: "0 16px 6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Groups
        </p>
        {state.groups.map((group) => {
          const isSelected = selectedGroupIds.includes(group.id);
          const hasOverlap = group.spotIds.some((id) => state.overlaps.has(id));
          const isTruck = group.type === "TRUCK_TRAILER";

          return (
            <div key={group.id}>
              <button
                onClick={() => dispatch({ type: "SELECT_GROUP", groupId: group.id })}
                onDoubleClick={() => {
                  setRenamingGroupId(group.id);
                  setRenameValue(group.name);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "7px 16px",
                  border: "none",
                  background: isSelected ? "#48484A" : "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: hasOverlap ? "#DC2626" : (isTruck ? "#2D7A4A" : "#2563EB"),
                    flexShrink: 0,
                  }}
                />
                {renamingGroupId === group.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setRenamingGroupId(null);
                    }}
                    onBlur={commitRename}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      flex: 1,
                      fontSize: 12,
                      fontWeight: 500,
                      border: "1px solid #636366",
                      borderRadius: 3,
                      padding: "2px 6px",
                      background: "#1C1C1E",
                      color: "#E5E5E5",
                      fontFamily: "var(--font-body)",
                      outline: "none",
                    }}
                  />
                ) : (
                  <span
                    style={{
                      flex: 1,
                      fontSize: 12,
                      fontWeight: isSelected ? 500 : 400,
                      color: isSelected ? "#fff" : "#AEAEB2",
                      fontFamily: "var(--font-body)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {group.name}
                  </span>
                )}
                <span style={{ fontSize: 11, color: "#636366", fontWeight: 500, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                  {group.spotIds.length}
                </span>
              </button>

              {isSelected && isSingleSelected && (
                <div style={{ padding: "4px 16px 8px 30px", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, color: "#636366" }}>
                    {group.angle}° · {Math.round(group.spacing)}px
                  </span>
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${group.name}"?`)) {
                        dispatch({ type: "DELETE_GROUP", groupId: group.id });
                      }
                    }}
                    style={{
                      marginLeft: "auto",
                      padding: "2px 8px",
                      fontSize: 10,
                      fontWeight: 500,
                      border: "none",
                      borderRadius: 3,
                      background: "#3B1818",
                      color: "#F87171",
                      cursor: "pointer",
                      fontFamily: "var(--font-body)",
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Hints */}
      {selectedGroupIds.length > 0 && (
        <div style={{ padding: "8px 16px", borderTop: "1px solid #3A3A3C" }}>
          <p style={{ fontSize: 10, color: "#636366", margin: 0, lineHeight: 1.5 }}>
            Drag to move · Shift+click multi-select · Drag bg to lasso
          </p>
        </div>
      )}

      {/* Bottom */}
      <div style={{ padding: "10px 16px", borderTop: "1px solid #3A3A3C", display: "flex", flexDirection: "column", gap: 6 }}>
        <button
          onClick={() => dispatch({ type: "UNDO" })}
          disabled={state.undoStack.length === 0}
          style={{
            padding: "7px",
            fontSize: 11,
            fontWeight: 500,
            border: "1px solid #3A3A3C",
            borderRadius: 4,
            background: "transparent",
            color: state.undoStack.length === 0 ? "#48484A" : "#AEAEB2",
            cursor: state.undoStack.length === 0 ? "default" : "pointer",
            fontFamily: "var(--font-body)",
          }}
        >
          Undo{state.undoStack.length > 0 ? ` (${state.undoStack.length})` : ""}
        </button>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => { navigator.clipboard.writeText(onExport()); }}
            style={btnStyle}
          >
            Export
          </button>
          <button
            onClick={() => { if (confirm("Reset all?")) onReset(); }}
            style={{ ...btnStyle, color: "#F87171" }}
          >
            Reset
          </button>
        </div>
      </div>

      {state.tool === "create-group" && (
        <input type="hidden" data-new-group-type={newGroupType} data-new-group-angle={0} />
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  flex: 1,
  padding: "7px",
  fontSize: 11,
  fontWeight: 500,
  border: "1px solid #3A3A3C",
  borderRadius: 4,
  background: "transparent",
  color: "#AEAEB2",
  cursor: "pointer",
  fontFamily: "var(--font-body)",
};
