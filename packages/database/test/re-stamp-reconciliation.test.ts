import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { runPendingMigrations, type MigrationTarget } from "../src/migration-runner.ts";
import { loadMigrationsFromDisk } from "../src/node-sqlite.ts";
import { RE_STAMPED_MIGRATIONS } from "../src/re-stamped-migrations.ts";

// On 2026-09-15 two per-firm migrations were re-stamped on `main` to repair an inverted apply order,
// on the premise that no database had applied either id. One had, and refused to wake from the
// moment the rename deployed — the ledger records the TAG, so it named two migrations the lineage no
// longer contained. These tests build that database and prove the runner rewrites those two rows and
// carries on, while every shape that is NOT a re-stamp still refuses.

const CREATE_MIGRATIONS_TABLE =
  "CREATE TABLE IF NOT EXISTS _migrations (tag TEXT PRIMARY KEY, applied_at TEXT NOT NULL)";

const APPLIED_AT = "2026-09-14T00:00:00.000Z";

// MigrationTarget over node:sqlite, mirroring the real adapters: same _migrations ledger, each write
// one transaction. The primary key on `tag` is the part that matters here — it is why a rewrite onto
// an id the ledger already holds cannot be expressed, and why the runner refuses that shape instead.
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

function appliedLedger(database: DatabaseSync): string[] {
  return (
    database.prepare("SELECT tag FROM _migrations ORDER BY tag").all() as { tag: string }[]
  ).map((row) => row.tag);
}

const PER_FIRM = RE_STAMPED_MIGRATIONS.filter((entry) => entry.lineage === "per-firm");

describe("the re-stamp registry describes the lineage on disk", () => {
  const journalTags = new Set(loadMigrationsFromDisk("per-firm").map((migration) => migration.tag));

  it("records the 2026-09-15 rename, which is the reason the registry exists", () => {
    expect(PER_FIRM.map((entry) => entry.supersededTag)).toEqual([
      "20260911T000000_office-email-address-lines-and-firm-brand-images",
      "20260914T090000_event-conference-link",
    ]);
  });

  it("every replacement tag is a migration this lineage actually carries", () => {
    // Without this the runner would rewrite a ledger row to an id it has no SQL for, stranding the
    // database one step further along than it found it.
    for (const entry of PER_FIRM) expect(journalTags.has(entry.replacementTag)).toBe(true);
  });

  it("no superseded tag is still in the lineage", () => {
    // A tag that is both retired and present is not a re-stamp; it would mean the rename never
    // happened, and reconciling a ledger away from a live migration would skip it.
    for (const entry of PER_FIRM) expect(journalTags.has(entry.supersededTag)).toBe(false);
  });

  it("no tag is re-stamped twice, in either direction", () => {
    // One hop only. A tag that is some entry's replacement and another's superseded id would need
    // the rewrites ordered, and the runner performs them independently.
    const superseded = PER_FIRM.map((entry) => entry.supersededTag);
    const replacements = PER_FIRM.map((entry) => entry.replacementTag);
    expect(new Set(superseded).size).toBe(superseded.length);
    expect(new Set(replacements).size).toBe(replacements.length);
    expect(replacements.filter((tag) => superseded.includes(tag))).toEqual([]);
  });
});

// The production shape: the schema the lineage produces, with the two re-stamped rows in the ledger
// still under the ids this database applied them by. `upTo` stops the ledger where the database
// stopped — the head of what had deployed when the rename landed.
function databaseWithSupersededLedger(upTo?: string): DatabaseSync {
  const migrations = loadMigrationsFromDisk("per-firm");
  const database = new DatabaseSync(":memory:");
  database.exec(CREATE_MIGRATIONS_TABLE);
  const supersededFor = new Map(
    PER_FIRM.map((entry) => [entry.replacementTag, entry.supersededTag]),
  );
  for (const migration of migrations) {
    for (const statement of migration.statements) database.exec(statement);
    database
      .prepare("INSERT INTO _migrations (tag, applied_at) VALUES (?, ?)")
      .run(supersededFor.get(migration.tag) ?? migration.tag, APPLIED_AT);
    if (migration.tag === upTo) break;
  }
  return database;
}

