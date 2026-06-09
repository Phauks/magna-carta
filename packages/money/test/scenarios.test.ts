import { describe, expect, it } from "vitest";
import { money, percentOf, ratio, sum, USD } from "../src/money.ts";
import { allocate } from "../src/allocate.ts";
import { roundTax } from "../src/rounding.ts";
import { toMinor } from "../src/format.ts";

// Scenario fixtures: contingency split, multi-invoice payment application, tax on a cost.
// These exercise the operations the way real billing/trust flows will compose them.

describe("scenario: contingency settlement statement", () => {
  it("splits a gross recovery across client / fee / cost / lien with no penny drift", () => {
    const gross = money(10_000_000, USD); // $100,000.00
    // Integer weights standing in for the agreed split (attorney fee, cost reimbursement, lien, client).
    const parts = allocate(gross, [3333, 500, 167, 6000]);
    expect(parts).toHaveLength(4);
    expect(toMinor(sum(parts))).toBe(10_000_000); // parts sum EXACTLY to gross
  });
});

describe("scenario: payment application across open invoices", () => {
  it("distributes a payment across invoice balances, summing exactly to the payment", () => {
    const payment = money(50_000, USD); // $500.00
    // Weighted by each open invoice's balance ($300 / $150 / $50).
    const parts = allocate(payment, [30000, 15000, 5000]);
    expect(parts).toHaveLength(3);
    expect(toMinor(sum(parts))).toBe(50_000);
  });
});

describe("scenario: tax on a taxable cost", () => {
  it("computes 8.375% tax on a $250.00 cost, half-up to the cent", () => {
    const cost = money(25000, USD); // $250.00
    const tax = roundTax(percentOf(cost, ratio(8375, 5))); // $250.00 * 0.08375 = $20.9375 -> $20.94
    expect(toMinor(tax)).toBe(2094);
  });
});
