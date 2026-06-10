import { newIdentifier } from "@magna-carta/identifiers/generate";
import { money, USD, EUR } from "@magna-carta/money/money";
import { describe, expect, it } from "vitest";
import type { AccountSnapshot, PostEntryInput } from "../src/types.ts";
import { isValidCalendarDate, LedgerValidationError, validateEntry } from "../src/validate.ts";

const TODAY = "2026-06-09";

function account(overrides: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    id: newIdentifier("ledgerAccount"),
    type: "asset",
    currency: "USD",
    active: true,
    hasChildren: false,
    hasBalanceRow: true,
    ...overrides,
  };
}

function snapshotMap(...accounts: AccountSnapshot[]): ReadonlyMap<string, AccountSnapshot> {
  return new Map(accounts.map((snapshot) => [snapshot.id, snapshot]));
}

function balancedInput(a: AccountSnapshot, b: AccountSnapshot): PostEntryInput {
  return {
    description: "Retainer deposit",
    effectiveDate: "2026-06-01",
    lines: [
      { accountId: a.id, direction: "debit", amount: money(500000, USD) },
      { accountId: b.id, direction: "credit", amount: money(500000, USD) },
    ],
  };
}

function codeOf(run: () => void): string {
  try {
    run();
  } catch (error) {
    if (error instanceof LedgerValidationError) return error.code;
    throw error;
  }
  throw new Error("expected validateEntry to throw");
}

describe("validateEntry — the ledger invariants (ADR-0072)", () => {
  it("accepts a balanced two-line single-currency entry on active leaf accounts", () => {
    const a = account();
    const b = account({ type: "liability" });
    expect(() => validateEntry(balancedInput(a, b), snapshotMap(a, b), TODAY)).not.toThrow();
  });

  it("rejects every invariant violation with its named code", () => {
    const a = account();
    const b = account({ type: "liability" });

    const oneLine = { ...balancedInput(a, b), lines: balancedInput(a, b).lines.slice(0, 1) };
    expect(codeOf(() => validateEntry(oneLine, snapshotMap(a, b), TODAY))).toBe("too-few-lines");

    const blank = { ...balancedInput(a, b), description: "   " };
    expect(codeOf(() => validateEntry(blank, snapshotMap(a, b), TODAY))).toBe("empty-description");

    const badDate = { ...balancedInput(a, b), effectiveDate: "2026-02-30" };
    expect(codeOf(() => validateEntry(badDate, snapshotMap(a, b), TODAY))).toBe(
      "invalid-effective-date",
    );

    const future = { ...balancedInput(a, b), effectiveDate: "2026-06-10" };
    expect(codeOf(() => validateEntry(future, snapshotMap(a, b), TODAY))).toBe(
      "future-effective-date",
    );

    const zeroAmount = {
      ...balancedInput(a, b),
      lines: [
        { accountId: a.id, direction: "debit" as const, amount: money(0, USD) },
        { accountId: b.id, direction: "credit" as const, amount: money(0, USD) },
      ],
    };
    expect(codeOf(() => validateEntry(zeroAmount, snapshotMap(a, b), TODAY))).toBe(
      "non-positive-amount",
    );

    expect(codeOf(() => validateEntry(balancedInput(a, b), snapshotMap(a), TODAY))).toBe(
      "unknown-account",
    );

    const inactive = account({ id: b.id, type: "liability", active: false });
    expect(codeOf(() => validateEntry(balancedInput(a, b), snapshotMap(a, inactive), TODAY))).toBe(
      "inactive-account",
    );

    const parent = account({ id: b.id, type: "liability", hasChildren: true });
    expect(codeOf(() => validateEntry(balancedInput(a, b), snapshotMap(a, parent), TODAY))).toBe(
      "non-leaf-account",
    );

    const noBalanceRow = account({ id: b.id, type: "liability", hasBalanceRow: false });
    expect(
      codeOf(() => validateEntry(balancedInput(a, b), snapshotMap(a, noBalanceRow), TODAY)),
    ).toBe("missing-balance-row");

    const euroLine = {
      ...balancedInput(a, b),
      lines: [
        { accountId: a.id, direction: "debit" as const, amount: money(500000, EUR) },
        { accountId: b.id, direction: "credit" as const, amount: money(500000, USD) },
      ],
    };
    expect(codeOf(() => validateEntry(euroLine, snapshotMap(a, b), TODAY))).toBe(
      "currency-mismatch",
    );

    const lopsided = {
      ...balancedInput(a, b),
      lines: [
        { accountId: a.id, direction: "debit" as const, amount: money(500000, USD) },
        { accountId: b.id, direction: "credit" as const, amount: money(499999, USD) },
      ],
    };
    expect(codeOf(() => validateEntry(lopsided, snapshotMap(a, b), TODAY))).toBe("unbalanced");
  });

  it("rejects an imbalance that float accumulation would round away near 2^53", () => {
    const a = account();
    const b = account({ type: "liability" });
    // Every amount is an individually safe integer, but the true net is +1 minor: float
    // accumulation rounds (2^53 - 1) + 2 to 2^53 (ties-to-even) and the imbalance vanishes.
    const nearLimit = {
      ...balancedInput(a, b),
      lines: [
        { accountId: a.id, direction: "debit" as const, amount: money(9007199254740991, USD) },
        { accountId: a.id, direction: "debit" as const, amount: money(2, USD) },
        { accountId: b.id, direction: "credit" as const, amount: money(4503599627370496, USD) },
        { accountId: b.id, direction: "credit" as const, amount: money(4503599627370496, USD) },
      ],
    };
    expect(codeOf(() => validateEntry(nearLimit, snapshotMap(a, b), TODAY))).toBe("unbalanced");
  });

  it("backdating is allowed (effective date in the past)", () => {
    const a = account();
    const b = account({ type: "liability" });
    const backdated = { ...balancedInput(a, b), effectiveDate: "2024-01-15" };
    expect(() => validateEntry(backdated, snapshotMap(a, b), TODAY)).not.toThrow();
  });
});

describe("isValidCalendarDate — edge cases (guards money movement; exported for reuse)", () => {
  it.each([
    ["2026-06-09", true],
    ["2028-02-29", true], // valid leap day
    ["9999-12-31", true], // upper boundary of 4-digit years
    ["0001-01-01", true], // padded early year still round-trips
    ["2026-02-29", false], // not a leap year — rollover caught
    ["2026-02-30", false], // day rollover
    ["2026-00-01", false], // month 00
    ["2026-13-01", false], // month 13
    ["2026-01-00", false], // day 00
    ["0000-01-01", false], // astronomical year zero — no ledger date
    ["2026-1-01", false], // single-digit month blocked by the regex
    ["10000-01-01", false], // 5-digit year blocked by the regex
    ["not-a-date", false],
  ])("isValidCalendarDate(%s) === %s", (input, expected) => {
    expect(isValidCalendarDate(input)).toBe(expected);
  });
});
