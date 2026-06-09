import { describe, expect, it } from "vitest";
import { money, percentOf, ratio, USD } from "../src/money.ts";
import { roundLedger, roundTax } from "../src/rounding.ts";
import { toMinor } from "../src/format.ts";

describe("named rounding helpers", () => {
  it("roundTax is half-up: $100.00 * 0.08375 = $8.375 -> 838 cents", () => {
    const tax = roundTax(percentOf(money(10000, USD), ratio(8375, 5)));
    expect(toMinor(tax)).toBe(838);
  });

  it("roundLedger is banker's (half-even): 2.5c -> 2, 3.5c -> 4", () => {
    const half5 = percentOf(money(100, USD), ratio(25, 3)); // $1.00 * 0.025 = 2.5 cents
    const half7 = percentOf(money(100, USD), ratio(35, 3)); // 3.5 cents
    expect(toMinor(roundLedger(half5))).toBe(2);
    expect(toMinor(roundLedger(half7))).toBe(4);
  });
});
