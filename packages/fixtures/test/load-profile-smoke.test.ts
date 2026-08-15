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
  conflictsCandidateBounds,
  conflictsMatcherBounds,
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
import {
  reportsHotPathPlans,
  reportsMeasurementHandle,
  reportsMeasurements,
  REPORTS_PLAN_SCAN_ALLOWLIST,
} from "../src/load-profile/reports-measurements.ts";
import {
  custodianHotPathPlans,
  custodianMeasurementHandle,
  custodianMeasurements,
  CUSTODIAN_PLAN_SCAN_ALLOWLIST,
} from "../src/load-profile/custodian-measurements.ts";
import {
  calendarHotPathPlans,
  calendarMeasurementHandle,
  calendarMeasurements,
  timelinePageBounds,
  CALENDAR_PLAN_SCAN_ALLOWLIST,
} from "../src/load-profile/calendar-measurements.ts";
import { TIMELINE_SOURCES } from "@magna-carta/calendar/sources/all";
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
      [
        "conflicts.run-check",
        "conflicts.imputation",
        "conflicts.co-party-check",
        "conflicts.run-check-deep-graph",
        "conflicts.run-check-truncating",
      ].sort(),
    );
    for (const result of conflictsResults) {
      expect(result.iterations).toBe(2);
      expect(result.minMs).toBeGreaterThanOrEqual(0);
    }

    // The batched matcher's statement count over the deep corporate group. Counted rather than timed:
    // a timing shows an N+1 only once the corpus is large enough for the difference to clear the
    // noise, while a count shows it the moment somebody puts a read back inside the loop.
    const matcherBounds = await conflictsMatcherBounds(conflictsHandle);
    expect(matcherBounds.map((bound) => bound.label)).toEqual([
      "conflicts.matcher-batch-deep-graph",
    ]);
    for (const bound of matcherBounds) {
      expect(bound.subjectCount).toBeGreaterThan(1);
      // The claim the whole batch exists to make: fewer queries than there are subjects to match.
      expect(bound.statementCount).toBeLessThan(bound.subjectCount);
    }

    // Where the candidates come from. The closure cap bounds the walk; these report the quantity the
    // SECOND cap exists for, which is the walk times the corpus — so the assertion is not on a number
    // (it moves with the profile scale) but on the breakdown being present and adding up, and on the
    // trigram channel being the bulk of it, which is the finding the candidate bound answers.
    const candidateBounds = await conflictsCandidateBounds(conflictsHandle);
    expect(candidateBounds.map((bound) => bound.label)).toEqual([
      "conflicts.candidates-per-person-subject",
      "conflicts.candidates-per-organization-subject",
    ]);
    for (const bound of candidateBounds) {
      expect(bound.subjectCount).toBeGreaterThan(1);
      expect(bound.corpusOfKind).toBeGreaterThan(bound.subjectCount);
      expect(bound.trigramOnlyCandidates).toBeLessThanOrEqual(bound.candidateCount);
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

    // The custody measured set runs under its own handle — the number draw writes, so its context
    // derives a disjoint identifier stream from the generation seed.
    const custodianHandle = custodianMeasurementHandle(snapshot, "smoke-seed");
    expect(
      custodianHandle.snapshot.manifest.custodianProbes.subtreeLocationIds.length,
    ).toBeGreaterThan(0);
    const custodianResults = await runMeasurements(custodianHandle, custodianMeasurements, {
      warmupIterations: 1,
      iterations: 2,
    });
    expect(custodianResults.map((result) => result.name).sort()).toEqual(
      [
        "custody-register.by-owner",
        "custody-register.by-location-subtree",
        "custody-location.subtree-walk",
        "custody-location.occupancy",
        "custody-packet.detail",
        "custody-overdue.sweep",
        "custody-reviews.due-sweep",
        "custody-history.deep-packet-page",
        "custody-number.counter-draw",
      ].sort(),
    );
    for (const result of custodianResults) {
      expect(result.iterations).toBe(2);
      expect(result.minMs).toBeGreaterThanOrEqual(0);
    }

    // The calendar measured set runs over the snapshot with the real source registry and the real
    // visible-matter predicate — every read here is the federated one the product issues.
    const calendarHandle = calendarMeasurementHandle(snapshot);
    const calendarResults = await runMeasurements(calendarHandle, calendarMeasurements, {
      warmupIterations: 1,
      iterations: 2,
    });
    expect(calendarResults.map((result) => result.name).sort()).toEqual(
      [
        "timeline.matter-page-1",
        "timeline.matter-page-20",
        "timeline.matter-shallow-page-1",
        "timeline.firm-window-31-day",
        "timeline.firm-window-member-filtered",
        "booking.availability-read",
        "booking.overlap-check",
        "continuance.chain-read",
      ].sort(),
    );
    for (const result of calendarResults) {
      expect(result.iterations).toBe(2);
      expect(result.minMs).toBeGreaterThanOrEqual(0);
    }

    // THE federation assertion, and the reason this subsystem gets counts as well as timings: the
    // read count per page must scale with the REGISTRY, never with the firm's data. One statement per
    // selected source (the custody review source contributes two arms — a packet's review date and an
    // item's), and rows read within sourceCount x (pageSize + 1). A per-row lookup added inside a
    // projection changes neither a plan nor, at this scale, a duration — but it changes these.
    const timelinePageSize = 50;
    const bounds = await timelinePageBounds(calendarHandle);
    expect(bounds.map((bound) => bound.label).sort()).toEqual(
      [
        "timeline.matter-page-1",
        "timeline.firm-window-31-day",
        "timeline.firm-window-member-filtered",
      ].sort(),
    );
    for (const bound of bounds) {
      expect(bound.statementCount).toBeLessThanOrEqual(TIMELINE_SOURCES.length + 1);
      expect(bound.statementCount).toBeGreaterThanOrEqual(bound.sourcesRead);
      expect(bound.rowsRead).toBeLessThanOrEqual(bound.statementCount * (timelinePageSize + 1));
    }
    // The member filter DROPS the sources that cannot answer it rather than post-filtering, so it
    // reads strictly fewer sources than the same window unfiltered. A regression to a post-filter
    // would make these two equal.
    const unfiltered = bounds.find((bound) => bound.label === "timeline.firm-window-31-day");
    const filtered = bounds.find((bound) => bound.label === "timeline.firm-window-member-filtered");
    expect(filtered?.sourcesRead ?? 0).toBeLessThan(unfiltered?.sourcesRead ?? 0);

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
    // identity join, the blind-index self-join, the exact-name probe, and the four log reads must each
    // walk an index, never the table. The two posture reads matter most here: they run on every view of
    // a matter over a log that only grows, so a scan there gets slower forever.
    const conflictsPlans = conflictsHotPathPlans(snapshot);
    expect(conflictsPlans.map((plan) => plan.label).sort()).toEqual(
      [
        "conflicts.imputation-join",
        "conflicts.blind-index-self-join",
        "conflicts.exact-name-probe",
        "conflicts.hits-by-check",
        "conflicts.disposition-current",
        "conflicts.latest-check-for-matter",
        "conflicts.hit-disposition-states",
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
        "assembly.merge-context.assets",
        "assembly.merge-context.custom-field-values",
        "assembly.merge-context.staffing",
        "assembly.merge-context.court-case",
        "assembly.merge-context.estate",
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

    // The custody hot-path plans: same label-set-first guard, then the scan check. The two that
    // matter most are the register list filtered by owner — the register's primary filter across the
    // whole packet corpus — and the recursive subtree walk, which the design names as the one read
    // here with a genuinely non-obvious plan. The paginated ledger read matters for a different
    // reason: it is the only table in this subsystem that grows without bound, so a scan there gets
    // slower forever.
    const custodianPlans = custodianHotPathPlans(snapshot);
    expect(custodianPlans.map((plan) => plan.label).sort()).toEqual(
      [
        "custody-register.by-owner",
        "custody-register.by-location-subtree",
        "custody-location.subtree-walk",
        "custody-location.occupancy",
        "custody-packet.detail.packet",
        "custody-packet.detail.items",
        "custody-packet.detail.owners",
        "custody-packet.detail.holds",
        "custody-overdue.sweep",
        "custody-reviews.due-sweep",
        "custody-history.deep-packet-page",
      ].sort(),
    );
    expect(findFullScans(custodianPlans, CUSTODIAN_PLAN_SCAN_ALLOWLIST)).toEqual([]);

    // A packet's history is keyset-paginated on (occurred_at, id) over its own composite index, and
    // that ordering must come OUT of the index rather than out of a temporary B-tree — a firm holds a
    // packet for decades, so a materialize-and-sort here degrades with every year it holds it.
    expect(
      findTempBtreeSorts(
        custodianPlans.filter((plan) => plan.label === "custody-history.deep-packet-page"),
      ),
    ).toEqual([]);

    // The calendar hot-path plans: every REGISTERED source's own statement, for the matter scope and
    // for the firm-window scope, built through the source's own builder — so a source added to the
    // registry appears here without anybody remembering to add it, and a source that changed shape
    // changes its own probe. The label set is asserted as a count rather than a list for that reason:
    // pinning the names would make adding a source a two-file change for no gain.
    const calendarPlans = await calendarHotPathPlans(calendarHandle);
    expect(calendarPlans.length).toBeGreaterThan(TIMELINE_SOURCES.length);
    expect(calendarPlans.map((plan) => plan.label)).toContain("timeline.matter.matterEvent");
    expect(calendarPlans.map((plan) => plan.label)).toContain("timeline.firm-window.firmEvent");
    expect(calendarPlans.map((plan) => plan.label)).toContain("booking.live-in-window");
    expect(findFullScans(calendarPlans, CALENDAR_PLAN_SCAN_ALLOWLIST)).toEqual([]);

    // The reporting measured set: the two per-row reads a pack is built from, the per-leaf balance
    // read behind its client-ledger section, and the whole document — each at one month and at
    // twelve, because how the cost grows with the period is the fact that matters about a report
    // produced for whatever period an examiner asks about.
    const reportsHandle = reportsMeasurementHandle(snapshot);
    const reportsResults = await runMeasurements(reportsHandle, reportsMeasurements, {
      warmupIterations: 1,
      iterations: 2,
    });
    expect(reportsResults.map((result) => result.name).sort()).toEqual(
      [
        "reports-client-ledgers.one-month",
        "reports-client-ledgers.twelve-months",
        "reports-journal.one-month",
        "reports-journal.twelve-months",
        "reports-leaf-balances.as-of",
        "reports-pack.one-month",
        "reports-pack.twelve-months",
      ].sort(),
    );
    for (const result of reportsResults) {
      expect(result.iterations).toBe(2);
      expect(result.minMs).toBeGreaterThanOrEqual(0);
    }

    // And nothing in the pack may scan: every read is bounded by one trust account and one period,
    // so a scan would mean a document's cost grows with the firm's whole book rather than with the
    // period it covers.
    const reportsPlans = reportsHotPathPlans(reportsHandle);
    expect(reportsPlans.map((plan) => plan.label).sort()).toEqual(
      ["reports-client-ledgers", "reports-journal", "reports-leaf-balances"].sort(),
    );
    expect(findFullScans(reportsPlans, REPORTS_PLAN_SCAN_ALLOWLIST)).toEqual([]);

    snapshot.close();
  });
});
