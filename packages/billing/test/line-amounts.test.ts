import { describe, expect, it } from "vitest";
import { aggregateMinor, invoiceLineAmountMinor } from "../src/line-amounts.ts";

const USD = "USD";
const HOUR = 10_000; // one hour at the quantity scale

describe("an invoice line's amount", () => {
  it("is integer-exact for a whole hour at a whole rate", () => {
    expect(invoiceLineAmountMinor(4_000_000, HOUR, USD)).toBe(40_000);
  });

  it("is integer-exact for a fractional duration", () => {
    // 1.5 hours at 400.0000, and 0.1 hours at 425.0000 — the second is where a float would drift.
    expect(invoiceLineAmountMinor(4_000_000, 15_000, USD)).toBe(60_000);
    expect(invoiceLineAmountMinor(4_250_000, 1_000, USD)).toBe(4_250);
  });

  it("rounds a half-cent AWAY FROM ZERO, so a credit rounds to the same magnitude as its twin", () => {
    // 8.375 at the invoice-line boundary: half-up would give -8.37 against +8.38, an asymmetry a
    // billing system with discounts and credits must not have.
    expect(invoiceLineAmountMinor(83_750, HOUR, USD)).toBe(838);
    expect(invoiceLineAmountMinor(-83_750, HOUR, USD)).toBe(-838);
  });

  it("carries a negative rate straight through — a discount is an ordinary line", () => {
    expect(invoiceLineAmountMinor(-2_500_000, 5_000, USD)).toBe(-12_500);
  });
});

describe("aggregating line amounts into a posting total", () => {
  it("sums to the penny over many lines", () => {
    const amounts = Array.from({ length: 250 }, (_, index) => 1_337 + index);
    const expected = amounts.reduce((total, amount) => total + amount, 0);
    expect(aggregateMinor(amounts, USD)).toBe(expected);
  });

  it("nets a discount against the fees it discounts", () => {
    expect(aggregateMinor([60_000, 12_500, -7_250], USD)).toBe(65_250);
  });

  it("is zero for no lines at all", () => {
    expect(aggregateMinor([], USD)).toBe(0);
  });

  it("refuses to add two currencies rather than producing a total in neither", () => {
    // Money's own addition is what catches this: the amounts are integers on the wire, and a total
    // assembled by plain arithmetic would have silently mixed them.
    expect(() => aggregateMinor([1, 2], "ZZZ")).toThrow();
  });
});
