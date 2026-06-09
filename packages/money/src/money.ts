import {
  addDinero,
  down,
  EUR,
  makeMoneyDinero,
  multiplyDinero,
  subtractDinero,
  transformScale,
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

// Dimensionless ratio: a scaled amount (e.g. ratio(8375, 5) === 0.08375). Not a Dinero.
export function ratio(amount: number, scale: number): Ratio {
  return { amount, scale } as Ratio;
}

// Rate x quantity -> high-precision intermediate (NOT yet rounded to Money). Quantity may be fractional.
export function multiplyByQuantity(value: Rate | Money, quantity: number): NumberDinero {
  // Represent quantity as a scaled multiplier to stay in integer math (e.g. 2.5 -> { amount: 25, scale: 1 }).
  return multiplyDinero(value, decimalToScaled(quantity));
}

export function percentOf(value: Money, percent: Ratio): NumberDinero {
  return multiplyDinero(value, { amount: percent.amount, scale: percent.scale });
}

// Collapse an intermediate to Money (scale 2). Rounds DOWN here; the NAMED boundary helpers
// (rounding.ts, a later task) are the real rounding API used at money boundaries.
export function transformToMoney(value: NumberDinero): Money {
  return transformScale(value, MONEY_SCALE, down) as Money;
}

// Turn a JS number like 2.5 into { amount: 25, scale: 1 } without float drift on typical inputs.
function decimalToScaled(n: number): { amount: number; scale: number } {
  const text = n.toString();
  const dot = text.indexOf(".");
  if (dot === -1) return { amount: Number(text), scale: 0 };
  const scale = text.length - dot - 1;
  return { amount: Number(text.replace(".", "")), scale };
}
