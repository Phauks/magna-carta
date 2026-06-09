import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { migrationsFromJournal, type Migration, type MigrationJournal } from "./migration.ts";

// DEV/TEST ONLY — node-only. A D1-shaped adapter over node:sqlite so the data-access batch write
// path (composeEffectBatch / commitEffectBatch) runs against real SQLite in plain Vitest and in the
// fixtures harness. Never import from Worker code: Workers have no node:sqlite and no filesystem.
// Sits beside d1-migration-target.ts as "adapt a database to the shared shape".

export interface NodeSqlStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
  bind(...values: unknown[]): NodeSqlStatement;
  run(): Promise<{ meta: { changes: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface NodeBatchDatabase {
  prepare(sql: string): NodeSqlStatement;
  // Statements must come from THIS database's prepare() — a statement built against another
  // NodeBatchDatabase is structurally identical and would silently execute here (real D1 cannot
  // express that mistake; this adapter trusts its single-database test/seeding context).
  batch(statements: NodeSqlStatement[]): Promise<{ success: boolean }[]>;
}

export function nodeSqliteBatchDatabase(database: DatabaseSync): NodeBatchDatabase {
  function makeStatement(sql: string, bindings: readonly unknown[]): NodeSqlStatement {
    return {
      sql,
      bindings,
      bind: (...values: unknown[]) => makeStatement(sql, values),
      run: () => {
        const result = database.prepare(sql).run(...(bindings as SQLInputValue[]));
        return Promise.resolve({ meta: { changes: Number(result.changes) } });
      },
      all: <T>() => {
        const results = database.prepare(sql).all(...(bindings as SQLInputValue[])) as T[];
        return Promise.resolve({ results });
      },
    };
  }
  return {
    prepare: (sql: string) => makeStatement(sql, []),
    batch: (statements: NodeSqlStatement[]) => {
      // D1 batch semantics: one transaction, all-or-nothing, statements run in order.
      database.exec("BEGIN");
      try {
        for (const statement of statements) {
          database.prepare(statement.sql).run(...(statement.bindings as SQLInputValue[]));
        }
        database.exec("COMMIT");
      } catch (error) {
        // SQLite may have auto-rolled-back already (e.g. SQLITE_FULL/IOERR end the transaction),
        // making this ROLLBACK itself throw "no transaction is active" — harmless per SQLite docs.
        // Swallow it so the caller always receives the ORIGINAL failure (the error consumers like
        // isIdempotencyKeyConflict match on), never a masking secondary error.
        try {
          database.exec("ROLLBACK");
        } catch {
          // transaction already gone — nothing to roll back
        }
        return Promise.reject(error);
      }
      return Promise.resolve(statements.map(() => ({ success: true })));
    },
  };
}

// Load the committed migration artifacts from this package's drizzle/ directory (filesystem — hence
// node-only; the Worker path imports SQL as ?raw text instead, see migration.ts).
export function loadMigrationsFromDisk(lineage: "control-plane" | "per-firm"): Migration[] {
  const root = join(import.meta.dirname, "..", "drizzle", lineage);
  const journal = JSON.parse(
    readFileSync(join(root, "meta", "_journal.json"), "utf8"),
  ) as MigrationJournal;
  const sqlByTag: Record<string, string> = {};
  for (const entry of journal.entries) {
    sqlByTag[entry.tag] = readFileSync(join(root, `${entry.tag}.sql`), "utf8");
  }
  return migrationsFromJournal(journal, sqlByTag);
}

export function applyMigrations(database: DatabaseSync, migrations: readonly Migration[]): void {
  for (const migration of migrations) {
    for (const statement of migration.statements) {
      database.exec(statement);
    }
  }
}
