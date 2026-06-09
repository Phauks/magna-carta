import { describe, expect, it } from "vitest";
import { money, USD } from "../src/money.ts";
import { format } from "../src/format.ts";

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
