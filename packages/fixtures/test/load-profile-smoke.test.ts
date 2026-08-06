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
import {
  editingHotPathPlans,
  editingMeasurements,
  EDITING_PLAN_SCAN_ALLOWLIST,
} from "../src/load-profile/editing-measurements.ts";
import {
  conflictsHotPathPlans,
  conflictsMeasurementHandle,
  conflictsMeasurements,
  CONFLICTS_PLAN_SCAN_ALLOWLIST,
} from "../src/load-profile/conflicts-measurements.ts";
import {
  documentAutomationHotPathPlans,
  documentAutomationMeasurementHandle,
  documentAutomationMeasurements,
  DOCUMENT_AUTOMATION_PLAN_SCAN_ALLOWLIST,
} from "../src/load-profile/document-automation-measurements.ts";
import {
  trustHotPathPlans,
  trustMeasurementHandle,
  trustMeasurements,
  TRUST_PLAN_SCAN_ALLOWLIST,
} from "../src/load-profile/trust-measurements.ts";
import { ledgerVolume, scaleProfile } from "../src/load-profile/profile.ts";
import { readTrustThreeWayProof } from "@magna-carta/trust/reconciliation";
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
      [
        ...ledgerMeasurements,
        ...mattersMeasurements,
        ...shippingMeasurements,
        ...editingMeasurements,
      ],
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
        "rescan-sweep.find-unscanned",
        "storage-meter.summary",
        "matter-number.counter-draw",
        "list-shipments.by-matter",
        "list-tracking-events.by-shipment",
        "tiering-sweep.find-candidates",
        "idle-checkout-sweep.find-idle",
        "reconcile.find-conflict",
        "checkout.active-exclusive-lock",
        "version-cut.commit",
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

    // The conflicts measured set runs under its own (async) handle — the seed-derived firm key and
    // viewSensitiveIdentifiers permission. run-check walks the directory corpus and writes its own log
    // rows; imputation runs the identity join over the firm's matters.
    const conflictsHandle = await conflictsMeasurementHandle(snapshot, "smoke-seed");
    expect(conflictsHandle.subjectEntityId).toMatch(/^directoryPerson_/);
    const conflictsResults = await runMeasurements(conflictsHandle, conflictsMeasurements, {
      warmupIterations: 1,
      iterations: 2,
    });
    expect(conflictsResults.map((result) => result.name).sort()).toEqual(
      ["conflicts.run-check", "conflicts.imputation", "conflicts.co-party-check"].sort(),
    );
    for (const result of conflictsResults) {
      expect(result.iterations).toBe(2);
      expect(result.minMs).toBeGreaterThanOrEqual(0);
    }

    // The document-automation measured set runs under its own (async) handle — it parses the probe
    // version's stored manifest and derives the firm's dictionary from the same catalogue read the
    // production path uses, so a manifest or a dictionary that stopped resolving fails here.
    const automationHandle = await documentAutomationMeasurementHandle(snapshot);
    expect(automationHandle.probeCustomHandles.length).toBeGreaterThan(0);
    const automationResults = await runMeasurements(
      automationHandle,
      documentAutomationMeasurements,
      { warmupIterations: 1, iterations: 2 },
    );
    expect(automationResults.map((result) => result.name).sort()).toEqual(
      [
        "templates.list-catalogue",
        "templates.version-for-assembly",
        "assembly.merge-context",
        "assembly.merge-context-expressions",
        "templates.custom-field-catalog",
        "templates.merge-field-catalog",
        "templates.field-binding-lookup",
      ].sort(),
    );
    for (const result of automationResults) {
      expect(result.iterations).toBe(2);
      expect(result.minMs).toBeGreaterThanOrEqual(0);
    }

    // The trust measured set runs over the snapshot directly — every operation is a read, and the
    // one that matters is the whole three-way proof for the period the generator left open.
    const trustHandle = trustMeasurementHandle(snapshot);
    const trustResults = await runMeasurements(trustHandle, trustMeasurements, {
      warmupIterations: 1,
      iterations: 2,
    });
    expect(trustResults.map((result) => result.name).sort()).toEqual(
      [
        "trust-proof.three-way",
        "trust-match.suggestions",
        "trust-client-ledger.movements-by-node",
        "trust-available-balance.by-node",
        "trust-fitness.table-wide",
      ].sort(),
    );
    for (const result of trustResults) {
      expect(result.iterations).toBe(2);
      expect(result.minMs).toBeGreaterThanOrEqual(0);
    }

    // And the proof is not merely timed but PROVEN honest: the generator puts a service charge on
    // every statement that the firm never records, so the open period cannot tie out and the proof
    // must say which leg is out rather than quietly agreeing.
    const { proof } = await readTrustThreeWayProof(
      snapshot.database,
      snapshot.manifest.trustProbes.openReconciliationId,
    );
    expect(proof.balanced).toBe(false);
    expect(proof.disagreements.map((disagreement) => disagreement.leg)).toContain("bank-to-book");
    // Book and client agree by construction while the composition guard holds, so that leg stays
    // silent — a row here would mean an entry reached the ledger without going through the guard.
    expect(proof.disagreements.map((disagreement) => disagreement.leg)).not.toContain(
      "book-to-client",
    );
    expect(proof.unmatchedStatementLines.length).toBeGreaterThan(0);

    // The co-party surfacing path is not merely timed but PROVEN expressed: the identically-named
    // co-party pair makes each member a co-party hit of the other, so the append-only log the checks
    // just wrote into the working copy carries at least one row flagged co_party = 1.
    const { results: coPartyRows } = await snapshot.database
      .prepare("SELECT COUNT(*) AS n FROM conflicts_hit WHERE co_party = 1")
      .all<{ n: number }>();
    expect(coPartyRows[0]!.n).toBeGreaterThan(0);

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
        "rescan-sweep.find-unscanned",
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

    // The editing hot-path plans: same label-set-first guard, then the scan check. The two firm-wide
    // sweep reads (tiering candidates, idle checkouts) must walk an index, never the table; the
    // reconcile + exclusive-lock lookups are file-scoped index seeks.
    const editingPlans = editingHotPathPlans(snapshot);
    expect(editingPlans.map((plan) => plan.label).sort()).toEqual(
      [
        "tiering-sweep.find-candidates",
        "idle-checkout-sweep.find-idle",
        "reconcile.find-conflict",
        "checkout.active-exclusive-lock",
      ].sort(),
    );
    expect(findFullScans(editingPlans, EDITING_PLAN_SCAN_ALLOWLIST)).toEqual([]);

    // The conflicts hot-path plans: same label-set-first guard, then the scan check. The imputation
    // identity join, the blind-index self-join, the exact-name probe, and the two log reads must each
    // walk an index, never the table.
    const conflictsPlans = conflictsHotPathPlans(snapshot);
    expect(conflictsPlans.map((plan) => plan.label).sort()).toEqual(
      [
        "conflicts.imputation-join",
        "conflicts.blind-index-self-join",
        "conflicts.exact-name-probe",
        "conflicts.hits-by-check",
        "conflicts.disposition-current",
      ].sort(),
    );
    expect(findFullScans(conflictsPlans, CONFLICTS_PLAN_SCAN_ALLOWLIST)).toEqual([]);

    // The document-automation hot-path plans: same label-set-first guard, then the scan check. The
    // catalogue list walks (status, name); the version resolve seeks the version's primary key and joins
    // its catalogue row's; the merge context's three reads each seek by matter or by handle. Only the
    // firm's field catalogue — table-wide by nature, since the dictionary IS the whole set — is
    // allowlisted.
    const automationPlans = documentAutomationHotPathPlans(automationHandle);
    expect(automationPlans.map((plan) => plan.label).sort()).toEqual(
      [
        "templates.list-catalogue",
        "templates.version-for-assembly",
        "assembly.merge-context.matter",
        "assembly.merge-context.parties",
        "assembly.merge-context.custom-field-values",
        "templates.custom-field-catalog",
        "templates.field-binding-lookup",
      ].sort(),
    );
    expect(findFullScans(automationPlans, DOCUMENT_AUTOMATION_PLAN_SCAN_ALLOWLIST)).toEqual([]);

    // The trust hot-path plans: same label-set-first guard, then the scan check. The proof's two
    // as-of totals are sums over ledger_line and must walk the account index rather than the table —
    // they are the reads that would silently degrade as a firm's book grows. Only the fitness sweep,
    // table-wide by nature, is allowlisted.
    const trustPlans = trustHotPathPlans(snapshot);
    expect(trustPlans.map((plan) => plan.label).sort()).toEqual(
      [
        "trust-proof.book-balance-as-of",
        "trust-proof.client-total-as-of",
        "trust-proof.outstanding-items",
        "trust-proof.unmatched-lines",
        "trust-statement.lines-by-statement",
        "trust-client-ledger.movements-by-node",
        "trust-available-balance.by-node",
      ].sort(),
    );
    expect(findFullScans(trustPlans, TRUST_PLAN_SCAN_ALLOWLIST)).toEqual([]);

    snapshot.close();
  });
});
