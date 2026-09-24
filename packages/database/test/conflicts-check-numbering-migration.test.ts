import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyMigrations, loadMigrationsFromDisk } from "../src/node-sqlite.ts";

/*
 * THE CONFLICTS CHECK NUMBERING MIGRATION, RUN OVER A DATABASE THAT ALREADY HOLDS CHECKS.
 *
 * Two things about it are invisible against an empty database. The seed of the firm-wide counter
 * is an aggregate over the numbered checks, and an aggregate over zero rows still yields one row —
 * a first draft of this migration seeded every empty firm with a counter at 1, which the shared
 * planner then read as "the firm's own start value" and rendered CONF-001 for a scheme starting at
 * 100. And the unique index on check_sequence has to be GONE, because a sequence restarting per
 * year draws a 1 twice, which no empty database can demonstrate.
 *
 * So: seed two numbered checks at the old schema, apply the rest of the lineage, and require that
 * the firm-wide counter stands past them, that two checks can now share a sequence value, and that
 * a database with no checks gets no counter row at all.
 */
const TAG = "20260918T195508_conflicts-check-numbering-scheme";
const NOW = "2026-09-11T12:00:00.000Z";

function seedChecksThroughTheOldSchema(raw: DatabaseSync): void {
  const insert = raw.prepare(
    `INSERT INTO conflicts_numbered_check
       (id, check_sequence, check_number, subject_matter_id, latest_run_id, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, NULL, ?, ?)`,
  );
  insert.run(
    "conflictsCheck_one0000000000000",
    1,
    "CC-0001",
    "conflictsCheck_one0000000000000",
    NOW,
    NOW,
  );
  insert.run(
    "conflictsCheck_two0000000000000",
    2,
    "CC-0002",
    "conflictsCheck_two0000000000000",
    NOW,
    NOW,
  );
}

describe("the conflicts check numbering migration, over rows", () => {
  const migrations = loadMigrationsFromDisk("per-firm");
  const at = migrations.findIndex((migration) => migration.tag === TAG);

  it("is in the lineage (guards the split itself)", () => {
    expect(at).toBeGreaterThan(0);
  });

  it("seeds the firm-wide counter past the checks already numbered, and frees the sequence to restart", () => {
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, migrations.slice(0, at));
    seedChecksThroughTheOldSchema(raw);

    expect(() => applyMigrations(raw, migrations.slice(at))).not.toThrow();

    const counter = raw
      .prepare("SELECT next_value FROM conflicts_check_number_counter WHERE scope_key = ''")
      .get() as { next_value: number } | undefined;
    expect(counter?.next_value).toBe(3);

    // The old numbers are exactly what they were.
    const numbers = raw
      .prepare("SELECT check_number FROM conflicts_numbered_check ORDER BY check_sequence")
      .all() as { check_number: string }[];
    expect(numbers.map((row) => row.check_number)).toEqual(["CC-0001", "CC-0002"]);

    // A per-year scheme draws a 1 in 2027 as it did in 2026: the sequence is unique only with its
    // scope now, and the rendered number is what stays unique on its own.
    expect(() =>
      raw
        .prepare(
          `INSERT INTO conflicts_numbered_check
             (id, check_sequence, check_number, subject_matter_id, latest_run_id, created_by_user_id, created_at, updated_at)
           VALUES ('conflictsCheck_three00000000000', 1, 'CC2027-00001', NULL, 'conflictsCheck_three00000000000', NULL, ?, ?)`,
        )
        .run(NOW, NOW),
    ).not.toThrow();
    expect(() =>
      raw
        .prepare(
          `INSERT INTO conflicts_numbered_check
             (id, check_sequence, check_number, subject_matter_id, latest_run_id, created_by_user_id, created_at, updated_at)
           VALUES ('conflictsCheck_four000000000000', 4, 'CC-0001', NULL, 'conflictsCheck_four000000000000', NULL, ?, ?)`,
        )
        .run(NOW, NOW),
    ).toThrow(/UNIQUE/);
  });

  it("seeds nothing for a firm that has never opened a check", () => {
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, migrations.slice(0, at));
    expect(() => applyMigrations(raw, migrations.slice(at))).not.toThrow();
    const rows = raw.prepare("SELECT COUNT(*) AS n FROM conflicts_check_number_counter").get() as {
      n: number;
    };
    expect(rows.n).toBe(0);
  });
});
