# Lot Layout History + Session Label Snapshots

Google-Docs-style version history for the lot editor, plus a session-level safeguard
so future spot renames never rewrite historical records.

> Landed on branch `lot-history-versioning`. See commits `214a386` … `e3bcd04`.

---

## The problem

`Spot.label` is mutable. `Session.spotId` is a foreign key. Every display of a
session's spot goes through a live `session.spot.label` JOIN. So if an admin renamed
`A-12` to `B-5`, every completed session that ever parked in `A-12` silently rebranded
to `B-5` across admin reports, SMS logs, and audit history — retroactive history
corruption with no warning.

There was also no record of *what the lot looked like* on any past date and no undo
after a save.

## The solution — two layers

**Layer A — `Session.spotLabelSnapshot`** (immutable).
Populated at session creation with the spot's label at that moment. All historical
displays go through `getSessionSpotLabel()` in `src/lib/sessions.ts`, which prefers
the snapshot and falls back to `spot.label` only for legacy rows.

**Layer B — `LotLayoutVersion`** (append-only).
Every save of the lot editor writes a full snapshot of `{ spots, groups }` plus a
`diffSummary`. Restore is **non-destructive** — restoring an old version appends a
new row equal to that state. Previous versions are preserved.

Together they solve two independent concerns: session history is no longer a
dangling pointer into the live Spot table, and admins get a full audit trail of
layout changes with one-click restore.

---

## Data model

Changes to `prisma/schema.prisma`:

```prisma
model Session {
  // ...existing fields...
  spotLabelSnapshot String @default("")   // "" = legacy row; read via getSessionSpotLabel()
}

model Spot {
  // ...existing fields...
  archivedAt DateTime?                    // archival replaces hard-deletion
  @@index([archivedAt])
}

model LotLayoutVersion {
  id             String   @id @default(uuid())
  createdAt      DateTime @default(now())
  createdBy      String                   // admin id (JWT.sub); "system" for baseline
  message        String?                  // optional commit-style note
  spotCount      Int
  snapshot       Json                     // { spots: SpotLayout[], groups: unknown }
  diffSummary    Json?                    // LotLayoutDiffSummary; null on baseline
  parentId       String?                  // previous version id (null on baseline)
  restoredFromId String?                  // set when this version was born from a restore
  @@index([createdAt(sort: Desc)])
}

enum AuditAction {
  // ...existing values...
  LAYOUT_SAVED
  LAYOUT_RESTORED
}
```

`LotLayoutDiffSummary` shape (TS definition lives in `src/types/domain.ts`):

```ts
type LotLayoutDiffSummary = {
  added: string[];              // spot ids new in this version
  removedArchived: string[];    // spot ids archived in this version
  renamed: { id: string; from: string; to: string }[];
  moved: string[];              // geometry changed beyond 0.01 epsilon
  typeChanged: string[];        // BOBTAIL ↔ TRUCK_TRAILER
  groupsChanged: boolean;       // JSON-equality check on lotGroups
};
```

---

## Save lifecycle

1. Admin edits layout in `/lot` (edit mode).
2. Unsaved-changes bar surfaces with an optional "Note" input.
3. Click Save → `useEditorReducer.saveSnapshot({ message })` → `PUT /api/spots/layout`
   with `{ spots, groups, message? }`.
4. `src/lib/lot-layout.ts::applyLayoutAndCreateVersion`:
   - Loads current non-archived spots + latest `LotLayoutVersion`.
   - Computes diff against the latest version's snapshot.
   - `prisma.$transaction`:
     - Upsert every incoming spot (resetting `archivedAt` if it was set).
     - `updateMany` to set `archivedAt: now()` on any existing non-archived spot
       that's missing from the incoming set.
     - Upsert `Settings.lotGroups`.
     - Insert `LotLayoutVersion` with snapshot + diff + `parentId` pointing at the
       previous latest.
   - After transaction: `auditLog()` writes `LAYOUT_SAVED` with version id + diff
     counts. (Audit is outside the transaction so a failed audit never rolls back
     a successful save.)

```
edit → Save → PUT /api/spots/layout
                 └→ applyLayoutAndCreateVersion
                       ├→ tx: upsert spots, archive missing, update groups, insert version
                       └→ audit log LAYOUT_SAVED
```

## Restore lifecycle

`POST /api/admin/layout-history/[id]/restore` → load target version's snapshot →
call `applyLayoutAndCreateVersion` with `restoredFromId = sourceId`. Result: a new
row in `LotLayoutVersion` whose `snapshot` equals the source, whose `parentId` is
still the previous latest (not the source — this preserves chronological order),
and whose `restoredFromId` points back at the source. The live `Spot` table is
updated to match.

