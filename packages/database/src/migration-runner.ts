import type { Migration } from "./migration.ts";

// The seam between "which migrations are pending" (pure, this file) and "how SQL reaches a database"
// (an adapter — see d1-migration-target.ts). applyMigration MUST be atomic: the migration's statements
// and its applied-record commit or roll back together.
export interface MigrationTarget {
  appliedMigrationTags(): Promise<string[]>;
  applyMigration(migration: Migration): Promise<void>;
}

export interface MigrationRunReport {
  readonly appliedTags: string[];
  readonly skippedTags: string[];
}

// Apply every pending migration, in journal order. Fails loud (and stops) on the first failure —
// a half-migrated database is visible in _migrations and resumable by re-running.
export async function runPendingMigrations(
  target: MigrationTarget,
  migrations: readonly Migration[],
): Promise<MigrationRunReport> {
  const applied = new Set(await target.appliedMigrationTags());
  const known = new Set(migrations.map((migration) => migration.tag));
  for (const tag of applied) {
    if (!known.has(tag)) {
      throw new Error(
        `database has applied migration "${tag}" which this code does not know — deploy mismatch (code older than schema)`,
      );
    }
  }
  const report: MigrationRunReport = { appliedTags: [], skippedTags: [] };
  for (const migration of migrations) {
    if (applied.has(migration.tag)) {
      report.skippedTags.push(migration.tag);
      continue;
    }
    await target.applyMigration(migration);
    report.appliedTags.push(migration.tag);
  }
  return report;
}
