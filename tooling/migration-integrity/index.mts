import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  applyMigrations,
  loadMigrationsFromDisk,
} from "../../packages/database/src/node-sqlite.ts";
import type { MigrationJournal } from "../../packages/database/src/migration.ts";
import {
  journalStructureViolations,
  rebuildViolations,
  snapshotLineageViolations,
  LINEAGES,
  REVIEWED_REBUILDS,
  type Artifacts,
  type Lineage,
  type SnapshotHeader,
} from "./checks.mts";

// A standing guard on the generated migration artifacts, complementing the per-migration CONTENT
// tests in packages/database/test: this asserts the journal/.sql/snapshot set is STRUCTURALLY sound
// and that the whole chain actually RUNS. These are the failure modes a parallel-branch merge
// introduces — two branches both grabbing the next idx, a renumber that orphans a snapshot, a chain
// whose statements read right but don't apply, or a silent destructive table-rebuild — none of which
// the by-tag content tests can see.
//
// Run it directly: `node tooling/migration-integrity/index.mts`. It is a plain script on purpose.
// The two callers that must never be starved by an unrelated test run — the pre-push hook and the
// gate's governance job — invoke it that way, so the guard needs no test runner, no worker pool, and
// no runtime beyond node:sqlite. migration-integrity.test.mts beside this file drives these same
// functions under Vitest, so there is one implementation and no caller can disagree with another
// about what a sound lineage is.

const DRIZZLE = join(import.meta.dirname, "..", "..", "packages", "database", "drizzle");

function loadArtifacts(lineage: Lineage): Artifacts {
  const directory = join(DRIZZLE, lineage);
  const journal = JSON.parse(
    readFileSync(join(directory, "meta", "_journal.json"), "utf8"),
  ) as MigrationJournal;
  const sqlFiles = readdirSync(directory).filter((file) => file.endsWith(".sql"));
  const snapshotIdx = readdirSync(join(directory, "meta"))
    .filter((file) => /^\d{4}_snapshot\.json$/.test(file))
    .map((file) => Number(file.slice(0, 4)));
  return { journal, sqlFiles, snapshotIdx };
}

function loadSnapshotHeaders(lineage: Lineage): SnapshotHeader[] {
  const directory = join(DRIZZLE, lineage, "meta");
  return readdirSync(directory)
    .filter((file) => /^\d{4}_snapshot\.json$/.test(file))
    .map((file) => {
      const parsed = JSON.parse(readFileSync(join(directory, file), "utf8")) as {
        id: string;
        prevId: string;
      };
      return { idx: Number(file.slice(0, 4)), id: parsed.id, prevId: parsed.prevId };
    });
}

function sqlByTagFor(lineage: Lineage): Record<string, string> {
  return Object.fromEntries(
    loadMigrationsFromDisk(lineage).map((migration) => [
      migration.tag,
      migration.statements.join("\n"),
    ]),
  );
}

// The chain has to APPLY, not merely parse: a broken snapshot chain (an ALTER referencing a column an
// earlier step never created) fails here rather than against a firm's database.
function chainApplyViolations(lineage: Lineage): string[] {
  const database = new DatabaseSync(":memory:");
  try {
    applyMigrations(database, loadMigrationsFromDisk(lineage));
    const tableCount = database
      .prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'")
      .get() as { count: number };
    if (tableCount.count === 0) {
      return ["the chain applied but produced no tables — the lineage builds nothing"];
    }
    return [];
  } catch (error) {
    return [
      `the chain does not apply from zero: ${error instanceof Error ? error.message : String(error)}`,
    ];
  } finally {
    database.close();
  }
}

export interface LineageReport {
  readonly lineage: Lineage;
  readonly migrationCount: number;
  readonly violations: readonly string[];
}

export function checkLineage(lineage: Lineage): LineageReport {
  const migrations = loadMigrationsFromDisk(lineage);
  const violations = [
    ...journalStructureViolations(loadArtifacts(lineage)),
    ...chainApplyViolations(lineage),
    ...rebuildViolations(sqlByTagFor(lineage), REVIEWED_REBUILDS),
    ...snapshotLineageViolations(loadSnapshotHeaders(lineage)),
  ];
  // A lineage with nothing in it satisfies every rule above vacuously. Report that as a violation
  // rather than as a pass: a guard that clears an empty set is indistinguishable from a guard that
  // ran, and the second is the only one worth having.
  if (migrations.length === 0) {
    violations.push(
      "no migrations found — the checks above cleared an empty set, which proves nothing",
    );
  }
  return { lineage, migrationCount: migrations.length, violations };
}

export function checkCommittedLineages(): LineageReport[] {
  return LINEAGES.map((lineage) => checkLineage(lineage));
}

function main(): void {
  let reports: LineageReport[];
  try {
    reports = checkCommittedLineages();
  } catch (error) {
    // A check that cannot be taken is a failure, never a pass. An unreadable journal, a missing
    // drizzle directory or an absent node:sqlite all land here, and all of them mean the lineage went
    // unverified — which must look different from a lineage that was verified and found sound.
    console.error("migration-integrity: the checks could not be run —");
    console.error(error);
    process.exit(1);
  }

  const failed = reports.filter((report) => report.violations.length > 0);
  for (const report of failed) {
    console.error(`\nmigration-integrity: ${report.lineage} —`);
    for (const violation of report.violations) console.error(`  ${violation}`);
  }
  if (failed.length > 0) {
    console.error("");
    process.exit(1);
  }

  const summary = reports
    .map((report) => `${report.lineage} (${report.migrationCount} migrations)`)
    .join(", ");
  console.log(`migration-integrity: journal, chain, rebuild and snapshot guards pass — ${summary}`);
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && resolve(entryPoint) === import.meta.filename) main();
