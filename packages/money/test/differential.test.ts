import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { add, money, percentOf, ratio, subtract, USD } from "../src/money.ts";
import { allocate } from "../src/allocate.ts";
import { roundInvoiceLine, roundLedger } from "../src/rounding.ts";
import { toMinor } from "../src/format.ts";

// Sample-based differential check: our Dinero-backed ops must match an independent decimal implementation.
// All samples stay well below 2^53 (the number calculator's exact range — the money model's documented bound).
const SAMPLES: Array<[number, number]> = [
  [45000, 5000],
  [1, 999999],
  [-250, 250],
  [123456789, 987654321],
];

// [amount_in_cents, ratio_numerator, ratio_scale] — chosen so several land exactly on the .5-cent boundary,
// where the rounding mode actually decides the result (and where half-even and half-away-from-zero diverge).
const PERCENT_SAMPLES: Array<[number, number, number]> = [
  [10000, 8375, 5], // 837.5
  [12000, 8375, 5], // 1005.0 (exact, no rounding)
  [-10000, 8375, 5], // -837.5
  [30000, 8375, 5], // 2512.5
  [25000, 8375, 5], // 2093.75
];

function decimalProduct(a: number, numerator: number, scale: number): Decimal {
  return new Decimal(a).times(new Decimal(numerator).div(new Decimal(10).pow(scale)));
}

describe("differential vs decimal.js", () => {
  it("add matches decimal.js (in minor units)", () => {
    for (const [a, b] of SAMPLES) {
      const ours = toMinor(add(money(a, USD), money(b, USD)));
      const reference = new Decimal(a).plus(b).toNumber();
      expect(ours).toBe(reference);
    }
  });

  it("subtract matches decimal.js (in minor units)", () => {
    for (const [a, b] of SAMPLES) {
      const ours = toMinor(subtract(money(a, USD), money(b, USD)));
      const reference = new Decimal(a).minus(b).toNumber();
      expect(ours).toBe(reference);
    }
  });

  it("percentOf + roundLedger matches decimal.js half-even", () => {
    for (const [a, numerator, scale] of PERCENT_SAMPLES) {
      const ours = toMinor(roundLedger(percentOf(money(a, USD), ratio(numerator, scale))));
      const reference = decimalProduct(a, numerator, scale)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN)
        .toNumber();
      expect(ours).toBe(reference);
    }
  });

  it("percentOf + roundInvoiceLine matches decimal.js half-away-from-zero", () => {
    for (const [a, numerator, scale] of PERCENT_SAMPLES) {
      const ours = toMinor(roundInvoiceLine(percentOf(money(a, USD), ratio(numerator, scale))));
      // decimal.js ROUND_HALF_UP rounds half AWAY from zero — the roundInvoiceLine convention.
      const reference = decimalProduct(a, numerator, scale)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        .toNumber();
      expect(ours).toBe(reference);
    }
  });

  it("allocate always sums to the input (property)", () => {
    for (const [a] of SAMPLES) {
      const gross = Math.abs(a);
      const parts = allocate(money(gross, USD), [1, 2, 3, 5]);
      expect(parts.reduce((sum, p) => sum + toMinor(p), 0)).toBe(gross);
    }
  });
});
