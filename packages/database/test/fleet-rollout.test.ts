import { describe, expect, it } from "vitest";
import type { Migration } from "../src/migration.ts";
import type { MigrationTarget } from "../src/migration-runner.ts";
import { rolloutMigrationsAcrossFleet, type FirmMigrationState } from "../src/fleet-rollout.ts";

const MIGRATIONS: Migration[] = [
  { tag: "0000_first", statements: ["CREATE TABLE a (id text);"] },
  { tag: "0001_second", statements: ["ALTER TABLE a ADD col text;"] },
];

function fleetFixture(states: { firmId: string; applied: string[]; fail?: boolean }[]) {
  const firms: FirmMigrationState[] = states.map((state) => ({
    firmId: state.firmId as FirmMigrationState["firmId"],
    schemaVersion: state.applied.at(-1) ?? null,
  }));
  const appliedByFirm = new Map(states.map((state) => [state.firmId, [...state.applied]]));
  const registryWrites: { firmId: string; tag: string }[] = [];
  const targetForFirm = (firmId: string): MigrationTarget => ({
    appliedMigrationTags: () => Promise.resolve([...(appliedByFirm.get(firmId) ?? [])]),
    applyMigration: (migration) => {
      if (states.find((state) => state.firmId === firmId)?.fail) {
        return Promise.reject(new Error(`quarantine ${firmId}`));
      }
      appliedByFirm.get(firmId)?.push(migration.tag);
      return Promise.resolve();
    },
  });
  return { firms, appliedByFirm, registryWrites, targetForFirm };
}

describe("rolloutMigrationsAcrossFleet", () => {
  it("migrates firms below target, skips current firms, and mirrors the registry version", async () => {
    const fleet = fleetFixture([
      { firmId: "firm_aaa", applied: [] },
      { firmId: "firm_bbb", applied: ["0000_first"] },
      { firmId: "firm_ccc", applied: ["0000_first", "0001_second"] }, // already current
    ]);
    const report = await rolloutMigrationsAcrossFleet({
      firms: fleet.firms,
      migrations: MIGRATIONS,
      targetForFirm: (firmId) => fleet.targetForFirm(firmId),
      recordFirmSchemaVersion: (firmId, tag) => {
        fleet.registryWrites.push({ firmId, tag });
        return Promise.resolve();
      },
    });
    expect(report.migratedFirms.map((entry) => entry.firmId)).toEqual(["firm_aaa", "firm_bbb"]);
    expect(report.currentFirms).toEqual(["firm_ccc"]);
    expect(fleet.appliedByFirm.get("firm_aaa")).toEqual(["0000_first", "0001_second"]);
    // registry mirror written once per migrated firm, with the latest tag
    expect(fleet.registryWrites).toContainEqual({ firmId: "firm_aaa", tag: "0001_second" });
    expect(fleet.registryWrites).toContainEqual({ firmId: "firm_bbb", tag: "0001_second" });
  });

  it("quarantines a failing firm and continues the fleet (failure isolation)", async () => {
    const fleet = fleetFixture([
      { firmId: "firm_bad", applied: [], fail: true },
      { firmId: "firm_good", applied: [] },
    ]);
    const report = await rolloutMigrationsAcrossFleet({
      firms: fleet.firms,
      migrations: MIGRATIONS,
      targetForFirm: (firmId) => fleet.targetForFirm(firmId),
      recordFirmSchemaVersion: () => Promise.resolve(),
    });
    expect(report.failedFirms.map((entry) => entry.firmId)).toEqual(["firm_bad"]);
    expect(report.failedFirms[0]?.error).toBeInstanceOf(Error);
    expect(report.migratedFirms.map((entry) => entry.firmId)).toEqual(["firm_good"]);
  });

  it("re-running after a partial failure is idempotent: current firms skipped, failed firm retries", async () => {
    const fleet = fleetFixture([
      { firmId: "firm_good", applied: ["0000_first", "0001_second"] },
      { firmId: "firm_was_bad", applied: [] },
    ]);
    const report = await rolloutMigrationsAcrossFleet({
      firms: fleet.firms,
      migrations: MIGRATIONS,
      targetForFirm: (firmId) => fleet.targetForFirm(firmId),
      recordFirmSchemaVersion: () => Promise.resolve(),
    });
    expect(report.currentFirms).toEqual(["firm_good"]);
    expect(report.migratedFirms.map((entry) => entry.firmId)).toEqual(["firm_was_bad"]);
  });

  it("bounds concurrency: never more than `concurrency` firms migrating at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const states = ["firm_a", "firm_b", "firm_c", "firm_d", "firm_e"].map((firmId) => ({
      firmId,
      applied: [] as string[],
    }));
    const fleet = fleetFixture(states);
    await rolloutMigrationsAcrossFleet({
      firms: fleet.firms,
      migrations: [MIGRATIONS[0] as Migration],
      concurrency: 2,
      targetForFirm: (firmId) => {
        const inner = fleet.targetForFirm(firmId);
        return {
          appliedMigrationTags: () => inner.appliedMigrationTags(),
          applyMigration: async (migration) => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 1));
            inFlight--;
            return inner.applyMigration(migration);
          },
        };
      },
      recordFirmSchemaVersion: () => Promise.resolve(),
    });
    expect(peak).toBeLessThanOrEqual(2);
  });
});
