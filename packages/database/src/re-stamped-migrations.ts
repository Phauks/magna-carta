// Migration tags that were RENAMED after they had already deployed, preserved as data so the
// databases that applied the old id stay recognizable.
//
// A tag is immutable once it is on `main`, because `main` is production — the rule
// `packages/database/CLAUDE.md` states and `tooling/migration-immutability/` enforces on every pull
// request. A re-stamp breaks it: the applied-ledger records the TAG, not the SQL behind it, so a
// database that ran the migration under its old id holds a row naming a migration this lineage no
// longer contains. The runner reads that as "a newer schema than this code" and refuses the whole
// lineage, which blocks every later migration for the life of that database.
//
// WHY RECONCILE RATHER THAN RECREATE. The rename's stated remedy was to recreate any database that
// had applied an old id, which is only free while no database holds data worth keeping. That is a
// window, and it closes without announcing itself — the 2026-09-15 rename below was taken on the
// premise that the window was open and it was not. Reconciling costs one ledger rewrite and is
// correct whether or not the premise held, so it is what the runner does.
//
// WHY THIS IS SAFE, AND WHERE IT STOPS BEING SAFE. A re-stamp moves the id and nothing else: the
// SQL behind the new tag is the SQL the old tag already ran, so a ledger holding the old id already
// carries exactly the schema the new id names, and rewriting the row asserts nothing that is not
// already true. That is the whole of the justification, and it is why an entry here is legitimate
// ONLY for a pure rename. A tag whose SQL also changed is not a re-stamp and must never be listed:
// the rewrite would then claim a schema the database does not have. Append a new migration instead.
//
// This is deliberately NOT `legacy-baselines.ts`. A baseline collapse retires a whole chain behind
// one new migration and reconciles only on an exact, complete match of that chain; a re-stamp
// retires exactly one tag in favour of exactly one other and each is independent of the rest of the
// ledger. Folding them together would mean loosening the complete-chain rule that makes a baseline
// collapse safe.
//
// Immutable history: these ids name committed migrations that real databases applied. Never edit or
// delete an entry; a later rename appends a new one.
export interface ReStampedMigration {
  // The lineage the rename happened in, for reports and for the immutability gate's filtering.
  readonly lineage: string;
  // The tag as the databases that already applied it recorded it.
  readonly supersededTag: string;
  // The tag the same migration carries now. Its SQL must be unchanged from what `supersededTag`
  // ran — see above.
  readonly replacementTag: string;
  // Why the rename was taken. The motive, not the safety argument: the safety argument is the same
  // for every entry and lives in this file's header.
  readonly why: string;
  // The day the rename landed on `main`, `YYYY-MM-DD`.
  readonly recorded: string;
}

export const RE_STAMPED_MIGRATIONS: readonly ReStampedMigration[] = [
  {
    lineage: "per-firm",
    supersededTag: "20260911T000000_office-email-address-lines-and-firm-brand-images",
    replacementTag: "20260911T120001_office-email-address-lines-and-firm-brand-images",
    why: "Its tag sorted below the migration it was merged after, so a freshly provisioned firm would have applied the pair in an order no already-migrated firm ever used. Re-stamped to restore one apply order; docs/deploy-queue.md records the rename.",
    recorded: "2026-09-15",
  },
  {
    lineage: "per-firm",
    supersededTag: "20260914T090000_event-conference-link",
    replacementTag: "20260914T120001_event-conference-link",
    why: "The same inversion as the entry above, in the same rename: its tag sorted below the migration it was merged after.",
    recorded: "2026-09-15",
  },
];

/**
 * The ledger rewrites this database needs before its applied tags can be read against this code:
 * one per re-stamped tag it still holds under the retired id.
 *
 * Each is independent, so they are returned as a list and performed one at a time. A crash between
 * two of them leaves the ledger holding one rewritten tag and one not, which is a state the next
 * wake resolves by doing the rest — the same resumability an interrupted migration run has.
 *
 * Three conditions, and a rewrite is offered only when all three hold:
 *
 *   * the database applied the superseded tag — otherwise there is nothing to rewrite;
 *   * this code carries the replacement tag — otherwise a deployment running older code than the
 *     rename would rewrite a ledger row to a tag it has no SQL for, stranding the database one step
 *     further along than it found it;
 *   * the database has NOT applied the replacement tag. Holding both is unreachable through any
 *     path this code creates, and it is also the one shape the rewrite cannot express: the ledger
 *     keys on the tag, so inserting a replacement row that already exists fails the primary key.
 *     `conflictingReStamps` names that state separately rather than letting it surface as a
 *     constraint error with no explanation attached.
 */
export function pendingReStamps(
  appliedTags: ReadonlySet<string>,
  knownTags: ReadonlySet<string>,
): ReStampedMigration[] {
  return RE_STAMPED_MIGRATIONS.filter(
    (entry) =>
      appliedTags.has(entry.supersededTag) &&
      knownTags.has(entry.replacementTag) &&
      !appliedTags.has(entry.replacementTag),
  );
}

/**
 * Re-stamps whose superseded AND replacement tags are both in the ledger — an anomaly no code path
 * here produces, kept nameable because the alternative is a primary-key failure inside a ledger
 * rewrite, which says nothing about what is actually wrong.
 */
export function conflictingReStamps(appliedTags: ReadonlySet<string>): ReStampedMigration[] {
  return RE_STAMPED_MIGRATIONS.filter(
    (entry) => appliedTags.has(entry.supersededTag) && appliedTags.has(entry.replacementTag),
  );
}

/** The re-stamp that retired this tag, when one did. */
export function findReStampOf(tag: string): ReStampedMigration | undefined {
  return RE_STAMPED_MIGRATIONS.find((entry) => entry.supersededTag === tag);
}
