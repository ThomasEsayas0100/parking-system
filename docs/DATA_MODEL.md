## ParkLogic Data Model

Single source of truth for the Prisma schema and the API/view-layer types derived from it. Update this file whenever `prisma/schema.prisma` or `src/types/domain.ts` changes.

---

### Enums

| Enum | Values |
|---|---|
| `VehicleType` | `BOBTAIL`, `TRUCK_TRAILER` |
| `SessionStatus` | `ACTIVE`, `COMPLETED`, `OVERSTAY` |
| `PaymentType` | `CHECKIN`, `MONTHLY_CHECKIN`, `EXTENSION`, `OVERSTAY` |
| `PaymentStatus` | `PENDING`, `COMPLETED`, `PARTIALLY_REFUNDED`, `REFUNDED`, `VOIDED`, `DISPUTED` |
| `AllowListLabel` | `EMPLOYEE`, `FAMILY`, `VENDOR`, `CONTRACTOR` |
| `AuditAction` | `CHECKIN`, `CHECKOUT`, `EXTEND`, `OVERSTAY_START`, `OVERSTAY_PAYMENT`, `GATE_OPEN`, `SPOT_FREED`, `REMINDER_SENT`, `OVERSTAY_ALERT`, `SUSPICIOUS_ENTRY`, `GATE_DENIED`, `ALLOWLIST_ENTRY` |

---

### Models

#### `AllowList`
Phone-based bypass list (employees, vendors, family). No session required to open the gate.

| Field | Type | Notes |
|---|---|---|
| `id` | `String` | PK, uuid |
| `phone` | `String` | **unique** |
| `name` | `String` | |
| `label` | `String` | default `"Employee"` — freeform (Employee/Family/Vendor/Contractor) |
| `active` | `Boolean` | default `true` |
| `createdAt` | `DateTime` | default `now()` |

#### `Driver`
Real person. Phone is the identity key.

| Field | Type | Notes |
|---|---|---|
| `id` | `String` | PK, uuid |
| `name` | `String` | |
| `email` | `String` | **not unique, not optional** |
| `phone` | `String` | **unique** — primary lookup key |
| `qbCustomerId` | `String?` | QuickBooks customer link |
| `createdAt` / `updatedAt` | `DateTime` | |

Relations: `vehicles[]`, `sessions[]`, `auditLogs[]`.

#### `Vehicle`
Belongs to a Driver. A driver may have many.

| Field | Type | Notes |
|---|---|---|
| `id` | `String` | PK, uuid |
| `driverId` | `String` | FK → Driver |
| `unitNumber` | `String?` | |
| `licensePlate` | `String?` | |
| `type` | `VehicleType` | |
| `nickname` | `String?` | |
| `createdAt` / `updatedAt` | `DateTime` | |

Composite unique: `(driverId, unitNumber)`, `(driverId, licensePlate)`.
Relations: `sessions[]`, `auditLogs[]`.

#### `Spot`
Physical parking spot. Layout coords (cx/cy/w/h/rot) live here.

| Field | Type | Notes |
|---|---|---|
| `id` | `String` | PK, uuid |
| `label` | `String` | **unique** (e.g. `"A12"`) |
| `type` | `VehicleType` | |
| `cx` / `cy` / `w` / `h` / `rot` | `Float` | SVG layout, all default `0` |

Relations: `sessions[]`, `auditLogs[]`.

A spot is "free" iff no Session with status `ACTIVE` or `OVERSTAY` references it. There is no `status` column — occupancy is always derived from the Session table. See `src/lib/spots.ts::assignSpot()`.

#### `Session`
Time-based reservation. The hotel-room model — driver owns the spot until `expectedEnd` + grace.

| Field | Type | Notes |
|---|---|---|
| `id` | `String` | PK, uuid |
| `spotId` | `String` | FK → Spot |
| `driverId` | `String` | FK → Driver |
| `vehicleId` | `String` | FK → Vehicle |
| `startedAt` | `DateTime` | default `now()` |
| `expectedEnd` | `DateTime` | when spot frees (before grace) |
| `endedAt` | `DateTime?` | set on COMPLETED |
| `status` | `SessionStatus` | default `ACTIVE`; cron flips to `OVERSTAY` |
| `reminderSent` | `Boolean` | default `false` — prevents duplicate reminder emails |
| `termsVersion` | `String?` | clickwrap consent snapshot |
| `overstayAuthorized` | `Boolean` | default `false` — manager flag |
| `createdAt` / `updatedAt` | `DateTime` | |

Relations: `payments[]`, `auditLogs[]`.

#### `Payment`
QuickBooks charge record attached to a session.

| Field | Type | Notes |
|---|---|---|
| `id` | `String` | PK, uuid |
| `sessionId` | `String` | FK → Session |
| `type` | `PaymentType` | CHECKIN / MONTHLY_CHECKIN / EXTENSION / OVERSTAY |
| `externalPaymentId` | `String` | **unique** — QB invoice/charge ID (provider-agnostic name). Free sessions use `free_<uuid>` so they can't collide. |
| `amount` | `Float` | gross charge |
| `hours` | `Float?` | hours purchased (null for monthly) |
| `status` | `PaymentStatus` | default `COMPLETED` |
| `refundedAmount` | `Float` | default `0` |
| `refundedAt` | `DateTime?` | |
| `refundExternalId` | `String?` | QB refund receipt/credit memo ID |
| `createdAt` | `DateTime` | default `now()` |

#### `AuditLog`
Append-only event log. All relation FKs are optional — one row may be about a driver with no session.

