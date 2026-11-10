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
// Objects whose scope was written onto them after the fact. It falls to zero as a firm's existing
// storage is repaired and should stay there — a count that starts rising again is a write path that
// stopped stamping, which is the reason this is a counter and not a one-off backfill signal.
export const storageDimensionStamped = defineMetric("storage.dimension.stamped", [] as const);
// Template objects collected because no version row in any firm's catalogue named them. Template
// registration writes its bytes before the rows that name them commit, so a registration that throws
// after the write leaves a copy behind; this counts what was reclaimed. A rate that stays non-zero is
// a registration path failing repeatedly, not a sweep doing its job.
export const storageTemplateOrphanCollected = defineMetric(
  "storage.template_orphan.found",
  [] as const,
);
// Firms whose collection stopped at the per-firm cap with candidates still listed. A truncated pass
// that said nothing would read as "there was nothing left", so the truncation is a number.
export const storageTemplateOrphanCapReached = defineMetric(
  "storage.template_orphan.cap_reached",
  [] as const,
);

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

// A version's export copy — the document with every tracked change accepted, made once per
// word-processing version the editor cuts and served wherever a copy leaves the platform.
// `produced` counts each outcome of the queue handler (ready, unavailable with its reason, not
// needed); `request_failed` is a save whose direct ask of the queue failed and is relying on the
// relay's backstop; `malformed_payload` is a message that names no version, acked rather than
// retried.
export const exportsCopyProduced = defineMetric("exports.copy.produced", [
  "outcome",
  "reason",
] as const);
export const exportsCopyRequestFailed = defineMetric("exports.copy.request_failed", [
  "reason",
] as const);
export const exportsCopyMalformedPayload = defineMetric("exports.copy.malformed_payload", [
  "topic",
] as const);

// The automatic conflicts re-check path. Every one of these is a counter rather than an event on
// purpose: the RATE is what says whether a firm's screening is keeping up with its records, and the
// per-row detail — a matter, an entity, a cause handle — is firm data with no place in a metric.
// `topic` is the only dimension, and it is a closed label from the cause catalogue.
//
// Between them they answer the operational question the ledger exists to make answerable: are causes
// being noticed (requested), is anything being lost (malformed, no_affected_matters), is the queue
// keeping up (fanout_deferred, drain_budget_exhausted), and is the work getting done (satisfied).
export const conflictsRecheckRequested = defineMetric("conflicts.recheck.requested", [
  "topic",
] as const);
export const conflictsRecheckMalformedCause = defineMetric("conflicts.recheck.malformed_cause", [
  "topic",
] as const);
export const conflictsRecheckNoAffectedMatters = defineMetric(
  "conflicts.recheck.no_affected_matters",
  ["topic"] as const,
);
// A fan-out larger than one relay cycle takes onto the queue. EVERY ledger row was still written —
// this counts what is waiting for the cron backstop, not what was dropped.
export const conflictsRecheckFanoutDeferred = defineMetric("conflicts.recheck.fanout_deferred", [
  "topic",
] as const);
export const conflictsRecheckSatisfied = defineMetric("conflicts.recheck.satisfied", [] as const);
// A drain signal for a matter that had nothing open by the time it ran — the backstop got there
// first, or a redelivery followed a run that already answered. Routine, and worth a number.
export const conflictsRecheckAlreadySatisfied = defineMetric(
  "conflicts.recheck.already_satisfied",
  [] as const,
);
// The drain ran out of wall clock with requests still open. Non-zero and persistent means the firm's
// screening is falling behind its own records, which is the one thing the ledger cannot fix by itself.
export const conflictsRecheckDrainBudgetExhausted = defineMetric(
  "conflicts.recheck.drain_budget_exhausted",
  [] as const,
);
export const conflictsRecheckRescanEnqueued = defineMetric(
  "conflicts.recheck.rescan_enqueued",
  [] as const,
);
// Requests still unsatisfied after a drain pass — the drain-lag gauge. A backlog that only grows is a
// firm whose conflicts screening is falling behind its own records, and nothing else in this set says
// so: `satisfied` counts work done, which looks identical whether the queue is keeping up or not.
export const conflictsRecheckOpenBacklog = defineMetric(
  "conflicts.recheck.open_backlog",
  [] as const,
);

