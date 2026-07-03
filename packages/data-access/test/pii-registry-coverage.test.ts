import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { PROTECTED_COLUMNS } from "@magna-carta/database/protected-columns";
import * as perFirmSchema from "@magna-carta/database/per-firm-schema";
import { NO_PII_TABLES, PII_TABLES } from "../src/pii-registry.ts";

// Every physical per-firm table name, introspected from the Drizzle schema exports (the same idiom
// as protected-field-registry.test.ts).
const schemaTables = new Set<string>();
for (const exported of Object.values(perFirmSchema)) {
  if (typeof exported !== "object" || exported === null) continue;
  try {
    schemaTables.add(getTableConfig(exported as SQLiteTable).name);
  } catch {
    continue;
  }
}

const registered = new Set(PII_TABLES.map((entry) => entry.table));
const declaredNonPii = new Set(NO_PII_TABLES);

describe("PII registry coverage", () => {
  it("every per-firm table is classified as PII (registered) or explicitly non-PII", () => {
    const unclassified = [...schemaTables].filter(
      (table) => !registered.has(table) && !declaredNonPii.has(table),
    );
    expect(
      unclassified,
      `unclassified tables — add each to PII_TABLES or NO_PII_TABLES: ${unclassified.join(", ")}`,
    ).toEqual([]);
  });

  it("PII and non-PII classifications are disjoint", () => {
    for (const table of registered) {
      expect(declaredNonPii.has(table), `${table} is in both PII_TABLES and NO_PII_TABLES`).toBe(
        false,
      );
    }
  });

  it("every registered table actually exists in the schema (no stale entries)", () => {
    for (const table of [...registered, ...declaredNonPii]) {
      expect(schemaTables.has(table), `${table} is classified but not in the per-firm schema`).toBe(
        true,
      );
    }
  });

  it("every protected column's table is registered as PII", () => {
    for (const protectedColumn of PROTECTED_COLUMNS) {
      // firm_secret is control-plane, not per-firm; skip control-plane-only protected tables.
      if (!schemaTables.has(protectedColumn.table)) continue;
      expect(
        registered.has(protectedColumn.table),
        `protected table ${protectedColumn.table} must be in PII_TABLES`,
      ).toBe(true);
    }
  });
});
