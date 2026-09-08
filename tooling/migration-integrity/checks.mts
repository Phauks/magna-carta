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

// Structural violations of the journal <-> files relationship. (Snapshot timestamps are NOT checked:
// merge-renumbering legitimately leaves `when` non-monotonic, and apply order is by idx.)
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
