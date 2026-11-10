import type { MigrationJournal } from "../../packages/database/src/migration.ts";

// The migration-lineage integrity rules, as pure functions over already-loaded data. The filesystem
// and node:sqlite halves live next door in index.mts; keeping the rules themselves free of both is
// what lets the known-bad-input suite prove each one bites without touching a disk.
//
// These are structural assertions over generated artifacts — a journal, a set of .sql files, and the
// meta/ snapshots. Nothing here needs a test runner, and running them under one inside a git hook
// costs more than it buys: the hook then competes for the same machine as any run already in flight,
// and a failure caused by that contention is printed under the words "migration integrity", which
// reads as lineage corruption and sends the reader to diagnose a break that does not exist.

export type Lineage = "control-plane" | "per-firm";
export const LINEAGES: readonly Lineage[] = ["control-plane", "per-firm"];

export interface Artifacts {
  readonly journal: MigrationJournal;
  readonly sqlFiles: readonly string[];
  readonly snapshotIdx: readonly number[];
}

export interface SnapshotHeader {
  readonly idx: number;
  readonly id: string;
  readonly prevId: string;
}

// Structural violations of the journal <-> files relationship. (Snapshot `when` timestamps are NOT
// checked: merge-renumbering legitimately leaves them non-monotonic, and nothing reads them.)
//
// APPLY ORDER IS BY TAG, NOT BY IDX, and this file used to say the opposite. `migrationsFromJournal`
// sorts the journal's entries lexically by tag, so the tag is what every database — fresh or
// already provisioned — actually applies in; `idx` is drizzle's own dense counter, and it names the
// snapshot a generate diffs against. The two are the same fact only while they agree, which is what
// applyOrderViolations below is for.
export function journalStructureViolations(artifacts: Artifacts): string[] {
  const violations: string[] = [];
  const entries = [...artifacts.journal.entries].sort((left, right) => left.idx - right.idx);

  entries.forEach((entry, position) => {
    if (entry.idx !== position) {
      violations.push(
        `idx not contiguous from 0: position ${position} holds idx ${entry.idx} (${entry.tag})`,
      );
    }
  });
  if (new Set(entries.map((entry) => entry.idx)).size !== entries.length) {
    violations.push("duplicate idx in journal (two migrations claimed the same slot)");
  }

  const journalTags = new Set(entries.map((entry) => entry.tag));
  for (const entry of entries) {
    if (!artifacts.sqlFiles.includes(`${entry.tag}.sql`)) {
      violations.push(`journal tag has no .sql file: ${entry.tag}`);
    }
  }
  for (const file of artifacts.sqlFiles) {
    if (!journalTags.has(file.replace(/\.sql$/, ""))) {
      violations.push(`orphan .sql not in the journal: ${file}`);
    }
  }

  // Seed-only migrations change no schema, so drizzle emits NO snapshot for them — a snapshot per
  // migration is NOT required. The real hazard is a STALE snapshot a renumber left behind, so every
  // snapshot must map to a journal idx (subset, not superset).
  const journalIdx = new Set(entries.map((entry) => entry.idx));
  for (const snapshotIdx of artifacts.snapshotIdx) {
    if (!journalIdx.has(snapshotIdx)) {
      violations.push(`orphan snapshot for idx ${snapshotIdx} (no such journal entry)`);
    }
  }
  return violations;
}

/**
 * A lineage whose apply order and authored order disagree.
 *
 * `idx` is the order the migrations were INTEGRATED in — drizzle hands out the next number when a
 * migration is generated, and a merge renumbers an incoming one above whatever landed first. The
 * TAG is the order they are APPLIED in, on every database there is. While the two agree, a
 * migration is applied against the same schema state it was authored against. When they disagree,
 * a branch cut earlier but merged later is applied BEFORE the migration it was actually written on
 * top of — so a fresh firm builds its schema in an order no existing firm ever used, and the two
 * fleets diverge the first time one of those migrations depends on the other.
 *
 * WHY THIS LIVES HERE RATHER THAN ONLY IN A TEST. It was only in a test — the Vitest fitness
 * function in packages/database — and the hosted gate of the time ran its test battery only when
 * asked, so two inversions merged on 2026-09-11 and 2026-09-14 without anything failing. This
 * module runs in the pre-push hook and in the gate's governance dimension on EVERY change, which is
 * where a tag still costs nothing to change: a migration nobody has applied can be renamed, and one
 * that has reached a database cannot.
 *
 * The remedy is always to re-stamp the incoming migration ABOVE the new head, never to renumber
 * `idx` — `idx` names snapshot files that describe the schema at that point, and reordering it
 * would make each snapshot describe a state its name denies.
 */
