import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as controlPlaneSchema from "../src/control-plane-schema.ts";
import * as perFirmSchema from "../src/per-firm-schema.ts";

// Every drizzle table exported by either lineage. New tables are enumerated automatically —
// these fitness functions bind to the whole schema surface, not a hand-kept list.
const ALL_TABLES = (
  [...Object.values(controlPlaneSchema), ...Object.values(perFirmSchema)] as unknown[]
).filter((candidate): candidate is SQLiteTable => candidate instanceof SQLiteTable);

describe("schema conformance (fitness functions)", () => {
  it("found the expected tables (guards the enumeration itself)", () => {
    expect(ALL_TABLES.length).toBeGreaterThanOrEqual(3); // firm, idempotency_key, outbox
  });

  it("every table's primary key is a TEXT identifier handle named id (ADR-0062)", () => {
    // Sanctioned exceptions: 1:1 extension tables keyed by the OWNING entity's handle. The primary
    // key is still a TEXT identifier handle (ADR-0062) — it is the owner's, not a fresh one.
    // account_balance is the materialized balance row of its ledger_account (ADR-0072).
    const extensionTablePrimaryKeyNames: Record<string, string> = {
      account_balance: "account_id",
    };
    for (const table of ALL_TABLES) {
      const config = getTableConfig(table);
      const primaryColumns = config.columns.filter((column) => column.primary);
      expect(primaryColumns, config.name).toHaveLength(1);
      expect(primaryColumns[0]?.name, config.name).toBe(
        extensionTablePrimaryKeyNames[config.name] ?? "id",
      );
      expect(primaryColumns[0]?.getSQLType(), config.name).toBe("text");
    }
  });

  it("no money column is a float: *_minor and *_rate_e4 must be INTEGER (ADR-0061)", () => {
    for (const table of ALL_TABLES) {
      const config = getTableConfig(table);
      for (const column of config.columns) {
        if (column.name.endsWith("_minor") || column.name.endsWith("_rate_e4")) {
          expect(column.getSQLType(), `${config.name}.${column.name}`).toBe("integer");
        }
      }
    }
  });

  it("no column anywhere is REAL — float money can never sneak in under another name", () => {
    // If a legitimately-float column ever appears (it has not yet), add an explicit allowlist HERE
    // with a comment justifying it — the default posture is no floats in a legal/financial schema.
    for (const table of ALL_TABLES) {
      const config = getTableConfig(table);
      for (const column of config.columns) {
        expect(column.getSQLType(), `${config.name}.${column.name}`).not.toBe("real");
      }
    }
  });

  it("money-ish column names must use the storage-encoding suffixes (*_minor / *_rate_e4)", () => {
    const moneyName = /(amount|balance|total|price|fee|cost)(_|$)/;
    for (const table of ALL_TABLES) {
      const config = getTableConfig(table);
      for (const column of config.columns) {
        if (moneyName.test(column.name)) {
          const suffixed = column.name.endsWith("_minor") || column.name.endsWith("_rate_e4");
          expect(suffixed, `${config.name}.${column.name} must be *_minor or *_rate_e4`).toBe(true);
        }
      }
    }
  });
});
