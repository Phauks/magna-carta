import { afterAll, describe, expect, it } from "vitest";
import { ledgerVolume, scaleProfile } from "./profile.ts";
import { findFullScans } from "./runner.ts";
import { loadProfileSnapshot, type LoadedSnapshot } from "./snapshot.ts";
import {
  timekeepingHotPathPlans,
  TIMEKEEPING_PLAN_SCAN_ALLOWLIST,
} from "./timekeeping-measurements.ts";

// A CI-smoke-scale snapshot (the smallest multiplier the floors allow), generated through the REAL
// capture/commit + rate-append write path — so the time volume is valid by construction. The plan-scan
// guard then asserts every timekeeping hot read walks an index, never a full table scan, at volume.
const SMOKE_SEED = "timekeeping-measurements-smoke";
const SMOKE_PROFILE = scaleProfile(ledgerVolume, 0.01);

let snapshot: LoadedSnapshot;

afterAll(() => {
  snapshot?.close();
});

describe("timekeeping hot reads are index-served at volume", () => {
  it("lays down the time volume through the real path and plans every hot read free of a full scan", async () => {
    snapshot = await loadProfileSnapshot(SMOKE_PROFILE, SMOKE_SEED, { allowSeeding: true });

    // Non-vacuity: the generator actually produced time entries and rates.
    expect(snapshot.manifest.timeEntryCount).toBeGreaterThan(0);
    expect(snapshot.manifest.rateCount).toBeGreaterThan(0);

    const scans = findFullScans(timekeepingHotPathPlans(snapshot), TIMEKEEPING_PLAN_SCAN_ALLOWLIST);
    expect(scans, scans.join(", ")).toEqual([]);
  });
});