describe("re-stamp reconciliation (per-firm)", () => {
  const migrations = loadMigrationsFromDisk("per-firm");
  const journalTags = migrations.map((migration) => migration.tag).toSorted();
  const lastReStamped = PER_FIRM[PER_FIRM.length - 1]?.replacementTag ?? "";

  it("rewrites both retired ids and runs no schema SQL to do it", async () => {
    const database = databaseWithSupersededLedger();
    const report = await runPendingMigrations(nodeSqliteMigrationTarget(database), migrations);

    expect(report.reStampedTags).toEqual(PER_FIRM.map((entry) => entry.replacementTag));
    expect(report.appliedTags).toEqual([]); // nothing re-run: the schema was already there
    expect(report.skippedTags).toEqual(migrations.map((migration) => migration.tag));
    expect(appliedLedger(database)).toEqual(journalTags); // no retired id left in the ledger
  });

  it("reconciles a database that stopped at the rename, then applies the tail it never saw", async () => {
    // The real outage: the firm applied the two under their old ids, the rename deployed, and every
    // migration after it has been blocked since.
    const database = databaseWithSupersededLedger(lastReStamped);
    const pending = migrations
      .map((migration) => migration.tag)
      .filter((tag) => tag > lastReStamped);
    const report = await runPendingMigrations(nodeSqliteMigrationTarget(database), migrations);

    expect(report.reStampedTags).toEqual(PER_FIRM.map((entry) => entry.replacementTag));
    expect(report.appliedTags).toEqual(pending);
    expect(appliedLedger(database)).toEqual(journalTags);
  });

  it("is a one-time event — the next wake is an ordinary no-op", async () => {
    const database = databaseWithSupersededLedger();
    const target = nodeSqliteMigrationTarget(database);
    await runPendingMigrations(target, migrations);
    const second = await runPendingMigrations(target, migrations);

    expect(second.reStampedTags).toEqual([]);
    expect(second.appliedTags).toEqual([]);
    expect(appliedLedger(database)).toEqual(journalTags);
  });

  it("reports nothing on a database that never held a retired id", async () => {
    const database = new DatabaseSync(":memory:");
    const report = await runPendingMigrations(nodeSqliteMigrationTarget(database), migrations);

    expect(report.reStampedTags).toEqual([]);
    expect(report.appliedTags).toEqual(migrations.map((migration) => migration.tag));
  });

  it("measures the ledger head after the rewrite, so the retired id is not read as the head", async () => {
    // A retired id sorts where its old tag put it, which is the inversion the rename existed to fix.
    // Measuring before the rewrite would report the migrations after it as arriving out of order.
    const database = databaseWithSupersededLedger();
    const report = await runPendingMigrations(nodeSqliteMigrationTarget(database), migrations);

    expect(report.outOfOrderTags).toEqual([]);
    expect(report.ledgerHead).toBe(journalTags[journalTags.length - 1]);
  });
});

describe("what re-stamp reconciliation refuses", () => {
  const entry = PER_FIRM[0];
  if (entry === undefined) throw new Error("no per-firm re-stamp recorded");

  it("names the rename when this code is older than it, instead of blaming the schema", async () => {
    // The pre-rename deployment: it carries the OLD tag and knows nothing of the new one. Reading
    // this as "code older than schema" sends whoever is holding the outage looking for a schema
    // change nobody made — the SQL is identical on both sides of a rename.
    const database = new DatabaseSync(":memory:");
    database.exec(CREATE_MIGRATIONS_TABLE);
    database
      .prepare("INSERT INTO _migrations (tag, applied_at) VALUES (?, ?)")
      .run(entry.supersededTag, APPLIED_AT);
    const beforeTheRename = loadMigrationsFromDisk("per-firm").filter(
      (migration) => migration.tag !== entry.replacementTag,
    );

    await expect(
      runPendingMigrations(nodeSqliteMigrationTarget(database), beforeTheRename),
    ).rejects.toThrow(/was re-stamped to .* older than the rename/su);
    expect(appliedLedger(database)).toEqual([entry.supersededTag]); // ledger untouched
  });

  it("refuses a ledger holding both ids of one re-stamp, before rewriting anything", async () => {
    const database = new DatabaseSync(":memory:");
    database.exec(CREATE_MIGRATIONS_TABLE);
    for (const tag of [entry.supersededTag, entry.replacementTag]) {
      database
        .prepare("INSERT INTO _migrations (tag, applied_at) VALUES (?, ?)")
        .run(tag, APPLIED_AT);
    }

    await expect(
      runPendingMigrations(nodeSqliteMigrationTarget(database), loadMigrationsFromDisk("per-firm")),
    ).rejects.toThrow(/applied both ids of a re-stamped migration/u);
    expect(appliedLedger(database)).toContain(entry.supersededTag); // nothing rewritten
  });

  it("still refuses a genuinely unknown tag as a deploy mismatch", async () => {
    const database = new DatabaseSync(":memory:");
    database.exec(CREATE_MIGRATIONS_TABLE);
    database
      .prepare("INSERT INTO _migrations (tag, applied_at) VALUES (?, ?)")
      .run("29990101T000000_from-the-future", APPLIED_AT);

    await expect(
      runPendingMigrations(nodeSqliteMigrationTarget(database), loadMigrationsFromDisk("per-firm")),
    ).rejects.toThrow(/which this code does not know/u);
  });
});
