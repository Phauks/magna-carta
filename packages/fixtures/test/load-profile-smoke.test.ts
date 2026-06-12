import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hotPathPlans,
  ledgerMeasurements,
  measurementHandle,
  PLAN_SCAN_ALLOWLIST,
} from "../src/load-profile/ledger-measurements.ts";
import { ledgerVolume, scaleProfile } from "../src/load-profile/profile.ts";
import { findFullScans, runMeasurements } from "../src/load-profile/runner.ts";
import { loadProfileSnapshot, type LoadedSnapshot } from "../src/load-profile/snapshot.ts";

// The CI smoke: the harness stays green end-to-end at tiny scale. NO timing assertions —
// budgets are deferred until stable numbers exist (performance.md).
describe("load-profile smoke", () => {
  const temporaryDirectories: string[] = [];
  const openSnapshots: LoadedSnapshot[] = [];
  // Every snapshot goes through here: its handle joins the close list (a mid-test assertion
  // failure must not leak an open handle into an EPERM cleanup error on Windows) and its
  // working-copy directory — created outside the cache directory — joins the cleanup list.
  const track = (snapshot: LoadedSnapshot): LoadedSnapshot => {
    openSnapshots.push(snapshot);
    temporaryDirectories.push(dirname(snapshot.workingPath));
    return snapshot;
  };
  afterEach(() => {
    // Close handles before cleanup — Windows refuses to delete a file another handle still
    // holds open. close() is idempotent, so snapshots the test already closed are fine.
    for (const snapshot of openSnapshots.splice(0)) {
      snapshot.close();
    }
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("snapshots, measures every v1 operation, and keeps hot-path statements scan-free", async () => {
    const cacheDirectory = mkdtempSync(join(tmpdir(), "mc-smoke-cache-"));
    temporaryDirectories.push(cacheDirectory);
    const snapshot = track(
      await loadProfileSnapshot(scaleProfile(ledgerVolume, 0.002), "smoke-seed", {
        allowSeeding: true,
        cacheDirectory,
      }),
    );
    const handle = measurementHandle(snapshot, "smoke-seed");

    const results = await runMeasurements(handle, ledgerMeasurements, {
      warmupIterations: 1,
      iterations: 2,
    });
    expect(results.map((result) => result.name).sort()).toEqual(
      [
        "balance-read.busy-subledger",
        "create-account.trust-subledger",
        "ledger-fitness.table-wide",
        "post-entry.two-line",
        "reverse-entry.two-line",
      ].sort(),
    );
    for (const result of results) {
      expect(result.iterations).toBe(2);
      expect(result.minMs).toBeGreaterThanOrEqual(0);
    }

    // The structural no-N+1/no-missing-index check on the hot-path statements. The label set is
    // asserted first: an empty plan list would make the scan check pass vacuously, so dropped
    // probes must fail here, not slip through.
    const plans = hotPathPlans(snapshot);
    expect(plans.map((plan) => plan.label).sort()).toEqual(
      ["balance-read.busy-subledger", "entry-read.by-id", "lines-read.by-entry"].sort(),
    );
    const scans = findFullScans(plans, PLAN_SCAN_ALLOWLIST);
    expect(scans).toEqual([]);

    snapshot.close();
  });
});
