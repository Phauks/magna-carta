import { describe, expect, it } from "vitest";
import { money, USD } from "../src/money.ts";
import { allocate } from "../src/allocate.ts";
import { toMinor } from "../src/format.ts";

describe("allocate (largest-remainder)", () => {
  it("splits with no penny drift: $10.03 by [50,50] -> 502 + 501", () => {
    const parts = allocate(money(1003, USD), [50, 50]);
    expect(parts.map(toMinor)).toEqual([502, 501]);
    expect(parts.reduce((sum, p) => sum + toMinor(p), 0)).toBe(1003);
  });

  it("contingency split sums exactly to gross for arbitrary weights", () => {
    const gross = money(1_000_000, USD); // $10,000.00
    const parts = allocate(gross, [333, 333, 333, 1]);
    expect(parts.reduce((sum, p) => sum + toMinor(p), 0)).toBe(1_000_000);
  });
});
