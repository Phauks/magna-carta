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

// Tags whose migration performs a reviewed SQLite table-rebuild (CREATE `__new_X` / copy / DROP /
// RENAME — what drizzle emits for an in-place ALTER SQLite can't do). The collapsed baselines rebuild
// nothing, so this list is empty. The sentinel FAILS on any rebuild not listed here, so a future
// destructive rebuild is a conscious review decision (does it preserve every row? is the copy SELECT
// correct?) — not a silent merge artifact. Adding a migration that rebuilds a table: audit it, then
// add its timestamp tag here.
export const REVIEWED_REBUILDS: ReadonlySet<string> = new Set<string>([]);

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