// Document automation. A MERGE-FIELD KEY IS NOT A DIMENSION here: dictionary-declared keys are
// enum-like and would be tolerable, but a firm's own custom-field entries are keyed by firm-defined
// handles, and a rule that admits one and not the other is a rule that gets applied wrongly. `source`
// is the dimension; the key is recorded on the per-firm assembly row instead.
export const documentAssemblyJobs = defineMetric("documentAssembly.jobs", [
  "outcome",
  "stage",
] as const);
// How often each dictionary source fails to resolve — the signal that a firm's templates and a firm's
// data have drifted apart, which is the condition the field inspector exists to repair. `cause`
// separates the two ways that happens, because they call for opposite repairs: `no-value` is data the
// firm has not recorded, while `unresolvable` is a question the firm's data cannot answer as asked —
// a matter with two parties in one Directory role has no single one to name, and the template wants a
// repeating block rather than a data entry. Enum-like, and never the key: a firm's own custom-field
// entries are keyed by firm-defined handles, and a rule that admits one key and not the other is a rule
// that gets applied wrongly.
export const documentAssemblyAbsentField = defineMetric("documentAssembly.absentField", [
  "source",
  "cause",
] as const);
// How often an assembly produces a document containing a Word merge field nobody converted, which
// therefore prints Word's frozen cached text instead of a merged value. The counterpart to the absent
// field: an absence is a value the firm's data could not supply, this is a blank the merge engine was
// never asked to fill, and both end as a document a human has to look at before it is filed. The
// dimension is the construct's FORM, not its name — a Word field name is firm-defined and
// high-cardinality, the same reason a merge-field key is not a dimension.
export const documentAssemblyFrozenField = defineMetric("documentAssembly.frozenMergeField", [
  "form",
] as const);
// How often registration rejects a template and which authoring form it came from — the signal that
// says whether text delimiters were the right primary form.
export const documentTemplateNormalization = defineMetric("documentTemplate.normalization", [
  "outcome",
  "placeholderForm",
] as const);
// How often registration rejects a template EXPRESSION, and which kind of failure it was. This is the
// instrument that says whether the expression language is teachable: a failure kind that dominates is a
// grammar or an error message to fix, not a firm to train. The expression TEXT is never a dimension —
// it names merge fields, and a firm's own custom-field handles are in it.
export const documentTemplateExpressionCheck = defineMetric("documentTemplate.expressionCheck", [
  "outcome",
  "failureKind",
] as const);
// Whether a registration's binding-index write landed. The index is what answers "which templates
// break if this key goes away", so a registration whose bindings did not commit is a template that has
// become invisible to deprecation reporting and to the guard on destroying a firm's own field.
// NO MERGE-FIELD KEY IS EVER A DIMENSION — the existing rule, restated here because a generated
// catalogue makes keys plentiful and the temptation to count them by name grows with it. A key names a
// firm's own custom field as often as it names a platform one, and both are high-cardinality.
export const documentTemplateFieldBinding = defineMetric("documentTemplate.fieldBinding", [
  "outcome",
] as const);
// How each expression site came out at assembly. A rising `unresolved` on conditions is the
// template-and-data drift signal, one layer up from `documentAssembly.absentField`: it says a firm's
// templates are asking questions its data can no longer answer.
export const documentAssemblyExpression = defineMetric("documentAssembly.expression", [
  "outcome",
  "site",
] as const);
// Custodian — the register of physical client originals. Every dimension here is an enum-like label
// from a closed set; a CUSTODY NUMBER is never one, for the same reason a merge-field key is not: it
// is firm-defined, high-cardinality, and printed on a physical object a person can be identified by.
export const custodyMovements = defineMetric("custody.movements", ["kind", "outcome"] as const);
// A periodic gauge of check-outs past their due-back date, in coarse buckets. An overdue check-out is
// THE operational signal a custody register produces, and a firm-level number is worth having in
// aggregate even though no individual packet is nameable here.
export const custodyPacketsOverdue = defineMetric("custody.packetsOverdue", ["bucket"] as const);
// How often a hold actually stops something — the evidence that the blocker is load-bearing rather
// than theoretical.
export const custodyHoldBlocked = defineMetric("custody.holdBlocked", [
  "action",
  "holdKind",
] as const);
// Draw contention on the custody-number counter, mirroring what the matters counter already teaches
// us to watch.
export const custodyNumberDraw = defineMetric("custody.numberDraw", ["outcome"] as const);
// Reminders the register surfaced, by why they surfaced and how long they have been waiting. This is
// the aggregate view of the emission point both review dates and overdue check-outs resolve through,
// so a firm-level "how far behind is this register" is one counter rather than two that can disagree.
export const custodyRemindersDue = defineMetric("custody.remindersDue", [
  "reason",
  "bucket",
] as const);
// Completed reviews, by what was reviewed and whether the cycle rolled forward or ended. A review
// that never reschedules is a firm that set a date once and will not be reminded again.
export const custodyReviewsCompleted = defineMetric("custody.reviewsCompleted", [
  "target",
  "outcome",
] as const);
// Label sheets printed, by what went on them. Nothing identifying is a dimension: a label carries a
// custody number and an identifier handle, and neither is ever counted by value.
export const custodyLabelsRendered = defineMetric("custody.labelsRendered", ["target"] as const);
// Releases the gate let through and turned away, by why. The same argument custody.holdBlocked
// carries: a gate nobody ever trips is either working or unused, and the counter is what tells the
// two apart. `outcome` is a closed set of refusal reasons; the authority a firm asserted is free text
// it wrote and is never a dimension.
export const custodyReleaseGated = defineMetric("custody.releaseGated", ["outcome"] as const);
// The matter asset register. Every dimension is an enum-like label from a closed platform set, and
// nothing that describes a THING is one: no description, address, parcel number, institution name,
// entity name, account suffix, or amount, for the reason the custody dimensions exclude a custody
// number — this register's metadata alone is a disclosure about a family's finances.
// What firms actually log, and where writes fail.
export const matterAssets = defineMetric("matterAssets.assets", ["class", "outcome"] as const);
// Whether the closed basis vocabulary matches what firms really record. This is the evidence for
// ever changing that vocabulary, which is otherwise a guess.
export const matterAssetValuations = defineMetric("matterAssets.valuations", [
  "basis",
  "outcome",
] as const);
// The read the subsystem exists to produce.
export const matterAssetScheduleReads = defineMetric("matterAssets.scheduleReads", [
  "outcome",
] as const);
// How often the ONE full-value decrypt path is used — the check that it stayed exceptional. A path
// nobody ever takes and a path taken forty times a day are different systems, and only the counter
// tells them apart. The identifier, its kind, and its suffix are never dimensions.
export const matterAssetProtectedIdentifierReads = defineMetric(
  "matterAssets.protectedIdentifierReads",
  ["outcome"] as const,
);

