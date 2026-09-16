import { findLegacyBaseline, LEGACY_BASELINES } from "./legacy-baselines.ts";
import type { Migration } from "./migration.ts";
import { conflictingReStamps, findReStampOf, pendingReStamps } from "./re-stamped-migrations.ts";

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
  // Tags rewritten from a retired id to the id the same migration carries now, because it was
  // re-stamped after this database had applied it (see re-stamped-migrations.ts). Each entry is the
  // REPLACEMENT tag — the id the ledger holds after the run. Empty on every ordinary run.
  readonly reStampedTags: string[];
  // Pending migrations whose tag sorts BEFORE a tag this database has already applied — see
  // outOfOrderArrivals. Empty on every ordinary run.
  readonly outOfOrderTags: string[];
  // The ledger's head by tag before this run, or null on a database that had applied nothing. The
  // other half of an out-of-order report: it names what the arrival came in behind.
  readonly ledgerHead: string | null;
}

/** The ledger's head by TAG, which is what apply order is measured in. Null on an empty ledger. */
export function ledgerHeadTag(appliedTags: ReadonlySet<string>): string | null {
  let head: string | null = null;
  for (const tag of appliedTags) {
    if (head === null || tag > head) head = tag;
  }
  return head;
}

/**
 * Pending migrations that arrived out of order: their tag sorts before the newest tag this database
 * has already applied.
 *
 * Apply order is tag order, so a database at head applies the whole chain in one sequence. But the
 * chain GROWS from parallel branches, and two branches merging can seat a migration behind one that
 * already shipped — a later-tagged migration lands first, and the earlier-tagged one arrives after
 * a database has already moved past where it sorts. The runner still applies it (it is pending, and
 * this database needs it), so the effect is only on ORDER: this database applies the pair in the
 * order it met them, and a database provisioned afterwards applies them in tag order.
 *
 * For independent migrations those two orders reach the same schema and nothing is wrong. For
 * dependent ones they do not, and the damage is silent: one set of firms carries a schema the
 * other does not, with no failure to point at it. That is what this names.
 *
 * It is a REPORT rather than a refusal on purpose. The migration is genuinely pending and genuinely
 * needed; refusing would strand the database over a condition that is usually harmless. What is
 * wanted is that somebody knows it happened, while the two orders can still be compared.
 */
export function outOfOrderArrivals(
  appliedTags: ReadonlySet<string>,
  migrations: readonly Migration[],
): string[] {
  // Measured against the head by TAG, not by applied_at: an out-of-order arrival is applied LATER in
  // time and would hide behind its own timestamp.
  const head = ledgerHeadTag(appliedTags);
  if (head === null) return [];
  return migrations
    .filter((migration) => !appliedTags.has(migration.tag) && migration.tag < head)
    .map((migration) => migration.tag);
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

  // A migration that was RENAMED after this database applied it leaves the ledger naming an id this
  // lineage no longer contains. The rename moved the id and not the SQL, so the schema this database
  // has is already the schema the new id names, and rewriting the row asserts nothing new — see
  // re-stamped-migrations.ts for why that is the whole justification and where it stops holding.
  //
  // Refused before anything is rewritten: a ledger holding BOTH ids of one re-stamp. The rewrite
  // cannot express it (the ledger keys on the tag), and it is not a state to guess at.
  const conflicting = conflictingReStamps(applied);
  if (conflicting.length > 0) {
    const pairs = conflicting
      .map((entry) => `"${entry.supersededTag}" and "${entry.replacementTag}"`)
      .join(", ");
    throw new Error(
      `database has applied both ids of a re-stamped migration (${pairs}) — one migration recorded twice under two names. The ledger cannot be rewritten automatically without choosing which row is the real one, so this needs a human.`,
    );
  }
  const reStampedTags: string[] = [];
  for (const entry of pendingReStamps(applied, known)) {
    await target.supersedeAppliedMigrations([entry.supersededTag], entry.replacementTag);
    reStampedTags.push(entry.replacementTag);
  }
  if (reStampedTags.length > 0) applied = new Set(await target.appliedMigrationTags());

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
    // A re-stamped tag that is still here got past the rewrite for one reason: this code does not
    // carry the replacement, which is what a deployment older than the rename looks like. Naming the
    // rename is the difference between "roll this deployment forward" and a hunt for a schema change
    // that was never made — the SQL is identical on both sides of it.
    const reStamp = findReStampOf(tag);
    if (reStamp !== undefined) {
      throw new Error(
        `database has applied migration "${tag}", which was re-stamped to "${reStamp.replacementTag}" on ${reStamp.recorded} — and this code carries neither id, so it is older than the rename. Deploy a build that contains "${reStamp.replacementTag}" and this database reconciles itself on the next wake.`,
      );
    }
    throw new Error(
      `database has applied migration "${tag}" which this code does not know — deploy mismatch (code older than schema)`,
    );
  }
  // Measured against the ledger as it stands BEFORE anything is applied: once the batch lands, every
  // tag is in the ledger and which of them arrived late is no longer visible anywhere.
  const outOfOrderTags = outOfOrderArrivals(applied, migrations);
  const ledgerHead = ledgerHeadTag(applied);

  const report: MigrationRunReport = {
    appliedTags: [],
    skippedTags: [],
    reconciledToBaseline,
    reStampedTags,
    outOfOrderTags,
    ledgerHead,
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
