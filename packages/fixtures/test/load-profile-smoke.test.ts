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
import {
  mattersMeasurements,
  practiceHotPathPlans,
  PRACTICE_PLAN_SCAN_ALLOWLIST,
} from "../src/load-profile/matters-measurements.ts";
import {
  protectedHotPathPlans,
  protectedMeasurementHandle,
  protectedMeasurements,
  PROTECTED_PLAN_SCAN_ALLOWLIST,
} from "../src/load-profile/protected-measurements.ts";
import {
  directoryHotPathPlans,
  directoryMeasurementHandle,
  directoryMeasurements,
  DIRECTORY_PLAN_SCAN_ALLOWLIST,
} from "../src/load-profile/directory-measurements.ts";
import {
  shippingHotPathPlans,
  shippingMeasurements,
  SHIPPING_PLAN_SCAN_ALLOWLIST,
} from "../src/load-profile/shipping-measurements.ts";
import {
  customFieldHotPathPlans,
  customFieldMeasurementHandle,
  customFieldMeasurements,
  CUSTOM_FIELD_PLAN_SCAN_ALLOWLIST,
} from "../src/load-profile/custom-field-measurements.ts";
import { ledgerVolume, scaleProfile } from "../src/load-profile/profile.ts";
import { findFullScans, findTempBtreeSorts, runMeasurements } from "../src/load-profile/runner.ts";
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

    const results = await runMeasurements(
      handle,
      [...ledgerMeasurements, ...mattersMeasurements, ...shippingMeasurements],
      {
        warmupIterations: 1,
        iterations: 2,
      },
    );
    expect(results.map((result) => result.name).sort()).toEqual(
      [
        "balance-read.busy-subledger",
        "create-account.trust-subledger",
        "ledger-fitness.table-wide",
        "post-entry.two-line",
        "reverse-entry.two-line",
        "list-matters.first-page",
        "list-matters.filtered",
        "list-consultations.by-member",
        "list-files.by-matter",
        "list-files.by-folder",
        "get-current-clean-version",
        "list-clean-versions.by-file",
        "zip-resolution.clean-current-versions",
        "zip-resolution.folders-by-matter",
        "storage-meter.summary",
        "matter-number.counter-draw",
        "list-shipments.by-matter",
        "list-tracking-events.by-shipment",
      ].sort(),
    );
    for (const result of results) {
      expect(result.iterations).toBe(2);
      expect(result.minMs).toBeGreaterThanOrEqual(0);
    }

    // The protected() chokepoint set runs under its own (async) handle — the seed-derived firm key
    // and owner permissions. Decrypts the cached sealed values, so a key-derivation regression would
    // fail here, not silently.
    const protectedHandle = await protectedMeasurementHandle(snapshot, "smoke-seed");
    expect(protectedHandle.incidentCiphertexts.length).toBeGreaterThan(0);
    const protectedResults = await runMeasurements(protectedHandle, protectedMeasurements, {
      warmupIterations: 1,
      iterations: 2,
    });
    expect(protectedResults.map((result) => result.name).sort()).toEqual(
      [
        "protected.incident-decrypt-page",
        "protected.firm-secret-read",
        "protected.blind-index-compute",
      ].sort(),
    );
    for (const result of protectedResults) {
      expect(result.iterations).toBe(2);
      expect(result.minMs).toBeGreaterThanOrEqual(0);
    }

    // The directory measured set runs under its own (async) handle — the seed-derived firm key and
    // viewSensitiveIdentifiers permission. Decrypts the cached sealed SSN ciphertexts on the
    // read-protected-list op, so a key-derivation regression would surface here.
    const directoryHandle = await directoryMeasurementHandle(snapshot, "smoke-seed");
    expect(directoryHandle.sampleEntityCiphertexts.length).toBeGreaterThan(0);
    const directoryResults = await runMeasurements(directoryHandle, directoryMeasurements, {
      warmupIterations: 1,
      iterations: 2,
    });
    expect(directoryResults.map((result) => result.name).sort()).toEqual(
      [
        "directory.find-by-identifier",
        "directory.read-protected-list",
        "directory.candidate-generation",
        "directory.graph-expansion",
      ].sort(),
    );
    for (const result of directoryResults) {
      expect(result.iterations).toBe(2);
      expect(result.minMs).toBeGreaterThanOrEqual(0);
    }

    // The custom-field measured set runs under its own handle. The merge-repoint op mints a fresh
    // person pair + value references per iteration (a merge archives the subordinate, so the pair
    // cannot be reused), then folds the subordinate into the master.
    const customFieldHandle = await customFieldMeasurementHandle(snapshot, "smoke-seed");
    expect(customFieldHandle.busiestRecordId).toMatch(/^matter_/);
    const customFieldResults = await runMeasurements(customFieldHandle, customFieldMeasurements, {
      warmupIterations: 1,
      iterations: 2,
    });
    expect(customFieldResults.map((result) => result.name).sort()).toEqual(
      [
        "custom-field.read-current-values",
        "custom-field.reference-lookup",
        "custom-field.preview-convert-scan",
        "custom-field.merge-repoint",
      ].sort(),
    );
    for (const result of customFieldResults) {
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

    // The practice hot-path plans: same label-set-first guard, then the scan check.
    const practicePlans = practiceHotPathPlans(snapshot);
    expect(practicePlans.map((plan) => plan.label).sort()).toEqual(
      [
        "list-matters.first-page",
        "list-matters.filtered",
        "list-consultations.by-member",
        "list-files.by-matter",
        "list-files.by-folder",
        "get-current-clean-version",
        "zip-resolution.clean-current-versions",
        "zip-resolution.folders-by-matter",
        "storage-meter.summary",
      ].sort(),
    );
    const practiceScans = findFullScans(practicePlans, PRACTICE_PLAN_SCAN_ALLOWLIST);
    expect(practiceScans).toEqual([]);

    // The shipping hot-path plans: same label-set-first guard, then the scan check.
    const shippingPlans = shippingHotPathPlans(snapshot);
    expect(shippingPlans.map((plan) => plan.label).sort()).toEqual(
      ["list-shipments.by-matter", "list-tracking-events.by-shipment"].sort(),
    );
    expect(findFullScans(shippingPlans, SHIPPING_PLAN_SCAN_ALLOWLIST)).toEqual([]);

    // The keyset-paginated list hot paths must satisfy their (created_at, id) ORDER BY from a
    // covering index — never a materialize-and-sort temporary B-tree, which defeats keyset
    // pagination at volume. A dropped or reordered covering index regresses the sort and fails here.
    const sortedListLabels = [
      "list-matters.first-page",
      "list-matters.filtered",
      "list-consultations.by-member",
      "list-files.by-matter",
      "list-files.by-folder",
      "zip-resolution.folders-by-matter",
    ];
    const sortedListPlans = practicePlans.filter((plan) => sortedListLabels.includes(plan.label));
    expect(sortedListPlans.map((plan) => plan.label).sort()).toEqual([...sortedListLabels].sort());
    expect(findTempBtreeSorts(sortedListPlans)).toEqual([]);

    // The protected keyed-read hot paths: same label-set-first guard, then the scan check. Both the
    // firm-secret name lookup and the by-id incident fetch must walk an index / the primary key.
    const protectedPlans = protectedHotPathPlans(snapshot);
    expect(protectedPlans.map((plan) => plan.label).sort()).toEqual(
      ["firm-secret.read-by-name", "incident.read-by-id"].sort(),
    );
    expect(findFullScans(protectedPlans, PROTECTED_PLAN_SCAN_ALLOWLIST)).toEqual([]);

    // The directory hot-path plans: same label-set-first guard, then the scan check. The
    // blind-index equality probe walks the (identifier_type, value_blind_index) index; the
    // duplicate-candidate phonetic channel walks the code-leading index; the related-party graph
    // expansion walks the from/to entity-id indexes.
    const directoryPlans = directoryHotPathPlans(snapshot);
    expect(directoryPlans.map((plan) => plan.label).sort()).toEqual(
      [
        "directory.candidate-generation.phonetic-channel",
        "directory.find-by-identifier",
        "directory.graph-expansion",
      ].sort(),
    );
    expect(findFullScans(directoryPlans, DIRECTORY_PLAN_SCAN_ALLOWLIST)).toEqual([]);

    // The custom-field hot-path plans: same label-set-first guard, then the scan check. The per-record
    // read walks (target_row_id, is_current); the reference lookup walks (value_reference_id); the
    // convert scan walks (field_id); the merge repoint's two reads walk those same indexes.
    const customFieldPlans = customFieldHotPathPlans(snapshot);
    expect(customFieldPlans.map((plan) => plan.label).sort()).toEqual(
      [
        "custom-field.read-current-values",
        "custom-field.reference-lookup",
        "custom-field.preview-convert-scan",
        "custom-field.merge-repoint.reference-read",
        "custom-field.merge-repoint.owned-read",
      ].sort(),
    );
    expect(findFullScans(customFieldPlans, CUSTOM_FIELD_PLAN_SCAN_ALLOWLIST)).toEqual([]);

    snapshot.close();
  });
});
