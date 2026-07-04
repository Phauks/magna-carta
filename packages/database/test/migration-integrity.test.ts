import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { MigrationJournal } from "../src/migration.ts";
import { applyMigrations, loadMigrationsFromDisk } from "../src/node-sqlite.ts";

// A standing guard on the generated migration artifacts, complementing generated-migrations.test.ts
// (which asserts per-migration CONTENT): this file asserts the journal/.sql/snapshot set is
// STRUCTURALLY sound and that the whole chain actually RUNS. These are the failure modes a
// parallel-branch merge introduces — two branches both grabbing the next idx, a renumber that
// orphans a snapshot, a chain whose statements read right but don't apply, or a silent destructive
// table-rebuild — none of which the by-tag content tests can see. Runs in the node pool against
// node:sqlite, so it stays fast and never touches Miniflare.

type Lineage = "control-plane" | "per-firm";
const LINEAGES: readonly Lineage[] = ["control-plane", "per-firm"];
const DRIZZLE = join(import.meta.dirname, "..", "drizzle");

// Tags whose migration performs a reviewed SQLite table-rebuild (CREATE `__new_X` / copy / DROP /
// RENAME — what drizzle emits for an in-place ALTER SQLite can't do). The collapsed baselines rebuild
// nothing, so this list is empty. The sentinel FAILS on any rebuild not listed here, so a future
// destructive rebuild is a conscious review decision (does it preserve every row? is the copy SELECT
// correct?) — not a silent merge artifact. Adding a migration that rebuilds a table: audit it, then
// add its timestamp tag here.
const REVIEWED_REBUILDS: ReadonlySet<string> = new Set<string>([]);

interface Artifacts {
  readonly journal: MigrationJournal;
  readonly sqlFiles: readonly string[];
  readonly snapshotIdx: readonly number[];
}

function loadArtifacts(lineage: Lineage): Artifacts {
  const dir = join(DRIZZLE, lineage);
  const journal = JSON.parse(
    readFileSync(join(dir, "meta", "_journal.json"), "utf8"),
  ) as MigrationJournal;
  const sqlFiles = readdirSync(dir).filter((file) => file.endsWith(".sql"));
  const snapshotIdx = readdirSync(join(dir, "meta"))
    .filter((file) => /^\d{4}_snapshot\.json$/.test(file))
    .map((file) => Number(file.slice(0, 4)));
  return { journal, sqlFiles, snapshotIdx };
}

// PURE — structural violations of the journal <-> files relationship. (Snapshot timestamps are NOT
// checked: merge-renumbering legitimately leaves `when` non-monotonic, and apply order is by idx.)
export function journalStructureViolations(art: Artifacts): string[] {
  const violations: string[] = [];
  const entries = [...art.journal.entries].sort((a, b) => a.idx - b.idx);

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
    if (!art.sqlFiles.includes(`${entry.tag}.sql`)) {
      violations.push(`journal tag has no .sql file: ${entry.tag}`);
    }
  }
  for (const file of art.sqlFiles) {
    if (!journalTags.has(file.replace(/\.sql$/, ""))) {
      violations.push(`orphan .sql not in the journal: ${file}`);
    }
  }

  // Seed-only migrations change no schema, so drizzle emits NO snapshot for them — a snapshot per
  // migration is NOT required. The real hazard is a STALE snapshot a renumber left behind, so every
  // snapshot must map to a journal idx (subset, not superset).
  const journalIdx = new Set(entries.map((entry) => entry.idx));
  for (const snapshotIdx of art.snapshotIdx) {
    if (!journalIdx.has(snapshotIdx)) {
      violations.push(`orphan snapshot for idx ${snapshotIdx} (no such journal entry)`);
    }
  }
  return violations;
}

// PURE — unreviewed destructive table-rebuilds, given a tag -> SQL map.
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

function sqlByTagFor(lineage: Lineage): Record<string, string> {
  return Object.fromEntries(
    loadMigrationsFromDisk(lineage).map((migration) => [
      migration.tag,
      migration.statements.join("\n"),
    ]),
  );
}

