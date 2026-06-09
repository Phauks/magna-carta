import { describe, expect, it } from "vitest";
import { d1MigrationTarget } from "../src/d1-migration-target.ts";

// Minimal scripted D1 stub. Records every executed statement; batch() is all-or-nothing like real D1.
function stubD1(options: { appliedRows?: { tag: string }[]; failBatchContaining?: string } = {}) {
  const executed: string[] = [];
  const batches: string[][] = [];
  const makeStatement = (sql: string, bindings: unknown[] = []) => ({
    sql,
    bindings,
    bind: (...values: unknown[]) => makeStatement(sql, values),
    run: () => {
      executed.push(sql);
      return Promise.resolve({ success: true });
    },
    all: () => {
      executed.push(sql);
      return Promise.resolve({ results: options.appliedRows ?? [], success: true });
    },
  });
  const database = {
    prepare: (sql: string) => makeStatement(sql),
    batch: (statements: { sql: string }[]) => {
      const sqls = statements.map((statement) => statement.sql);
      const failOn = options.failBatchContaining;
      if (failOn !== undefined && sqls.some((sql) => sql.includes(failOn))) {
        return Promise.reject(new Error("D1_ERROR: batch rolled back")); // nothing recorded — atomic
      }
      batches.push(sqls);
      executed.push(...sqls);
      return Promise.resolve(sqls.map(() => ({ success: true })));
    },
  };
  return { database, executed, batches };
}

describe("d1MigrationTarget", () => {
  it("creates _migrations if missing and returns the applied tags", async () => {
    const { database, executed } = stubD1({ appliedRows: [{ tag: "0000_first" }] });
    const target = d1MigrationTarget(database as never);
    const tags = await target.appliedMigrationTags();
    expect(tags).toEqual(["0000_first"]);
    expect(executed.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS _migrations"))).toBe(
      true,
    );
  });

  it("applies a migration's statements AND its _migrations record in one batch (atomic)", async () => {
    const { database, batches } = stubD1();
    const target = d1MigrationTarget(database as never, () => "2026-06-09T00:00:00.000Z");
    await target.applyMigration({
      tag: "0001_second",
      statements: ["ALTER TABLE a ADD col text;", "CREATE INDEX i ON a (col);"],
    });
    expect(batches).toHaveLength(1); // ONE batch — the atomicity guarantee
    const batch = batches[0] ?? [];
    expect(batch).toHaveLength(3); // 2 statements + 1 record insert
    expect(batch[2]).toContain("INSERT INTO _migrations");
  });

  it("a failed batch records nothing (the stub mirrors D1 rollback)", async () => {
    const { database, executed } = stubD1({ failBatchContaining: "ALTER TABLE" });
    const target = d1MigrationTarget(database as never);
    await expect(
      target.applyMigration({ tag: "0001_second", statements: ["ALTER TABLE a ADD col text;"] }),
    ).rejects.toThrow(/batch rolled back/);
    expect(executed).toEqual([]); // statements and record both absent — never half-applied
  });
});