Because restore reuses the same apply function, all the archival / diffing rules
are identical to a normal save.

---

## Archival rules

The lot map has a hard rule: **spots are never hard-deleted**.

- `Spot` rows referenced by any session (past or present) must survive forever so
  sessions, payments, and audit logs have a valid FK target. Previously the PUT
  handler only protected ACTIVE/OVERSTAY sessions — it would have tripped Prisma's
  `Restrict` FK on COMPLETED sessions.
- When a spot is removed from the editor, it gets `archivedAt = now()`. It stays
  in the DB, its relations stay valid, but it stops appearing on the live lot map.
- Live queries filter `archivedAt: null`:
  - `GET /api/spots` (lot viewer + admin Overview lot map)
  - `GET /api/spots/layout` (editor initial state)
- History queries **do not** filter — a version snapshot from before a spot was
  archived still shows that spot as part of the lot it was.

### Caveat — `Spot.label` uniqueness

`label` has a DB `@unique` constraint. An archived spot still occupies its label
slot, so creating a new spot with the same label as an archived one fails. Admins
hit this if they archive `A-12` and then try to label another spot `A-12`.

Workarounds today: rename the new spot to something else, or delete the archived
spot by hand in SQL. A proper fix is a partial unique index (`UNIQUE (label) WHERE
archivedAt IS NULL`), which Prisma doesn't model directly but can be added via raw
SQL migration if this caveat starts to bite.

---

## Display — how spot labels are shown everywhere

**Rule:** Live lot map uses `spot.label` (current). Everything that references a
session's spot goes through `getSessionSpotLabel(session)`.

`getSessionSpotLabel` returns `session.spotLabelSnapshot` when non-empty, else
`session.spot?.label ?? "—"`. The helper lives in `src/lib/sessions.ts`.

Sites already wired:

| Location | Which label |
|---|---|
| `/api/spots`, `/api/spots/layout` GET | current `Spot.label` (live map) |
| Admin Overview lot map | current (keyed by `Spot.label`) |
| Admin Sessions tab row | `getSessionSpotLabel(session)` |
| Admin Payments tab row | `getSessionSpotLabel(payment.session)` |
| Admin cancel-session audit detail | `getSessionSpotLabel(session)` |
| Exit checkout audit detail | `getSessionSpotLabel(session)` |
| Cron reminder SMS text | `getSessionSpotLabel(session)` |
| Cron OVERSTAY audit detail | `getSessionSpotLabel(s)` |
| Cron OVERSTAY alert summary | `getSessionSpotLabel(s)` |
| Session history filter (`?spotLabel=`) | matches both snapshot AND live |

Sites intentionally using current label:

- `SpotDetailPanel` header — the admin clicked on a live spot, so the panel's
  header reflects the live label. The session details below (when present) are
  the current session's view, so snapshot and current agree in practice.

---

## UI entry points

### Editor (`src/app/lot/page.tsx`)

- New **History** button in edit mode (top-right of the canvas).
- New optional **Note** input in the unsaved-changes bar — passes through to
  `saveSnapshot({ message })`.
- After a restore, the drawer triggers `editor.loadFromApi()` so the canvas shows
  the restored state without a page reload.

### History drawer (`src/app/lot/LotHistoryDrawer.tsx`)

- Right-side drawer (full height) with two columns:
  - **Left:** version list, most recent first. Each row shows relative timestamp,
    author, optional message, and a compact diff chip (`+1 ~3 ↻2` for
    added/renamed/moved).
  - **Right:** read-only `LotMapViewer` rendering the selected version's snapshot,
    with absolute timestamp, human-readable diff bullets, and a **Restore this
    version** button.
- Restore confirms via `window.confirm`, POSTs to the restore endpoint, reloads
  the version list, and calls `onRestored` so the editor can refresh.

### Admin Log tab

- New **Layout** filter chip on `/admin` Log tab, scoped to `LAYOUT_SAVED` +
  `LAYOUT_RESTORED`. Details field on each row includes the version id (first
  8 chars) and diff counts.

---

## API surface

