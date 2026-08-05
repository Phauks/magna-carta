import {
  custodyHold,
  custodyItem,
  custodyItemType,
  custodyLocation,
  custodyMovement,
  custodyNumberAllocation,
  custodyNumberCounter,
  custodyOwner,
  custodyPacket,
  custodyScan,
  custodyStocktake,
  custodyStocktakeSighting,
} from "@magna-carta/database/per-firm-schema";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  CUSTODY_HOLD_TABLE,
  insertCustodyHoldStatement,
  releaseCustodyHoldStatement,
  selectActiveCustodyHoldsStatement,
  selectCustodyHoldStatement,
  selectCustodyHoldsStatement,
} from "../src/hold-statements.ts";
import {
  CUSTODY_ITEM_TYPE_TABLE,
  deactivateCustodyItemTypeStatement,
  insertCustodyItemTypeStatement,
  selectCustodyItemTypeIdByCodeStatement,
  selectCustodyItemTypeIdByNameStatement,
  selectCustodyItemTypeStatement,
  selectCustodyItemTypesStatement,
  setCustodyItemTypeIntrinsicDefaultStatement,
  updateCustodyItemTypeStatement,
} from "../src/item-type-statements.ts";
import {
  CUSTODY_LOCATION_TABLE,
  closeCustodyLocationStatement,
  insertCustodyLocationStatement,
  selectAllCustodyLocationsStatement,
  selectCustodyLocationStatement,
  updateCustodyLocationStatement,
} from "../src/location-statements.ts";
import {
  CUSTODY_MOVEMENT_TABLE,
  insertCustodyMovementStatement,
  selectCustodyMovementStatement,
  selectCustodyMovementsStatement,
} from "../src/movement-statements.ts";
import {
  CUSTODY_NUMBER_ALLOCATION_TABLE,
  CUSTODY_NUMBER_COUNTER_TABLE,
  allocateCounterValueStatement,
  ensureCounterRowStatement,
  guardedIncrementStatement,
  selectCounterValueStatement,
} from "../src/numbering/counter-statements.ts";
import {
  CUSTODY_ITEM_TABLE,
  CUSTODY_OWNER_TABLE,
  CUSTODY_PACKET_TABLE,
  endCustodyOwnerStatement,
  insertCustodyItemStatement,
  insertCustodyOwnerStatement,
  insertCustodyPacketStatement,
  selectCustodyItemStatement,
  selectCustodyItemsStatement,
  selectCustodyOwnersStatement,
  selectCustodyPacketStatement,
  setCustodyItemStatusStatement,
  setCustodyPacketLocationStatement,
  setCustodyPacketStatusStatement,
  updateCustodyItemFieldsStatement,
  updateCustodyPacketFieldsStatement,
} from "../src/packet-statements.ts";
import {
  CUSTODY_SCAN_TABLE,
  insertCustodyScanStatement,
  selectCustodyScansStatement,
} from "../src/scan-statements.ts";
import {
  CUSTODY_STOCKTAKE_SIGHTING_TABLE,
  CUSTODY_STOCKTAKE_TABLE,
  closeCustodyStocktakeStatement,
  insertCustodyStocktakeSightingStatement,
  insertCustodyStocktakeStatement,
  selectCustodyExpectedPacketsStatement,
  selectCustodyPacketsByIdStatement,
  selectCustodyStocktakeSightingsStatement,
  selectCustodyStocktakeStatement,
  selectCustodyStocktakesStatement,
} from "../src/stocktake-statements.ts";

// Fitness function (the ledger pattern): the raw SQL in this package must track
// @magna-carta/database's schema. Renaming a table or a column there fails here, not in production.

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

// SQL keywords and the aliases the joined reads introduce — everything that is legitimately an
// identifier in the statement text without being a table or a column.
const SQL_VOCABULARY = new Set([
  "insert",
  "into",
  "values",
  "select",
  "from",
  "where",
  "and",
  "or",
  "not",
  "null",
  "is",
  "in",
  "on",
  "join",
  "order",
  "by",
  "asc",
  "desc",
  "limit",
  "update",
  "set",
  "conflict",
  "do",
  "nothing",
  "count",
  "max",
  "coalesce",
  "as",
  "with",
  "recursive",
  "union",
  "all",
  "length",
  "case",
  "when",
  "then",
  "else",
  "end",
  // Read aliases.
  "subtree",
  "child",
  "depth",
  "occupancy",
  "highest",
  "owners",
  "hold",
  "scan",
  "latest",
  "movement",
  "packet",
  "total",
]);

