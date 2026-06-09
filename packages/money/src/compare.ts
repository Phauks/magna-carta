import {
  compareDinero,
  equalDinero,
  greaterThanDinero,
  greaterThanOrEqualDinero,
  isNegativeDinero,
  isPositiveDinero,
  isZeroDinero,
  lessThanDinero,
  lessThanOrEqualDinero,
  maximumDinero,
  minimumDinero,
} from "./dinero.ts";
import type { Money } from "./money.ts";

// Comparisons and sign predicates over Money. Mixing currencies throws (Dinero enforces same-currency),
// mirroring add/subtract. The ledger sum-to-zero (ADR-0008) and no-negative-trust (ADR-0009) invariants
// are expressed with these: e.g. a disbursement is rejected unless `greaterThanOrEqual(balance, amount)`.

export function equal(a: Money, b: Money): boolean {
  return equalDinero(a, b);
}

export function greaterThan(a: Money, b: Money): boolean {
  return greaterThanDinero(a, b);
}

export function greaterThanOrEqual(a: Money, b: Money): boolean {
  return greaterThanOrEqualDinero(a, b);
}

export function lessThan(a: Money, b: Money): boolean {
  return lessThanDinero(a, b);
}

export function lessThanOrEqual(a: Money, b: Money): boolean {
  return lessThanOrEqualDinero(a, b);
}

export function isZero(value: Money): boolean {
  return isZeroDinero(value);
}

export function isNegative(value: Money): boolean {
  return isNegativeDinero(value);
}

export function isPositive(value: Money): boolean {
  return isPositiveDinero(value);
}

// Returns -1 (a < b), 0 (a === b), or 1 (a > b) — suitable as an Array.sort comparator.
export function compare(a: Money, b: Money): number {
  return compareDinero(a, b);
}

export function minimum(values: Money[]): Money {
  if (values.length === 0) {
    throw new RangeError("minimum() requires at least one Money");
  }
  return minimumDinero(values as [Money, ...Money[]]) as Money;
}

export function maximum(values: Money[]): Money {
  if (values.length === 0) {
    throw new RangeError("maximum() requires at least one Money");
  }
  return maximumDinero(values as [Money, ...Money[]]) as Money;
}