// Notifications — the delivery half. `topic` is the only dimension any of these carries, and it is
// enum-like by construction: the values are outbox topic names, which come from a producing
// package's exported constant set rather than from firm data. Deliberately NOT dimensions here: the
// notification kind's subject id, its matter id, and any recipient handle — this subsystem's whole
// premise is that a notification row carries no identifier a reader could resolve without going
// through an access-checked read, and a telemetry dimension is a place that rule would be easy to
// forget. Recipient counts ride the VALUE, never a dimension.
//
// The bus these come off is open and mostly unhandled by design, so a topic that silently stops
// producing notifications looks exactly like a topic nobody subscribed to. That is what the whole
// group exists to distinguish.

// Human verification on the anonymous endpoints — one point per decision, on every protected
// request. A COUNTER rather than an event because the whole question is a rate: how much of the
// traffic at the front door is being checked, how much is being turned away, and how much is walking
// straight through unchecked. That last number is the reason this metric exists at all — an
// anonymous endpoint with no verifier provisioned is exactly as unprotected as it was before the
// gate was built, and the only difference a gate can make while dormant is that the absence has a
// number on it. `outcome` is verified/refused/unenforced/unavailable and `reason` is a closed label
// from the port's own vocabulary; there is deliberately NO dimension a token, an address, or an
// email could occupy.
export const humanVerificationDecided = defineMetric("human_verification.decided", [
  "route",
  "outcome",
  "reason",
] as const);

