@AGENTS.md

## Driver Flow

```
                        ┌──────────┐
                        │  / (hub) │
                        └────┬─────┘
                             │
               ┌─────────────┼──────────────┐
               ▼             ▼              ▼
          /scan          /checkin?demo=1    /checkin
          (identity)     (demo mode)       (→ redirect to /scan)
               │              │
    ┌──────────┴────┐         │
    ▼               ▼         ▼
 /checkin         /checkin   /spot-assigned
 ?locked=true     ?new=true      │
    │               │            ├→ /lot (view map)
    └───────┬───────┘            └→ /scan (done)
            ▼
     /confirmation
            │
            ▼
     /welcome?driverId=X
        │          │
   ┌────┴────┐     └─────────┐
   ▼         ▼               ▼
 /exit    /extend          /checkin (new session)
   │         │
 exited   /confirmation → /welcome
```

## Session Model (PENDING REFACTOR)

Sessions are **time-based reservations** (hotel model), NOT gate passes.

**Current behavior (needs fixing):** the exit flow (`POST /api/sessions/exit`) opens
the gate AND completes the session in one action. This is wrong.

**Target behavior:**
- **Session = reservation.** Driver pays for X hours, spot is theirs until `expectedEnd`.
- **Gate is decoupled from session.** Gate opens freely for anyone with a valid
  (non-expired) booking. Opening the gate does NOT end the session.
- **Sessions expire by time.** When `expectedEnd` passes → grace period → cron flips
  to OVERSTAY → fees accrue until driver settles up or manager overrides.
- **Explicit checkout is optional.** Driver CAN release a spot early (courtesy), but
  the default is the session runs its full duration and frees automatically.
- **Overstay settlement** can happen from the driver's phone at any time, not just at the gate.

**What this means for the refactor:**
1. `/exit` page → rename/repurpose to gate page. Just opens gate, shows session status.
2. `POST /api/sessions/exit` → split into `POST /api/gate` (open gate, no session change)
   and optional `POST /api/sessions/checkout` (early release).
3. Cron job handles session expiry: ACTIVE → OVERSTAY (existing) and eventually
   OVERSTAY → COMPLETED when time + fees are settled or manager overrides.
4. `/welcome` page gate button should open the gate without touching the session.

### Key conventions
- **localStorage**: single key `parking_driver` via `src/lib/driver-store.ts` — never use raw localStorage
- **Fetch**: always use `apiFetch` / `apiPost` from `src/lib/fetch.ts` — throws on non-2xx
- **Identity**: localStorage is never trusted — always verify against `/api/drivers?phone=X` before prefilling
- **Session status lifecycle**: ACTIVE → OVERSTAY (cron) → COMPLETED (on exit)
- **Shared types**: `src/types/domain.ts` — never define inline Driver/Vehicle/Session types in pages
