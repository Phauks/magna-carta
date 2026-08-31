/*
 * Reading an amount somebody typed.
 *
 * This is the file where a quiet mistake becomes money. `parseFloat(text) * 100` is wrong for
 * amounts a firm types every day and right for the handful anybody would test by eye, so the cases
 * pinned here are the ones that expose the difference — and the ceiling refusal is pinned because
 * silently clamping an amount is how a firm applies a figure it did not mean.
 */
import { describe, expect, it } from "vitest";
import {
  amountFieldText,
  readAmountMinor,
  readBoundedAmountMinor,
  readShareE4,
  shareFieldText,
} from "../src/lib/billing/amount-entry.ts";

describe("reading a typed amount", () => {
  it("reads the digits rather than multiplying a float", () => {
    // 1.15 * 100 is 114.99999999999999 in binary floating point. These are the amounts that expose
    // it, and every one of them has to land on the exact cent.
    expect(readAmountMinor("1.15")).toEqual({ kind: "amount", minor: 115 });
    expect(readAmountMinor("2.29")).toEqual({ kind: "amount", minor: 229 });
    expect(readAmountMinor("8.29")).toEqual({ kind: "amount", minor: 829 });
    expect(readAmountMinor("1234.56")).toEqual({ kind: "amount", minor: 123_456 });
  });

  it("accepts an amount pasted out of another document", () => {
    expect(readAmountMinor("$1,250.00")).toEqual({ kind: "amount", minor: 125_000 });
    expect(readAmountMinor("  480 ")).toEqual({ kind: "amount", minor: 48_000 });
  });

  it("reads a single decimal place as tenths, not hundredths", () => {
    expect(readAmountMinor("12.5")).toEqual({ kind: "amount", minor: 1250 });
  });

  it("distinguishes an empty field from a malformed one", () => {
    expect(readAmountMinor("")).toEqual({ kind: "empty" });
    expect(readAmountMinor("   ")).toEqual({ kind: "empty" });
    expect(readAmountMinor("about four hundred").kind).toBe("refused");
  });

  it("refuses an amount finer than a cent rather than rounding it", () => {
    // Rounding would charge a client a figure they did not type.
    expect(readAmountMinor("10.005").kind).toBe("refused");
  });

  it("round-trips through the field text it writes", () => {
    for (const minor of [0, 5, 50, 115, 100_000, 123_456]) {
      expect(readAmountMinor(amountFieldText(minor))).toEqual({ kind: "amount", minor });
    }
  });
});

describe("an amount bounded by a ceiling", () => {
  const ceiling = 50_000;

  it("takes an amount at or under the ceiling", () => {
    expect(readBoundedAmountMinor("500.00", ceiling, "$500.00")).toEqual({
      kind: "amount",
      minor: 50_000,
    });
    expect(readBoundedAmountMinor("120.00", ceiling, "$500.00")).toEqual({
      kind: "amount",
      minor: 12_000,
    });
  });

  it("refuses above the ceiling with the ceiling in the reason, and never clamps", () => {
    const reading = readBoundedAmountMinor("900.00", ceiling, "$500.00");
    expect(reading.kind).toBe("refused");
    expect(reading.kind === "refused" ? reading.reason : "").toContain("$500.00");
  });

  it("refuses an amount of nothing", () => {
    expect(readBoundedAmountMinor("0.00", ceiling, "$500.00").kind).toBe("refused");
  });
});

describe("a contingency share at the rate scale", () => {
  it("reads a percentage as ten-thousandths", () => {
    expect(readShareE4("33.33")).toEqual({ kind: "amount", minor: 3333 });
    expect(readShareE4("40%")).toEqual({ kind: "amount", minor: 4000 });
    expect(readShareE4("25")).toEqual({ kind: "amount", minor: 2500 });
  });

  it("refuses a share of nothing and a share beyond the whole recovery", () => {
    expect(readShareE4("0").kind).toBe("refused");
    expect(readShareE4("120").kind).toBe("refused");
  });

  it("writes a share back the way it reads", () => {
    expect(shareFieldText(3333)).toBe("33.33");
    expect(shareFieldText(4000)).toBe("40");
  });
});
