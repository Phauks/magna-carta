import { describe, expect, it } from "vitest";
import type { MigrationJournal } from "../../packages/database/src/migration.ts";
import { checkCommittedLineages } from "./index.mts";
import {
  applyOrderViolations,
  journalStructureViolations,
  rebuildViolations,
  snapshotLineageViolations,
  LINEAGES,
} from "./checks.mts";

// The same checks the pre-push hook and the gate run as a plain script, driven here under the test
// runner so they are also covered by the normal suite. One implementation, two callers: index.mts.

describe("migration integrity — committed lineages", () => {
  const reports = checkCommittedLineages();

  it("covers every lineage", () => {
    expect(reports.map((report) => report.lineage)).toEqual([...LINEAGES]);
  });

  for (const lineage of LINEAGES) {
    it(`${lineage}: journal, chain, rebuild and snapshot guards pass`, () => {
      const report = reports.find((candidate) => candidate.lineage === lineage);
      expect(report?.violations).toEqual([]);
      // A lineage that loaded nothing would satisfy every rule above vacuously.
      expect(report?.migrationCount).toBeGreaterThan(0);
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

  it("flags a migration whose tag sorts before the one it was authored after", () => {
    // The real shape, from 2026-09-14: a branch cut at 09:00 merged after one cut at 12:00, so
    // drizzle gave it the later idx while its tag still sorted earlier. Apply order is by tag, so a
    // fresh firm would have run it FIRST — building its schema in an order no existing firm used.
    const violations = applyOrderViolations(
      journalOf([
        { idx: 0, tag: "20260914T120000_task-rungs-and-archive" },
        { idx: 1, tag: "20260914T090000_event-conference-link" },
      ]),
    );
    expect(violations.join(" ")).toContain("is APPLIED before the migration it was authored after");
    expect(violations.join(" ")).toContain("20260914T090000_event-conference-link");
  });

  it("passes a lineage whose tags climb with idx", () => {
    expect(
      applyOrderViolations(
        journalOf([
          { idx: 0, tag: "20260914T120000_task-rungs-and-archive" },
          { idx: 1, tag: "20260914T120001_event-conference-link" },
        ]),
      ),
    ).toEqual([]);
  });

  it("flags two migrations that claim the same tag", () => {
    // Equal tags are not "in order": the loader sorts by tag, so which of the two applies first is
    // whatever the sort happens to do with a tie.
    expect(
      applyOrderViolations(
        journalOf([
          { idx: 0, tag: "20260914T120000_a" },
          { idx: 1, tag: "20260914T120000_a" },
        ]),
      ),
    ).toHaveLength(1);
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

  it("flags a snapshot whose prevId names something other than its predecessor", () => {
    const violations = snapshotLineageViolations([
      { idx: 0, id: "id-zero", prevId: "id-collapsed-away" },
      { idx: 1, id: "id-one", prevId: "id-zero" },
      { idx: 3, id: "id-three", prevId: "id-from-nowhere" },
    ]);
    expect(violations.join(" ")).toContain("prevId id-from-nowhere");
    // The oldest snapshot's own prevId is exempt (its ancestor was collapsed away), and a gap for a
    // seed-only migration is fine as long as the ids still chain across it.
    expect(
      snapshotLineageViolations([
        { idx: 0, id: "id-zero", prevId: "id-collapsed-away" },
        { idx: 2, id: "id-two", prevId: "id-zero" },
      ]),
    ).toEqual([]);
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
