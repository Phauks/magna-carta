import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  hotPathPlans,
  ledgerMeasurements,
  measurementHandle,
  PLAN_SCAN_ALLOWLIST,
} from "./ledger-measurements.ts";
import {
  mattersMeasurements,
  practiceHotPathPlans,
  PRACTICE_PLAN_SCAN_ALLOWLIST,
} from "./matters-measurements.ts";
import {
  protectedHotPathPlans,
  protectedMeasurementHandle,
  protectedMeasurements,
  PROTECTED_PLAN_SCAN_ALLOWLIST,
} from "./protected-measurements.ts";
import {
  directoryHotPathPlans,
  directoryMeasurementHandle,
  directoryMeasurements,
  DIRECTORY_PLAN_SCAN_ALLOWLIST,
} from "./directory-measurements.ts";
import {
  shippingHotPathPlans,
  shippingMeasurements,
  SHIPPING_PLAN_SCAN_ALLOWLIST,
} from "./shipping-measurements.ts";
import {
  customFieldHotPathPlans,
  customFieldMeasurementHandle,
  customFieldMeasurements,
  CUSTOM_FIELD_PLAN_SCAN_ALLOWLIST,
} from "./custom-field-measurements.ts";
import {
  editingHotPathPlans,
  editingMeasurements,
  EDITING_PLAN_SCAN_ALLOWLIST,
} from "./editing-measurements.ts";
import {
  timekeepingHotPathPlans,
  timekeepingMeasurementHandle,
  timekeepingMeasurements,
  TIMEKEEPING_PLAN_SCAN_ALLOWLIST,
} from "./timekeeping-measurements.ts";
import {
  conflictsHotPathPlans,
  conflictsMeasurementHandle,
  conflictsMeasurements,
  CONFLICTS_PLAN_SCAN_ALLOWLIST,
} from "./conflicts-measurements.ts";
import { ledgerVolume } from "./profile.ts";
import { findFullScans, runMeasurements, writeBaselineFile } from "./runner.ts";
import { loadProfileSnapshot } from "./snapshot.ts";

// Produce/refresh the committed baseline for the full-scale ledgerVolume profile. Local-only,
// owner-run; numbers are machine-relative — compare across commits on ONE machine, never across
// machines. First run generates the snapshot (minutes); replays are instant.
//
// The package.json script runs this with --experimental-transform-types: a transitive ledger
// import uses a constructor parameter property (non-erasable TS syntax). The flag ships in
// Node 25 and is slated for removal in Node 26 — revisit on the next Node upgrade.
const BASELINE_SEED = "ledger-volume-baseline";

const snapshot = await loadProfileSnapshot(ledgerVolume, BASELINE_SEED, { allowSeeding: true });
// These console calls predate the slice 0·6 console-ban fitness function; when 0·6 lands, this
// dev-only CLI either moves onto the telemetry logger or gets an explicit exemption (never Worker
// code).
console.log(
  `snapshot ${snapshot.cacheKey}: ${snapshot.manifest.entryCount} entries, ${snapshot.manifest.matterCount} matters, ${snapshot.manifest.fileCount} files (${snapshot.manifest.fileVersionCount} versions), ${snapshot.manifest.folderCount} folders, ${snapshot.manifest.incidentCount} sealed incidents, ${snapshot.manifest.firmSecretCount} firm secrets, ${snapshot.manifest.directoryPersonCount} persons, ${snapshot.manifest.directoryOrganizationCount} organizations, ${snapshot.manifest.shipmentCount} shipments (${snapshot.manifest.trackingEventCount} tracking events), ${snapshot.manifest.customFieldDefinitionCount} custom fields (${snapshot.manifest.customFieldValueCount} values), ${snapshot.manifest.timeEntryCount} time entries (${snapshot.manifest.rateCount} rates, ${snapshot.manifest.rateCardCount} cards) (profile v${snapshot.manifest.profile.version})`,
);

const scans = [
  ...findFullScans(hotPathPlans(snapshot), PLAN_SCAN_ALLOWLIST),
  ...findFullScans(practiceHotPathPlans(snapshot), PRACTICE_PLAN_SCAN_ALLOWLIST),
  ...findFullScans(protectedHotPathPlans(snapshot), PROTECTED_PLAN_SCAN_ALLOWLIST),
  ...findFullScans(directoryHotPathPlans(snapshot), DIRECTORY_PLAN_SCAN_ALLOWLIST),
  ...findFullScans(shippingHotPathPlans(snapshot), SHIPPING_PLAN_SCAN_ALLOWLIST),
  ...findFullScans(customFieldHotPathPlans(snapshot), CUSTOM_FIELD_PLAN_SCAN_ALLOWLIST),
  ...findFullScans(editingHotPathPlans(snapshot), EDITING_PLAN_SCAN_ALLOWLIST),
  ...findFullScans(timekeepingHotPathPlans(snapshot), TIMEKEEPING_PLAN_SCAN_ALLOWLIST),
  ...findFullScans(conflictsHotPathPlans(snapshot), CONFLICTS_PLAN_SCAN_ALLOWLIST),
];
if (scans.length > 0) {
  // A scan regression must never be baked into a committed baseline — fail before measuring.
  console.error(`full table scans on hot paths: ${scans.join(", ")}`);
  snapshot.close();
  process.exit(1);
}

const results = [
  ...(await runMeasurements(
    measurementHandle(snapshot, BASELINE_SEED),
    [
      ...ledgerMeasurements,
      ...mattersMeasurements,
      ...shippingMeasurements,
      ...editingMeasurements,
    ],
    { warmupIterations: 3, iterations: 30 },
  )),
  ...(await runMeasurements(
    await protectedMeasurementHandle(snapshot, BASELINE_SEED),
    protectedMeasurements,
    { warmupIterations: 3, iterations: 30 },
  )),
  ...(await runMeasurements(
    await directoryMeasurementHandle(snapshot, BASELINE_SEED),
    directoryMeasurements,
    { warmupIterations: 3, iterations: 30 },
  )),
  ...(await runMeasurements(
    await customFieldMeasurementHandle(snapshot, BASELINE_SEED),
    customFieldMeasurements,
    { warmupIterations: 3, iterations: 30 },
  )),
  ...(await runMeasurements(
    timekeepingMeasurementHandle(snapshot, BASELINE_SEED),
    timekeepingMeasurements,
    { warmupIterations: 3, iterations: 30 },
  )),
  ...(await runMeasurements(
    await conflictsMeasurementHandle(snapshot, BASELINE_SEED),
    conflictsMeasurements,
    { warmupIterations: 3, iterations: 30 },
  )),
];
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
