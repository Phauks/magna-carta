import { fromMinor, toMinor } from "@magna-carta/money/format";
import { currencyFromCode, multiplyByQuantity, rate } from "@magna-carta/money/money";
import { roundInvoiceLine } from "@magna-carta/money/rounding";

// Direction the captured raw duration rounds toward its billing increment. Distinct from the money
// rounding mode (which collapses fractional cents) — this rounds the billable QUANTITY before any
// rate multiply.
export type RoundingDirection = "up" | "nearest" | "down";

function assertNonNegativeInteger(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${what} must be a non-negative integer, received ${value}`);
  }
}

// Round the raw captured minutes to a whole multiple of the billing increment. Integer math only —
// a half (nearest) rounds up, matching the commercial "round half up" expectation for a billable unit.
export function roundDuration(
  rawMinutes: number,
  incrementMinutes: number,
  direction: RoundingDirection,
): number {
  assertNonNegativeInteger(rawMinutes, "raw duration minutes");
  if (!Number.isInteger(incrementMinutes) || incrementMinutes <= 0) {
    throw new RangeError(
      `increment minutes must be a positive integer, received ${incrementMinutes}`,
    );
  }
  const whole = Math.trunc(rawMinutes / incrementMinutes);
  const remainder = rawMinutes - whole * incrementMinutes;
  if (remainder === 0) return rawMinutes;
  switch (direction) {
    case "down":
      return whole * incrementMinutes;
    case "up":
      return (whole + 1) * incrementMinutes;
    case "nearest":
      // Half rounds up: a remainder at or past the midpoint advances to the next increment.
      return (remainder * 2 >= incrementMinutes ? whole + 1 : whole) * incrementMinutes;
  }
}

// The WIP amount in minor units: amount_minor = round(rate_e4 x duration_minutes / 60), half away
// from zero (the invoice-line convention). The division by 60 stays in integer space — passing
// duration_minutes/60 as a float quantity to multiplyByQuantity would, for any minute count that
// does not divide 60 cleanly, produce a repeating decimal whose scaled form corrupts the result.
// Instead: form rate x minutes as an exact integer Intermediate, collapse it to Money (scale 2) via
// roundInvoiceLine, then divide the resulting minor count by 60 with explicit half-away-from-zero
// rounding to keep every step float-free.
export function computeAmountMinor(
  rateE4: number,
  durationMinutes: number,
  currencyCode: string,
): number {
  if (!Number.isInteger(rateE4)) {
    throw new RangeError(`rate_e4 must be an integer, received ${rateE4}`);
  }
  assertNonNegativeInteger(durationMinutes, "duration minutes");
  const currency = currencyFromCode(currencyCode); // throws on an unregistered code
  // rate x minutes at scale 4 (exact: quantity is an integer, so no float widening). This gives
  // "(dollars-per-hour x minutes)" still owing a /60 to reach dollars; collapse to scale 2
  // (cents) first with half-away-from-zero, yielding "cents-of-rate-minutes".
  const ratePerHour = rate(rateE4, currency);
  const intermediate = multiplyByQuantity(ratePerHour, durationMinutes);
  const collapsedMoney = roundInvoiceLine(intermediate);
  const perHourMinutesMinor = toMinor(collapsedMoney);
  // Divide by 60 with half-away-from-zero to yield the billed minor units. Integer arithmetic
  // throughout keeps the result deterministic across all minute counts.
  const sign = perHourMinutesMinor < 0 ? -1 : 1;
  const magnitude = Math.abs(perHourMinutesMinor);
  const quotient = Math.trunc(magnitude / 60);
  const remainder = magnitude - quotient * 60;
  const rounded = remainder * 2 >= 60 ? quotient + 1 : quotient;
  const amountMinor = sign * rounded;
  // Reconstruct a real Money so the currency is registered and the stored column round-trips.
  return toMinor(fromMinor(amountMinor, currency));
}
