import {
  addDinero,
  EUR,
  makeMoneyDinero,
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

export type Money = NumberDinero & { readonly [moneyBrand]: "Money" };
export type Rate = NumberDinero & { readonly [rateBrand]: "Rate" };
// Ratio is dimensionless (no currency) — a scaled amount, e.g. { amount: 8375, scale: 5 } === 0.08375.
// It is NOT a Dinero (Dinero requires a currency); it is the multiplier shape Dinero's multiply() accepts.
export type Ratio = {
  readonly amount: number;
  readonly scale: number;
  readonly [ratioBrand]: "Ratio";
};

const MONEY_SCALE = 2;
const RATE_SCALE = 4;

function assertSafeInteger(value: number): void {
  // Fail loud at the boundary: the number calculator is exact only for safe integers (< 2^53).
  // If this ever fires in practice, the engine must move to the decimal.js custom calculator (ADR-0061).
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
