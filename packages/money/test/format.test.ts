import { describe, expect, it } from "vitest";
import { money, rate, USD } from "../src/money.ts";
import { decimalText, format, formatRate } from "../src/format.ts";

describe("format", () => {
  it("formats Money with explicit currency via Intl", () => {
    expect(format(money(45000, USD))).toBe("$450.00");
  });

  it("formats negative amounts", () => {
    expect(format(money(-45000, USD))).toBe("-$450.00");
  });

  it("formats exactly at the top of the supported range (no float drift in the cents)", () => {
    // Near 2^53 cents the float spacing (~1.6 cents) exceeds half a cent, so any pass through
    // Number() can misprint the last digits. The package promises exactness up to 2^53.
    expect(format(money(9007199254740991, USD))).toBe("$90,071,992,547,409.91");
    expect(format(money(9007199254740987, USD))).toBe("$90,071,992,547,409.87");
  });
});

describe("formatRate", () => {
  it("prints a rate in whole cents as money", () => {
    expect(formatRate(rate(4_500_000, USD))).toBe("$450.00");
  });

  it("keeps the finer places a rate card holds", () => {
    expect(formatRate(rate(4_500_125, USD))).toBe("$450.0125");
  });
});

describe("decimalText", () => {
  it("prints two places, no symbol and no grouping", () => {
    expect(decimalText(money(123_450, USD))).toBe("1234.50");
    expect(decimalText(money(5, USD))).toBe("0.05");
    expect(decimalText(money(0, USD))).toBe("0.00");
  });

  it("stays exact at the top of the supported range", () => {
    expect(decimalText(money(9007199254740991, USD))).toBe("90071992547409.91");
  });
});