// Notifications actually written, and the recipient rows they fanned out to. The pair is what makes
// a fan-out bug legible: events steady while recipients collapse is a resolver that stopped
// resolving.
export const notificationsMaterialized = defineMetric("notifications.materialized", [
  "topic",
] as const);
export const notificationsRecipients = defineMetric("notifications.recipients", ["topic"] as const);
// A registered type matched its topic and reached NOBODY. Either a resolver bug or an audience
// nobody has configured, and both are invisible without this — the message acks and the feed simply
// stays empty.
export const notificationsEmptyAudience = defineMetric("notifications.empty_audience", [
  "topic",
] as const);
// Recipients the per-event fan-out cap removed. A fan-out larger than a firm's staff means a
// resolver bug; the cap turns that into a number instead of a mail storm, but only if the clamp is
// counted rather than silently applied.
export const notificationsRecipientsClamped = defineMetric("notifications.recipients_clamped", [
  "topic",
] as const);
// A producer published facts the registered type's own declaration refuses — the producer changed
// shape. PERMANENT, so the message acks; this counter is the only thing standing between that and
// the notifications for one topic quietly ceasing.
export const notificationsRefusedFacts = defineMetric("notifications.refused_facts", [
  "topic",
] as const);
// A translator failure. Acked when an owning handler already committed for the message (retrying
// would re-run it) and retried when none exists, so a persistently non-zero count on a topic with no
// owning handler means messages are marching toward the dead-letter queue rather than being dropped.
export const notificationsTranslateFailed = defineMetric("notifications.translate_failed", [
  "topic",
] as const);
// How many notifications the nightly retention sweep took from members while they were still unread.
// No dimension at all: the members it concerns are exactly what must not reach the dataset, and the
// per-member detail is kept in the firm's own swept-unread tally where that member can read it.
export const notificationsSweptUnread = defineMetric("notifications.swept_unread", [] as const);
// How many shelf items the daily download-register pass took once their retention window closed. No
// dimension at all, for the reason the swept-unread counter carries none: whose export aged out is
// exactly what must not reach the dataset, and the rate is the whole alertable signal — a sudden
// zero means the pass stopped running, and a sudden surge means a producer is writing an expiry it
// should not.
export const downloadsShelfSwept = defineMetric("downloads.shelf_swept", [] as const);
// Findings the per-kind cap removed from one firm's comparison pass before they were considered.
// A comparison is unbounded by nature — "every open deadline past its due instant" is a number the
// firm's own working habits choose — so the read is capped, and a firm reporting this every night is
// a firm being told about some of its overdue work and not the rest. Distinct from
// `recipients_clamped`, which is about how many people heard one thing rather than how many things
// were heard about at all.
export const notificationsComparisonClamped = defineMetric("notifications.comparison_clamped", [
  "topic",
] as const);
// A comparison pass whose TIME-ZONE DISCOVERY was truncated, which is the one way this pass can stop
// finding things without the count above moving. The deadline comparison needs one cutoff per zone
// because no SQLite query can resolve a zone, so it first reads the distinct zones in play; a zone
// that read never returns contributes no cutoff, and every deadline in that zone then matches neither
// the overdue bound nor the due-today window. The pass reports zero findings for a whole jurisdiction
// and `comparison_clamped` stays at zero beside it, which reads as coverage. Kept apart from that
// counter deliberately: a clamp bounds what was missed, and this does not bound it at all — the value
// counts truncated PASSES, because a read that over-reads by one to catch its own truncation learns
// that it truncated and can never learn by how much.
export const notificationsComparisonZoneDiscoveryTruncated = defineMetric(
  "notifications.comparison_zone_discovery_truncated",
  ["topic"] as const,
);
// A member the audience reached who got no feed row because a preference silenced the category.
// The one counter in this group that exists to make an ABSENCE visible: every other one counts
// something that happened, and this counts something that deliberately did not. Without it a
// working preference and a broken fan-out produce the same observable — nothing — and the platform
// can neither reassure a member nor find the fault. `category` and `reason` are both closed labels;
// how many people rides the value, never a dimension, and no member appears here at all (the
// per-member detail is in the firm's own tally, where that member can read it).
export const notificationsSuppressedByPreference = defineMetric(
  "notifications.suppressed_by_preference",
  ["category", "reason"] as const,
);
// Recipients a firm's trust-compliance designation added over a kind's own audience. Counted
// because a designation that quietly reaches nobody — an empty list, a member who has left — is
// precisely the kind of control a firm believes is working.
export const notificationsDesignatedRecipients = defineMetric(
  "notifications.designated_recipients",
  ["category"] as const,
);
// Summaries that actually left the platform, by cadence. The pair with `digest_items` below is what
// makes a mailing legible: summaries steady while items collapse is a window that has stopped
// filling, and items steady while summaries collapse is a send path that has stopped sending.
// `cadence` is a closed label; no member, no firm, and no address appears here or anywhere near it.
export const notificationsDigestSent = defineMetric("notifications.digest_sent", [
  "cadence",
] as const);
export const notificationsDigestItems = defineMetric("notifications.digest_items", [
  "cadence",
] as const);
// A copy that did NOT leave, by the closed reason it did not — the counter that keeps an unsent
// email as visible as a sent one. Without it, a member who chose not to be mailed and a member the
// platform silently failed to mail produce the same observable, which is the failure mode a
// preference system has and the one this subsystem already refuses in app.
export const notificationsDigestSuppressed = defineMetric("notifications.digest_suppressed", [
  "reason",
] as const);
// The whole channel is unprovisioned on this deployment: no send binding, no verified sender, or no
// public origin to link to. Counted every pass rather than logged once, because "the digest has
// never run here" and "the digest ran and had nothing to say" are different facts and only the
// first is a deployment step somebody still owes. `reason` is the port's own closed vocabulary.
export const notificationsDigestUnavailable = defineMetric("notifications.digest_unavailable", [
  "reason",
] as const);
// Members one firm's pass could not consider because the per-run cap removed them. A firm's staff is
// the natural bound and the cap sits far above any plausible one, so a non-zero value is a fan-out
// fault rather than a busy day.
export const notificationsDigestRecipientsClamped = defineMetric(
  "notifications.digest_recipients_clamped",
  ["cadence"] as const,
);
// Rows a kind declaring `immediate` stopped a summary's walk at. No registered kind declares one, so
// a non-zero value means a type was added without the immediate send path it needs — and the walk
// halted rather than folding a compliance-grade notice into a day's counts.
export const notificationsDigestRefusedEscalation = defineMetric(
  "notifications.digest_refused_escalation",
  ["cadence"] as const,
);