| Field | Type | Notes |
|---|---|---|
| `id` | `String` | PK, uuid |
| `action` | `AuditAction` | |
| `sessionId` | `String?` | FK → Session |
| `driverId` | `String?` | FK → Driver |
| `vehicleId` | `String?` | FK → Vehicle |
| `spotId` | `String?` | FK → Spot |
| `details` | `String?` | freeform JSON/text |
| `createdAt` | `DateTime` | default `now()` |

#### `Settings`
Singleton. Exactly one row with `id = "default"`.

| Field | Type | Default |
|---|---|---|
| `hourlyRateBobtail` / `hourlyRateTruck` | `Float` | `10.0` / `15.0` |
| `monthlyRateBobtail` / `monthlyRateTruck` | `Float` | `250.0` / `400.0` |
| `overstayRateBobtail` / `overstayRateTruck` | `Float` | `20.0` / `25.0` |
| `gracePeriodMinutes` | `Int` | `15` |
| `reminderMinutesBefore` | `Int` | `60` |
| `totalSpotsBobtail` / `totalSpotsTruck` | `Int` | `45` / `100` |
| `managerEmail` / `managerPhone` | `String` | `""` |
| `bobtailOverflow` | `Boolean` | `true` |
| `paymentRequired` | `Boolean` | `true` |
| `lotGroups` | `Json` | `"[]"` |
| `termsVersion` / `termsBody` | `String` | `"1.0"` / `""` |
| `qbAccessToken` / `qbRefreshToken` / `qbRealmId` | `String` | `""` |
| `qbTokenExpiresAt` | `DateTime?` | |

---

### Relationship Map

```
AllowList  (standalone — phone only)

Driver ──┬── Vehicle ──┐
         │             │
         └────────────┐│
                      ▼▼
                   Session ── Payment
                      │
                      ▼
                    Spot

AuditLog ── (optional FKs) → Session, Driver, Vehicle, Spot

Settings  (singleton)
```

---

### API / View Types (`src/types/domain.ts`)

JSON-serialized shapes returned by API routes. Dates are ISO strings (not `Date`). Pages and components use these, not Prisma types.

- **`ApiDriver`** — `{ id, name, email, phone }` (no `qbCustomerId`, no timestamps)
- **`ApiVehicle`** — `{ id, unitNumber, licensePlate, type, nickname }` (no `driverId`, no timestamps)
- **`ApiSpot`** — `{ id, label, type }` (no layout coords; occupancy derived from nested `sessions`)
- **`ApiSession`** — `{ id, status, startedAt, expectedEnd, endedAt, reminderSent }` (no FK ids, no terms fields)
- **`ApiSessionWithRelations`** — `ApiSession & { driver, vehicle, spot, payments }`
- **`ApiSpotNestedSession`** — narrower session shape returned under `/api/spots`: `ApiSession & { driver, vehicle }`. No `spot` back-ref, no `payments[]` — consumers on the lot map only read those via the parent spot.
- **`ApiSpotWithSessions`** — `ApiSpot & { sessions: ApiSpotNestedSession[] }`
- **`ApiPayment`** — `{ id, type, amount, hours, createdAt }` ⚠ no `status`, no refund fields
- **`ApiAuditEntry`** — flat `{ id, action, details, createdAt, driver?, vehicle?, spot? }`
- **`AppSettings`** — same shape as Prisma Settings **minus** QB token fields
- **`SavedDriver`** — `{ id, name, phone }` — localStorage only
- **`DriverActiveSession`** — lightweight session shape for `/api/drivers` response
- **`OverstayInfo`** — `{ requiresPayment, overstayHours, overstayAmount, overstayRate, sessionId }`
- **`SpotLayout`** — layout coords only, for lot editor
- **`LotSpotStatus`** — `"VACANT" | "RESERVED" | "OVERDUE" | "COMPANY"` (view-layer palette, **not** DB `SpotStatus`)
- **`LotSpotDetail`** / **`LotSpotSession`** — map click panel (uses real `Date` objects, not ISO strings)

---

### Invariants

1. **Phone is the driver identity key.** Unique index enforces it.
2. **Settings is a singleton** — `id = "default"` is the only row.
3. **Session lifecycle**: `ACTIVE` → `OVERSTAY` (cron) → `COMPLETED` (exit settlement or manager override). `endedAt` is `null` until `COMPLETED`.
4. **Spot occupancy has no dedicated column.** A spot is free iff no Session with `status IN (ACTIVE, OVERSTAY)` references it. This is the *only* source of truth — anything else (lot map colors, available counts, assignment logic) derives from here.
5. **Payment status lifecycle**: `COMPLETED` → `VOIDED` (admin cancel). `REFUNDED` and `PARTIALLY_REFUNDED` are reserved for a future refund API — nothing writes them today. QB-side refunds issued via the QB dashboard are not synced back (M2 gap). `refundedAmount ≤ amount` is a model invariant but not DB-enforced; the future refund endpoint must validate before writing. The incoming-partial guard (`verifyAndClaimInvoice` rejects `status.partial`) is separate from this — it blocks check-in when a QB invoice is only partially paid, and is always active.
6. **AllowList bypasses sessions entirely** — no Session/Payment/Spot row is created for allow-list entries.
7. **Payment idempotency is DB-enforced** — `@@unique([externalPaymentId])` guarantees that the same QB invoice/charge cannot produce two Payment rows, no matter how many times `/api/sessions` or `/api/sessions/extend` is called. App code may still `findFirst` for a friendlier 409, but the DB is the source of truth.
8. **Session check-in verifies the full invoice, not a charge** — `/api/sessions` calls `verifyAndClaimInvoice()` which requires `paid && !partial && !voided` on the QB invoice. Extend and overstay settlement still use the charge-based `verifyAndClaimPayment()`.
9. **Vehicle ownership is enforced at session creation** — `/api/sessions` 404s if the supplied `vehicleId` does not belong to `driverId` (no cross-driver vehicle reuse).
