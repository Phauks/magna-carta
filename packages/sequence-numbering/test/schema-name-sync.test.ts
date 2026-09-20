// @repo-wide-fitness scope=schema — the statements are here, the table they name is in
// packages/database, so the diff that renames it never touches this package.
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { numberingScheme } from "@magna-carta/database/per-firm-schema";
import type { NumberingSchemeId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { NUMBERING_PURPOSES, SCHEME_NUMBERING_PURPOSES } from "../src/purposes.ts";
import {
  NUMBERING_SCHEME_TABLE,
  deactivateActiveSchemeStatement,
  insertNumberingSchemeStatement,
  selectActiveSchemeStatement,
} from "../src/scheme-statements.ts";

// Fitness function (the ledger pattern): the raw SQL in this package must track
// @magna-carta/database's schema. Renaming the table or a column there fails here, not in production.

function stubDatabase(): SqlDatabase {
  const statement = (sql: string): SqlStatement => ({
    sql,
    bind: () => statement(sql),
    run: () => Promise.resolve({ meta: { changes: 0 } }),
    all: <T>() => Promise.resolve({ results: [] as T[] }),
    first: () => Promise.resolve(null),
  });
  return { prepare: statement };
}

const sqlOf = (statement: SqlStatement): string => statement.sql ?? "";

describe("schema name sync (numbering SQL pinned to @magna-carta/database)", () => {
  it("the table name constant matches the drizzle schema", () => {
    expect(getTableConfig(numberingScheme).name).toBe(NUMBERING_SCHEME_TABLE);
  });

  it("every column the scheme SQL names exists in the schema", () => {
    const stub = stubDatabase();
    const known = new Set([
      NUMBERING_SCHEME_TABLE,
      ...getTableConfig(numberingScheme).columns.map((column) => column.name),
    ]);
    const sql = [
      sqlOf(selectActiveSchemeStatement(stub, "matter")),
      sqlOf(deactivateActiveSchemeStatement(stub, "matter", "t")),
      sqlOf(
        insertNumberingSchemeStatement(stub, {
          id: "numberingScheme_x" as NumberingSchemeId,
          segments: "[]",
          purpose: "matter",
          createdAt: "t",
        }),
      ),
    ].join("\n");
    const identifiers = sql.match(/\b[a-z_]+\b/g) ?? [];
    const sqlWords = new Set([
      "select",
      "from",
      "where",
      "and",
      "update",
      "set",
      "insert",
      "into",
      "values",
    ]);
    for (const identifier of identifiers) {
      if (sqlWords.has(identifier) || /^\d+$/.test(identifier)) continue;
      expect(known, `unknown identifier ${identifier}`).toContain(identifier);
    }
  });

  // The `purpose` column's enum is the constraint where it is enforced (no CHECK on the table), so
  // the register and the column must agree on every purpose that takes a scheme.
  it("every scheme purpose on the register is a value the purpose column admits", () => {
    const column = getTableConfig(numberingScheme).columns.find(
      (candidate) => candidate.name === "purpose",
    );
    const admitted = new Set(
      (column as { enumValues?: readonly string[] } | undefined)?.enumValues,
    );
    for (const purpose of SCHEME_NUMBERING_PURPOSES) {
      expect(admitted, `purpose column does not admit ${purpose}`).toContain(purpose);
    }
    expect(NUMBERING_PURPOSES.map((definition) => definition.purpose)).toContain("conflicts_check");
  });
});
