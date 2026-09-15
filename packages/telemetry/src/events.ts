// The event catalog — telemetry grows by ADDING a builder here, never by free-form logging. Each
// builder enumerates exactly its loggable fields (the three-class model: technical metadata always;
// opaque identifier handles allowed; content fields have no slot to exist in).
import { defineEvent } from "./event.ts";

// request.completed — one per served request (route TEMPLATE, never the concrete path, which can
// embed matter numbers).
export const requestCompleted = defineEvent("request.completed", [
  "route",
  "method",
  "status",
  "durationMs",
] as const);

// error.captured — an escaped exception. messageHead is the first slice of error.message; the
// scrubber backstops it (the message could carry user content).
export const errorCaptured = defineEvent("error.captured", [
  "errorId",
  "route",
  "method",
  "errorName",
  "messageHead",
] as const);

// outbox.swept — the relay sweep result, one per sweep (database + dispatched/failed/deadLettered
// counts). WIRED by the scheduled sweep: a successful pass emits this so sweep volume is observable,
// not just failures.
export const outboxSwept = defineEvent("outbox.swept", [
  "database",
  "dispatched",
  "failed",
  "deadLettered",
] as const);

// migration.applied — a per-database migration apply ({ database, tag }). DEFINED-FOR-WIRING seam:
// the producer is the provisioning migrate-to-head path (apps/api-worker/src/firm-provisioner-wiring.ts).
// The builder ships ahead of that wiring so the producer needs no catalog change. Not yet emitted.
export const migrationApplied = defineEvent("migration.applied", ["database", "tag"] as const);

// migration.arrivedOutOfOrder — a migration applied to a database that had already applied a
// LATER-tagged one ({ database, tag, ledgerHead }). Apply order is tag order, so this database met
// the pair in a different order than one provisioned afterwards will. Not a failure: the migration
// is applied and the schema is at head. It is emitted because this is the only moment the fact
// exists — the ledger it lands in is a set of tags, with nothing recording which arrived late — and
// because for two migrations that touch the same objects it is the only thing that would say which
// firms carry a different schema. One event per tag: fields are flat, so a list has no slot.
export const migrationArrivedOutOfOrder = defineEvent("migration.arrivedOutOfOrder", [
  "database",
  "tag",
  "ledgerHead",
] as const);

// email.sent — a transactional email send outcome (never the body).
export const emailSent = defineEvent("email.sent", ["messageClass", "outcome"] as const);

// incident.created — a user-reported incident landed (the diagnostics agent's future feed).
export const incidentCreated = defineEvent("incident.created", [
  "incidentId",
  "errorIdCount",
] as const);

// telemetry.scrubbed is a COUNTER, not an event — the scrub backstop bumps a counter, it does not
// log a per-trip event. The Workers logger records each trip via count("telemetry.scrubbed", …)
// — an Analytics Engine metric, the aggregatable tripwire signal. There is deliberately no event
// builder for it (a per-trip log line would be noise on the hot path).

// operation.failed — a caught error in a NON-request context (a cron sweep, a best-effort
// post-response sweep, an unguarded auth hook). The request path uses error.captured; this is its
// background counterpart, carrying the operation label instead of a route/method. messageHead is
// scrubbed by the logger.
export const operationFailed = defineEvent("operation.failed", [
  "operation",
  "errorName",
  "messageHead",
  "errorId",
] as const);

// outbox.deadLettered — the relay exhausted a message's delivery attempts and parked it (an
// operational outcome, not an error). ids + topic + attempts only — payloads are never logged
// (redact by default; the allowlist has no payload slot anyway).
export const outboxDeadLettered = defineEvent("outbox.deadLettered", [
  "scope",
  "outboxId",
  "topic",
  "attempts",
] as const);

// auth.denied — a route-specific auth guard refused a request. The platform-admin guard logs the
// denial CAUSE (the operator signal — `unconfigured`/`missing-header`/`mismatch`) against the same
// errorId the client receives, while the client still sees one field-identical 401. The allowlist is
// the redaction: there is NO field for the presented or configured key, so neither can ever be
// logged — the structural replacement for the raw console.error the guard used to reach for, which
// had no such slot discipline.
export const authDenied = defineEvent("auth.denied", ["cause", "route", "errorId"] as const);

// ingest.verdict — one per terminal ingest outcome (commit or quarantine). Redaction is structural:
// there is NO slot for file id, name, r2 key, or content — only the scan verdict and the outcome
// classification. This makes infected/quarantine rates observable without logging anything that
// identifies the file or its uploader.
export const ingestVerdict = defineEvent("ingest.verdict", [
  "outcome",
  "scanVerdict",
  "scanDetail",
  "quarantineReason",
] as const);

// usage.feature — a product-usage signal: a feature was reached (an authorized route mapped to it
// was served) or completed (an authoritative domain mutation for it occurred). Identifiers are
// pseudonymous HMAC handles, never raw ids; surface/userIdHash/appVersion are null when the emit
// site cannot supply them (server-derived reached/completed). No content slot exists.
export const usageFeature = defineEvent("usage.feature", [
  "feature",
  "phase",
  "surface",
  "firmIdHash",
  "userIdHash",
  "appVersion",
] as const);

