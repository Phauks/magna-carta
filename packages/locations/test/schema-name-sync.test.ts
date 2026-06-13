import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { location, locationAddress, memberLocation } from "@magna-carta/database/per-firm-schema";
import { describe, expect, it } from "vitest";
import {
  LOCATION_ADDRESS_TABLE,
  LOCATION_TABLE,
  MEMBER_LOCATION_TABLE,
  closeLocationStatement,
  deleteLocationAddressesStatement,
  deleteMemberLocationsStatement,
  insertLocationAddressStatement,
  insertLocationStatement,
  insertMemberLocationStatement,
  selectLocationStatement,
  updateLocationFieldsStatement,
} from "../src/statements.ts";

// Fitness function (the ledger pattern): the raw SQL in this package must track
// @magna-carta/database's schema. Renaming a table/column there fails here, not in production.

function stubDatabase(): SqlDatabase {
  const statement = (sql: string): SqlStatement => ({
    sql,
    bind: () => statement(sql),
    run: () => Promise.resolve({ meta: { changes: 0 } }),
    all: <T>() => Promise.resolve({ results: [] as T[] }),
  });
  return { prepare: statement };
}

const sqlOf = (statement: SqlStatement): string => statement.sql ?? "";
const columnsOf = (table: Parameters<typeof getTableConfig>[0]): Set<string> =>
  new Set(getTableConfig(table).columns.map((column) => column.name));

// SQL keywords are UPPERCASE in the builders; string literals ('active', 'closed', 'physical') are
// stripped before extraction. What remains is table and column identifiers.
const identifiers = (sql: string) =>
  sql.replace(/'(?:[^']|'')*'/g, " ").match(/\b[a-z_][a-z0-9_]*\b/g) ?? [];

function expectOnlyKnownIdentifiers(sql: string, allowed: ReadonlySet<string>, label: string) {
  for (const identifier of identifiers(sql)) {
    expect(allowed.has(identifier), `${label} SQL names "${identifier}"`).toBe(true);
  }
}

const LOCATION_ID = "location_x" as never;
const ADDRESS_ID = "locationAddress_x" as never;
const MEMBER_LOCATION_ID = "memberLocation_x" as never;
const USER_ID = "user_x" as never;

describe("schema name sync (locations SQL pinned to @magna-carta/database)", () => {
  it("table name constants match the drizzle schema", () => {
    expect(getTableConfig(location).name).toBe(LOCATION_TABLE);
    expect(getTableConfig(locationAddress).name).toBe(LOCATION_ADDRESS_TABLE);
    expect(getTableConfig(memberLocation).name).toBe(MEMBER_LOCATION_TABLE);
  });

  it("every column the location SQL names exists in the schema", () => {
    const stub = stubDatabase();
    const fields = {
      name: "n",
      jurisdiction: null,
      numberCode: null,
      addressBlock: null,
      footer: null,
      remitTo: null,
    };
    const sql = [
      sqlOf(insertLocationStatement(stub, { id: LOCATION_ID, ...fields, createdAt: "t" })),
      sqlOf(updateLocationFieldsStatement(stub, LOCATION_ID, fields, "t")),
      sqlOf(closeLocationStatement(stub, LOCATION_ID, "t")),
      sqlOf(selectLocationStatement(stub, LOCATION_ID)),
    ].join("\n");
    expectOnlyKnownIdentifiers(sql, new Set([LOCATION_TABLE, ...columnsOf(location)]), "location");
  });

  it("every column the address SQL names exists in the schema", () => {
    const stub = stubDatabase();
    const sql = [
      sqlOf(
        insertLocationAddressStatement(stub, {
          id: ADDRESS_ID,
          locationId: LOCATION_ID,
          kind: "physical",
          street: null,
          city: null,
          region: null,
          postal: null,
          phone: null,
          createdAt: "t",
        }),
      ),
      sqlOf(deleteLocationAddressesStatement(stub, LOCATION_ID)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      sql,
      new Set([LOCATION_ADDRESS_TABLE, ...columnsOf(locationAddress)]),
      "address",
    );
  });

  it("every column the member-location SQL names exists in the schema", () => {
    const stub = stubDatabase();
    const sql = [
      sqlOf(
        insertMemberLocationStatement(stub, {
          id: MEMBER_LOCATION_ID,
          memberUserId: USER_ID,
          locationId: LOCATION_ID,
          isPrimary: true,
          createdAt: "t",
        }),
      ),
      sqlOf(deleteMemberLocationsStatement(stub, USER_ID)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      sql,
      new Set([MEMBER_LOCATION_TABLE, ...columnsOf(memberLocation)]),
      "member-location",
    );
  });
});
