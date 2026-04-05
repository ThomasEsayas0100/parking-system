// ---------------------------------------------------------------------------
// Demo data — fake drivers, vehicles, sessions, payments for the lot view
// ---------------------------------------------------------------------------

export type SpotStatus = "VACANT" | "RESERVED" | "OVERDUE" | "COMPANY";

export type DemoDriver = {
  id: string;
  name: string;
  email: string;
  phone: string;
};

export type DemoVehicle = {
  id: string;
  unitNumber: string | null;
  licensePlate: string | null;
  type: "BOBTAIL" | "TRUCK_TRAILER";
  nickname: string | null;
};

export type DemoPayment = {
  id: string;
  type: "CHECKIN" | "EXTENSION" | "OVERSTAY";
  amount: number;
  hours: number | null;
  createdAt: Date;
};

export type DemoSession = {
  id: string;
  driver: DemoDriver;
  vehicle: DemoVehicle;
  startedAt: Date;
  expectedEnd: Date;
  endedAt: Date | null;
  sessionStatus: "ACTIVE" | "COMPLETED" | "OVERSTAY";
  reminderSent: boolean;
  payments: DemoPayment[];
};

export type SpotDetail = {
  spotId: string;
  spotLabel: string;
  status: SpotStatus;
  session: DemoSession | null;
};

// ---------------------------------------------------------------------------
// Pools of fake data
// ---------------------------------------------------------------------------
const FIRST_NAMES = [
  "Marcus", "Elena", "James", "Priya", "Carlos", "Aisha", "Tommy", "Mei",
  "Diego", "Fatima", "Andre", "Sarah", "Kofi", "Lucia", "Omar", "Yuki",
  "Raj", "Natasha", "Kwame", "Ingrid", "Pavel", "Amara", "Chen", "Rosa",
  "Viktor", "Zara", "Emilio", "Keiko", "Hassan", "Olivia",
];

const LAST_NAMES = [
  "Johnson", "Petrov", "Garcia", "Okafor", "Kim", "Muller", "Singh",
  "Nakamura", "Alvarez", "Osei", "Lindgren", "Patel", "Torres", "Nkomo",
  "Johansson", "Chen", "Volkov", "Diaz", "Amari", "Kowalski",
];

const TRUCK_NICKNAMES = [
  "Big Red", "Silver Bullet", "Night Hawk", "Road King", "Thunder",
  "Iron Horse", "Blue Steel", "Ghost Rider", "The Rig", "Midnight",
  null, null, null, null, null,
];

// Seeded random for stability
let _seed = 42;
function seededRandom(): number {
  _seed = (_seed * 16807 + 0) % 2147483647;
  return (_seed - 1) / 2147483646;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(seededRandom() * arr.length)];
}

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (seededRandom() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function randomPhone(): string {
  const area = 200 + Math.floor(seededRandom() * 800);
  const mid = 200 + Math.floor(seededRandom() * 800);
  const end = 1000 + Math.floor(seededRandom() * 9000);
  return `(${area}) ${mid}-${end}`;
}

function randomPlate(): string {
  const letters = "ABCDEFGHJKLMNPRSTUVWXYZ";
  const l = () => letters[Math.floor(seededRandom() * letters.length)];
  const d = () => Math.floor(seededRandom() * 10);
  return `${l()}${l()}${l()}-${d()}${d()}${d()}${d()}`;
}

function randomUnit(): string {
  return `${Math.floor(1000 + seededRandom() * 9000)}`;
}

// ---------------------------------------------------------------------------
// Generate demo data for all spots
// ---------------------------------------------------------------------------
export function generateDemoData(
  spots: { id: string; label: string; type: "BOBTAIL" | "TRUCK_TRAILER" }[],
): { statuses: Record<string, SpotStatus>; details: Record<string, SpotDetail> } {
  _seed = 42; // reset for determinism

  const statuses: Record<string, SpotStatus> = {};
  const details: Record<string, SpotDetail> = {};

  for (const spot of spots) {
    const r = seededRandom();
    const status: SpotStatus =
      r < 0.40 ? "VACANT" : r < 0.65 ? "RESERVED" : r < 0.82 ? "COMPANY" : "OVERDUE";

    statuses[spot.id] = status;

    if (status === "VACANT") {
      details[spot.id] = {
        spotId: spot.id,
        spotLabel: spot.label,
        status,
        session: null,
      };
      continue;
    }

    // Generate driver
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const driver: DemoDriver = {
      id: uuid(),
      name: `${firstName} ${lastName}`,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@email.com`,
      phone: randomPhone(),
    };

    // Generate vehicle
    const vehicle: DemoVehicle = {
      id: uuid(),
      unitNumber: seededRandom() > 0.3 ? randomUnit() : null,
      licensePlate: randomPlate(),
      type: spot.type,
      nickname: spot.type === "TRUCK_TRAILER" ? pick(TRUCK_NICKNAMES) : null,
    };

    // Generate session timing
    const now = new Date();
    const hoursAgo = 1 + Math.floor(seededRandom() * 18);
    const startedAt = new Date(now.getTime() - hoursAgo * 3600_000);
    const bookedHours = [2, 4, 6, 8, 12, 24][Math.floor(seededRandom() * 6)];
    const expectedEnd = new Date(startedAt.getTime() + bookedHours * 3600_000);

    const isOverdue = status === "OVERDUE";
    const sessionStatus = isOverdue ? "OVERSTAY" as const : "ACTIVE" as const;

    // Generate payments
    const hourlyRate = spot.type === "TRUCK_TRAILER" ? 15 : 10;
    const payments: DemoPayment[] = [
      {
        id: uuid(),
        type: "CHECKIN",
        amount: bookedHours * hourlyRate,
        hours: bookedHours,
        createdAt: startedAt,
      },
    ];

    // Some sessions have extensions
    if (seededRandom() > 0.7) {
      const extHours = [2, 4][Math.floor(seededRandom() * 2)];
      payments.push({
        id: uuid(),
        type: "EXTENSION",
        amount: extHours * hourlyRate,
        hours: extHours,
        createdAt: new Date(startedAt.getTime() + (bookedHours - 1) * 3600_000),
      });
    }

    // Overdue spots get overstay payment
    if (isOverdue && seededRandom() > 0.5) {
      const overstayRate = spot.type === "TRUCK_TRAILER" ? 25 : 20;
      const overstayHours = 1 + Math.floor(seededRandom() * 4);
      payments.push({
        id: uuid(),
        type: "OVERSTAY",
        amount: overstayHours * overstayRate,
        hours: overstayHours,
        createdAt: new Date(expectedEnd.getTime() + 900_000),
      });
    }

    const session: DemoSession = {
      id: uuid(),
      driver,
      vehicle,
      startedAt,
      expectedEnd,
      endedAt: null,
      sessionStatus,
      reminderSent: seededRandom() > 0.4,
      payments,
    };

    details[spot.id] = {
      spotId: spot.id,
      spotLabel: spot.label,
      status,
      session,
    };
  }

  return { statuses, details };
}