export function applyOrderViolations(journal: MigrationJournal): string[] {
  const byIdx = [...journal.entries].sort((left, right) => left.idx - right.idx);
  const violations: string[] = [];
  for (let position = 1; position < byIdx.length; position += 1) {
    const previous = byIdx[position - 1];
    const current = byIdx[position];
    if (previous === undefined || current === undefined) continue;
    if (current.tag > previous.tag) continue;
    violations.push(
      `${current.tag} (idx ${current.idx}) sorts before ${previous.tag} (idx ${previous.idx}), so it ` +
        "is APPLIED before the migration it was authored after. Re-stamp it above the lineage head " +
        "with a later timestamp id — never renumber idx, which names the snapshots.",
    );
  }
  return violations;
}

// Drizzle's ancestry chain: each snapshot's prevId must name the id of the snapshot emitted before it
// (before it among the EMITTED snapshots — a seed-only migration emits none, so the chain legitimately
// skips its idx; and the oldest committed snapshot may descend from one a baseline collapse removed,
// so only the links between existing snapshots are checked). A prevId that names nothing changes no
// generate today, which is exactly why it would otherwise sit wrong in the lineage metadata
// indefinitely.
export function snapshotLineageViolations(snapshots: readonly SnapshotHeader[]): string[] {
  const violations: string[] = [];
  const ordered = [...snapshots].sort((left, right) => left.idx - right.idx);
  for (let position = 1; position < ordered.length; position += 1) {
    const previous = ordered[position - 1];
    const current = ordered[position];
    if (previous !== undefined && current !== undefined && current.prevId !== previous.id) {
      violations.push(
        `snapshot ${current.idx} prevId ${current.prevId} does not name snapshot ${previous.idx} (id ${previous.id})`,
      );
    }
  }
  return violations;
}

// Unreviewed destructive table-rebuilds, given a tag -> SQL map.
export function rebuildViolations(
  sqlByTag: Record<string, string>,
  reviewed: ReadonlySet<string>,
): string[] {
  return Object.entries(sqlByTag)
    .filter(([tag, sql]) => /`__new_\w+`/.test(sql) && !reviewed.has(tag))
    .map(
      ([tag]) =>
        `unreviewed table-rebuild in ${tag} — audit that the copy preserves every row, then add the tag to REVIEWED_REBUILDS`,
    );
}

/**
 * A rebuild of a table that OTHER TABLES POINT AT — the shape that cannot run in production.
 *
 * The reviewed-rebuild rule above asks whether a human audited the copy. That is the wrong question
 * for this case, because no amount of care makes the migration applicable: a rebuild drops the table
 * it replaces, and in a Cloudflare durable object foreign keys are enforced at the statement and at
 * the commit, with `PRAGMA foreign_keys=OFF` a no-op inside the one execution context a migration
 * runs in. A drop with children therefore fails against every firm database that holds data, and
 * succeeds only against the empty ones the test suite used to build. The reasoning and the four
 * probes that establish it are recorded beside the grandfather list in reviewed-rebuilds.ts.
 *
 * The children are read from the schema AS IT STANDS at that migration, not from the head — a table
 * gains references over time, and the question is what pointed at it on the day it was rebuilt.
 *
 * Takes the applied-schema reader as a parameter so this file stays free of node:sqlite and can run
 * under the same guard the rest of these checks do.
 */
