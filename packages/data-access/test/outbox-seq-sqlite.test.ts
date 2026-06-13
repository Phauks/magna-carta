import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { insertOutboxMessageStatement } from "../src/outbox-statements.ts";
import { captured, stubD1 } from "./support/stub-d1.ts";

// The seq subselect's correctness rests on a SQLite semantic the stub cannot prove: statements
// executed sequentially inside ONE transaction (what a D1 batch is) see each other's uncommitted
// rows, so two same-aggregate inserts get CONSECUTIVE seq values. This test runs the REAL insert
// SQL against real SQLite (node:sqlite) to pin that fact.
describe("outbox seq against real SQLite (in-transaction visibility)", () => {
  function setupDatabase() {
    const database = new DatabaseSync(":memory:");
    database.exec(
      `CREATE TABLE outbox (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        payload TEXT NOT NULL,
        aggregate_key TEXT,
        seq INTEGER,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        dispatched_at TEXT
      )`,
    );
    return database;
  }

  // The EXACT SQL and binding order the production builder emits, captured via the stub.
  function productionInsert(aggregateKey: string | undefined) {
    const stub = stubD1();
    const statement = captured(
      insertOutboxMessageStatement(
        stub.database,
        { topic: "t", payload: {}, aggregateKey },
        "2026-06-09T00:00:00.000Z",
      ),
    );
    return { sql: statement.sql, bindings: statement.bindings as (string | null)[] };
  }

  it("two same-aggregate inserts in one transaction get consecutive seq (0 then 1)", () => {
    const database = setupDatabase();
    const first = productionInsert("matter_x");
    const second = productionInsert("matter_x");
    database.exec("BEGIN");
    database.prepare(first.sql).run(...first.bindings);
    database.prepare(second.sql).run(...second.bindings);
    database.exec("COMMIT");
    const rows = database.prepare("SELECT seq FROM outbox ORDER BY seq").all() as {
      seq: number;
    }[];
    expect(rows.map((row) => row.seq)).toEqual([0, 1]);
  });

  it("different aggregates each start at 0; no aggregate key yields NULL seq", () => {
    const database = setupDatabase();
    const a = productionInsert("matter_a");
    const b = productionInsert("matter_b");
    const unordered = productionInsert(undefined);
    database.exec("BEGIN");
    database.prepare(a.sql).run(...a.bindings);
    database.prepare(b.sql).run(...b.bindings);
    database.prepare(unordered.sql).run(...unordered.bindings);
    database.exec("COMMIT");
    const rows = database.prepare("SELECT aggregate_key, seq FROM outbox ORDER BY id").all() as {
      aggregate_key: string | null;
      seq: number | null;
    }[];
    expect(rows.find((row) => row.aggregate_key === "matter_a")?.seq).toBe(0);
    expect(rows.find((row) => row.aggregate_key === "matter_b")?.seq).toBe(0);
    expect(rows.find((row) => row.aggregate_key === null)?.seq).toBeNull();
  });
});
