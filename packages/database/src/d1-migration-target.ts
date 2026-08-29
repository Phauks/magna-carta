import type { D1Database } from "@cloudflare/workers-types";
import type { Migration } from "./migration.ts";
import type { MigrationTarget } from "./migration-runner.ts";

// Applied-migration tracking, per database. Runner-managed, deliberately NOT a drizzle
// schema table: it must exist before any migration runs.
const CREATE_MIGRATIONS_TABLE =
  "CREATE TABLE IF NOT EXISTS _migrations (tag TEXT PRIMARY KEY, applied_at TEXT NOT NULL)";

// MigrationTarget over a real D1 database. Atomicity: D1 rejects BEGIN (no interactive transactions;
// drizzle's db.transaction() throws at runtime on D1), so the migration's statements plus its
// _migrations record go through ONE batch() call — Cloudflare executes a batch as a transaction,
// rolling the whole sequence back if any statement fails.
export function d1MigrationTarget(
  database: D1Database,
  now: () => string = () => new Date().toISOString(),
): MigrationTarget {
  return {
    async appliedMigrationTags(): Promise<string[]> {
      await database.prepare(CREATE_MIGRATIONS_TABLE).run();
      const { results } = await database
        .prepare("SELECT tag FROM _migrations ORDER BY tag")
        .all<{ tag: string }>();
      return results.map((row) => row.tag);
    },

    async applyMigration(migration: Migration): Promise<void> {
      const statements = migration.statements.map((statement) => database.prepare(statement));
      statements.push(
        database
          .prepare("INSERT INTO _migrations (tag, applied_at) VALUES (?1, ?2)")
          .bind(migration.tag, now()),
      );
      await database.batch(statements);
    },

    async supersedeAppliedMigrations(
      supersededTags: readonly string[],
      replacementTag: string,
    ): Promise<void> {
      // Ledger rewrite only — no schema SQL. One batch() = one transaction, so the removals and the
      // replacement row land together or not at all.
      const statements = supersededTags.map((tag) =>
        database.prepare("DELETE FROM _migrations WHERE tag = ?1").bind(tag),
      );
      statements.push(
        database
          .prepare("INSERT INTO _migrations (tag, applied_at) VALUES (?1, ?2)")
          .bind(replacementTag, now()),
      );
      await database.batch(statements);
    },
  };
}
