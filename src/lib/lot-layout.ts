import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { log as auditLog } from "./audit";
import type { SpotLayout } from "@/types/domain";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LotLayoutSnapshot = {
  spots: SpotLayout[];
  groups: unknown;
};

export type LotLayoutDiffSummary = {
  added: string[];              // spot ids added in this version
  removedArchived: string[];    // spot ids removed (archived) in this version
  renamed: { id: string; from: string; to: string }[];
  moved: string[];              // spot ids whose geometry changed
  typeChanged: string[];        // spot ids whose type changed
  groupsChanged: boolean;
};

// Treat sub-pixel float jitter as "not moved" so a re-save of the same layout
// doesn't log phantom moves.
const MOVE_EPSILON = 0.01;

function geometryChanged(a: SpotLayout, b: SpotLayout): boolean {
  return (
    Math.abs(a.cx - b.cx) > MOVE_EPSILON ||
    Math.abs(a.cy - b.cy) > MOVE_EPSILON ||
    Math.abs(a.w - b.w) > MOVE_EPSILON ||
    Math.abs(a.h - b.h) > MOVE_EPSILON ||
    Math.abs(a.rot - b.rot) > MOVE_EPSILON
  );
}

export function computeDiff(
  prev: LotLayoutSnapshot | null,
  next: LotLayoutSnapshot,
): LotLayoutDiffSummary {
  const diff: LotLayoutDiffSummary = {
    added: [],
    removedArchived: [],
    renamed: [],
    moved: [],
    typeChanged: [],
    groupsChanged: false,
  };

  if (!prev) {
    // First snapshot after baseline — treat everything as added, no "moved".
    diff.added = next.spots.map((s) => s.id);
    diff.groupsChanged = true;
    return diff;
  }

  const prevById = new Map(prev.spots.map((s) => [s.id, s]));
  const nextById = new Map(next.spots.map((s) => [s.id, s]));

  for (const [id, spot] of nextById) {
    const before = prevById.get(id);
    if (!before) {
      diff.added.push(id);
      continue;
    }
    if (before.label !== spot.label) {
      diff.renamed.push({ id, from: before.label, to: spot.label });
    }
    if (before.type !== spot.type) {
      diff.typeChanged.push(id);
    }
    if (geometryChanged(before, spot)) {
      diff.moved.push(id);
    }
  }
  for (const id of prevById.keys()) {
    if (!nextById.has(id)) diff.removedArchived.push(id);
  }

  diff.groupsChanged = JSON.stringify(prev.groups) !== JSON.stringify(next.groups);

  return diff;
}

// ---------------------------------------------------------------------------
// Apply a layout + create a version row (atomic)
// ---------------------------------------------------------------------------

export type ApplyLayoutInput = {
  spots: SpotLayout[];
  groups: unknown;
  message?: string | null;
  restoredFromId?: string | null;
  createdBy: string;
};

export type ApplyLayoutResult = {
  version: {
    id: string;
    createdAt: Date;
    spotCount: number;
    diffSummary: LotLayoutDiffSummary;
    parentId: string | null;
    restoredFromId: string | null;
  };
};

export async function applyLayoutAndCreateVersion(
  input: ApplyLayoutInput,
): Promise<ApplyLayoutResult> {
  const { spots: incoming, groups, message, restoredFromId, createdBy } = input;
  const incomingIds = new Set(incoming.map((s) => s.id));

  // Pull current state (only non-archived spots count as "existing" for the
  // purpose of this save — an archived spot being re-added would still be a
  // brand new spot entry for version history purposes).
  const [existingSpots, latestVersion] = await Promise.all([
    prisma.spot.findMany({
      where: { archivedAt: null },
      select: {
        id: true, label: true, type: true,
        cx: true, cy: true, w: true, h: true, rot: true,
      },
    }),
    prisma.lotLayoutVersion.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true, snapshot: true } }),
  ]);

  const prevSnapshot = (latestVersion?.snapshot as unknown as LotLayoutSnapshot | null) ?? null;
  const nextSnapshot: LotLayoutSnapshot = { spots: incoming, groups };
  const diff = computeDiff(prevSnapshot, nextSnapshot);

  // IDs to archive = existing non-archived spots that aren't in the incoming set.
  const toArchive = existingSpots
    .filter((s) => !incomingIds.has(s.id))
    .map((s) => s.id);

  const result = await prisma.$transaction(async (tx) => {
    // Upsert incoming spots. Reset archivedAt if a previously archived spot
    // is being brought back with the same id.
    for (const spot of incoming) {
      await tx.spot.upsert({
        where: { id: spot.id },
        create: {
          id: spot.id,
          label: spot.label,
          type: spot.type,
          cx: spot.cx,
          cy: spot.cy,
          w: spot.w,
          h: spot.h,
          rot: spot.rot,
          archivedAt: null,
        },
        update: {
          label: spot.label,
          type: spot.type,
          cx: spot.cx,
          cy: spot.cy,
          w: spot.w,
          h: spot.h,
          rot: spot.rot,
          archivedAt: null,
        },
      });
    }

    // Archive rather than hard-delete. Keeps FK targets for historical
    // sessions and audit logs.
    if (toArchive.length > 0) {
      await tx.spot.updateMany({
        where: { id: { in: toArchive }, archivedAt: null },
        data: { archivedAt: new Date() },
      });
    }

    // Persist groups (editor metadata).
    await tx.settings.upsert({
      where: { id: "default" },
      create: { lotGroups: groups as Prisma.InputJsonValue },
      update: { lotGroups: groups as Prisma.InputJsonValue },
    });

    // Create the version row.
    const version = await tx.lotLayoutVersion.create({
      data: {
        createdBy,
        message: message ?? null,
        spotCount: incoming.length,
        snapshot: nextSnapshot as unknown as Prisma.InputJsonValue,
        diffSummary: diff as unknown as Prisma.InputJsonValue,
        parentId: latestVersion?.id ?? null,
        restoredFromId: restoredFromId ?? null,
      },
      select: {
        id: true, createdAt: true, spotCount: true, parentId: true, restoredFromId: true,
      },
    });

    return version;
  });

  // Audit trail — outside the transaction to avoid blocking.
  await auditLog({
    action: restoredFromId ? "LAYOUT_RESTORED" : "LAYOUT_SAVED",
    details: JSON.stringify({
      versionId: result.id,
      createdBy,
      restoredFromId: restoredFromId ?? null,
      counts: {
        added: diff.added.length,
        removed: diff.removedArchived.length,
        renamed: diff.renamed.length,
        moved: diff.moved.length,
        typeChanged: diff.typeChanged.length,
      },
      message: message ?? null,
    }),
  });

  return {
    version: {
      id: result.id,
      createdAt: result.createdAt,
      spotCount: result.spotCount,
      diffSummary: diff,
      parentId: result.parentId,
      restoredFromId: result.restoredFromId,
    },
  };
}
