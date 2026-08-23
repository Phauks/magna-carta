import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { doSqliteMigrationTarget } from "@magna-carta/database/do-sqlite-migration-target";
import { runPendingMigrations } from "@magna-carta/database/migration-runner";
import type { Migration } from "@magna-carta/database/migration";
import type { FirmDatabase } from "../../src/firm-database/firm-database-object.ts";
import { perFirmMigrations } from "../../src/per-firm-migrations.ts";

// A migration that fails partway must leave NO trace: the applied-tag ledger must not record it and
// no partial table from an earlier statement may leak (transactionSync rolls the whole migration
// back). A re-run with the migration fixed must then resume and apply it. This drives the real
// migration machinery (doSqliteMigrationTarget + runPendingMigrations) against a real FirmDatabase
// Durable Object's storage.

const PROBE_TAG = "9999_migration_partial_probe";
const PROBE_TABLE = "migration_partial_probe";

// First statement creates a table; the second references a table that does not exist, so the whole
// migration throws AFTER the table-create — the rollback must undo the create too.
const brokenMigration: Migration = {
  tag: PROBE_TAG,
  statements: [
    `CREATE TABLE ${PROBE_TABLE} (id TEXT PRIMARY KEY)`,
    "INSERT INTO a_table_that_does_not_exist (id) VALUES ('boom')",
  ],
};

const fixedMigration: Migration = {
  tag: PROBE_TAG,
  statements: [`CREATE TABLE ${PROBE_TABLE} (id TEXT PRIMARY KEY)`],
};

function tableExists(state: DurableObjectState, name: string): boolean {
  const row = state.storage.sql
    .exec("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name = ?1", name)
    .one() as { c: number };
  return Number(row.c) > 0;
}

function migrationRecorded(state: DurableObjectState, tag: string): boolean {
  const row = state.storage.sql
    .exec("SELECT count(*) AS c FROM _migrations WHERE tag = ?1", tag)
    .one() as { c: number };
  return Number(row.c) > 0;
}

describe("FirmDatabase migration partial failure", () => {
  it("rolls a failing migration fully back (no tag, no partial table), then resumes when fixed", async () => {
    const stub = env.FIRM_DATABASE.get(env.FIRM_DATABASE.idFromName("migration_partial_firm"));

    // Phase 1 — the broken migration: runPendingMigrations must throw, and afterwards the tag is
    // absent and the partial table did not leak.
    const afterFailure = await runInDurableObject(
      stub,
      async (_instance: FirmDatabase, state: DurableObjectState) => {
        const target = doSqliteMigrationTarget(state.storage);
        let threw = false;
        try {
          await runPendingMigrations(target, [...perFirmMigrations(), brokenMigration]);
        } catch {
          threw = true;
        }
        return {
          threw,
          tagRecorded: migrationRecorded(state, PROBE_TAG),
          tableLeaked: tableExists(state, PROBE_TABLE),
        };
      },
    );
    expect(afterFailure.threw).toBe(true);
    expect(afterFailure.tagRecorded).toBe(false);
    expect(afterFailure.tableLeaked).toBe(false);

    // Phase 2 — the fixed migration resumes against the SAME storage: the earlier real lineage is
    // already applied (skipped), and the now-valid probe migration applies cleanly.
    const afterFix = await runInDurableObject(
      stub,
      async (_instance: FirmDatabase, state: DurableObjectState) => {
        const target = doSqliteMigrationTarget(state.storage);
        const report = await runPendingMigrations(target, [...perFirmMigrations(), fixedMigration]);
        return {
          appliedTags: report.appliedTags,
          tagRecorded: migrationRecorded(state, PROBE_TAG),
          tableExists: tableExists(state, PROBE_TABLE),
        };
      },
    );
    expect(afterFix.appliedTags).toEqual([PROBE_TAG]);
    expect(afterFix.tagRecorded).toBe(true);
    expect(afterFix.tableExists).toBe(true);
  });
});
