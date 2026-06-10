import { describe, expect, it } from "vitest";
import { currencyCode } from "../src/format.ts";
import { add, currencyFromCode, money, USD, EUR } from "../src/money.ts";

describe("currencyCode (ledger validation boundary)", () => {
  it("returns the ISO-4217 code of a Money", () => {
    expect(currencyCode(money(500000, USD))).toBe("USD");
    expect(currencyCode(money(1, EUR))).toBe("EUR");
  });

  it("survives arithmetic — a derived Money keeps its currency", () => {
    expect(currencyCode(add(money(1, USD), money(2, USD)))).toBe("USD");
  });
});

describe("currencyFromCode — the code → currency registry (the single home)", () => {
  it("resolves registered codes to their currency object", () => {
    expect(currencyFromCode("USD")).toBe(USD);
    expect(currencyFromCode("EUR")).toBe(EUR);
  });

  it("round-trips with currencyCode", () => {
    expect(currencyFromCode(currencyCode(money(1, EUR)))).toBe(EUR);
  });

  it("throws on unknown or miscased codes — never guesses a currency", () => {
    expect(() => currencyFromCode("usd")).toThrow(RangeError);
    expect(() => currencyFromCode("")).toThrow(RangeError);
    expect(() => currencyFromCode("XYZ")).toThrow(RangeError);
  });
});
