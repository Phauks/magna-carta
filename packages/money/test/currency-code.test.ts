import { describe, expect, it } from "vitest";
import { currencyCode } from "../src/format.ts";
import { money, USD, EUR } from "../src/money.ts";

describe("currencyCode (ledger validation boundary)", () => {
  it("returns the ISO-4217 code of a Money", () => {
    expect(currencyCode(money(500000, USD))).toBe("USD");
    expect(currencyCode(money(1, EUR))).toBe("EUR");
  });
});