// A transactional email that did NOT go out, by the path that asked for it and the class of message
// it was. The `email.sent` event already records a failed outcome at the adapter, but only the
// adapter that has a real binding emits one — a deployment whose mail is not switched on resolves
// the logging adapter and reports nothing at all, which is exactly the deployment where nobody is
// receiving anything. This counter is raised by the CALLER instead, so "a person was not mailed" is
// a number on every path and in every environment. `surface` is a route template or a consumer
// name; `messageClass` is the port's own non-content tag. There is deliberately no dimension an
// address, a subject, a link or a body could occupy.
export const emailDeliveryFailed = defineMetric("email.delivery_failed", [
  "surface",
  "messageClass",
] as const);

// One address-autocomplete request, by what was asked, which engine answered and how it came out.
// This is the number that drives the provider's bill, and `outcome: failed` beginning to climb is the
// first sign the provider has refused — a spent subscription answers exactly that way. There is
// deliberately no dimension that could hold what was typed: the query is a client's address.
//   operation: suggest | resolve
//   engine:    smarty | deferred
//   outcome:   suggestions | address | group | expired | no-coverage | unavailable | failed
export const addressesLookup = defineMetric("addresses.lookup", [
  "operation",
  "engine",
  "outcome",
] as const);

// One paid caller-identity lookup a member pressed for, by which engine answered and how it came
// out. Every `found` is a billed query, so this is the number that drives the provider's bill, and
// `failed` climbing is the first sign the key was revoked or the balance ran out. `cached` is a press
// answered from the firm's kept answer, which cost nothing. No dimension can hold the number or the
// name: both are a person's.
//   engine:  telnyx | deferred
//   outcome: found | cached | not-covered | unavailable | failed
export const communicationsCallerLookup = defineMetric("communications.caller_lookup", [
  "engine",
  "outcome",
] as const);