export function parentRebuildViolations(
  sqlByTag: Record<string, string>,
  childrenOfRebuiltTableAt: (tag: string, table: string) => readonly string[],
  grandfathered: ReadonlySet<string>,
): string[] {
  const violations: string[] = [];
  for (const [tag, sql] of Object.entries(sqlByTag)) {
    const rebuilt = /`__new_(\w+)`/.exec(sql)?.[1];
    if (rebuilt === undefined) continue;
    const children = childrenOfRebuiltTableAt(tag, rebuilt);
    if (children.length === 0) continue;
    if (grandfathered.has(tag)) continue;
    violations.push(
      `${tag} rebuilds \`${rebuilt}\`, which ${String(children.length)} table(s) reference ` +
        `(${children.slice(0, 4).join(", ")}${children.length > 4 ? ", …" : ""}). A rebuild drops ` +
        "the table it replaces, and a durable object refuses that drop while anything points at it " +
        "— the pragma that would suspend enforcement does nothing inside a migration's execution " +
        "context. This migration would apply to an empty database and fail against every firm that " +
        "holds data. Widening a CHECK or dropping a column on a parent table needs a different " +
        "approach; see PARENT_REBUILDS_PREDATING_THE_DURABLE_OBJECT_FINDING for why that list must " +
        "not grow.",
    );
  }
  return violations;
}

/*
 * THE CHAIN AGAINST THE SCHEMA.
 *
 * The one check the rest of this file cannot make: does the SQL actually build what the TypeScript
 * says the database is? Everything else here asks whether the artifacts are well-formed and whether
 * the chain runs. A chain can be well-formed, run cleanly, and still produce a column the schema
 * does not declare, or miss one it does.
 *
 * That gap is wide open here rather than theoretical, and for two reasons that compound. Hand-written
 * migrations are the NORMAL case in this repository (partial indexes, FTS5, seeds, ordered column
 * adds — drizzle-kit cannot express them), so most of the lineage is authored beside the schema
 * rather than derived from it. And the snapshot check that looks like it would catch a divergence
 * does not: refresh-snapshot re-derives the snapshot FROM the TypeScript, so a migration that drifts
 * from the schema leaves both of them agreeing with each other and disagreeing with every database.
 *
 * The package's own notes already prescribe this comparison — "apply the lineage to node:sqlite and
 * compare PRAGMA output" — as something to do BY HAND when a divergence is suspected. A check
 * somebody has to think of running is a check that runs after the damage. This is that comparison,
 * run every time.
 */

/** A live database's shape, read back from SQLite: table name -> its column names. */
export type LiveSchema = ReadonlyMap<string, ReadonlySet<string>>;

/** What the TypeScript declares: table name -> its column names. */
export type DeclaredSchema = ReadonlyMap<string, ReadonlySet<string>>;

/*
 * Tables the migrations build that the TypeScript deliberately does not declare, because drizzle
 * cannot model them. The FTS5 virtual table for directory name search and the one for the record
 * index, each with the four shadow tables SQLite creates underneath it. Named exactly rather than
 * matched by prefix: a new undeclared table is a real finding, and a prefix rule would swallow the
 * next one silently.
 */
export const UNDECLARED_BY_DESIGN: readonly string[] = [
  "directory_name_fts",
  "directory_name_fts_data",
  "directory_name_fts_idx",
  "directory_name_fts_docsize",
  "directory_name_fts_config",
  "record_text_fts",
  "record_text_fts_data",
  "record_text_fts_idx",
  "record_text_fts_docsize",
  "record_text_fts_config",
];

/**
 * Where the applied chain and the declared schema disagree. Empty when they build the same thing.
 *
 * Runner-managed tables (`_migrations`, `_migration_restore_point`) are skipped: they are the
 * runtime's own bookkeeping, created outside the lineage, and no schema declares them.
 */
export function schemaAgreementViolations(declared: DeclaredSchema, live: LiveSchema): string[] {
  const violations: string[] = [];
  for (const [table, declaredColumns] of declared) {
    const liveColumns = live.get(table);
    if (liveColumns === undefined) {
      violations.push(`the schema declares table "${table}" and the chain never creates it`);
      continue;
    }
    for (const column of declaredColumns) {
      if (!liveColumns.has(column)) {
        violations.push(
          `the schema declares "${table}"."${column}" and the chain never creates it`,
        );
      }
    }
    for (const column of liveColumns) {
      if (!declaredColumns.has(column)) {
        violations.push(
          `the chain creates "${table}"."${column}" and the schema does not declare it`,
        );
      }
    }
  }
  const allowed = new Set(UNDECLARED_BY_DESIGN);
  for (const table of live.keys()) {
    if (declared.has(table) || allowed.has(table) || table.startsWith("_")) continue;
    violations.push(
      `the chain creates table "${table}" and the schema does not declare it — if that is deliberate, add it to UNDECLARED_BY_DESIGN with the reason`,
    );
  }
  return violations;
}