const identifiers = (sql: string) =>
  sql.replace(/'(?:[^']|'')*'/g, " ").match(/\b[a-z_][a-z0-9_]*\b/g) ?? [];

function expectOnlyKnownIdentifiers(sql: string, allowed: ReadonlySet<string>, label: string) {
  for (const identifier of identifiers(sql)) {
    if (SQL_VOCABULARY.has(identifier)) continue;
    expect(allowed.has(identifier), `${label} SQL names "${identifier}"`).toBe(true);
  }
}

const stub = stubDatabase();
const LOCATION_ID = "custodyLocation_x" as never;
const PACKET_ID = "custodyPacket_x" as never;
const ITEM_ID = "custodyItem_x" as never;
const ITEM_TYPE_ID = "custodyItemType_x" as never;
const OWNER_ID = "custodyOwner_x" as never;
const MOVEMENT_ID = "custodyMovement_x" as never;
const HOLD_ID = "custodyHold_x" as never;
const SCAN_ID = "custodyScan_x" as never;
const FILE_ID = "file_x" as never;
const STOCKTAKE_ID = "custodyStocktake_x" as never;
const SIGHTING_ID = "custodyStocktakeSighting_x" as never;

describe("schema name sync (custodian SQL pinned to @magna-carta/database)", () => {
  it("table name constants match the drizzle schema", () => {
    expect(getTableConfig(custodyLocation).name).toBe(CUSTODY_LOCATION_TABLE);
    expect(getTableConfig(custodyItemType).name).toBe(CUSTODY_ITEM_TYPE_TABLE);
    expect(getTableConfig(custodyPacket).name).toBe(CUSTODY_PACKET_TABLE);
    expect(getTableConfig(custodyItem).name).toBe(CUSTODY_ITEM_TABLE);
    expect(getTableConfig(custodyOwner).name).toBe(CUSTODY_OWNER_TABLE);
    expect(getTableConfig(custodyMovement).name).toBe(CUSTODY_MOVEMENT_TABLE);
    expect(getTableConfig(custodyHold).name).toBe(CUSTODY_HOLD_TABLE);
    expect(getTableConfig(custodyScan).name).toBe(CUSTODY_SCAN_TABLE);
    expect(getTableConfig(custodyNumberCounter).name).toBe(CUSTODY_NUMBER_COUNTER_TABLE);
    expect(getTableConfig(custodyNumberAllocation).name).toBe(CUSTODY_NUMBER_ALLOCATION_TABLE);
    expect(getTableConfig(custodyStocktake).name).toBe(CUSTODY_STOCKTAKE_TABLE);
    expect(getTableConfig(custodyStocktakeSighting).name).toBe(CUSTODY_STOCKTAKE_SIGHTING_TABLE);
  });

  it("every column the location SQL names exists in the schema", () => {
    const sql = [
      sqlOf(
        insertCustodyLocationStatement(stub, {
          id: LOCATION_ID,
          name: "n",
          kind: "safe",
          parentLocationId: null,
          firmLocationId: null,
          address: null,
          notes: null,
          createdAt: "t",
        }),
      ),
      sqlOf(
        updateCustodyLocationStatement(
          stub,
          LOCATION_ID,
          { name: "n", parentLocationId: null, address: null, notes: null },
          "t",
        ),
      ),
      sqlOf(closeCustodyLocationStatement(stub, LOCATION_ID, "t")),
      sqlOf(selectCustodyLocationStatement(stub, LOCATION_ID)),
      sqlOf(selectAllCustodyLocationsStatement(stub)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      sql,
      new Set([CUSTODY_LOCATION_TABLE, ...columnsOf(custodyLocation)]),
      "location",
    );
  });

  it("every column the packet, item, and owner SQL names exists in the schema", () => {
    const packetSql = [
      sqlOf(
        insertCustodyPacketStatement(stub, {
          id: PACKET_ID,
          custodyNumber: "CUS-00001",
          numberSource: "drawn",
          name: "n",
          currentLocationId: null,
          matterId: null,
          depositorEntityId: null,
          depositedAt: null,
          notes: null,
          createdAt: "t",
        }),
      ),
      sqlOf(
        updateCustodyPacketFieldsStatement(
          stub,
          PACKET_ID,
          {
            name: "n",
            matterId: null,
            depositorEntityId: null,
            depositedAt: null,
            notes: null,
          },
          "t",
        ),
      ),
      sqlOf(setCustodyPacketStatusStatement(stub, PACKET_ID, "out", "held", null, "t")),
      sqlOf(setCustodyPacketLocationStatement(stub, PACKET_ID, null, "held", "t")),
      sqlOf(selectCustodyPacketStatement(stub, PACKET_ID)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      packetSql,
      new Set([CUSTODY_PACKET_TABLE, ...columnsOf(custodyPacket)]),
      "packet",
    );

    const itemSql = [
      sqlOf(
        insertCustodyItemStatement(stub, {
          id: ITEM_ID,
          packetId: PACKET_ID,
          ordinal: 1,
          itemTypeId: null,
          description: "d",
          instrumentDate: null,
          intrinsicValue: false,
          declaredValueAmountMinor: null,
          declaredValueCurrency: null,
          createdAt: "t",
        }),
      ),
      sqlOf(
        updateCustodyItemFieldsStatement(
          stub,
          ITEM_ID,
          {
            itemTypeId: null,
            description: "d",
            instrumentDate: null,
            intrinsicValue: false,
            declaredValueAmountMinor: null,
            declaredValueCurrency: null,
          },
          "t",
        ),
      ),
      sqlOf(setCustodyItemStatusStatement(stub, ITEM_ID, "out", "held", "t")),
      sqlOf(selectCustodyItemStatement(stub, ITEM_ID)),
      sqlOf(selectCustodyItemsStatement(stub, PACKET_ID)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      itemSql,
      new Set([CUSTODY_ITEM_TABLE, ...columnsOf(custodyItem)]),
      "item",
    );

    const ownerSql = [
      sqlOf(
        insertCustodyOwnerStatement(stub, {
          id: OWNER_ID,
          packetId: PACKET_ID,
          entityId: "directoryPerson_x",
          ownershipRole: null,
          effectiveFrom: "t",
          createdAt: "t",
        }),
      ),
      sqlOf(endCustodyOwnerStatement(stub, OWNER_ID, "t")),
      sqlOf(selectCustodyOwnersStatement(stub, PACKET_ID)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      ownerSql,
      new Set([CUSTODY_OWNER_TABLE, ...columnsOf(custodyOwner)]),
      "owner",
    );
  });

  it("every column the movement SQL names exists in the schema", () => {
    const sql = [
      sqlOf(
        insertCustodyMovementStatement(stub, {
          id: MOVEMENT_ID,
          packetId: PACKET_ID,
          itemId: null,
          kind: "logged",
          occurredAt: "t",
          recordedAt: "t",
          recordedByUserId: null,
          fromLocationId: null,
          toLocationId: null,
          borrowerKind: null,
          borrowerUserId: null,
          borrowerEntityId: null,
          borrowerName: null,
          dueBackOn: null,
          reason: null,
          correctsMovementId: null,
          shipmentId: null,
          note: null,
        }),
      ),
      sqlOf(selectCustodyMovementStatement(stub, MOVEMENT_ID)),
      sqlOf(selectCustodyMovementsStatement(stub, PACKET_ID, 10)),
      sqlOf(selectCustodyMovementsStatement(stub, PACKET_ID, 10, { occurredAt: "t", id: "x" })),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      sql,
      new Set([CUSTODY_MOVEMENT_TABLE, ...columnsOf(custodyMovement)]),
      "movement",
    );
  });

  it("every column the hold and scan SQL names exists in the schema", () => {
    const holdSql = [
      sqlOf(
        insertCustodyHoldStatement(stub, {
          id: HOLD_ID,
          packetId: PACKET_ID,
          itemId: null,
          kind: "legal",
          placedAt: "t",
          placedBy: null,
          reason: null,
          createdAt: "t",
        }),
      ),
      sqlOf(releaseCustodyHoldStatement(stub, HOLD_ID, null, "t")),
      sqlOf(selectCustodyHoldStatement(stub, HOLD_ID)),
      sqlOf(selectActiveCustodyHoldsStatement(stub, PACKET_ID)),
      sqlOf(selectCustodyHoldsStatement(stub, PACKET_ID)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      holdSql,
      new Set([CUSTODY_HOLD_TABLE, ...columnsOf(custodyHold)]),
      "hold",
    );

    const scanSql = [
      sqlOf(
        insertCustodyScanStatement(stub, {
          id: SCAN_ID,
          packetId: PACKET_ID,
          itemId: null,
          fileId: FILE_ID,
          kind: "scan",
          capturedAt: "t",
          capturedBy: null,
          createdAt: "t",
        }),
      ),
      sqlOf(selectCustodyScansStatement(stub, PACKET_ID)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      scanSql,
      new Set([CUSTODY_SCAN_TABLE, ...columnsOf(custodyScan)]),
      "scan",
    );
  });

  it("every column the item-type SQL names exists in the schema", () => {
    const sql = [
      sqlOf(
        insertCustodyItemTypeStatement(stub, {
          id: ITEM_TYPE_ID,
          name: "n",
          code: "c",
          createdAt: "t",
        }),
      ),
      sqlOf(updateCustodyItemTypeStatement(stub, ITEM_TYPE_ID, "n", "c", "t")),
      sqlOf(deactivateCustodyItemTypeStatement(stub, ITEM_TYPE_ID, "t")),
      sqlOf(setCustodyItemTypeIntrinsicDefaultStatement(stub, ITEM_TYPE_ID, true, "t")),
      sqlOf(selectCustodyItemTypeStatement(stub, ITEM_TYPE_ID)),
      sqlOf(selectCustodyItemTypeIdByNameStatement(stub, "n")),
      sqlOf(selectCustodyItemTypeIdByCodeStatement(stub, "c")),
      sqlOf(selectCustodyItemTypesStatement(stub, true)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      sql,
      new Set([CUSTODY_ITEM_TYPE_TABLE, ...columnsOf(custodyItemType)]),
      "item type",
    );
  });

  it("every column the stocktake SQL names exists in the schema", () => {
    const stocktakeSql = [
      sqlOf(
        insertCustodyStocktakeStatement(stub, {
          id: STOCKTAKE_ID,
          name: "March count",
          scopeLocationId: null,
          openedAt: "t",
          openedByUserId: null,
          note: null,
          createdAt: "t",
        }),
      ),
      sqlOf(
        closeCustodyStocktakeStatement(
          stub,
          STOCKTAKE_ID,
          "closed",
          { matched: 0, missing: 0, misplaced: 0, unexpected: 0, unregistered: 0 },
          null,
          "t",
        ),
      ),
      sqlOf(selectCustodyStocktakeStatement(stub, STOCKTAKE_ID)),
      sqlOf(selectCustodyStocktakesStatement(stub, undefined, 10)),
      sqlOf(selectCustodyStocktakesStatement(stub, "open", 10)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      stocktakeSql,
      new Set([CUSTODY_STOCKTAKE_TABLE, ...columnsOf(custodyStocktake)]),
      "stocktake",
    );

    const sightingSql = [
      sqlOf(
        insertCustodyStocktakeSightingStatement(stub, {
          id: SIGHTING_ID,
          stocktakeId: STOCKTAKE_ID,
          kind: "sighted",
          packetId: PACKET_ID,
          itemId: null,
          locationId: LOCATION_ID,
          expectedLocationId: LOCATION_ID,
          description: null,
          observedAt: "t",
          recordedAt: "t",
          observedByUserId: null,
          note: null,
        }),
      ),
      sqlOf(selectCustodyStocktakeSightingsStatement(stub, STOCKTAKE_ID, 10)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      sightingSql,
      new Set([CUSTODY_STOCKTAKE_SIGHTING_TABLE, ...columnsOf(custodyStocktakeSighting)]),
      "stocktake sighting",
    );

    // The reconciliation's two reads run against the packet table, so they are pinned to it rather
    // than to either stocktake table — the register is what a count is reconciled against.
    const expectedSql = [
      sqlOf(selectCustodyExpectedPacketsStatement(stub, undefined, 10)),
      sqlOf(selectCustodyExpectedPacketsStatement(stub, [], 10)),
      sqlOf(selectCustodyExpectedPacketsStatement(stub, [LOCATION_ID], 10)),
      sqlOf(selectCustodyPacketsByIdStatement(stub, [PACKET_ID])),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      expectedSql,
      new Set([CUSTODY_PACKET_TABLE, ...columnsOf(custodyPacket)]),
      "stocktake expectation",
    );
  });

  it("every column the numbering SQL names exists in the schema", () => {
    const counterSql = [
      sqlOf(ensureCounterRowStatement(stub, "k", 1)),
      sqlOf(guardedIncrementStatement(stub, "k", 1)),
      sqlOf(selectCounterValueStatement(stub, "k")),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      counterSql,
      new Set([CUSTODY_NUMBER_COUNTER_TABLE, ...columnsOf(custodyNumberCounter)]),
      "counter",
    );
    const allocationSql = sqlOf(allocateCounterValueStatement(stub, "k", 1, PACKET_ID, "t"));
    expectOnlyKnownIdentifiers(
      allocationSql,
      new Set([CUSTODY_NUMBER_ALLOCATION_TABLE, ...columnsOf(custodyNumberAllocation)]),
      "allocation",
    );
  });
});
