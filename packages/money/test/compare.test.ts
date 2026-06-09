import { describe, expect, it } from "vitest";
import { EUR, money, USD } from "../src/money.ts";
import { toMinor } from "../src/format.ts";
import {
  compare,
  equal,
  greaterThan,
  greaterThanOrEqual,
  isNegative,
  isPositive,
  isZero,
  lessThan,
  lessThanOrEqual,
  maximum,
  minimum,
} from "../src/compare.ts";

describe("comparison operators", () => {
  it("orders same-currency Money", () => {
    const a = money(10000, USD);
    const b = money(20000, USD);
    expect(greaterThan(b, a)).toBe(true);
    expect(greaterThanOrEqual(a, a)).toBe(true);
    expect(lessThan(a, b)).toBe(true);
    expect(lessThanOrEqual(a, a)).toBe(true);
    expect(equal(a, money(10000, USD))).toBe(true);
    expect(equal(a, b)).toBe(false);
  });

  it("compare returns -1 / 0 / 1 (sort-comparator shape)", () => {
    expect(compare(money(100, USD), money(200, USD))).toBe(-1);
    expect(compare(money(200, USD), money(200, USD))).toBe(0);
    expect(compare(money(300, USD), money(200, USD))).toBe(1);
  });

  it("throws on mixed currencies", () => {
    expect(() => greaterThan(money(100, USD), money(100, EUR))).toThrow();
  });
});

describe("sign predicates (ledger/trust invariants)", () => {
  it("isZero / isNegative / isPositive", () => {
    expect(isZero(money(0, USD))).toBe(true);
    expect(isZero(money(1, USD))).toBe(false);
    expect(isNegative(money(-1, USD))).toBe(true);
    expect(isNegative(money(0, USD))).toBe(false);
    expect(isPositive(money(1, USD))).toBe(true);
    expect(isPositive(money(0, USD))).toBe(false);
  });
});

describe("minimum / maximum", () => {
  it("selects the smallest and largest", () => {
    const values = [money(300, USD), money(100, USD), money(200, USD)];
    expect(toMinor(minimum(values))).toBe(100);
    expect(toMinor(maximum(values))).toBe(300);
  });
});