All three routes live under `src/app/api/admin/layout-history/` and require admin
auth.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/layout-history` | Paginated list (latest first). `?cursor=<id>&limit=25`. Omits `snapshot` for payload size. |
| `GET` | `/api/admin/layout-history/[id]` | Single version including `snapshot`. |
| `POST` | `/api/admin/layout-history/[id]/restore` | Body `{ message? }`. Non-destructive; returns the new version. |

The write path for editor saves stays at `PUT /api/spots/layout`, now with
optional `{ message, restoredFromId }` fields on the body. The restore endpoint
passes `restoredFromId` through to `applyLayoutAndCreateVersion`.

---

## Known gaps (follow-up work)

1. **Audit Log tab shows live spot label in its footer badge.**
   `src/app/admin/page.tsx:1115` renders `entry.spot.label` directly, so a
   rename retroactively changes that badge on old entries. The main `details`
   string is still correct because it's written at log time. Fix options:
   (a) add `spotLabelSnapshot` to `AuditLog` and denormalize at write; or
   (b) include `session.spotLabelSnapshot` in the audit API response and
   prefer it in the renderer when an entry has a related session.
2. **Driver-facing pages (`/entry`, `/confirmation`, `/exit`, `/welcome`,
   `/spot-assigned`) still deref `session.spot.label`.** Only matters if
   a spot is renamed while a driver has an active session — uncommon, but
   a one-liner swap to `getSessionSpotLabel` would make every surface
   consistent.
3. **`Spot.label` unique constraint collides with archived rows.** See
   caveat above. Requires a partial unique index via raw SQL to fix.
4. **No DB-level lock on `LotLayoutVersion` insert.** See concurrency note
   below — single-admin today, multi-admin later would need `SELECT FOR
   UPDATE` or a unique constraint + retry.

## Concurrency note

`applyLayoutAndCreateVersion` reads the current spot set and the latest version
*before* opening its transaction, then writes inside the transaction. Two admins
saving simultaneously could both read the same "latest" and both insert as its
child — creating two versions with the same `parentId`. The history would branch
in terms of lineage while the DB state would reflect whichever transaction
committed last.

For a single-admin lot (the current product), this is fine. If multi-admin
becomes real, add a `SELECT ... FOR UPDATE` on the latest version row inside the
transaction, or enforce a unique constraint on `parentId` + a retry loop.

---

## Verification checklist

Run locally after any change that touches the save/restore path:

1. Fresh schema: `source .env.local && export DATABASE_URL && npx prisma db push`.
2. Backfill if needed: `npx tsx scripts/backfill-lot-history.ts`.
3. Types: `npx tsc --noEmit` — source must be clean.
4. Manual end-to-end:
   - `npm run dev`, sign in as admin, open `/lot`, enter edit mode.
   - Note an existing spot label (e.g. `A-12`).
   - Complete a dummy check-in that parks a driver at `A-12`.
   - Back in `/lot` editor, rename that spot to `Z-99`, write a note, save.
   - History drawer → the new version shows `renamed: 1` and the note.
   - Admin Sessions tab → the driver's session still shows `A-12`. Lot map
     shows `Z-99`.
   - Open history drawer, select the baseline, click **Restore this version**.
   - Drawer closes → editor state reverts to pre-rename → a new version row
     appears with `restoredFromId` set.
   - Session still shows `A-12`.
5. Archival check:
   - In editor, remove a spot that has at least one COMPLETED session, save.
   - DB: `SELECT id, label, "archivedAt" FROM "Spot" WHERE id = '...'` — row
     still exists, `archivedAt` is set.
   - Lot map: spot is gone.
   - Session history for that session: still renders the archived spot's label
     via the snapshot.
6. Log tab: filter by **Layout** — `LAYOUT_SAVED` / `LAYOUT_RESTORED` rows present.

---

## File index

**Lib:**
- `src/lib/lot-layout.ts` — `computeDiff()`, `applyLayoutAndCreateVersion()`, types.
- `src/lib/sessions.ts` — `getSessionSpotLabel()`.

**API:**
- `src/app/api/spots/layout/route.ts` — versioned PUT, archived-filtered GET.
- `src/app/api/spots/route.ts` — archived-filtered GET.
- `src/app/api/admin/layout-history/route.ts` — list.
- `src/app/api/admin/layout-history/[id]/route.ts` — detail.
- `src/app/api/admin/layout-history/[id]/restore/route.ts` — restore.

**UI:**
- `src/app/lot/page.tsx` — History button, save-with-message, restore refresh.
- `src/app/lot/LotHistoryDrawer.tsx` — drawer, list, preview, restore UI.
- `src/components/lot/editor/useEditorReducer.ts` — `saveSnapshot({ message })`,
  `loadFromApi()` exposed.
- `src/app/admin/page.tsx` — Layout filter chip, badges.

**Data:**
- `prisma/schema.prisma` — Session.spotLabelSnapshot, Spot.archivedAt,
  LotLayoutVersion, enum additions.
- `scripts/backfill-lot-history.ts` — populates snapshots on existing sessions,
  creates baseline version.
- `src/types/domain.ts` — `LotLayoutDiffSummary`, `ApiLotLayoutVersion`,
  `ApiLotLayoutVersionSummary`, `spotLabelSnapshot` on session types.
