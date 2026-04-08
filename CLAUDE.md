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

### Key conventions
- **localStorage**: single key `parking_driver` via `src/lib/driver-store.ts` — never use raw localStorage
- **Fetch**: always use `apiFetch` / `apiPost` from `src/lib/fetch.ts` — throws on non-2xx
- **Identity**: localStorage is never trusted — always verify against `/api/drivers?phone=X` before prefilling
- **Session status lifecycle**: ACTIVE → OVERSTAY (cron) → COMPLETED (on exit)
- **Shared types**: `src/types/domain.ts` — never define inline Driver/Vehicle/Session types in pages