describe("migration integrity — committed lineages", () => {
  for (const lineage of LINEAGES) {
    it(`${lineage}: journal, .sql, and snapshots are structurally consistent`, () => {
      expect(journalStructureViolations(loadArtifacts(lineage))).toEqual([]);
    });

    it(`${lineage}: the full chain applies from zero in a fresh SQLite`, () => {
      const database = new DatabaseSync(":memory:");
      // applyMigrations throws on the first failing statement — a broken snapshot chain (an ALTER
      // referencing a column an earlier step never created) fails HERE, not in production.
      expect(() => {
        applyMigrations(database, loadMigrationsFromDisk(lineage));
      }).not.toThrow();
      const tableCount = database
        .prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'")
        .get() as { count: number };
      expect(tableCount.count).toBeGreaterThan(0);
      database.close();
    });

    it(`${lineage}: no UNREVIEWED destructive table-rebuild`, () => {
      expect(rebuildViolations(sqlByTagFor(lineage), REVIEWED_REBUILDS)).toEqual([]);
    });
  }
});

// The validators must not be vacuous — prove each catches the merge-corruption it guards against.
describe("migration-integrity validators reject known-bad inputs", () => {
  const journalOf = (entries: { idx: number; tag: string }[]): MigrationJournal => ({
    version: "7",
    dialect: "sqlite",
    entries: entries.map((entry) => ({ ...entry, version: "6", when: 0, breakpoints: true })),
  });

  it("flags a duplicate idx (two branches both grabbed the same slot)", () => {
    const violations = journalStructureViolations({
      journal: journalOf([
        { idx: 5, tag: "0005_a" },
        { idx: 5, tag: "0005_b" },
      ]),
      sqlFiles: ["0005_a.sql", "0005_b.sql"],
      snapshotIdx: [],
    });
    expect(violations.join(" ")).toContain("duplicate idx");
  });

  it("flags an idx gap (a renumber dropped a slot)", () => {
    const violations = journalStructureViolations({
      journal: journalOf([
        { idx: 0, tag: "0000_a" },
        { idx: 2, tag: "0002_c" },
      ]),
      sqlFiles: ["0000_a.sql", "0002_c.sql"],
      snapshotIdx: [],
    });
    expect(violations.join(" ")).toContain("not contiguous");
  });

  it("flags an orphan .sql not in the journal", () => {
    const violations = journalStructureViolations({
      journal: journalOf([{ idx: 0, tag: "0000_a" }]),
      sqlFiles: ["0000_a.sql", "0001_stray.sql"],
      snapshotIdx: [],
    });
    expect(violations.join(" ")).toContain("orphan .sql");
  });

  it("flags a stale snapshot left by a renumber", () => {
    const violations = journalStructureViolations({
      journal: journalOf([{ idx: 0, tag: "0000_a" }]),
      sqlFiles: ["0000_a.sql"],
      snapshotIdx: [0, 1],
    });
    expect(violations.join(" ")).toContain("orphan snapshot");
  });

  it("does NOT require a snapshot for every migration (seed-only migrations have none)", () => {
    const violations = journalStructureViolations({
      journal: journalOf([
        { idx: 0, tag: "0000_a" },
        { idx: 1, tag: "0001_seed" },
      ]),
      sqlFiles: ["0000_a.sql", "0001_seed.sql"],
      snapshotIdx: [0],
    });
    expect(violations).toEqual([]);
  });

  it("flags an unreviewed table-rebuild but passes a reviewed or non-rebuild one", () => {
    const rebuild = { "0099_x": "CREATE TABLE `__new_foo` (`id` text);" };
    expect(rebuildViolations(rebuild, new Set())).toHaveLength(1);
    expect(rebuildViolations(rebuild, new Set(["0099_x"]))).toEqual([]);
    expect(rebuildViolations({ "0099_x": "ALTER TABLE `foo` ADD `bar` text;" }, new Set())).toEqual(
      [],
    );
  });
});
