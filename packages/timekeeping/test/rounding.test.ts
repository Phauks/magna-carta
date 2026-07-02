import { describe, expect, it } from "vitest";
import { fromMinor, toMinor } from "@magna-carta/money/format";
import { currencyFromCode } from "@magna-carta/money/money";
import { computeAmountMinor, roundDuration } from "../src/rounding.ts";

describe("roundDuration — billable-quantity rounding (distinct from money rounding)", () => {
  it("rounds UP to the increment (any nonzero remainder rounds up)", () => {
    expect(roundDuration(0, 6, "up")).toBe(0);
    expect(roundDuration(1, 6, "up")).toBe(6);
    expect(roundDuration(6, 6, "up")).toBe(6);
    expect(roundDuration(7, 6, "up")).toBe(12);
    expect(roundDuration(1, 15, "up")).toBe(15);
    expect(roundDuration(16, 15, "up")).toBe(30);
  });

  it("rounds DOWN to the increment (truncates the remainder)", () => {
    expect(roundDuration(0, 6, "down")).toBe(0);
    expect(roundDuration(5, 6, "down")).toBe(0);
    expect(roundDuration(6, 6, "down")).toBe(6);
    expect(roundDuration(11, 6, "down")).toBe(6);
    expect(roundDuration(29, 15, "down")).toBe(15);
  });

  it("rounds to the NEAREST increment, half rounding up", () => {
    expect(roundDuration(2, 6, "nearest")).toBe(0);
    expect(roundDuration(3, 6, "nearest")).toBe(6); // exactly half -> up
    expect(roundDuration(4, 6, "nearest")).toBe(6);
    expect(roundDuration(9, 6, "nearest")).toBe(12); // 9 is the half of the 6..12 step -> up
    expect(roundDuration(7, 15, "nearest")).toBe(0);
    expect(roundDuration(8, 15, "nearest")).toBe(15); // 7.5 is half; 8 >= 7.5 -> up
  });

  it("treats an already-on-increment value as fixed in every direction", () => {
    for (const direction of ["up", "nearest", "down"] as const) {
      expect(roundDuration(30, 6, direction)).toBe(30);
      expect(roundDuration(30, 15, direction)).toBe(30);
    }
  });

  it("rejects a non-positive increment and a negative raw duration (fail loud, no floats)", () => {
    expect(() => roundDuration(10, 0, "nearest")).toThrow(RangeError);
    expect(() => roundDuration(10, -6, "nearest")).toThrow(RangeError);
    expect(() => roundDuration(-1, 6, "nearest")).toThrow(RangeError);
    expect(() => roundDuration(1.5, 6, "nearest")).toThrow(RangeError);
  });
});

describe("computeAmountMinor — integer-minor WIP amount = round(rate_e4 x minutes / 60)", () => {
  // Golden table: hand-computed minor units. amount_minor = round_half_away_from_zero(rate_e4 x min / 6000).
  // $450.0000/hr = rate_e4 4500000.
  it.each([
    { rateE4: 4500000, minutes: 150, expected: 112500 }, // 2.5 h -> $1125.00
    { rateE4: 4500000, minutes: 6, expected: 4500 }, //   0.1 h -> $45.00
    { rateE4: 4500000, minutes: 1, expected: 750 }, //    1 min -> $7.50
    { rateE4: 4500000, minutes: 7, expected: 5250 }, //   7 min -> $52.50
    { rateE4: 3333300, minutes: 7, expected: 3889 }, //   $333.33/hr x 7 min = $38.8885 -> $38.89
    { rateE4: 3333300, minutes: 1, expected: 556 }, //    $5.5555 -> $5.56 (half away from zero)
    { rateE4: 0, minutes: 150, expected: 0 }, //          a zero rate is a zero amount
  ])("rate_e4=$rateE4 over $minutes min -> $expected minor", ({ rateE4, minutes, expected }) => {
    expect(computeAmountMinor(rateE4, minutes, "USD")).toBe(expected);
  });

  it("rounds half AWAY from zero, matching the invoice-line convention", () => {
    // $5.5555 -> 556 (not 555): the .5 cent rounds away from zero.
    expect(computeAmountMinor(3333300, 1, "USD")).toBe(556);
  });

  it("rejects an unregistered currency and non-integer inputs (fail loud)", () => {
    expect(() => computeAmountMinor(4500000, 60, "ZZZ")).toThrow(RangeError);
    expect(() => computeAmountMinor(4500000.5, 60, "USD")).toThrow(RangeError);
    expect(() => computeAmountMinor(4500000, 60.5, "USD")).toThrow(RangeError);
    expect(() => computeAmountMinor(4500000, -1, "USD")).toThrow(RangeError);
  });

  it("currency round-trip: a Money reconstructs from the stored rate_e4/duration/currency columns", () => {
    // The stored columns alone reconstruct a Money tagged with the right currency — the invariant
    // that nothing about the amount is lost between capture and read. Compare via toMinor() since
    // Dinero objects carry a calculator reference that defeats toEqual() on two separately
    // constructed instances even when they represent the same amount and currency.
    const amountMinor = computeAmountMinor(4500000, 150, "USD");
    const reconstructed = fromMinor(amountMinor, currencyFromCode("USD"));
    expect(toMinor(reconstructed)).toBe(toMinor(fromMinor(112500, currencyFromCode("USD"))));
  });
});
