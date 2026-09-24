import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyMigrations, loadMigrationsFromDisk } from "../src/node-sqlite.ts";

/*
 * THE CALL AND TEXT COUNTER RE-KEY, RUN OVER A DATABASE THAT ALREADY HOLDS COUNTERS.
 *
 * An UPDATE that rewrites a key is indistinguishable from a correct one against an empty table, and
 * getting it wrong is not a cosmetic fault: a counter row the draw can no longer find restarts the
 * day's count at 1 and issues a reference number the firm has already said out loud. So seed the
 * counters at the old key, apply the rest of the lineage, and require that every row moved to the
 * key the scheme's scoping parts now derive, with its value intact.
 */
const TAG = "20260924T183850_communication-number-scope-parts";

describe("the call and text counter re-key, over rows", () => {
  const migrations = loadMigrationsFromDisk("per-firm");
  const at = migrations.findIndex((migration) => migration.tag === TAG);

  it("is in the lineage (guards the split itself)", () => {
    expect(at).toBeGreaterThan(0);
  });

  it("moves each day's counter to the key the scoping parts derive, keeping its value", () => {
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, migrations.slice(0, at));
    const insert = raw.prepare(
      "INSERT INTO communication_number_counter (scope_key, next_value) VALUES (?, ?)",
    );
    insert.run("2026-09-08", 43);
    insert.run("2026-12-31", 2);

    expect(() => applyMigrations(raw, migrations.slice(at))).not.toThrow();

    const rows = raw
      .prepare("SELECT scope_key, next_value FROM communication_number_counter ORDER BY scope_key")
      .all() as { scope_key: string; next_value: number }[];
    expect(rows).toEqual([
      { scope_key: "2026:09:08", next_value: 43 },
      { scope_key: "2026:12:31", next_value: 2 },
    ]);
  });

  it("leaves a firm that has recorded no call with no counter at all", () => {
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, migrations.slice(0, at));
    expect(() => applyMigrations(raw, migrations.slice(at))).not.toThrow();
    const count = raw.prepare("SELECT COUNT(*) AS n FROM communication_number_counter").get() as {
      n: number;
    };
    expect(count.n).toBe(0);
  });
});