// The catalog itself, derived from the declarations above so it cannot drift from them.
// Task copies the scheduled pass wrote for repeating tasks that fall due by date rather than on
// completion. A firm with repeating tasks and a flat zero here means the cron pass stopped writing.
export const tasksRecurringWrites = defineMetric("tasks.recurring_writes", [] as const);

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
  storageDimensionStamped,
  storageTemplateOrphanCollected,
  storageTemplateOrphanCapReached,
  backfillRowsAffected,
  costsRecoveryMalformedPayload,
  costsRecoveryShipmentMissing,
  costsRecoveryRejected,
  costsRecoveryReplayedAfterPurge,
  costsRecoveryFingerprintMismatch,
  costsRecoveryUnhandledTopic,
  conflictsRecheckRequested,
  conflictsRecheckMalformedCause,
  conflictsRecheckNoAffectedMatters,
  conflictsRecheckFanoutDeferred,
  conflictsRecheckSatisfied,
  conflictsRecheckAlreadySatisfied,
  conflictsRecheckDrainBudgetExhausted,
  conflictsRecheckRescanEnqueued,
  conflictsRecheckOpenBacklog,
  documentAssemblyJobs,
  documentAssemblyAbsentField,
  documentAssemblyFrozenField,
  documentTemplateNormalization,
  documentTemplateExpressionCheck,
  documentAssemblyExpression,
  custodyMovements,
  custodyPacketsOverdue,
  custodyHoldBlocked,
  custodyNumberDraw,
  custodyRemindersDue,
  custodyReviewsCompleted,
  custodyLabelsRendered,
  custodyReleaseGated,
  matterAssets,
  matterAssetValuations,
  matterAssetScheduleReads,
  matterAssetProtectedIdentifierReads,
  humanVerificationDecided,
  notificationsMaterialized,
  notificationsRecipients,
  notificationsEmptyAudience,
  notificationsRecipientsClamped,
  notificationsRefusedFacts,
  notificationsTranslateFailed,
  notificationsSweptUnread,
  notificationsComparisonClamped,
  notificationsComparisonZoneDiscoveryTruncated,
  notificationsSuppressedByPreference,
  notificationsDesignatedRecipients,
  notificationsDigestSent,
  notificationsDigestItems,
  notificationsDigestSuppressed,
  notificationsDigestUnavailable,
  notificationsDigestRecipientsClamped,
  notificationsDigestRefusedEscalation,
  emailDeliveryFailed,
  downloadsShelfSwept,
  addressesLookup,
  communicationsCallerLookup,
  exportsCopyProduced,
  exportsCopyRequestFailed,
  exportsCopyMalformedPayload,
  tasksRecurringWrites,
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
