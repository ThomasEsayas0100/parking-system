/**
 * Rate selection and overstay calculation helpers.
 *
 * Centralises the vehicle-type → rate lookup and overstay duration math
 * so they aren't duplicated across API routes and frontend pages.
 */

const MS_PER_HOUR = 60 * 60 * 1000;

/** Add `hours` to a base Date and return the new Date. */
export function addHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * MS_PER_HOUR);
}

/** Milliseconds between two dates, floored at 0. */
export function msBetween(start: Date, end: Date): number {
  return Math.max(0, end.getTime() - start.getTime());
}

/** Whole hours (rounded up) between two dates. */
export function ceilHours(start: Date, end: Date): number {
  return Math.ceil(msBetween(start, end) / MS_PER_HOUR);
}

type RateSettings = {
  hourlyRateBobtail: number;
  hourlyRateTruck: number;
  monthlyRateBobtail: number;
  monthlyRateTruck: number;
  overstayRateBobtail: number;
  overstayRateTruck: number;
};

type VehicleType = "BOBTAIL" | "TRUCK_TRAILER";

/** Look up the standard hourly rate for a vehicle type. */
export function hourlyRate(settings: RateSettings, vehicleType: VehicleType): number {
  return vehicleType === "BOBTAIL"
    ? settings.hourlyRateBobtail
    : settings.hourlyRateTruck;
}

/** Look up the monthly rate for a vehicle type. */
export function monthlyRate(settings: RateSettings, vehicleType: VehicleType): number {
  return vehicleType === "BOBTAIL"
    ? settings.monthlyRateBobtail
    : settings.monthlyRateTruck;
}

/** Look up the overstay (premium) hourly rate for a vehicle type. */
export function overstayRate(settings: RateSettings, vehicleType: VehicleType): number {
  return vehicleType === "BOBTAIL"
    ? settings.overstayRateBobtail
    : settings.overstayRateTruck;
}

/** Add `months` to a base Date and return the new Date. */
export function addMonths(base: Date, months: number): Date {
  const result = new Date(base);
  result.setMonth(result.getMonth() + months);
  return result;
}
