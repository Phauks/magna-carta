import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseMigrationStateFor } from "../src/firm-database/firm-database-proxy.ts";
import { seedFirm } from "./support/test-auth.ts";

/*
 * The restore point a migration leaves behind.
 *
 * The lineage runs only forwards, so a migration that FAILS needs no undo — workerd rolls the whole
 * context back and the database is exactly as it was. The case this exists for is the other one: a
 * migration that succeeds and turns out to be wrong, which had no way back at all. A bookmark taken
 * before the batch names the instant to restore to, and keeping it beside the ledger is what turns
 * "put this firm back to before that deploy" into a value somebody can read off the panel.
 */
let firmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Restore Point Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
});

describe("the restore point beside a firm's migration ledger", () => {
  it("names the instant before the batch that just ran, and the migrations it applied", async () => {
    // Waking a fresh firm database applies the whole lineage, which is a batch like any other.
    const state = await firmDatabaseMigrationStateFor(env.FIRM_DATABASE, firmId);

    expect(state.fault).toBeNull();
    expect(state.appliedCount).toBeGreaterThan(0);

    const restorePoint = state.restorePoint;
    expect(restorePoint, "a firm that just migrated has somewhere to go back to").not.toBeNull();
    // A bookmark is opaque, so what is asserted is that a real one was taken rather than its shape.
    expect(restorePoint?.bookmark.length ?? 0).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(restorePoint?.takenAt ?? ""))).toBe(false);
    // It says WHAT it is a restore point for. A bookmark with no tags beside it would leave a
    // reader to guess which deploy it precedes.
    expect(restorePoint?.appliedTags.length ?? 0).toBe(state.appliedCount);
  });

  it("is stable across reads, so it names one instant rather than the latest one", async () => {
    // Read twice with no migration in between: a restore point that moved on every read would be a
    // bookmark for "now", which restores nothing.
    const first = await firmDatabaseMigrationStateFor(env.FIRM_DATABASE, firmId);
    const second = await firmDatabaseMigrationStateFor(env.FIRM_DATABASE, firmId);
    expect(second.restorePoint?.bookmark).toBe(first.restorePoint?.bookmark);
    expect(second.restorePoint?.takenAt).toBe(first.restorePoint?.takenAt);
  });
});
