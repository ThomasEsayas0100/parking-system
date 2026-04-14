## ParkLogic Data Model

Single source of truth for the Prisma schema and the API/view-layer types derived from it. Update this file whenever `prisma/schema.prisma` or `src/types/domain.ts` changes.

---

### Enums

| Enum | Values |
|---|---|
| `VehicleType` | `BOBTAIL`, `TRUCK_TRAILER` |
| `SpotStatus` | `AVAILABLE`, `OCCUPIED` |
| `SessionStatus` | `ACTIVE`, `COMPLETED`, `OVERSTAY` |
| `PaymentType` | `CHECKIN`, `MONTHLY_CHECKIN`, `EXTENSION`, `OVERSTAY` |
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
| `status` | `SpotStatus` | default `AVAILABLE` |
| `cx` / `cy` / `w` / `h` / `rot` | `Float` | SVG layout, all default `0` |

Relations: `sessions[]`, `auditLogs[]`.

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
| `externalPaymentId` | `String` | QB invoice/charge ID (provider-agnostic name) |
| `amount` | `Float` | gross charge |
| `hours` | `Float?` | hours purchased (null for monthly) |
| `status` | `String` | **free-text**, default `"COMPLETED"` — PENDING / COMPLETED / REFUNDED / VOIDED / DISPUTED |
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
- **`ApiSpot`** — `{ id, label, type, status }` (no layout coords)
- **`ApiSession`** — `{ id, status, startedAt, expectedEnd, endedAt, reminderSent }` (no FK ids, no terms fields)
- **`ApiSessionWithRelations`** — `ApiSession & { driver, vehicle, spot, payments }`
- **`ApiSpotWithSessions`** — `ApiSpot & { sessions: ApiSessionWithRelations[] }`
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
4. **Spot.status is view-level**; the authoritative "is this spot taken right now" check is "does a session with `status IN (ACTIVE, OVERSTAY)` reference it?"
5. **Payment refunds are partial-aware**: `refundedAmount ≤ amount`; `status` flips when fully refunded.
6. **AllowList bypasses sessions entirely** — no Session/Payment/Spot row is created for allow-list entries.
