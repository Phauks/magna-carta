import { MONEY_SCALE } from "@magna-carta/money/money";
import type { CustomFieldKind } from "./types.ts";

// The scale arithmetic every numeric custom-field value passes through. `value_number` is an integer
// column holding minor units, and how many minor units make one whole unit is the field's *effective
// scale* — so 500 on a plain number field means 500, while 500 on a currency field means $5.00. Every
// place a value crosses a kind boundary (the route scaling an inbound decimal, Convert retyping a
// field) has to agree on that exponent or the stored magnitude silently shifts by a power of ten.
//
// All of the arithmetic here is integer-and-string only: a decimal is shifted by moving its point, never
// by multiplying a float, so no value ever picks up a binary-floating-point remainder. An operation that
// cannot be done exactly returns null rather than an approximation — the caller parks the value instead
// of storing a number that is nearly right.

// The minor-unit exponent a field's stored integers are expressed at: the field's explicit
// number_scale when it declares one, else the kind's natural scale — the firm-currency minor unit
// (cents, mirroring @magna-carta/money) for currency, and whole units for everything else.
export function effectiveNumberScale(kind: CustomFieldKind, numberScale: number | null): number {
  if (kind === "checkbox") return 0;
  if (numberScale !== null) return numberScale;
  return kind === "currency" ? MONEY_SCALE : 0;
}

// A plain decimal: optional sign, digits, optional fractional digits. No exponent notation, no
// separators — the caller strips grouping commas and a leading currency symbol before testing.
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export function isDecimalString(text: string): boolean {
  return DECIMAL_PATTERN.test(text);
}

// Render a stored integer as the decimal a person wrote: 50000 at scale 2 is "500.00", 500 at scale 0
// is "500". The inverse of scaledIntegerFromDecimalString, so a value converted to text and back to a
// numeric kind returns to the same stored integer.
export function decimalStringFromScaledInteger(value: number, scale: number): string {
  if (scale <= 0) return String(value);
  const sign = value < 0 ? "-" : "";
  const digits = String(Math.abs(value)).padStart(scale + 1, "0");
  return `${sign}${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
}

// Parse a plain decimal string into the integer that represents it at `scale`, exactly. "500.00" at
// scale 2 is 50000; at scale 0 it is 500 (the fraction is all zeros, so nothing is lost). Returns null
// when the text is not a plain decimal, when it carries more significant fractional digits than the
// scale can hold ("12.345" at scale 2 — rounding it would invent precision the user never wrote), or
// when the result would leave the exact-integer range.
export function scaledIntegerFromDecimalString(text: string, scale: number): number | null {
  if (!DECIMAL_PATTERN.test(text) || !Number.isInteger(scale) || scale < 0) return null;
  const negative = text.startsWith("-");
  const [wholePart, fractionPart = ""] = text.replace(/^-/, "").split(".");
  let fraction = fractionPart;
  if (fraction.length > scale) {
    // The digits past the scale must be zeros, or the value cannot be represented without rounding.
    if (!/^0*$/.test(fraction.slice(scale))) return null;
    fraction = fraction.slice(0, scale);
  }
  const magnitude = Number(`${wholePart}${fraction.padEnd(scale, "0")}`);
  if (!Number.isSafeInteger(magnitude)) return null;
  // `magnitude === 0` guards the negative-zero a "-0.00" input would otherwise produce.
  return negative && magnitude !== 0 ? -magnitude : magnitude;
}

// Re-express a stored integer from one scale at another: 500 at scale 0 becomes 50000 at scale 2 (the
// same magnitude, finer units). Returns null when the move cannot be made exactly — 50050 from scale 2
// to scale 0 is $500.50 in a column that can only hold whole units — or when it would leave the
// exact-integer range.
export function rescaleStoredInteger(
  value: number,
  fromScale: number,
  toScale: number,
): number | null {
  if (!Number.isInteger(value)) return null;
  if (fromScale === toScale) return value;
  if (toScale > fromScale) {
    const scaled = value * 10 ** (toScale - fromScale);
    return Number.isSafeInteger(scaled) ? scaled : null;
  }
  const divisor = 10 ** (fromScale - toScale);
  if (!Number.isSafeInteger(divisor) || value % divisor !== 0) return null;
  return value / divisor;
}
