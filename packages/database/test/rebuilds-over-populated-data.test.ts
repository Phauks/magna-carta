import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyMigrations, loadMigrationsFromDisk } from "../src/node-sqlite.ts";
import { REVIEWED_REBUILDS } from "../src/reviewed-rebuilds.ts";

/*
 * EVERY REVIEWED REBUILD, RUN OVER A DATABASE THAT ALREADY HOLDS ROWS.
 *
 * Nothing else in this repository does. `createMigratedNodeDatabase` migrates an EMPTY database and
 * seeds afterwards, and the fixtures harness and the load-profile suites all build on it, so the
 * whole lineage is only ever applied to nothing. Two outages in one day came through that gap, and
 * both were the same shape: a rebuild that cannot survive contact with real data, passing every test
 * because no test had any.
 *
 * A rebuild is the one migration shape where an empty database is not a weaker case but a DIFFERENT
 * one. It drops the table it is replacing, and DROP TABLE on a parent fires a foreign-key violation
 * for every child row — of which an empty database has none. So the fixture that matters is not
 * volume; it is a single row in the table being rebuilt and a single row pointing at it.
 *
 * Each case below is exactly that, at the schema of the moment: seed the parent, seed one child,
 * apply the rest of the lineage, and require that it completes, that nothing is left dangling, and
 * that the child still resolves to the row it resolved to before. The last one is what makes this
 * more than a smoke test — a rebuild that silently re-keyed its rows would still "pass" a migration
 * that merely completed.
 *
 * REVIEWED_REBUILDS is the list of migrations that do this, and the pairing is asserted at the
 * bottom: a rebuild added without a case here fails, so the coverage cannot quietly fall behind the
 * thing it covers.
 */
const NOW = "2026-09-06T12:00:00.000Z";

interface RebuildCase {
  /** The migration, and the lineage it belongs to. */
  readonly lineage: "per-firm" | "control-plane";
  /** The table it rebuilds, and one table that points at it. */
  readonly rebuilt: string;
  readonly child: string;
  /** Rows at the schema of the moment: the parent, its own ancestors, and one child. */
  seed(raw: DatabaseSync): void;
  /**
   * How many children resolve to a parent that is really there — asked before the rebuild and
   * again after. Two functions rather than one because a rebuild may RETIRE the child table it is
   * asked about (the note revisions collapse into the note), and the question then has to be put a
   * different way on each side while still being the same question about the same row.
   */
  childrenAtSeed(raw: DatabaseSync): number;
  childrenAfterRebuild(raw: DatabaseSync): number;
}

function countJoin(raw: DatabaseSync, sql: string): number {
  return (raw.prepare(sql).get() as { n: number }).n;
}

const REBUILD_CASES: Record<string, RebuildCase> = {
  "20260829T101500_firmless-account": {
    lineage: "control-plane",
    rebuilt: "user",
    child: "account",
    seed(raw) {
      raw
        .prepare("INSERT INTO firm (id, name, created_at) VALUES (?, 'Seeded Firm', ?)")
        .run("firm_seed", NOW);
      raw
        .prepare("INSERT INTO user (id, name, email, firm_id) VALUES (?, 'Seeded Person', ?, ?)")
        .run("user_seed", "seeded@example.com", "firm_seed");
      raw
        .prepare(
          `INSERT INTO account (id, account_id, provider_id, user_id, updated_at)
           VALUES (?, ?, 'credential', ?, ?)`,
        )
        .run("account_seed", "seeded@example.com", "user_seed", 1_757_000_000_000);
    },
    childrenAtSeed: countAccounts,
    childrenAfterRebuild: countAccounts,
  },
};

function countAccounts(raw: DatabaseSync): number {
  return countJoin(raw, "SELECT COUNT(*) AS n FROM account JOIN user ON user.id = account.user_id");
}

describe("every reviewed rebuild, applied to a database that already holds rows", () => {
  for (const [tag, rebuild] of Object.entries(REBUILD_CASES)) {
    it(`${tag} carries its ${rebuild.rebuilt} rows across, and what points at them`, () => {
      const migrations = loadMigrationsFromDisk(rebuild.lineage);
      const at = migrations.findIndex((migration) => migration.tag === tag);
      expect(at, `${tag} is no longer in the ${rebuild.lineage} lineage`).toBeGreaterThan(0);

      const raw = new DatabaseSync(":memory:");
      applyMigrations(raw, migrations.slice(0, at));
      rebuild.seed(raw);
      expect(rebuild.childrenAtSeed(raw)).toBe(1);

      // The rest of the lineage, not just this migration: a rebuild that breaks something for a
      // LATER migration is the same outage, and stopping at this one would not see it.
      expect(() => applyMigrations(raw, migrations.slice(at))).not.toThrow();

      // Completing is not enough. Nothing dangling, and the child still resolves to a row that is
      // really there — a rebuild that re-keyed its rows would complete and lose every reference.
      expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(rebuild.childrenAfterRebuild(raw)).toBe(1);
    });
  }

  it("covers every reviewed rebuild, so the coverage cannot fall behind the list", () => {
    // The pairing is the point. A rebuild is added to REVIEWED_REBUILDS by someone who has audited
    // the copy by reading it; this requires that it also be run over rows before it ships.
    expect(Object.keys(REBUILD_CASES).toSorted()).toEqual([...REVIEWED_REBUILDS].toSorted());
  });
});
