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
  conflictsCandidateBounds,
  conflictsHotPathPlans,
  conflictsMatcherBounds,
  conflictsMeasurementHandle,
  conflictsMeasurements,
  CONFLICTS_PLAN_SCAN_ALLOWLIST,
} from "./conflicts-measurements.ts";
import {
  documentAutomationHotPathPlans,
  documentAutomationMeasurementHandle,
  documentAutomationMeasurements,
  DOCUMENT_AUTOMATION_PLAN_SCAN_ALLOWLIST,
} from "./document-automation-measurements.ts";
import {
  trustHotPathPlans,
  trustMeasurementHandle,
  trustMeasurements,
  TRUST_PLAN_SCAN_ALLOWLIST,
} from "./trust-measurements.ts";
import {
  custodianHotPathPlans,
  custodianMeasurementHandle,
  custodianMeasurements,
  CUSTODIAN_PLAN_SCAN_ALLOWLIST,
} from "./custodian-measurements.ts";
import {
  reportsHotPathPlans,
  reportsMeasurementHandle,
  reportsMeasurements,
  REPORTS_PLAN_SCAN_ALLOWLIST,
} from "./reports-measurements.ts";
import {
  calendarHotPathPlans,
  calendarMeasurementHandle,
  calendarMeasurements,
  timelinePageBounds,
  CALENDAR_PLAN_SCAN_ALLOWLIST,
} from "./calendar-measurements.ts";
import { ledgerVolume } from "./profile.ts";
import {
  baselineEnvironment,
  findFullScans,
  runMeasurements,
  writeBaselineFile,
} from "./runner.ts";
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
  `snapshot ${snapshot.cacheKey}: ${snapshot.manifest.entryCount} entries, ${snapshot.manifest.matterCount} matters, ${snapshot.manifest.fileCount} files (${snapshot.manifest.fileVersionCount} versions), ${snapshot.manifest.folderCount} folders, ${snapshot.manifest.incidentCount} sealed incidents, ${snapshot.manifest.firmSecretCount} firm secrets, ${snapshot.manifest.directoryPersonCount} persons, ${snapshot.manifest.directoryOrganizationCount} organizations, ${snapshot.manifest.shipmentCount} shipments (${snapshot.manifest.trackingEventCount} tracking events), ${snapshot.manifest.customFieldDefinitionCount} custom fields (${snapshot.manifest.customFieldValueCount} values), ${snapshot.manifest.timeEntryCount} time entries (${snapshot.manifest.rateCount} rates, ${snapshot.manifest.rateCardCount} cards), ${snapshot.manifest.documentTemplateCount} document templates (${snapshot.manifest.documentTemplateVersionCount} versions, ${snapshot.manifest.documentFormTemplateCount} fillable forms, ${snapshot.manifest.archivedDocumentTemplateCount} archived), ${snapshot.manifest.documentAssemblyCount} assemblies, ${snapshot.manifest.documentFieldMappingCount} field mappings, ${snapshot.manifest.trustLedgerNodeCount} trust ledger nodes (${snapshot.manifest.trustMovementCount} movements, ${snapshot.manifest.trustHoldCount} holds), ${snapshot.manifest.trustBankStatementCount} bank statements (${snapshot.manifest.trustBankStatementLineCount} lines), ${snapshot.manifest.trustReconciliationCount} reconciliations (${snapshot.manifest.trustReconciliationMatchCount} matches) (profile v${snapshot.manifest.profile.version})`,
);

console.log(
  `custody: ${snapshot.manifest.custodyLocationCount} container nodes, ${snapshot.manifest.custodyPacketCount} packets (${snapshot.manifest.custodyItemCount} items), ${snapshot.manifest.custodyMovementCount} ledger movements, ${snapshot.manifest.custodyHoldCount} holds · calendar: ${snapshot.manifest.matterEventCount} matter events (${snapshot.manifest.matterEventParticipantCount} participants), ${snapshot.manifest.matterDeadlineCount} deadlines, ${snapshot.manifest.firmEventCount} firm events, ${snapshot.manifest.firmResourceCount} resources (${snapshot.manifest.firmResourceBookingCount} bookings)`,
);

