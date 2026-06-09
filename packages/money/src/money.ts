import {
  addDinero,
  EUR,
  makeMoneyDinero,
  multiplyDinero,
  snapshot,
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

// The human/decimal input boundary (API/UI): parse "450.00", "-1234.5", "450" into Money (cents).
// Rejects sub-cent precision (> 2 decimals) and malformed input — fail loud rather than guess.
export function fromDecimal(text: string, currency: NumberCurrency): Money {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) {
    throw new RangeError(
      `not a valid money amount (expected e.g. "450.00", at most 2 decimals): ${text}`,
    );
  }
  const [, sign, whole, fraction = ""] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  const minor = sign === "-" && cents !== 0 ? -cents : cents; // avoid -0 (Object.is(-0, 0) is false)
  assertSafeInteger(minor);
  return money(minor, currency);
}

// Dinero's add/subtract enforce same-currency at the type level and throw at runtime on mismatch.
export function add(a: Money, b: Money): Money {
  return addDinero(a, b) as Money;
}

export function subtract(a: Money, b: Money): Money {
  return subtractDinero(a, b) as Money;
}

// A zero balance in the given currency — the identity for sum() and the seed for accumulators.
export function zero(currency: NumberCurrency): Money {
  return money(0, currency);
}

// Negate a Money (a charge becomes its credit, and vice versa). Preserves scale and currency.
export function negate(value: Money): Money {
  return multiplyDinero(value, -1) as Money;
}

// Absolute value — the magnitude of a Money regardless of sign.
export function abs(value: Money): Money {
  return snapshot(value).amount < 0 ? negate(value) : value;
}

// Sum a NON-EMPTY list of same-currency Money (ledger/invoice totals). Mixed currencies throw (via add).
// Empty throws — there is no currency to infer a zero from; callers with a possibly-empty list use
// `list.length ? sum(list) : zero(currency)`.
export function sum(values: Money[]): Money {
  if (values.length === 0) {
    throw new RangeError(
      "sum() requires at least one Money (cannot infer currency from an empty list)",
    );
  }
  return values.reduce((total, value) => add(total, value));
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
