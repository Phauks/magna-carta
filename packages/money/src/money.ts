import {
  addDinero,
  EUR,
  makeMoneyDinero,
  multiplyDinero,
  subtractDinero,
  USD,
  type NumberCurrency,
  type NumberDinero,
} from "./dinero.ts";

export { EUR, USD };
export type { NumberCurrency };

// Branded, immutable. Backed by Dinero<number> (default calculator): Money @ scale 2, Rate @ scale 4.
// Amounts are JS safe integers (exact below 2^53). Brands are compile-time only (erased at runtime).
declare const moneyBrand: unique symbol;
declare const rateBrand: unique symbol;
declare const ratioBrand: unique symbol;
declare const intermediateBrand: unique symbol;

export type Money = NumberDinero & { readonly [moneyBrand]: "Money" };
export type Rate = NumberDinero & { readonly [rateBrand]: "Rate" };
// A high-precision product (rate x quantity, or money x ratio) at a scale finer than cents.
// It is NOT spendable Money: the only legal next step is a named rounding helper (rounding.ts), which
// collapses it to Money at the boundary. Branding it makes "round before you use it" a compile-time
// guarantee — a raw Intermediate cannot be read as cents (toMinor) or added to Money.
export type Intermediate = NumberDinero & { readonly [intermediateBrand]: "Intermediate" };
// Ratio is dimensionless (no currency) — a scaled amount, e.g. { amount: 8375, scale: 5 } === 0.08375.
// It is NOT a Dinero (Dinero requires a currency); it is the multiplier shape Dinero's multiply() accepts.
export type Ratio = {
  readonly amount: number;
  readonly scale: number;
  readonly [ratioBrand]: "Ratio";
};

const MONEY_SCALE = 2;
const RATE_SCALE = 4;

// Fail loud at the boundary: the number calculator is exact only for safe integers (< 2^53). If this
// ever fires in practice, the engine must move to the decimal.js custom calculator (ADR-0061).
// Exported so the rounding helpers can re-check a grown intermediate's raw amount before it collapses.
export function assertSafeInteger(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`money amount must be a safe integer, received ${value}`);
  }
}

export function money(minor: number, currency: NumberCurrency): Money {
  assertSafeInteger(minor);
  return makeMoneyDinero(minor, currency, MONEY_SCALE) as Money;
}

export function rate(e4: number, currency: NumberCurrency): Rate {
  assertSafeInteger(e4);
  return makeMoneyDinero(e4, currency, RATE_SCALE) as Rate;
}

// Dinero's add/subtract enforce same-currency at the type level and throw at runtime on mismatch.
export function add(a: Money, b: Money): Money {
  return addDinero(a, b) as Money;
}

export function subtract(a: Money, b: Money): Money {
  return subtractDinero(a, b) as Money;
}

// Dimensionless ratio: a scaled amount (e.g. ratio(8375, 5) === 0.08375). Not a Dinero.
export function ratio(amount: number, scale: number): Ratio {
  return { amount, scale } as Ratio;
}

// Rate x quantity -> high-precision Intermediate (NOT yet Money). Quantity may be fractional.
// Round it to Money with a named rounding helper (rounding.ts) at the boundary.
export function multiplyByQuantity(value: Rate | Money, quantity: number): Intermediate {
  // Represent quantity as a scaled multiplier to stay in integer math (e.g. 2.5 -> { amount: 25, scale: 1 }).
  return multiplyDinero(value, decimalToScaled(quantity)) as Intermediate;
}

// money x ratio (tax, interest, contingency %) -> high-precision Intermediate. Round at the boundary.
export function percentOf(value: Money, percent: Ratio): Intermediate {
  return multiplyDinero(value, { amount: percent.amount, scale: percent.scale }) as Intermediate;
}

// Turn a JS number like 2.5 into { amount: 25, scale: 1 } so multiplication stays in integer math.
// Rejects exponential notation (|n| >= 1e21 or |n| < 1e-6): toString() would emit "1e-7"/"1e+21", which
// the dot-parsing would turn into a NON-integer amount and silently defeat the integer-math design.
// Such quantities are out of the supported decimal range and must fail loud rather than corrupt.
function decimalToScaled(n: number): { amount: number; scale: number } {
  if (!Number.isFinite(n)) {
    throw new RangeError(`quantity must be a finite number, received ${n}`);
  }
  const text = n.toString();
  if (text.includes("e") || text.includes("E")) {
    throw new RangeError(`quantity out of supported decimal range: ${n}`);
  }
  const dot = text.indexOf(".");
  if (dot === -1) return { amount: Number(text), scale: 0 };
  const scale = text.length - dot - 1;
  return { amount: Number(text.replace(".", "")), scale };
}
