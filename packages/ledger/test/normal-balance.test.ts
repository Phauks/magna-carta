import { describe, expect, it } from "vitest";
import { balanceDelta, normalBalanceFor } from "../src/normal-balance.ts";

describe("normal balance derivation (the only home of the rule)", () => {
  it("asset/expense are debit-normal; liability/equity/income are credit-normal", () => {
    expect(normalBalanceFor("asset")).toBe("debit");
    expect(normalBalanceFor("expense")).toBe("debit");
    expect(normalBalanceFor("liability")).toBe("credit");
    expect(normalBalanceFor("equity")).toBe("credit");
    expect(normalBalanceFor("income")).toBe("credit");
  });

  it("balanceDelta is +amount when direction matches normal balance, else -amount", () => {
    expect(balanceDelta("asset", "debit", 500000)).toBe(500000); // debit a bank account: grows
    expect(balanceDelta("asset", "credit", 500000)).toBe(-500000);
    expect(balanceDelta("liability", "credit", 500000)).toBe(500000); // credit trust liability: grows
    expect(balanceDelta("liability", "debit", 500000)).toBe(-500000);
  });
});