// The automation handle is built before the scan gate: its plan probes bind to the probe manifest's
// own custom-field handles, so the handle has to exist before the plans can be taken.
const automationHandle = await documentAutomationMeasurementHandle(snapshot);
// The calendar's plan probes are built from the registry's own statement builders and its join-key
// pre-reads, so its handle and its plans are both resolved before the gate too.
const calendarHandle = calendarMeasurementHandle(snapshot);
// The conflicts handle is built before the gate too: the matcher's statement-count bound below binds
// to it, and it is the number that catches an N+1 a plan cannot see and a timing would only show
// once the corpus outgrew the noise.
const conflictsHandle = await conflictsMeasurementHandle(snapshot, BASELINE_SEED);

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
  ...findFullScans(
    documentAutomationHotPathPlans(automationHandle),
    DOCUMENT_AUTOMATION_PLAN_SCAN_ALLOWLIST,
  ),
  ...findFullScans(trustHotPathPlans(snapshot), TRUST_PLAN_SCAN_ALLOWLIST),
  ...findFullScans(custodianHotPathPlans(snapshot), CUSTODIAN_PLAN_SCAN_ALLOWLIST),
  ...findFullScans(await calendarHotPathPlans(calendarHandle), CALENDAR_PLAN_SCAN_ALLOWLIST),
  ...findFullScans(
    reportsHotPathPlans(reportsMeasurementHandle(snapshot)),
    REPORTS_PLAN_SCAN_ALLOWLIST,
  ),
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
  ...(await runMeasurements(conflictsHandle, conflictsMeasurements, {
    warmupIterations: 3,
    iterations: 30,
  })),
  ...(await runMeasurements(automationHandle, documentAutomationMeasurements, {
    warmupIterations: 3,
    iterations: 30,
  })),
  ...(await runMeasurements(trustMeasurementHandle(snapshot), trustMeasurements, {
    warmupIterations: 3,
    iterations: 30,
  })),
  ...(await runMeasurements(
    custodianMeasurementHandle(snapshot, BASELINE_SEED),
    custodianMeasurements,
    { warmupIterations: 3, iterations: 30 },
  )),
  ...(await runMeasurements(calendarHandle, calendarMeasurements, {
    warmupIterations: 3,
    iterations: 30,
  })),
  // Reporting last, because it reads over everything the stages above laid down.
  ...(await runMeasurements(reportsMeasurementHandle(snapshot), reportsMeasurements, {
    warmupIterations: 3,
    iterations: 30,
  })),
];
for (const result of results) {
  console.log(
    `${result.name}: median ${result.medianMs}ms · p95 ${result.p95Ms}ms · min ${result.minMs}ms (${result.iterations} iterations)`,
  );
}

// The federated read's own counts, printed beside the timings. They are the numbers that catch an
// N+1 the moment somebody adds a per-row lookup to a projection — a plan cannot see that, and a
// timing would only show it once the corpus was large enough for the difference to clear the noise.
const timelineBounds = await timelinePageBounds(calendarHandle);
for (const bound of timelineBounds) {
  console.log(
    `${bound.label}: ${bound.statementCount} statements over ${bound.sourcesRead} sources · ${bound.rowsRead} rows read · ${bound.entriesReturned} entries returned`,
  );
}

// The batched conflicts matcher's own count, for the same reason: the whole claim of the batch is
// that its query count follows the channel count rather than the entity count, and only a count can
// state that.
const matcherBounds = await conflictsMatcherBounds(conflictsHandle);
for (const bound of matcherBounds) {
  console.log(
    `${bound.label}: ${bound.statementCount} statements over ${bound.subjectCount} subjects`,
  );
}

// Where the candidates come from, and how many of them there are per subject. The closure cap bounds
// the walk; these bound nothing — they REPORT the quantity the second cap exists for, so that reading
// two baselines taken at different profile scales shows the slope against the corpus rather than one
// number at one size.
const candidateBounds = await conflictsCandidateBounds(conflictsHandle);
for (const bound of candidateBounds) {
  console.log(
    `${bound.label}: ${bound.candidateCount} candidates over ${bound.subjectCount} subjects against a corpus of ${bound.corpusOfKind} (trigram-only ${bound.trigramOnlyCandidates}, phonetic ${bound.phoneticCandidates}, exact name ${bound.exactNameCandidates}, match key ${bound.matchKeyCandidates}, bare match key ${bound.bareMatchKeyCandidates}, identifier ${bound.identifierCandidates})`,
  );
}

const baselineDirectory = join(import.meta.dirname, "..", "..", "baselines");
mkdirSync(baselineDirectory, { recursive: true });
const baselinePath = join(baselineDirectory, `${ledgerVolume.name}-v${ledgerVolume.version}.json`);
writeBaselineFile(baselinePath, {
  profileName: ledgerVolume.name,
  profileVersion: ledgerVolume.version,
  cacheKey: snapshot.cacheKey,
  // Which machine produced these. Without it a reader diffing two baselines cannot tell a regression
  // from a different laptop, which is the one mistake the relative-numbers rule most invites.
  environment: baselineEnvironment(),
  results,
  bounds: [
    ...timelineBounds.map((bound) => ({
      name: bound.label,
      statementCount: bound.statementCount,
      rowsRead: bound.rowsRead,
      sourcesRead: bound.sourcesRead,
      entriesReturned: bound.entriesReturned,
    })),
    ...matcherBounds.map((bound) => ({
      name: bound.label,
      statementCount: bound.statementCount,
      rowsRead: 0,
      sourcesRead: bound.subjectCount,
      entriesReturned: 0,
    })),
    ...candidateBounds.map((bound) => ({
      name: bound.label,
      statementCount: 0,
      rowsRead: 0,
      sourcesRead: bound.subjectCount,
      entriesReturned: bound.candidateCount,
      counts: {
        corpusOfKind: bound.corpusOfKind,
        trigramOnlyCandidates: bound.trigramOnlyCandidates,
        matchKeyCandidates: bound.matchKeyCandidates,
        bareMatchKeyCandidates: bound.bareMatchKeyCandidates,
        phoneticCandidates: bound.phoneticCandidates,
        exactNameCandidates: bound.exactNameCandidates,
        identifierCandidates: bound.identifierCandidates,
      },
    })),
  ],
});
console.log(`baseline written: ${baselinePath}`);
snapshot.close();
