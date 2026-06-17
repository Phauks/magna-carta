import { DatabaseSync } from "node:sqlite";
import type { BatchDatabase } from "../../src/effect-batch.ts";
import type { SqlStatement } from "../../src/idempotency-statements.ts";

// A real-SQLite BatchDatabase for the integration tests: node:sqlite behind the async D1 surface the
// data-access chokepoints call (prepare → bind → run/all, plus an all-or-nothing batch). node:sqlite is
// synchronous; the methods wrap each result in a resolved promise so the production code's awaits work
// unchanged. batch() runs inside BEGIN/COMMIT and ROLLBACKs on any failure, mirroring D1's all-or-nothing
// commit — the property readProtected's audit-before-return and the secrets upsert rely on.

interface PreparedStatement extends SqlStatement {
  readonly bindings: readonly unknown[];
}

export function sqliteBatchDatabase(database: DatabaseSync): BatchDatabase {
  function statement(sql: string, bindings: readonly unknown[]): PreparedStatement {
    return {
      sql,
      bindings,
      bind: (...values: unknown[]) => statement(sql, values),
      run: () => {
        const info = database.prepare(sql).run(...(bindings as never[]));
        return Promise.resolve({ meta: { changes: Number(info.changes) } });
      },
      all: <T = Record<string, unknown>>() => {
        const results = database.prepare(sql).all(...(bindings as never[])) as T[];
        return Promise.resolve({ results });
      },
    };
  }

  return {
    prepare: (sql: string) => statement(sql, []),
    batch: (statements: SqlStatement[]) => {
      const prepared = statements as PreparedStatement[];
      database.exec("BEGIN");
      try {
        for (const each of prepared) {
          database.prepare(each.sql as string).run(...(each.bindings as never[]));
        }
        database.exec("COMMIT");
      } catch (caught) {
        database.exec("ROLLBACK");
        throw caught;
      }
      return Promise.resolve(prepared.map(() => ({ success: true })));
    },
  };
}