// document.assembled — one per finished assembly job. Redaction is structural: there is NO slot for a
// template name, a matter identifier, a merge-field key, or a resolved value — only the outcome
// classification, an error code from a closed set, and how many fields the matter could not supply.
// That makes the "documents are being filed with holes in them" signal observable without any of the
// document's content, and the absent KEYS (never values) are recorded on the assembly row instead,
// which is per-firm data behind the firm-scoped data-access layer rather than cross-firm analytics.
export const documentAssembled = defineEvent("document.assembled", [
  "outcome",
  "reason",
  "absenceCount",
] as const);

// custody.movementRecorded — one per appended row of the physical-custody ledger. The redaction is
// structural: there is NO slot for a packet handle, a custody number, a location name, a borrower, or
// an item description. That matters more here than almost anywhere else — the register is a list of
// the most sensitive things a firm holds, and its metadata alone is a disclosure ("this firm holds an
// original will for Jane Smith" needs no document attached). What remains is the shape of the
// activity: which kind of event, which class of borrower, and whether a carrier was involved.
export const custodyMovementRecorded = defineEvent("custody.movementRecorded", [
  "kind",
  "borrowerKind",
  "hasShipment",
] as const);

// matterAssets.assetRecorded — one per asset added to a matter's register. The redaction is
// structural, exactly as the custody ledger's is and for the same reason: this register concentrates
// what a family owns and what it is worth, so there is NO slot for a description, an address, a
// parcel number, an entity name, an account suffix, or an amount. What remains is the shape of the
// activity: which class of thing, and whether it arrived one at a time or in a bulk entry (which is
// how "is quick entry actually being used" gets answered without reading a single row).
export const matterAssetRecorded = defineEvent("matterAssets.assetRecorded", [
  "class",
  "entryMode",
] as const);

// ── Natural-language document search ────────────────────────────────────────
//
// Three events, and none of them has a slot for a member's question or a passage of a document. A
// member's natural-language question about a client matter is privileged content and the fields
// below are identifiers, counts, and closed labels — there is no declared key any of it could
// travel in.

// search.naturalLanguage.hitDropped — a hit the managed index returned whose pointer FAILED
// re-authorization through the firm-scoped data-access layer, and was therefore dropped before any
// of its text was returned.
//
// THIS IS THE HIGHEST-SEVERITY SIGNAL IN THE FEATURE and is never a routine condition. The index is
// scoped by a metadata filter that is an optimization rather than a boundary, so a returned pointer
// the caller may not see means either that filter did not do what it was asked or that the index
// holds something the feed should never have produced — both platform defects of the most serious
// kind. `check` names which re-authorization step refused, so the two are distinguishable without
// anybody reading the document.
//
// The count of drops is never returned to the caller: "your query matched fourteen passages you are
// not permitted to see" is itself a disclosure, and a measurable one. It goes here instead, to the
// people who can act on it.
export const naturalLanguageHitDropped = defineEvent("search.naturalLanguage.hitDropped", [
  "matterId",
  "objectKey",
  "check",
] as const);

// search.naturalLanguage.instanceOperationFailed — a provisioning or teardown job could not do what
// it was asked. `operation` is provision | teardown; `reason` is the port's closed failure label.
// A teardown failure matters more than a provisioning one: a firm has withdrawn consent and the
// request to delete the managed index did not land, which is a thing somebody has to finish by hand.
export const naturalLanguageInstanceOperationFailed = defineEvent(
  "search.naturalLanguage.instanceOperationFailed",
  ["operation", "reason", "instanceName"] as const,
);

// search.naturalLanguage.feedReconciliationMismatch — the feed catalog and the bucket disagree.
// Either direction is an inconsistency worth raising: an object with no live catalog row means
// something reached the feed prefix outside the writer, or a recorded deletion never executed; a
// live row with no object means a write was recorded and the bytes are gone. Counts only — the keys
// themselves are in the catalog, which is where somebody investigating will look.
export const naturalLanguageFeedReconciliationMismatch = defineEvent(
  "search.naturalLanguage.feedReconciliationMismatch",
  ["objectsWithoutLiveRow", "liveRowsWithoutObject"] as const,
);

// The catalog's event names — derived from the builders themselves (each carries its `eventName`),
// so this registry cannot drift from the real builders and the uniqueness fitness test checks the
// actual catalog, not a hand-copied parallel list. Adding a builder above adds it here.
export const EVENT_NAMES = [
  requestCompleted,
  errorCaptured,
  outboxSwept,
  migrationApplied,
  migrationArrivedOutOfOrder,
  emailSent,
  incidentCreated,
  operationFailed,
  outboxDeadLettered,
  authDenied,
  ingestVerdict,
  usageFeature,
  documentAssembled,
  custodyMovementRecorded,
  matterAssetRecorded,
  naturalLanguageHitDropped,
  naturalLanguageInstanceOperationFailed,
  naturalLanguageFeedReconciliationMismatch,
].map((builder) => builder.eventName);
