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
});
