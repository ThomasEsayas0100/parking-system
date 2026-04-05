# Parking System — Specification

## Overview
A QR-code-based parking management system for a single lot with two vehicle types. Drivers scan a QR code, fill out a form, pay, and receive a spot assignment. The system tracks occupancy, notifies the property manager of overstays, and triggers a gate to open upon successful check-in.

---

## Vehicle Types
- **Bobtail** (cab only)
- **Truck/Trailer** (full rig)

Spot assignments and pricing may differ by type.

---

## User Roles

### Driver (unauthenticated)
- No account required
- Optional "Remember Me" (stores name, phone, vehicle info via cookie/local storage for faster repeat visits)
- Scans QR code → lands on check-in form

### Property Manager / Owner (authenticated)
- Dashboard for monitoring lot status
- Receives overstay notifications
- Manages spots, rates, and settings

---

## QR Code
Single QR code at the gate. The system determines what to show based on the driver's session state:
- **No active session** → check-in form (entrance flow)
- **Active session, within time** → gate opens (exit flow)
- **Active session, overstayed** → overstay payment prompt, then gate opens (exit flow)

---

## Core Flows

### 1. Entrance — New Driver (no active session)
1. Driver scans **Entrance QR** code
2. Web form loads — driver fills out:
   - Name
   - Email
   - Phone number
   - Vehicle type (Bobtail / Truck+Trailer)
   - Expected parking duration (hourly)
   - Payment info
3. System assigns an available spot based on vehicle type
4. Payment is processed
5. Driver sees confirmation with assigned spot number/location
6. Gate open signal is sent (`POST /api/gate/open?gate=entrance`)
7. Driver's session is stored (cookie/local storage) for subsequent QR scans

### 2. Exit — Within Allotted Time
1. Driver scans QR code
2. System detects active session, time has NOT expired
3. Gate open signal is sent (`POST /api/gate/open`)
4. Session is marked as completed, spot is freed

### 3. Exit — Overstayed
1. Driver scans QR code
2. System detects active session, time HAS expired
3. Driver is shown overstay duration and additional charge (premium hourly rate)
4. Driver pays the overstay amount
5. Gate open signal is sent (`POST /api/gate/open`)
6. Session is marked as completed, spot is freed

### 4. Expiry Notifications (Driver)
- System sends a reminder to the driver via **email + SMS** shortly before their parking time expires (e.g. 15 min before)
- Gives the driver the option to extend their time (pay for additional hours) from the notification link

### 5. Overstay Notifications (Property Manager)
- If a driver's time expires and they have NOT signed out, the property manager is notified via **email + SMS**
- Grace period before notification is configurable (e.g. 15 min after expiry)
- Dashboard also highlights overstaying vehicles in real time

---

## Tech Stack

### Frontend
- **Next.js** (React) — handles both driver-facing pages and admin dashboard
- **Tailwind CSS** — styling
- Hosted on **Vercel**

### Backend / API
- **Next.js API Routes** — lightweight API layer
- Alternative: separate **Node.js/Express** service if complexity grows

### Database
- **PostgreSQL** (hosted on **Supabase** or **Neon**)
- Tables: spots, sessions (active parkings), vehicles, payments, settings

### Payment
- **Stripe** — payment processing
- QuickBooks integration via **Stripe ↔ QuickBooks sync** (native integration or middleware like Zapier/Make)

### Gate Control
- `POST /api/gate/open` — abstracted endpoint
- Future: triggers Shelly relay or similar hardware via local network / tunnel

### Notifications
- **Email**: Resend or SendGrid
- **SMS**: Twilio
- Recipients:
  - **Drivers** — expiry reminder (email + SMS) shortly before time runs out
  - **Property Manager** — overstay alert (email + SMS) after grace period

### Auth (Admin only)
- Simple auth for dashboard (NextAuth.js or Supabase Auth)

---

## Data Model (Draft)

