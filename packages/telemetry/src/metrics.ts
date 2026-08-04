// The metric catalog — the counter-side twin of the event catalog (events.ts). Counters grow by
// ADDING a declaration here, never by a free-form `count()` call, and each declaration fixes two
// things the emission path had no way to know on its own:
//
//   1. The ORDERED dimension keys. Analytics Engine stores dimensions as positional blob columns, so
//      the column contract used to be whichever order each call site happened to write its object
//      literal in. Swapping two keys in a literal — an edit no reviewer would question — silently
//      re-labelled every column of that metric in the dataset, and nothing anywhere compared one
//      call site's order to another's. Laying blobs out from this tuple makes the contract a single
//      declared fact instead of an accident of source order.
//   2. WHICH dimension keys exist at all. That makes the counter path an allowlist, matching the
//      event path: a key nobody declared has no column to land in, so it cannot carry content into
//      the dataset. Values are additionally scrubbed on the way out (the Workers logger applies the
//      scrub.ts denylist), because a declared dimension can still be handed the wrong string —
//      `topic` on the unhandled-topic counter, for instance, comes off a queue message.
//
// Dimension values must stay LOW CARDINALITY: they are enum-like labels (a route template, an error
// code, a feature name), never identifiers, never free text.

export interface MetricDefinition {
  readonly metricName: string;
  readonly dimensionKeys: readonly string[];
}

export function defineMetric(
  metricName: string,
  dimensionKeys: readonly string[],
): MetricDefinition {
  return { metricName, dimensionKeys };
}

// Telemetry's own tripwires — the counters the pipeline raises against itself. Each one names the
// event or metric that misbehaved and the field/dimension responsible, never the offending value:
// the value is exactly what must not reach the dataset, which is why the counter exists.

// A string field matched the scrub denylist on its way out of the logger. Non-zero means a builder
// declared a field that carried content it should not have.
export const scrubbedField = defineMetric("telemetry.scrubbed", ["eventName", "field"] as const);

// A declared event field was handed something that is not a flat primitive (an object, an array, a
// bigint). The value was replaced before it could be serialised; this names the call site to fix.
export const unloggableField = defineMetric("telemetry.unloggable", [
  "eventName",
  "field",
] as const);

// A dimension value matched the scrub denylist. Non-zero means a call site is passing content, not a
// label, into a counter dimension.
export const scrubbedDimension = defineMetric("telemetry.metric_scrubbed", [
  "metric",
  "dimension",
] as const);

// A counter named a metric, or a dimension key, that is not declared below. The undeclared part is
// dropped rather than guessed at; `dimension` is empty when the metric itself is the undeclared one.
export const undeclaredMetric = defineMetric("telemetry.metric_undeclared", [
  "metric",
  "dimension",
] as const);

// Product usage. The blob layout here is the stable contract the canonical usage queries read
// (docs/analytics/usage-queries.md): blob1 is the metric name, then feature, phase, surface.
export const usage = defineMetric("usage", ["feature", "phase", "surface"] as const);

// Background sweeps and reconciliation. Each is a self-healing operational signal whose RATE is the
// alertable fact, which is why it rides a counter rather than a per-occurrence event.
export const ingestStrandedPendingRedriven = defineMetric(
  "ingest.stranded_pending_redriven",
  [] as const,
);
export const reconciliationUnprovisioned = defineMetric(
  "reconciliation.unprovisioned",
  [] as const,
);
export const storageReconciliationCorrected = defineMetric(
  "storage.reconciliation.corrected",
  [] as const,
);
export const statusSnapshotComponents = defineMetric("status.snapshot.components", [] as const);

// One-off idempotent backfill progress. The backfill NAME is a dimension rather than part of the
// metric name: a name interpolated into the metric itself cannot be declared here, and it would make
// every new backfill a new Analytics Engine index for a signal that is always read the same way.
export const backfillRowsAffected = defineMetric("backfill.rows_affected", ["backfill"] as const);

// Recoverable-charge queue consumer outcomes — the terminal drops and drifts that are acked rather
// than retried, and would otherwise be invisible.
export const costsRecoveryMalformedPayload = defineMetric(
  "costs.recovery.malformed_payload",
  [] as const,
);
export const costsRecoveryShipmentMissing = defineMetric(
  "costs.recovery.shipment_missing",
  [] as const,
);
export const costsRecoveryRejected = defineMetric("costs.recovery.rejected", ["code"] as const);
export const costsRecoveryReplayedAfterPurge = defineMetric(
  "costs.recovery.replayed_after_purge",
  [] as const,
);
export const costsRecoveryFingerprintMismatch = defineMetric(
  "costs.recovery.fingerprint_mismatch",
  ["recoveryCategory"] as const,
);
export const costsRecoveryUnhandledTopic = defineMetric("costs.recovery.unhandled_topic", [
  "topic",
] as const);

// Document automation. A MERGE-FIELD KEY IS NOT A DIMENSION here: dictionary-declared keys are
// enum-like and would be tolerable, but a firm's own custom-field entries are keyed by firm-defined
// handles, and a rule that admits one and not the other is a rule that gets applied wrongly. `source`
// is the dimension; the key is recorded on the per-firm assembly row instead.
export const documentAssemblyJobs = defineMetric("documentAssembly.jobs", [
  "outcome",
  "stage",
] as const);
// How often each dictionary source fails to resolve — the signal that a firm's templates and a firm's
// data have drifted apart, which is the condition the field inspector exists to repair.
export const documentAssemblyAbsentField = defineMetric("documentAssembly.absentField", [
  "source",
] as const);
// How often registration rejects a template and which authoring form it came from — the signal that
// says whether text delimiters were the right primary form.
export const documentTemplateNormalization = defineMetric("documentTemplate.normalization", [
  "outcome",
  "placeholderForm",
] as const);

// The catalog itself, derived from the declarations above so it cannot drift from them.
const CATALOG: readonly MetricDefinition[] = [
  scrubbedField,
  unloggableField,
  scrubbedDimension,
  undeclaredMetric,
  usage,
  ingestStrandedPendingRedriven,
  reconciliationUnprovisioned,
  storageReconciliationCorrected,
  statusSnapshotComponents,
  backfillRowsAffected,
  costsRecoveryMalformedPayload,
  costsRecoveryShipmentMissing,
  costsRecoveryRejected,
  costsRecoveryReplayedAfterPurge,
  costsRecoveryFingerprintMismatch,
  costsRecoveryUnhandledTopic,
  documentAssemblyJobs,
  documentAssemblyAbsentField,
  documentTemplateNormalization,
];

const BY_NAME = new Map(CATALOG.map((definition) => [definition.metricName, definition]));

// Declaration order, which is grouped by subsystem — the useful order for reading the catalog. No
// consumer depends on it: the emission path looks metrics up by name, and the fitness tests treat
// this as a set.
export const METRIC_NAMES: readonly string[] = CATALOG.map((definition) => definition.metricName);

// The lookup the emission path uses. `undefined` means "not declared" — the caller drops the point
// rather than inventing a column layout for it.
export function metricDefinition(metricName: string): MetricDefinition | undefined {
  return BY_NAME.get(metricName);
}
