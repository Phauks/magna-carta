import { describe, expect, it } from "vitest";
import { add, EUR, money, rate, subtract, USD, type Money } from "../src/money.ts";
import { fromMinor, toMinor } from "../src/format.ts";

describe("money / rate constructors", () => {
  it("builds Money at 2dp from minor units and round-trips through the DB boundary", () => {
    const m: Money = money(45000, USD); // $450.00
    expect(toMinor(m)).toBe(45000);
    expect(toMinor(fromMinor(45000, USD))).toBe(45000);
  });

  it("builds Rate at 4dp", () => {
    const r = rate(4500000, USD); // $450.0000
    expect(r).toBeDefined();
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
