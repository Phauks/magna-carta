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
  //
  // ONE hop is all there ever is, and that is a property of what a collapse is rather than a limit
  // settled for here. Reconciling leaves the ledger holding exactly one tag, so a second hop would
  // need an entry that retired a single migration — and a collapse always retires the previous
  // baseline PLUS every migration appended after it, so its chain is never one tag long. A ledger
  // that stopped part way through history therefore does not chain forward to today; it is
  // stranded, which is what the refusal below says in those words.
  const legacyBaseline = findLegacyBaseline(applied, known);
  if (legacyBaseline !== undefined) {
    await target.supersedeAppliedMigrations(legacyBaseline.legacyTags, legacyBaseline.baselineTag);
    applied = new Set(await target.appliedMigrationTags());
  }
  const reconciledToBaseline = legacyBaseline?.baselineTag ?? null;

  for (const tag of applied) {
    if (known.has(tag)) continue;
    // Two different faults answer with two different sentences, because the remedies are opposite.
    // A tag this bundle retired means the database is behind and the SQL that would carry it
    // forward is gone — no redeploy fixes that, and reading it as a stale deploy sends whoever is
    // holding the outage looking for a rollback that does not exist. Anything else really is a
    // deployment running older code than the schema it was pointed at.
    const retiredInto = LEGACY_BASELINES.find((entry) => entry.legacyTags.includes(tag));
    if (retiredInto !== undefined) {
      throw new Error(
        `database has applied migration "${tag}", which was retired into baseline "${retiredInto.baselineTag}" — but the ledger is not that complete chain, so this database's schema stops part way through a history this code no longer carries. It cannot be migrated forward automatically and needs a human.`,
      );
    }
    throw new Error(
      `database has applied migration "${tag}" which this code does not know — deploy mismatch (code older than schema)`,
    );
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
