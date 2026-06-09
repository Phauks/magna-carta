import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { accountBalance, ledgerAccount, ledgerEntry, ledgerLine } from "../src/per-firm-schema.ts";

describe("ledger tables (ADR-0072)", () => {
  it("ledger_account: TEXT handle PK, type enum, parent seam, active flag", () => {
    const config = getTableConfig(ledgerAccount);
    expect(config.name).toBe("ledger_account");
    const columns = Object.fromEntries(config.columns.map((column) => [column.name, column]));
    expect(columns["id"]?.primary).toBe(true);
    expect(columns["parent_account_id"]?.notNull).toBe(false);
    expect(columns["active"]?.notNull).toBe(true);
  });

  it("ledger_entry: dual dates, UNIQUE reverses_entry_id, non-empty description CHECK", () => {
    const config = getTableConfig(ledgerEntry);
    expect(config.name).toBe("ledger_entry");
    const columnNames = config.columns.map((column) => column.name);
    expect(columnNames).toEqual(
      expect.arrayContaining(["effective_date", "recorded_at", "reverses_entry_id"]),
    );
    const uniqueOnReversesEntryId = config.indexes.some(
      (index) =>
        index.config.unique &&
        index.config.columns.some(
          (column) => "name" in column && column.name === "reverses_entry_id",
        ),
    );
    expect(uniqueOnReversesEntryId).toBe(true);
    expect(config.checks.map((check) => check.name)).toContain(
      "ledger_entry_description_nonempty_check",
    );
  });

  it("ledger_line: direction + positive amount CHECK, UNIQUE(entry_id, line_index)", () => {
    const config = getTableConfig(ledgerLine);
    expect(config.name).toBe("ledger_line");
    expect(config.checks.map((check) => check.name)).toContain(
      "ledger_line_amount_minor_positive_check",
    );
    expect(config.checks.map((check) => check.name)).toContain("ledger_line_direction_check");
    const uniqueOnEntryIdLineIndex = config.indexes.some(
      (index) =>
        index.config.unique &&
        ["entry_id", "line_index"].every((wanted) =>
          index.config.columns.some((column) => "name" in column && column.name === wanted),
        ),
    );
    expect(uniqueOnEntryIdLineIndex).toBe(true);
    const direction = config.columns.find((column) => column.name === "direction");
    expect(direction).toBeDefined();
    expect(direction?.notNull).toBe(true);
    expect(direction?.enumValues).toEqual(["debit", "credit"]);
  });

  it("account_balance: bounds CHECK present (the D1 batch-abort mechanism)", () => {
    const config = getTableConfig(accountBalance);
    expect(config.name).toBe("account_balance");
    expect(config.checks.map((check) => check.name)).toContain("account_balance_bounds_check");
  });
});
