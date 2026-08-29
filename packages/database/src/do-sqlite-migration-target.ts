import type { DurableObjectStorage } from "@cloudflare/workers-types";
import type { Migration } from "./migration.ts";
import type { MigrationTarget } from "./migration-runner.ts";

// MigrationTarget over a SQLite-backed Durable Object's storage. Sits beside d1-migration-target.ts.
// Atomicity uses transactionSync (the documented DO primitive); the applied-tags ledger is the same
// runner-managed _migrations table D1 uses (PRAGMA user_version is unsupported on DO SQLite).
const CREATE_MIGRATIONS_TABLE =
  "CREATE TABLE IF NOT EXISTS _migrations (tag TEXT PRIMARY KEY, applied_at TEXT NOT NULL)";

export function doSqliteMigrationTarget(
  storage: DurableObjectStorage,
  now: () => string = () => new Date().toISOString(),
): MigrationTarget {
  const sql = storage.sql;
  return {
    appliedMigrationTags(): Promise<string[]> {
      sql.exec(CREATE_MIGRATIONS_TABLE);
      const rows = sql.exec("SELECT tag FROM _migrations ORDER BY tag").toArray() as {
        tag: string;
      }[];
      return Promise.resolve(rows.map((row) => row.tag));
    },
    applyMigration(migration: Migration): Promise<void> {
      try {
        storage.transactionSync(() => {
          for (const statement of migration.statements) sql.exec(statement);
          sql.exec(
            "INSERT INTO _migrations (tag, applied_at) VALUES (?1, ?2)",
            migration.tag,
            now(),
          );
        });
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return Promise.resolve();
    },
    supersedeAppliedMigrations(
      supersededTags: readonly string[],
      replacementTag: string,
    ): Promise<void> {
      // Ledger rewrite only — no schema SQL. transactionSync makes the removals and the replacement
      // row atomic, same as applyMigration.
      try {
        storage.transactionSync(() => {
          for (const tag of supersededTags) sql.exec("DELETE FROM _migrations WHERE tag = ?1", tag);
          sql.exec(
            "INSERT INTO _migrations (tag, applied_at) VALUES (?1, ?2)",
            replacementTag,
            now(),
          );
        });
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return Promise.resolve();
    },
  };
}
