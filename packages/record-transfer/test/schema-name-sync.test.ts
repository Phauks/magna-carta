// @repo-wide-fitness scope=schema — the statements are here, the tables they name are in
// packages/database, so the diff that renames one never touches this package.
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import * as perFirmSchema from "@magna-carta/database/per-firm-schema";
import {
  sourceRecordLink,
  transferPass,
  transferRun,
  transferSourceFile,
} from "@magna-carta/database/per-firm-schema";
import type {
  TransferPassId,
  TransferRunId,
  TransferSourceFileId,
  UserId,
} from "@magna-carta/identifiers/types";
import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { LINKABLE_LOCAL_TABLES, type SourceRecordKey } from "../src/source-record.ts";
import {
  SOURCE_RECORD_LINK_TABLE,
  countLinksBySourceSystemStatement,
  countLinksByTransferRunStatement,
  insertSourceRecordLinkStatement,
  selectLinkedLocalRecordStatement,
  selectLinksForSourceRecordStatement,
  selectSourcesOfLocalRecordStatement,
} from "../src/source-record-link-statements.ts";
import {
  TRANSFER_PASS_TABLE,
  failTransferPassStatement,
  finishTransferPassStatement,
  insertTransferPassStatement,
  selectTransferPassStatement,
  selectTransferPassesStatement,
  startTransferPassStatement,
} from "../src/transfer-pass-statements.ts";
import {
  TRANSFER_RUN_TABLE,
  abandonTransferRunStatement,
  completeTransferRunStatement,
  insertTransferRunStatement,
  selectAllTransferRunsStatement,
  selectTransferRunStatement,
  selectTransferRunsStatement,
} from "../src/transfer-run-statements.ts";
import {
  TRANSFER_SOURCE_FILE_TABLE,
  insertTransferSourceFileStatement,
  recordTransferSourceFileReadStatement,
  recordTransferSourceFileRemovedStatement,
  selectTransferSourceFileStatement,
  selectTransferSourceFilesStatement,
} from "../src/transfer-source-file-statements.ts";

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

const SQL_WORDS = new Set([
  "select",
  "from",
  "where",
  "and",
  "order",
  "by",
  "insert",
  "into",
  "values",
  "null",
  "update",
  "set",
  "is",
  "desc",
  "count",
  "distinct",
  "as",
  "group",
  "not",
]);

// Aliases the statements introduce for computed columns; they name no column of any table.
const RESULT_ALIASES = new Set(["link_count", "source_record_count"]);

function identifiersIn(sql: string): string[] {
  return (sql.match(/[a-z_][a-z0-9_]*/gi) ?? []).filter(
    (word) => !SQL_WORDS.has(word.toLowerCase()) && !RESULT_ALIASES.has(word),
  );
}

function columnsOf(table: SQLiteTable): Set<string> {
  return new Set(getTableConfig(table).columns.map((column) => column.name));
}

const RUN_ID = "transferRun_x" as TransferRunId;
const USER_ID = "user_x" as UserId;
const SOURCE: SourceRecordKey = { sourceSystem: "leap", sourceKind: "matter", sourceId: "1" };
const NOW = "2026-11-10T09:00:00.000Z";

