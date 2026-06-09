import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { idempotencyKey, outbox } from "@magna-carta/database/per-firm-schema";
import { IDEMPOTENCY_TABLE } from "../src/idempotency-statements.ts";
import { OUTBOX_TABLE } from "../src/outbox-statements.ts";
import {
  insertCompletedIdempotencyRecordStatement,
  selectIdempotencyRecordStatement,
} from "../src/idempotency-statements.ts";
import { insertOutboxMessageStatement } from "../src/outbox-statements.ts";
import { captured, stubD1 } from "./support/stub-d1.ts";

// Fitness function: the raw SQL in this package must track @magna-carta/database's schema — the
// single source of truth (ADR-0065). Renaming a table/column there fails here, not in production.
describe("schema-name sync", () => {
  it("table name constants match the drizzle schema", () => {
    expect(IDEMPOTENCY_TABLE).toBe(getTableConfig(idempotencyKey).name);
    expect(OUTBOX_TABLE).toBe(getTableConfig(outbox).name);
  });

  it("every column the SQL statements name exists in the schema", () => {
    const stub = stubD1();
    const idempotencyColumns = new Set(
      getTableConfig(idempotencyKey).columns.map((column) => column.name),
    );
    const outboxColumns = new Set(getTableConfig(outbox).columns.map((column) => column.name));

    const idempotencySql = [
      captured(selectIdempotencyRecordStatement(stub.database, "k")).sql,
      captured(
        insertCompletedIdempotencyRecordStatement(stub.database, {
          id: "idr_x" as never,
          key: "k",
          fingerprint: "f",
          responseCode: 200,
          responseBody: null,
          createdAt: "t",
        }),
      ).sql,
    ].join("\n");
    const outboxSql = captured(
      insertOutboxMessageStatement(stub.database, { topic: "t", payload: {} }, "t"),
    ).sql;

    // Column lists appear inside ( ... ) after the table name and in SELECT/WHERE clauses; extract
    // bare identifiers and check each against the schema (ignoring SQL keywords and table names).
    const identifiers = (sql: string) => sql.match(/\b[a-z_]+\b/g) ?? [];
    const sqlKeywords = new Set([
      "select",
      "from",
      "where",
      "insert",
      "into",
      "values",
      "delete",
      "case",
      "when",
      "then",
      "else",
      "end",
      "is",
      "null",
      "coalesce",
      "max",
      "and",
      "or",
      "not",
      "pending",
      "completed",
      IDEMPOTENCY_TABLE,
      OUTBOX_TABLE,
    ]);
    for (const identifier of identifiers(idempotencySql)) {
      if (sqlKeywords.has(identifier)) continue;
      expect(idempotencyColumns.has(identifier), `idempotency SQL names "${identifier}"`).toBe(
        true,
      );
    }
    for (const identifier of identifiers(outboxSql)) {
      if (sqlKeywords.has(identifier)) continue;
      expect(outboxColumns.has(identifier), `outbox SQL names "${identifier}"`).toBe(true);
    }
  });
});
