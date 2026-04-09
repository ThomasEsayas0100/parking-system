import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------
export const VehicleTypeSchema = z.enum(["BOBTAIL", "TRUCK_TRAILER"]);
export const SessionStatusSchema = z.enum(["ACTIVE", "COMPLETED", "OVERSTAY"]);
export const PaymentTypeSchema = z.enum(["CHECKIN", "EXTENSION", "OVERSTAY"]);

export const idSchema = z.string().min(1, "required").max(200);
export const emailSchema = z.string().email().max(200);
export const phoneSchema = z
  .string()
  .min(7, "phone too short")
  .max(30, "phone too long");
export const nameSchema = z.string().trim().min(1, "required").max(120);

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------
export const DriverUpsertSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
});
export type DriverUpsertInput = z.infer<typeof DriverUpsertSchema>;

export const DriverLookupSchema = z
  .object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
  })
  .refine((d) => d.email || d.phone, {
    message: "email or phone required",
  });

// ---------------------------------------------------------------------------
// Vehicle
// ---------------------------------------------------------------------------
export const VehicleUpsertSchema = z
  .object({
    driverId: idSchema,
    type: VehicleTypeSchema,
    unitNumber: z.string().trim().max(50).optional().nullable(),
    licensePlate: z.string().trim().max(20).optional().nullable(),
    nickname: z.string().trim().max(80).optional().nullable(),
  })
  .refine((d) => !!d.unitNumber || !!d.licensePlate, {
    message: "unitNumber or licensePlate required",
    path: ["unitNumber"],
  });
export type VehicleUpsertInput = z.infer<typeof VehicleUpsertSchema>;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
export const SessionCreateSchema = z.object({
  driverId: idSchema,
  vehicleId: idSchema,
  hours: z.number().int().min(1, "min 1 hour").max(72, "max 72 hours"),
  paymentId: z.string().min(1).max(200),
});
export type SessionCreateInput = z.infer<typeof SessionCreateSchema>;

export const SessionExtendSchema = z.object({
  sessionId: idSchema,
  hours: z.number().int().min(1).max(72),
  paymentId: z.string().min(1).max(200),
});

export const SessionExitSchema = z.object({
  sessionId: idSchema,
  overstayPaymentId: z.string().min(1).max(200).optional(),
});

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------
export const PaymentIntentCreateSchema = z.object({
  amount: z.number().min(0.5).max(10000),
  description: z.string().max(500).optional(),
});
export type PaymentIntentCreateInput = z.infer<typeof PaymentIntentCreateSchema>;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export const SettingsUpdateSchema = z.object({
  hourlyRateBobtail: z.number().min(0).max(1000).optional(),
  hourlyRateTruck: z.number().min(0).max(1000).optional(),
  overstayRateBobtail: z.number().min(0).max(1000).optional(),
  overstayRateTruck: z.number().min(0).max(1000).optional(),
  gracePeriodMinutes: z.number().int().min(0).max(1440).optional(),
  reminderMinutesBefore: z.number().int().min(0).max(1440).optional(),
  totalSpotsBobtail: z.number().int().min(0).max(10000).optional(),
  totalSpotsTruck: z.number().int().min(0).max(10000).optional(),
  managerEmail: z.string().email().max(200).optional().or(z.literal("")),
  managerPhone: phoneSchema.optional().or(z.literal("")),
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
export const SpotOverrideSchema = z.object({
  spotId: idSchema,
  action: z.enum(["free"]),
  reason: z.string().trim().min(1, "reason required").max(500),
});

// ---------------------------------------------------------------------------
// Audit query
// ---------------------------------------------------------------------------
export const AuditActionSchema = z.enum([
  "CHECKIN", "CHECKOUT", "EXTEND",
  "OVERSTAY_START", "OVERSTAY_PAYMENT",
  "GATE_OPEN", "SPOT_FREED",
  "REMINDER_SENT", "OVERSTAY_ALERT",
  "SUSPICIOUS_ENTRY",
]);

export const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  action: AuditActionSchema.optional(),
  vehicleId: idSchema.optional(),
  driverId: idSchema.optional(),
  spotId: idSchema.optional(),
});

// ---------------------------------------------------------------------------
// Session history query
// ---------------------------------------------------------------------------
export const SessionHistoryQuerySchema = z.object({
  driverId: idSchema.optional(),
  vehicleId: idSchema.optional(),
  spotId: idSchema.optional(),
  licensePlate: z.string().trim().max(20).optional(),
  spotLabel: z.string().trim().max(20).optional(),
  status: SessionStatusSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  // search across name/plate/phone/spot
  q: z.string().trim().max(120).optional(),
});
export type SessionHistoryQuery = z.infer<typeof SessionHistoryQuerySchema>;