### drivers
| Field          | Type      | Notes                              |
|----------------|-----------|-------------------------------------|
| id             | uuid      | PK                                  |
| name           | string    |                                     |
| email          | string    | unique, used for Remember Me lookup |
| phone          | string    | unique, used for Remember Me lookup |
| vehicle_type   | enum      | bobtail, truck_trailer              |
| created_at     | timestamp |                                     |
| updated_at     | timestamp |                                     |

### spots
| Field       | Type    | Notes                          |
|-------------|---------|--------------------------------|
| id          | uuid    | PK                             |
| label       | string  | e.g. "A1", "B3"               |
| type        | enum    | bobtail, truck_trailer         |
| status      | enum    | available, occupied, reserved  |

### sessions
| Field              | Type      | Notes                              |
|--------------------|-----------|-------------------------------------|
| id                 | uuid      | PK                                  |
| spot_id            | uuid      | FK → spots                         |
| driver_name        | string    |                                     |
| driver_email       | string    | for expiry notifications            |
| driver_phone       | string    | for expiry notifications (SMS)      |
| vehicle_type       | enum      | bobtail, truck_trailer              |
| started_at         | timestamp |                                     |
| expected_end       | timestamp |                                     |
| ended_at           | timestamp | null until exit                     |
| status             | enum      | active, completed, overstay         |
| payment_id         | string    | Stripe payment/charge ID            |
| overstay_payment_id| string    | Stripe ID for overstay charge, nullable |
| amount_paid        | decimal   | initial payment                     |
| overstay_amount    | decimal   | additional overstay charge, nullable|
| reminder_sent      | boolean   | whether expiry reminder was sent    |

### settings
| Field                    | Type    | Notes                        |
|--------------------------|---------|------------------------------|
| hourly_rate_bobtail      | decimal |                              |
| hourly_rate_truck        | decimal |                              |
| overstay_rate_bobtail    | decimal | hourly overstay rate         |
| overstay_rate_truck      | decimal | hourly overstay rate         |
| grace_period_minutes     | int     | before overstay alert        |
| reminder_minutes_before  | int     | default: 60 (1 hour)         |
| total_spots_bobtail      | int     |                              |
| total_spots_truck        | int     |                              |

---

## Lot Capacity
- **Total spots: ~140**
- **Truck/Trailer: ~100 spots**
- **Bobtail: ~45 spots**
- Note: exact counts may shift — configurable via admin dashboard

---

## Time Extension
- Drivers can extend their parking time remotely from the expiry reminder (email/SMS link)
- Extension link leads to a page showing current session + option to add hours and pay
- No need to return to the lot or re-scan

---

## Resolved Decisions

### Overstay Rate
- Premium rate (higher than standard hourly) — exact multiplier configurable by property manager in dashboard

### Remember Me
Three tiers of convenience based on device recognition and session state:

**Tier 1 — Same device, active paid session (fastest)**
- QR scan loads page → system detects local session token + verifies active paid session server-side
- Gate signal fires immediately on page load (no user interaction)
- Page shows confirmation screen simultaneously (spot info, time remaining, "Gate opening...")
- This covers both entrance re-entry and exit within allotted time

**Tier 2 — Same device, no active session (returning driver)**
- System reads saved driver info from local storage
- Form is pre-filled (name, email, phone, vehicle type)
- Driver only needs to select duration and pay

**Tier 3 — Cross-device (different phone/device)**
- Driver enters phone number or email
- Receives a short verification code via SMS or email
- On verification, saved info is pulled from server and form is pre-filled
- Local storage is then set for future Tier 1/2 on this device

Requires lightweight server-side `drivers` table (not a full account — just stored info linked to phone/email).

### Expiry Reminder
- Sent **1 hour** before parking time expires via email + SMS

### Gate
- **Single gate** for both entrance and exit
- One QR code at the gate; system determines direction context based on session state:
  - No active session → treat as entrance (show check-in form)
  - Active session, within time → treat as exit (open gate, end session)
  - Active session, overstayed → treat as exit (prompt overstay payment, then open gate)
