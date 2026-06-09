import { describe, expect, it } from "vitest";
import { USD, makeMoneyDinero, snapshot } from "../src/dinero.ts";

describe("dinero seam (number calculator)", () => {
  it("creates a dinero at an explicit scale and reads its snapshot", () => {
    const d = makeMoneyDinero(45000, USD, 2);
    const s = snapshot(d);
    expect(s.amount).toBe(45000);
    expect(s.scale).toBe(2);
    expect(s.currency.code).toBe("USD");
  });
});
