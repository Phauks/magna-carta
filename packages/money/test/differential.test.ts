import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { add, money, subtract, USD } from "../src/money.ts";
import { allocate } from "../src/allocate.ts";
import { toMinor } from "../src/format.ts";

// Sample-based differential check: our Dinero-backed ops must match an independent decimal implementation.
// All samples stay well below 2^53 (the number calculator's exact range — the money model's documented bound).
const SAMPLES: Array<[number, number]> = [
  [45000, 5000],
  [1, 999999],
  [-250, 250],
  [123456789, 987654321],
];

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

  it("allocate always sums to the input (property)", () => {
    for (const [a] of SAMPLES) {
      const gross = Math.abs(a);
      const parts = allocate(money(gross, USD), [1, 2, 3, 5]);
      expect(parts.reduce((sum, p) => sum + toMinor(p), 0)).toBe(gross);
    }
  });
});
