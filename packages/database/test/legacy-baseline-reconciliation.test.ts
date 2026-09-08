import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { LEGACY_BASELINES, findLegacyBaseline } from "../src/legacy-baselines.ts";
import { runPendingMigrations, type MigrationTarget } from "../src/migration-runner.ts";
import { loadMigrationsFromDisk } from "../src/node-sqlite.ts";

// A production database provisioned before the 2026-07-04 baseline collapse holds the lineage's
// cumulative schema with an applied ledger under the retired sequential ids. These tests rebuild
// that shape on node:sqlite and prove the runner rewrites the ledger to the baseline and then
// migrates to head — while a genuinely unknown ledger still refuses.

const CREATE_MIGRATIONS_TABLE =
  "CREATE TABLE IF NOT EXISTS _migrations (tag TEXT PRIMARY KEY, applied_at TEXT NOT NULL)";

// MigrationTarget over node:sqlite, mirroring the real adapters: same _migrations ledger, each
// write one transaction.
function nodeSqliteMigrationTarget(database: DatabaseSync): MigrationTarget {
  return {
    appliedMigrationTags: () => {
      database.exec(CREATE_MIGRATIONS_TABLE);
      const rows = database.prepare("SELECT tag FROM _migrations ORDER BY tag").all() as {
        tag: string;
      }[];
      return Promise.resolve(rows.map((row) => row.tag));
    },
    applyMigration: (migration) => {
      database.exec("BEGIN");
      try {
        for (const statement of migration.statements) database.exec(statement);
        database
          .prepare("INSERT INTO _migrations (tag, applied_at) VALUES (?, ?)")
          .run(migration.tag, new Date().toISOString());
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return Promise.resolve();
    },
    supersedeAppliedMigrations: (supersededTags, replacementTag) => {
      database.exec("BEGIN");
      try {
        for (const tag of supersededTags) {
          database.prepare("DELETE FROM _migrations WHERE tag = ?").run(tag);
        }
        database
          .prepare("INSERT INTO _migrations (tag, applied_at) VALUES (?, ?)")
          .run(replacementTag, new Date().toISOString());
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return Promise.resolve();
    },
  };
}

function legacyBaselineFor(lineage: string) {
  const entry = LEGACY_BASELINES.find((candidate) => candidate.lineage === lineage);
  if (entry === undefined) throw new Error(`no legacy baseline recorded for ${lineage}`);
  return entry;
}

// The pre-collapse production shape: schema as the retired chain left it (the committed baseline
// SQL, verified equivalent to that chain's cumulative schema and seeds when the collapse landed),
// ledger under the retired ids. The retired SQL itself no longer ships, so the baseline is the
// faithful stand-in.
function preCollapseDatabase(lineage: "control-plane" | "per-firm"): DatabaseSync {
  const { baselineTag, legacyTags } = legacyBaselineFor(lineage);
  const database = new DatabaseSync(":memory:");
  const baseline = loadMigrationsFromDisk(lineage).find(
    (migration) => migration.tag === baselineTag,
  );
  if (baseline === undefined) throw new Error(`baseline ${baselineTag} not on disk for ${lineage}`);
  for (const statement of baseline.statements) database.exec(statement);
  database.exec(CREATE_MIGRATIONS_TABLE);
  for (const tag of legacyTags) {
    database
      .prepare("INSERT INTO _migrations (tag, applied_at) VALUES (?, ?)")
      .run(tag, "2026-07-01T00:00:00.000Z");
  }
  return database;
}

function appliedLedger(database: DatabaseSync): string[] {
  return (
    database.prepare("SELECT tag FROM _migrations ORDER BY tag").all() as { tag: string }[]
  ).map((row) => row.tag);
}

for (const lineage of ["per-firm", "control-plane"] as const) {
  describe(`legacy-baseline reconciliation (${lineage})`, () => {
    const { baselineTag, legacyTags } = legacyBaselineFor(lineage);
    const migrations = loadMigrationsFromDisk(lineage);
    const journalTags = migrations.map((migration) => migration.tag).toSorted();

    it("rewrites the full retired ledger to the baseline and applies the chain to head", async () => {
      const database = preCollapseDatabase(lineage);
      const report = await runPendingMigrations(nodeSqliteMigrationTarget(database), migrations);

      expect(report.reconciledToBaseline).toBe(baselineTag);
      expect(report.skippedTags).toEqual([baselineTag]); // schema was never re-run
      expect(report.appliedTags).toEqual(
        migrations.map((migration) => migration.tag).filter((tag) => tag !== baselineTag),
      );
      expect(appliedLedger(database)).toEqual(journalTags); // ledger now exactly the journal — no retired ids left
    });

    it("reconciling is a one-time event — the next run is an ordinary no-op", async () => {
      const database = preCollapseDatabase(lineage);
      const target = nodeSqliteMigrationTarget(database);
      await runPendingMigrations(target, migrations);
      const second = await runPendingMigrations(target, migrations);

      expect(second.reconciledToBaseline).toBeNull();
      expect(second.appliedTags).toEqual([]);
      expect(second.skippedTags.length).toBe(migrations.length);
      expect(appliedLedger(database)).toEqual(journalTags);
    });

    it("a strict prefix of the retired chain refuses AS STRANDED — not as a stale deploy", async () => {
      const database = new DatabaseSync(":memory:");
      database.exec(CREATE_MIGRATIONS_TABLE);
      for (const tag of legacyTags.slice(0, 3)) {
        database
          .prepare("INSERT INTO _migrations (tag, applied_at) VALUES (?, ?)")
          .run(tag, "2026-07-01T00:00:00.000Z");
      }
      // The schema stops short of the baseline and the SQL that would carry it the rest of the way
      // was retired by the collapse, so this is a database that is BEHIND with no path forward. The
      // wording matters more than the throw: told "code older than schema", whoever is holding the
      // outage goes looking for a rollback that cannot help.
      await expect(
        runPendingMigrations(nodeSqliteMigrationTarget(database), migrations),
      ).rejects.toThrow(/was retired into baseline .* needs a human/su);
      await expect(
        runPendingMigrations(nodeSqliteMigrationTarget(database), migrations),
      ).rejects.not.toThrow(/deploy mismatch/);
      expect(appliedLedger(database)).toEqual(legacyTags.slice(0, 3).toSorted()); // ledger untouched
    });
  });
}

describe("legacy-baseline reconciliation (guard rails)", () => {
  const perFirmMigrations = loadMigrationsFromDisk("per-firm");

  it("a genuinely unknown tag still refuses with the existing message", async () => {
    const database = new DatabaseSync(":memory:");
    database.exec(CREATE_MIGRATIONS_TABLE);
    database
      .prepare("INSERT INTO _migrations (tag, applied_at) VALUES (?, ?)")
      .run("20990101T000000_from_the_future", "2099-01-01T00:00:00.000Z");
    await expect(
      runPendingMigrations(nodeSqliteMigrationTarget(database), perFirmMigrations),
    ).rejects.toThrow(
      'database has applied migration "20990101T000000_from_the_future" which this code does not know — deploy mismatch (code older than schema)',
    );
  });

  it("the retired chain plus one unknown extra is not a legacy ledger — refuses", async () => {
    const database = new DatabaseSync(":memory:");
    database.exec(CREATE_MIGRATIONS_TABLE);
    const { legacyTags } = LEGACY_BASELINES.find((entry) => entry.lineage === "per-firm")!;
    for (const tag of [...legacyTags, "20990101T000000_from_the_future"]) {
      database
        .prepare("INSERT INTO _migrations (tag, applied_at) VALUES (?, ?)")
        .run(tag, "2026-07-01T00:00:00.000Z");
    }
    // The retired tags sort ahead of the future one, so the retired-chain sentence is what this
    // answers with — correctly: the ledger is not the complete chain, whatever else is in it.
    await expect(
      runPendingMigrations(nodeSqliteMigrationTarget(database), perFirmMigrations),
    ).rejects.toThrow(/was retired into baseline/u);
  });

  it("a fresh database never enters the reconciliation path", async () => {
    const database = new DatabaseSync(":memory:");
    const report = await runPendingMigrations(
      nodeSqliteMigrationTarget(database),
      perFirmMigrations,
    );
    expect(report.reconciledToBaseline).toBeNull();
    expect(report.appliedTags).toEqual(perFirmMigrations.map((migration) => migration.tag));
    expect(appliedLedger(database)).toEqual(
      perFirmMigrations.map((migration) => migration.tag).toSorted(),
    );
  });

  it("reconciling can only ever hop ONCE — no collapse retires a single migration", () => {
    // The loop this replaced could not fire twice and said in a comment that it walked history
    // forward. It cannot: reconciling leaves the ledger holding exactly one tag, so a second hop
    // would need an entry whose retired chain is one migration long. A collapse retires the
    // previous baseline PLUS everything appended after it, so that shape does not occur — asserted
    // here rather than left as reasoning, because a future entry that broke it would silently
    // reintroduce the stranded-ledger case the runner now reports by name.
    for (const entry of LEGACY_BASELINES) {
      expect(entry.legacyTags.length, entry.baselineTag).toBeGreaterThan(1);
    }
  });

  it("findLegacyBaseline matches only when the code also carries the baseline", () => {
    // Read from the entry rather than written as a literal: a collapse retires the tag the previous
    // one replaced, so a literal here would name a baseline that no longer exists the next time.
    const entry = LEGACY_BASELINES.find((candidate) => candidate.lineage === "per-firm")!;
    const applied = new Set(entry.legacyTags);
    expect(
      findLegacyBaseline(applied, new Set(["20990101T000000_something-else"])),
    ).toBeUndefined();
    expect(findLegacyBaseline(applied, new Set([entry.baselineTag]))?.lineage).toBe("per-firm");
  });
});
