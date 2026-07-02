import type { DurableObjectStorage, SqlStorageValue } from "@cloudflare/workers-types";

export interface DoSqlStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
  bind(...values: unknown[]): DoSqlStatement;
  run(): Promise<{ meta: { changes: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface DoBatchDatabase {
  prepare(sql: string): DoSqlStatement;
  batch(statements: DoSqlStatement[]): Promise<{ success: boolean }[]>;
}

export function doSqliteBatchDatabase(storage: DurableObjectStorage): DoBatchDatabase {
  const sql = storage.sql;
  function makeStatement(text: string, bindings: readonly unknown[]): DoSqlStatement {
    return {
      sql: text,
      bindings,
      bind: (...values: unknown[]) => makeStatement(text, values),
      run: () => {
        sql.exec(text, ...(bindings as SqlStorageValue[]));
        // changes() reflects the last INSERT/UPDATE/DELETE and is NOT reset by a following SELECT —
        // this is the faithful D1Result.meta.changes mapping the guarded UPDATE/DELETE statements need.
        const changes = Number(
          (sql.exec("SELECT changes() AS c").one() as { c: number | bigint }).c,
        );
        return Promise.resolve({ meta: { changes } });
      },
      all: <T>() => {
        const results = sql.exec(text, ...(bindings as SqlStorageValue[])).toArray() as T[];
        return Promise.resolve({ results });
      },
    };
  }
  return {
    prepare: (text: string) => makeStatement(text, []),
    batch: (statements: DoSqlStatement[]) => {
      // transactionSync = all-or-nothing; a throwing statement (e.g. a UNIQUE violation) rolls the
      // whole sequence back, matching D1 batch() semantics. The throw propagates to the caller.
      try {
        storage.transactionSync(() => {
          for (const statement of statements) {
            sql.exec(statement.sql, ...(statement.bindings as SqlStorageValue[]));
          }
        });
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return Promise.resolve(statements.map(() => ({ success: true })));
    },
  };
}
