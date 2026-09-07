import { findLegacyBaseline, LEGACY_BASELINES } from "./legacy-baselines.ts";
import type { Migration } from "./migration.ts";

// The seam between "which migrations are pending" (pure, this file) and "how SQL reaches a database"
// (an adapter — see d1-migration-target.ts). applyMigration MUST be atomic: the migration's statements
// and its applied-record commit or roll back together. supersedeAppliedMigrations MUST be atomic the
// same way: the removals and the replacement record commit or roll back together, so the ledger is
// never seen half-rewritten.
export interface MigrationTarget {
  appliedMigrationTags(): Promise<string[]>;
  applyMigration(migration: Migration): Promise<void>;
  // Rewrite the applied ledger only — run no schema SQL. Replaces the given already-applied tags
  // with a single tag that names the same cumulative schema (a baseline that collapsed a retired
  // chain; see legacy-baselines.ts).
  supersedeAppliedMigrations(
    supersededTags: readonly string[],
    replacementTag: string,
  ): Promise<void>;
}

export interface MigrationRunReport {
  readonly appliedTags: string[];
  readonly skippedTags: string[];
  // Set when the applied ledger was a retired pre-baseline chain and was rewritten to the baseline
  // tag before applying; null on every ordinary run.
  readonly reconciledToBaseline: string | null;
}

// Apply every pending migration, in journal order. Fails loud (and stops) on the first failure —
// a half-migrated database is visible in _migrations and resumable by re-running.
export async function runPendingMigrations(
  target: MigrationTarget,
  migrations: readonly Migration[],
): Promise<MigrationRunReport> {
  let applied = new Set(await target.appliedMigrationTags());
  const known = new Set(migrations.map((migration) => migration.tag));

  // A database provisioned before a lineage's chain was collapsed into a baseline carries its
  // applied ledger under the retired ids. When the ledger is exactly that retired chain — whose
  // cumulative schema the baseline was verified to reproduce — rewrite it to the baseline tag and
  // carry on; the schema itself is untouched. Exact-complete-chain matches only: any other unknown
  // tag still refuses below, because it really does mean a newer schema than this code.
  // RECONCILED REPEATEDLY, because collapses compose. A database provisioned before the first
  // collapse carries the retired chain that collapse replaced; reconciling it once lands the ledger
  // on that collapse's baseline tag — which a LATER collapse has since retired in turn. One hop
  // would leave such a database holding a tag this code no longer knows, and the refusal below would
  // read it as a newer schema and stop. Each pass rewrites the ledger to the next baseline forward
  // until no retired chain matches, which is the whole history walked in order.
  //
  // Bounded by the number of baselines there could be: findLegacyBaseline only matches a COMPLETE
  // retired chain, so a pass either advances the ledger or returns nothing, and a malformed set that
  // somehow cycled would stop here rather than spin.
  let reconciledToBaseline: string | null = null;
  for (let hop = 0; hop <= LEGACY_BASELINES.length; hop += 1) {
    const legacyBaseline = findLegacyBaseline(applied, known);
    if (legacyBaseline === undefined) break;
    await target.supersedeAppliedMigrations(legacyBaseline.legacyTags, legacyBaseline.baselineTag);
    applied = new Set(await target.appliedMigrationTags());
    reconciledToBaseline = legacyBaseline.baselineTag;
  }

  for (const tag of applied) {
    if (!known.has(tag)) {
      throw new Error(
        `database has applied migration "${tag}" which this code does not know — deploy mismatch (code older than schema)`,
      );
    }
  }
  const report: MigrationRunReport = {
    appliedTags: [],
    skippedTags: [],
    reconciledToBaseline,
  };
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
