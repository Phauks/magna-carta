import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  hotPathPlans,
  ledgerMeasurements,
  measurementHandle,
  PLAN_SCAN_ALLOWLIST,
} from "./ledger-measurements.ts";
import { ledgerVolume } from "./profile.ts";
import { findFullScans, runMeasurements, writeBaselineFile } from "./runner.ts";
import { loadProfileSnapshot } from "./snapshot.ts";

// Produce/refresh the committed baseline for the full-scale ledgerVolume profile. Local-only,
// owner-run; numbers are machine-relative — compare across commits on ONE machine, never across
// machines. First run generates the snapshot (minutes); replays are instant.
const BASELINE_SEED = "ledger-volume-baseline";

const snapshot = await loadProfileSnapshot(ledgerVolume, BASELINE_SEED, { allowSeeding: true });
// These console calls predate the slice 0·6 console-ban fitness function; when 0·6 lands, this
// dev-only CLI either moves onto the telemetry logger or gets an explicit exemption (never Worker
// code).
console.log(
  `snapshot ${snapshot.cacheKey}: ${snapshot.manifest.entryCount} entries (profile v${snapshot.manifest.profile.version})`,
);

const scans = findFullScans(hotPathPlans(snapshot), PLAN_SCAN_ALLOWLIST);
if (scans.length > 0) {
  console.error(`full table scans on hot paths: ${scans.join(", ")}`);
}

const results = await runMeasurements(
  measurementHandle(snapshot, BASELINE_SEED),
  ledgerMeasurements,
  {
    warmupIterations: 3,
    iterations: 30,
  },
);
for (const result of results) {
  console.log(
    `${result.name}: median ${result.medianMs}ms · p95 ${result.p95Ms}ms · min ${result.minMs}ms (${result.iterations} iterations)`,
  );
}

const baselineDirectory = join(import.meta.dirname, "..", "..", "baselines");
mkdirSync(baselineDirectory, { recursive: true });
const baselinePath = join(baselineDirectory, `${ledgerVolume.name}-v${ledgerVolume.version}.json`);
writeBaselineFile(baselinePath, {
  profileName: ledgerVolume.name,
  profileVersion: ledgerVolume.version,
  cacheKey: snapshot.cacheKey,
  results,
});
console.log(`baseline written: ${baselinePath}`);
snapshot.close();
