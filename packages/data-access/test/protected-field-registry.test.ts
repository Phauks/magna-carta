// @repo-wide-fitness — pins the registry here against the per-firm schema in packages/database and
// the permission registry in packages/access-control; a change in either breaks it from outside.
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { isPermission } from "@magna-carta/access-control/registry";
import { PROTECTED_COLUMNS } from "@magna-carta/database/protected-columns";
import * as perFirmSchema from "@magna-carta/database/per-firm-schema";
import { PROTECTED_FIELD_DECLARATIONS } from "../src/protected-field-registry.ts";

// Conformance fitness: the protected-field registry, the schema's protected-column list, the per-firm
// schema, and the access-control registry must agree. A declaration that names an unknown permission,
// a protected column with no declaration (or two), or a declaration pointing at a (table, column) that
// does not exist in the schema all fail HERE, not in production. These three lists drift independently
// — this test pins them to each other.

// Every (table, column) pair the per-firm drizzle schema defines, so a declaration can be checked to
// point at a real column. Built once from the schema's exported tables.
const schemaColumns = new Set<string>();
for (const exported of Object.values(perFirmSchema)) {
  // Only drizzle table objects carry a table config; skip the schema module's other exports.
  if (typeof exported !== "object" || exported === null) continue;
  let config: ReturnType<typeof getTableConfig>;
  try {
    config = getTableConfig(exported as SQLiteTable);
  } catch {
    continue;
  }
  for (const column of config.columns) {
    schemaColumns.add(`${config.name}.${column.name}`);
  }
}

describe("protected-field registry conformance", () => {
  it("every declaration names a permission that exists in the access-control registry", () => {
    for (const declaration of PROTECTED_FIELD_DECLARATIONS) {
      expect(
        isPermission(declaration.permission),
        `${declaration.table}.${declaration.column} declares permission "${declaration.permission}"`,
      ).toBe(true);
    }
  });

  it("every protected column in the schema has EXACTLY ONE declaration", () => {
    for (const protectedColumn of PROTECTED_COLUMNS) {
      const matches = PROTECTED_FIELD_DECLARATIONS.filter(
        (declaration) =>
          declaration.table === protectedColumn.table &&
          declaration.column === protectedColumn.column,
      );
      expect(
        matches.length,
        `protected column ${protectedColumn.table}.${protectedColumn.column} has ${matches.length} declarations`,
      ).toBe(1);
    }
  });

  it("every declaration guards a column that is in the PROTECTED_COLUMNS list", () => {
    const protectedSet = new Set(
      PROTECTED_COLUMNS.map((column) => `${column.table}.${column.column}`),
    );
    for (const declaration of PROTECTED_FIELD_DECLARATIONS) {
      expect(
        protectedSet.has(`${declaration.table}.${declaration.column}`),
        `${declaration.table}.${declaration.column} is declared but not in PROTECTED_COLUMNS`,
      ).toBe(true);
    }
  });

  it("every declaration's (table, column) exists in the per-firm schema", () => {
    for (const declaration of PROTECTED_FIELD_DECLARATIONS) {
      expect(
        schemaColumns.has(`${declaration.table}.${declaration.column}`),
        `${declaration.table}.${declaration.column} is not a column in the per-firm schema`,
      ).toBe(true);
      // A declared blind index, when present, also rides a real sibling column.
      if (declaration.blindIndex !== undefined) {
        expect(
          schemaColumns.has(`${declaration.table}.${declaration.blindIndex.column}`),
          `${declaration.table}.${declaration.blindIndex.column} (blind index) is not a column in the per-firm schema`,
        ).toBe(true);
      }
    }
  });
});
