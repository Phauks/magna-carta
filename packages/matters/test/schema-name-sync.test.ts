// @repo-wide-fitness scope=schema — the statements are here, the tables they name are in
// packages/database, so the diff that renames one never touches this package.
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  matter,
  matterNumberAllocation,
  matterNumberCounter,
  matterType,
} from "@magna-carta/database/per-firm-schema";
import { describe, expect, it } from "vitest";
import {
  MATTER_TYPE_TABLE,
  deactivateMatterTypeStatement,
  insertMatterTypeStatement,
  selectMatterTypeIdByCodeStatement,
  selectMatterTypeIdByNameStatement,
  selectMatterTypeStatement,
  updateMatterTypeStatement,
} from "../src/matter-type-statements.ts";
import { listConsultationsStatement, listMattersStatement } from "../src/queries.ts";
import {
  MATTER_TABLE,
  closeMatterStatement,
  insertMatterStatement,
  openMatterStatement,
  renumberMatterStatement,
  reopenMatterStatement,
  selectMatterStatement,
  updateMatterFieldsStatement,
} from "../src/matter-statements.ts";
import {
  MATTER_NUMBER_ALLOCATION_TABLE,
  MATTER_NUMBER_COUNTER_TABLE,
  allocateCounterValueStatement,
  ensureCounterRowStatement,
  guardedIncrementStatement,
  selectCounterValueStatement,
} from "../src/numbering/counter-statements.ts";

// Fitness function (the ledger pattern): the raw SQL in this package must track
// @magna-carta/database's schema. Renaming a table/column there fails here, not in production.

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
const columnsOf = (table: Parameters<typeof getTableConfig>[0]): Set<string> =>
  new Set(getTableConfig(table).columns.map((column) => column.name));

const identifiers = (sql: string) =>
  sql.replace(/'(?:[^']|'')*'/g, " ").match(/\b[a-z_][a-z0-9_]*\b/g) ?? [];

function expectOnlyKnownIdentifiers(sql: string, allowed: ReadonlySet<string>, label: string) {
  for (const identifier of identifiers(sql)) {
    expect(allowed.has(identifier), `${label} SQL names "${identifier}"`).toBe(true);
  }
}

const MATTER_ID = "matter_x" as never;
const FIELDS = {
  title: "t",
  description: null,
  matterTypeId: null,
  locationId: null,
  physicalFileLocationId: null,
  responsibleMemberId: "user_x" as never,
  clientDisplayName: null,
  clientCode: null,
};

describe("schema name sync (matters SQL pinned to @magna-carta/database)", () => {
  it("table name constants match the drizzle schema", () => {
    expect(getTableConfig(matter).name).toBe(MATTER_TABLE);
    expect(getTableConfig(matterNumberCounter).name).toBe(MATTER_NUMBER_COUNTER_TABLE);
    expect(getTableConfig(matterNumberAllocation).name).toBe(MATTER_NUMBER_ALLOCATION_TABLE);
  });

  it("every column the matter SQL names exists in the schema", () => {
    const stub = stubDatabase();
    const sql = [
      sqlOf(
        insertMatterStatement(stub, {
          id: MATTER_ID,
          ...FIELDS,
          status: "open",
          matterNumber: "n",
          consultationNumber: null,
          intakeNumber: null,
          numberedAt: "t",
          openedAt: "t",
          createdAt: "t",
        }),
      ),
      sqlOf(selectMatterStatement(stub, MATTER_ID)),
      sqlOf(openMatterStatement(stub, MATTER_ID, "n", "t")),
      sqlOf(updateMatterFieldsStatement(stub, MATTER_ID, FIELDS, "t")),
      sqlOf(closeMatterStatement(stub, MATTER_ID, "t")),
      sqlOf(reopenMatterStatement(stub, MATTER_ID, "open", "t")),
      sqlOf(renumberMatterStatement(stub, MATTER_ID, "n", "t")),
    ].join("\n");
    expectOnlyKnownIdentifiers(sql, new Set([MATTER_TABLE, ...columnsOf(matter)]), "matter");
  });

  it("every column the counter SQL names exists in the schema", () => {
    const stub = stubDatabase();
    const counterStatements = [
      sqlOf(ensureCounterRowStatement(stub, "k", 1)),
      sqlOf(guardedIncrementStatement(stub, "k", 1)),
      sqlOf(selectCounterValueStatement(stub, "k")),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      counterStatements,
      new Set([MATTER_NUMBER_COUNTER_TABLE, ...columnsOf(matterNumberCounter)]),
      "counter",
    );
    const allocationSql = sqlOf(
      allocateCounterValueStatement(stub, "k", 1, MATTER_ID, "2026-06-13T12:00:00.000Z"),
    );
    expectOnlyKnownIdentifiers(
      allocationSql,
      new Set([MATTER_NUMBER_ALLOCATION_TABLE, ...columnsOf(matterNumberAllocation)]),
      "allocation",
    );
  });

  it("every column the matter-type SQL names exists in the schema", () => {
    const stub = stubDatabase();
    const typeId = "matterType_x" as never;
    const sql = [
      sqlOf(insertMatterTypeStatement(stub, { id: typeId, name: "n", code: "c", createdAt: "t" })),
      sqlOf(updateMatterTypeStatement(stub, typeId, "n", "c", "t")),
      sqlOf(deactivateMatterTypeStatement(stub, typeId, "t")),
      sqlOf(selectMatterTypeStatement(stub, typeId)),
      sqlOf(selectMatterTypeIdByNameStatement(stub, "n")),
      sqlOf(selectMatterTypeIdByCodeStatement(stub, "c")),
    ].join("\n");
    expectOnlyKnownIdentifiers(sql, new Set([MATTER_TYPE_TABLE, ...columnsOf(matterType)]), "type");
  });

  it("every column the list queries name exists in the schema", () => {
    const stub = stubDatabase();
    // Every filter set, so the SQL names every column the list queries can reference.
    const sql = [
      sqlOf(
        listMattersStatement(
          stub,
          {
            status: "open",
            matterTypeId: "matterType_x" as never,
            locationId: "location_x" as never,
            responsibleMemberId: "user_x" as never,
            search: "term",
          },
          { createdAt: "t", id: "matter_x" },
          10,
        ),
      ),
      sqlOf(
        listConsultationsStatement(stub, "user_x" as never, { createdAt: "t", id: "matter_x" }, 10),
      ),
    ].join("\n");
    expectOnlyKnownIdentifiers(sql, new Set([MATTER_TABLE, ...columnsOf(matter)]), "queries");
  });
});
