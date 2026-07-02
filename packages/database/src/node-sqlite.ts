import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
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
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface NodeBatchDatabase {
  prepare(sql: string): NodeSqlStatement;
  // Statements must come from THIS database's prepare() — a statement built against another
  // NodeBatchDatabase is structurally identical and would silently execute here. Real D1 behaves
  // the same way (its prepared statements are SQL text + params re-sent through whichever binding
  // runs them — workerd's d1-api shim does no identity check), so this is D1-faithful, not a
  // local weakening; the single-database-per-request Worker context is what makes it safe there.
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
      first: <T>(): Promise<T | null> => {
        const results = database.prepare(sql).all(...(bindings as SQLInputValue[])) as T[];
        return Promise.resolve(results.length > 0 ? (results[0] as T) : null);
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

export interface MigratedNodeDatabase {
  readonly database: NodeBatchDatabase; // D1-shaped; feed to the domain services + commitEffectBatch
  readonly raw: DatabaseSync; // escape hatch for assertions / deliberate corruption in tests
}

// An in-memory database at the lineage's CURRENT committed schema — the one composition every
// node-side test and the fixtures harness needs (one home; the copies it replaces drifted per file).
export function createMigratedNodeDatabase(
  lineage: "control-plane" | "per-firm",
): MigratedNodeDatabase {
  const raw = new DatabaseSync(":memory:");
  applyMigrations(raw, loadMigrationsFromDisk(lineage));
  return { database: nodeSqliteBatchDatabase(raw), raw };
}

// Open an EXISTING database file as the D1-shaped adapter — no migrations applied (the file is
// already at some schema; callers own staleness, e.g. the fixtures snapshot manifest). Node-only,
// like everything in this module.
export function openNodeDatabaseFile(path: string): MigratedNodeDatabase {
  const raw = new DatabaseSync(path);
  return { database: nodeSqliteBatchDatabase(raw), raw };
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
