"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LotMapViewer from "@/components/lot/LotMapViewer";
import { apiFetch, apiPost } from "@/lib/fetch";
import type {
  ApiLotLayoutVersion,
  ApiLotLayoutVersionSummary,
  LotLayoutDiffSummary,
  SpotLayout,
} from "@/types/domain";

type Props = {
  open: boolean;
  onClose: () => void;
  onRestored: () => void;
};

const T = "160ms ease";

function fmtRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.round((now - then) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 14) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function fmtAbsolute(iso: string): string {
  return new Date(iso).toLocaleString();
}

function diffChip(diff: LotLayoutDiffSummary | null): string {
  if (!diff) return "baseline";
  const parts: string[] = [];
  if (diff.added.length) parts.push(`+${diff.added.length}`);
  if (diff.removedArchived.length) parts.push(`−${diff.removedArchived.length}`);
  if (diff.renamed.length) parts.push(`~${diff.renamed.length}`);
  if (diff.moved.length) parts.push(`↻${diff.moved.length}`);
  if (diff.typeChanged.length) parts.push(`⇄${diff.typeChanged.length}`);
  return parts.length ? parts.join(" ") : "no change";
}

export default function LotHistoryDrawer({ open, onClose, onRestored }: Props) {
  const [versions, setVersions] = useState<ApiLotLayoutVersionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ApiLotLayoutVersion | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string>("");

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ versions: ApiLotLayoutVersionSummary[] }>(
        "/api/admin/layout-history?limit=50",
      );
      setVersions(data.versions);
      if (data.versions.length && !selectedId) {
        setSelectedId(data.versions[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    if (open) loadList();
  }, [open, loadList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<{ version: ApiLotLayoutVersion }>(
          `/api/admin/layout-history/${selectedId}`,
        );
        if (!cancelled) setDetail(data.version);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load version");
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  const handleRestore = useCallback(async () => {
    if (!detail) return;
    const short = detail.id.slice(0, 8);
    if (!confirm(
      `Restore version ${short}?\n\nThis creates a NEW version matching the selected state — your current layout stays in history.`,
    )) return;
    setRestoring(true);
    setError("");
    try {
      await apiPost(`/api/admin/layout-history/${detail.id}/restore`, {});
      await loadList();
      onRestored();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setRestoring(false);
    }
  }, [detail, loadList, onRestored]);

  const snapshotSpots: SpotLayout[] = useMemo(() => {
    if (!detail) return [];
    const s = detail.snapshot;
    return Array.isArray(s?.spots) ? (s.spots as SpotLayout[]) : [];
  }, [detail]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.5)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: `opacity ${T}`,
          zIndex: 200,
        }}
      />

      {/* Drawer */}
      <aside
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0,
          width: "min(920px, 100vw)",
          background: "#1C1C1E",
          borderLeft: "1px solid #2C2C2E",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: `transform 220ms ease`,
          display: "flex",
          flexDirection: "column",
          zIndex: 201,
          fontFamily: "var(--font-body)",
        }}
      >
        {/* Header */}
        <header style={{
          padding: "14px 20px",
          borderBottom: "1px solid #2C2C2E",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 13, color: "#98989D", fontWeight: 500 }}>Lot layout history</div>
            <div style={{ fontSize: 11, color: "#6E6E73", marginTop: 2 }}>
              Every save is kept. Restore creates a new version, nothing is lost.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: "6px 12px", fontSize: 12, color: "#AEAEB2",
              background: "transparent", border: "1px solid #3A3A3C",
              borderRadius: 6, cursor: "pointer",
            }}
          >
            Close
          </button>
        </header>

        {/* Body: list + preview */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* List */}
          <div style={{
            width: 300,
            borderRight: "1px solid #2C2C2E",
            overflowY: "auto",
            background: "#141416",
          }}>
            {loading && (
              <div style={{ padding: 20, fontSize: 12, color: "#6E6E73" }}>Loading…</div>
            )}
            {!loading && versions.length === 0 && (
              <div style={{ padding: 20, fontSize: 12, color: "#6E6E73" }}>No versions yet.</div>
            )}
            {versions.map((v) => {
              const isSel = v.id === selectedId;
              return (
                <button
                  key={v.id}
                  onClick={() => setSelectedId(v.id)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "10px 14px",
                    background: isSel ? "#1A1A2E" : "transparent",
                    borderLeft: isSel ? "2px solid #6366F1" : "2px solid transparent",
                    border: "none", borderBottom: "1px solid #2C2C2E",
                    color: "#F2F2F7", fontSize: 12, cursor: "pointer",
                    fontFamily: "var(--font-body)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontWeight: 600 }}>{fmtRelative(v.createdAt)}</span>
                    <span style={{
                      fontSize: 10, color: "#8E8E93",
                      background: "#2C2C2E", padding: "1px 6px", borderRadius: 3,
                    }}>
                      {diffChip(v.diffSummary)}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "#8E8E93", marginBottom: 2 }}>
                    {v.createdBy}{v.restoredFromId ? " · restored" : ""}
                  </div>
                  {v.message && (
                    <div style={{ fontSize: 11, color: "#AEAEB2", fontStyle: "italic" }}>
                      {v.message}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Preview pane */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {detail ? (
              <>
                <div style={{
                  padding: "12px 20px",
                  borderBottom: "1px solid #2C2C2E",
                  flexShrink: 0,
                }}>
                  <div style={{ fontSize: 13, color: "#F2F2F7", fontWeight: 600 }}>
                    {fmtAbsolute(detail.createdAt)}
                  </div>
                  <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 2 }}>
                    {detail.createdBy} · {detail.spotCount} spots
                    {detail.restoredFromId && (
                      <> · restored from <code style={{ fontSize: 10 }}>{detail.restoredFromId.slice(0, 8)}</code></>
                    )}
                  </div>
                  {detail.message && (
                    <div style={{ fontSize: 12, color: "#AEAEB2", marginTop: 6, fontStyle: "italic" }}>
                      "{detail.message}"
                    </div>
                  )}
                  {detail.diffSummary && (
                    <DiffList diff={detail.diffSummary} snapshotSpots={snapshotSpots} />
                  )}
                </div>

                <div style={{ flex: 1, overflow: "auto", background: "#1C1C1E" }}>
                  <LotMapViewer
                    spots={snapshotSpots}
                    statuses={{}}
                    selectedSpotId={null}
                    onSelectSpot={() => {}}
                  />
                </div>

                <div style={{
                  padding: "10px 20px",
                  borderTop: "1px solid #2C2C2E",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 12, flexShrink: 0,
                }}>
                  <div style={{ fontSize: 11, color: error ? "#F87171" : "#6E6E73" }}>
                    {error || "Preview is read-only. Restore to apply."}
                  </div>
                  <button
                    onClick={handleRestore}
                    disabled={restoring}
                    style={{
                      padding: "8px 16px", fontSize: 12, fontWeight: 600,
                      background: restoring ? "#3A3A3C" : "#0A84FF", color: "#fff",
                      border: "none", borderRadius: 6,
                      cursor: restoring ? "default" : "pointer",
                    }}
                  >
                    {restoring ? "Restoring…" : "Restore this version"}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ padding: 20, fontSize: 12, color: "#6E6E73" }}>
                Select a version to preview.
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function DiffList({
  diff,
  snapshotSpots,
}: {
  diff: LotLayoutDiffSummary;
  snapshotSpots: SpotLayout[];
}) {
  const labelOf = (id: string) =>
    snapshotSpots.find((s) => s.id === id)?.label ?? id;

  const lines: string[] = [];
  if (diff.added.length)
    lines.push(`Added: ${diff.added.map(labelOf).join(", ")}`);
  if (diff.removedArchived.length)
    lines.push(`Archived: ${diff.removedArchived.length} spot(s)`);
  if (diff.renamed.length)
    lines.push(`Renamed: ${diff.renamed.map((r) => `${r.from}→${r.to}`).join(", ")}`);
  if (diff.typeChanged.length)
    lines.push(`Type changed: ${diff.typeChanged.map(labelOf).join(", ")}`);
  if (diff.moved.length)
    lines.push(`Moved: ${diff.moved.length} spot(s)`);
  if (!lines.length) return null;
  return (
    <ul style={{ margin: "8px 0 0", paddingLeft: 14, fontSize: 11, color: "#8E8E93" }}>
      {lines.map((l) => <li key={l} style={{ marginBottom: 2 }}>{l}</li>)}
    </ul>
  );
}
