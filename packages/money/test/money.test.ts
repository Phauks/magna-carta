import { describe, expect, it } from "vitest";
import {
  abs,
  add,
  EUR,
  fromDecimal,
  money,
  multiplyByQuantity,
  negate,
  percentOf,
  rate,
  ratio,
  subtract,
  sum,
  USD,
  zero,
  type Money,
} from "../src/money.ts";
import { fromMinor, toMinor } from "../src/format.ts";
import { roundInvoiceLine } from "../src/rounding.ts";
import { snapshot } from "../src/dinero.ts";

describe("money / rate constructors", () => {
  it("builds Money at 2dp from minor units and round-trips through the DB boundary", () => {
    const m: Money = money(45000, USD); // $450.00
    expect(toMinor(m)).toBe(45000);
    expect(toMinor(fromMinor(45000, USD))).toBe(45000);
  });

  it("builds Rate at 4dp (scale 4)", () => {
    expect(snapshot(rate(4500000, USD)).scale).toBe(4); // $450.0000
  });

  it("rejects a non-safe-integer minor amount (fails loud at the 2^53 boundary)", () => {
    expect(() => money(Number.MAX_SAFE_INTEGER + 2, USD)).toThrow();
    expect(() => money(1.5, USD)).toThrow();
  });
});

describe("money arithmetic", () => {
  it("adds and subtracts same-currency Money", () => {
    expect(toMinor(add(money(45000, USD), money(5000, USD)))).toBe(50000);
    expect(toMinor(subtract(money(45000, USD), money(5000, USD)))).toBe(40000);
  });

  it("throws when currencies are mixed", () => {
    expect(() => add(money(100, USD), money(100, EUR))).toThrow();
  });
});

describe("rate x quantity and percent", () => {
  it("multiplies a Rate by a fractional quantity, rounded to Money at the invoice-line boundary", () => {
    // $450.0000/hr x 2.5 hr = $1125.00
    const line = roundInvoiceLine(multiplyByQuantity(rate(4500000, USD), 2.5));
    expect(toMinor(line)).toBe(112500);
  });

  it("keeps a high-precision intermediate (scale > 2) until a boundary rounds it", () => {
    const intermediate = percentOf(money(10000, USD), ratio(8375, 5)); // $100.00 * 0.08375
    expect(snapshot(intermediate).scale).toBeGreaterThan(2);
  });

  it("rejects a quantity outside the supported decimal range (exponential notation)", () => {
    expect(() => multiplyByQuantity(rate(4500000, USD), 1e-7)).toThrow();
  });
});

describe("zero / negate / abs / sum", () => {
  it("zero is the additive identity in a currency", () => {
    expect(toMinor(zero(USD))).toBe(0);
    expect(toMinor(add(money(45000, USD), zero(USD)))).toBe(45000);
  });

  it("negate of zero stays +0, never -0 (0 * -1 is -0 in JS)", () => {
    expect(Object.is(toMinor(negate(zero(USD))), -0)).toBe(false);
    expect(Object.is(toMinor(negate(zero(USD))), 0)).toBe(true);
  });

  it("negate flips sign; abs takes magnitude", () => {
    expect(toMinor(negate(money(45000, USD)))).toBe(-45000);
    expect(toMinor(negate(money(-45000, USD)))).toBe(45000);
    expect(toMinor(abs(money(-45000, USD)))).toBe(45000);
    expect(toMinor(abs(money(45000, USD)))).toBe(45000);
  });

  it("sum totals a non-empty list and throws on empty", () => {
    expect(toMinor(sum([money(100, USD), money(200, USD), money(50, USD)]))).toBe(350);
    expect(toMinor(sum([money(45000, USD)]))).toBe(45000);
    expect(() => sum([])).toThrow();
  });

  it("sum throws on mixed currencies", () => {
    expect(() => sum([money(100, USD), money(100, EUR)])).toThrow();
  });
});

describe("ratio constructor", () => {
  it("rejects a non-integer, non-finite, or unsafe amount (parity with money/rate)", () => {
    expect(() => ratio(1.5, 2)).toThrow(RangeError);
    expect(() => ratio(NaN, 2)).toThrow(RangeError);
    expect(() => ratio(2 ** 53, 0)).toThrow(RangeError);
  });

  it("rejects a negative or fractional scale", () => {
    expect(() => ratio(10, -2)).toThrow(RangeError);
    expect(() => ratio(10, 0.5)).toThrow(RangeError);
  });
});

describe("fromDecimal (human input boundary)", () => {
  it("parses decimal strings into cents", () => {
    expect(toMinor(fromDecimal("450.00", USD))).toBe(45000);
    expect(toMinor(fromDecimal("450", USD))).toBe(45000);
    expect(toMinor(fromDecimal("450.5", USD))).toBe(45050);
    expect(toMinor(fromDecimal("-1234.56", USD))).toBe(-123456);
    expect(toMinor(fromDecimal("0.01", USD))).toBe(1);
    expect(toMinor(fromDecimal("0", USD))).toBe(0);
    expect(toMinor(fromDecimal("-0", USD))).toBe(0); // never -0
  });

  it("rejects sub-cent precision and malformed input", () => {
    expect(() => fromDecimal("450.005", USD)).toThrow(); // 3 decimals
    expect(() => fromDecimal("abc", USD)).toThrow();
    expect(() => fromDecimal("", USD)).toThrow();
    expect(() => fromDecimal("4.5.6", USD)).toThrow();
  });
});