describe("schema name sync (record-transfer SQL pinned to @magna-carta/database)", () => {
  it("the table name constants match the drizzle schema", () => {
    expect(getTableConfig(transferRun).name).toBe(TRANSFER_RUN_TABLE);
    expect(getTableConfig(sourceRecordLink).name).toBe(SOURCE_RECORD_LINK_TABLE);
    expect(getTableConfig(transferSourceFile).name).toBe(TRANSFER_SOURCE_FILE_TABLE);
    expect(getTableConfig(transferPass).name).toBe(TRANSFER_PASS_TABLE);
  });

  it("every name the transfer-run SQL uses is the table or one of its columns", () => {
    const stub = stubDatabase();
    const known = new Set([TRANSFER_RUN_TABLE, ...columnsOf(transferRun)]);
    const statements = [
      insertTransferRunStatement(
        stub,
        { id: RUN_ID, sourceSystem: "leap", label: "x", startedBy: USER_ID },
        NOW,
      ),
      selectTransferRunStatement(stub, RUN_ID),
      selectTransferRunsStatement(stub, "leap"),
      selectAllTransferRunsStatement(stub),
      completeTransferRunStatement(stub, RUN_ID, NOW),
      abandonTransferRunStatement(stub, RUN_ID, NOW),
    ];
    for (const statement of statements) {
      const unknown = identifiersIn(sqlOf(statement)).filter((name) => !known.has(name));
      expect(unknown, sqlOf(statement)).toEqual([]);
    }
  });

  it("every name the source-record-link SQL uses is the table or one of its columns", () => {
    const stub = stubDatabase();
    const known = new Set([SOURCE_RECORD_LINK_TABLE, ...columnsOf(sourceRecordLink)]);
    const statements = [
      insertSourceRecordLinkStatement(
        stub,
        { source: SOURCE, localTable: "matter", localId: "x", transferRunId: RUN_ID },
        NOW,
      ),
      selectLinksForSourceRecordStatement(stub, SOURCE),
      selectLinkedLocalRecordStatement(stub, SOURCE, "matter"),
      selectSourcesOfLocalRecordStatement(stub, "matter", "x"),
      countLinksByTransferRunStatement(stub, RUN_ID),
      countLinksBySourceSystemStatement(stub, "leap"),
    ];
    for (const statement of statements) {
      const unknown = identifiersIn(sqlOf(statement)).filter((name) => !known.has(name));
      expect(unknown, sqlOf(statement)).toEqual([]);
    }
  });

  it("every name the transfer-source-file SQL uses is the table or one of its columns", () => {
    const stub = stubDatabase();
    const known = new Set([TRANSFER_SOURCE_FILE_TABLE, ...columnsOf(transferSourceFile)]);
    const fileId = "transferSourceFile_x" as TransferSourceFileId;
    const statements = [
      insertTransferSourceFileStatement(
        stub,
        {
          id: fileId,
          transferRunId: RUN_ID,
          sourceKind: "matter-list",
          format: "delimited-text",
          fileName: "x.csv",
          byteLength: 1,
          contentSha256: "a".repeat(64),
          keyColumn: null,
        },
        NOW,
      ),
      selectTransferSourceFileStatement(stub, fileId),
      selectTransferSourceFilesStatement(stub, RUN_ID),
      recordTransferSourceFileReadStatement(stub, fileId, 1, NOW),
      recordTransferSourceFileRemovedStatement(stub, fileId, NOW),
    ];
    for (const statement of statements) {
      const unknown = identifiersIn(sqlOf(statement)).filter((name) => !known.has(name));
      expect(unknown, sqlOf(statement)).toEqual([]);
    }
  });

  it("every name the transfer-pass SQL uses is the table or one of its columns", () => {
    const stub = stubDatabase();
    const known = new Set([TRANSFER_PASS_TABLE, ...columnsOf(transferPass)]);
    const passId = "transferPass_x" as TransferPassId;
    const report = {
      columnsMissing: [],
      rowsRead: 0,
      created: 0,
      alreadyLinked: 0,
      rejected: [],
      waiting: [],
      findings: [],
      sample: [],
    };
    const statements = [
      insertTransferPassStatement(
        stub,
        {
          id: passId,
          transferRunId: RUN_ID,
          transferSourceFileId: "transferSourceFile_x" as TransferSourceFileId,
          recordKind: "person",
          sourceKind: "card",
          rulesJson: "{}",
          requestedBy: USER_ID,
        },
        NOW,
      ),
      selectTransferPassStatement(stub, passId),
      selectTransferPassesStatement(stub, RUN_ID),
      startTransferPassStatement(stub, passId, NOW),
      finishTransferPassStatement(stub, passId, report, NOW),
      failTransferPassStatement(stub, passId, NOW),
    ];
    for (const statement of statements) {
      const unknown = identifiersIn(sqlOf(statement)).filter((name) => !known.has(name));
      expect(unknown, sqlOf(statement)).toEqual([]);
    }
  });

  it("every linkable table exists in the per-firm schema and is keyed by the column named for it", () => {
    const tablesByName = new Map<string, SQLiteTable>();
    for (const exported of Object.values(perFirmSchema)) {
      if (is(exported, SQLiteTable)) {
        tablesByName.set(getTableConfig(exported).name, exported);
      }
    }
    for (const [tableName, keyColumn] of Object.entries(LINKABLE_LOCAL_TABLES)) {
      const table = tablesByName.get(tableName);
      expect(table, `${tableName} is linkable but is not a per-firm table`).toBeDefined();
      if (table === undefined) continue;
      const primaryColumns = getTableConfig(table)
        .columns.filter((column) => column.primary)
        .map((column) => column.name);
      expect(primaryColumns, `${tableName} must be keyed by ${keyColumn} alone`).toEqual([
        keyColumn,
      ]);
    }
  });
});
