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
// the producer is the provisioning migrate-to-head path (slice 0·4 firm-provisioner); this slice
// ships the builder so provisioning wires it without a catalog change. Not yet emitted.
export const migrationApplied = defineEvent("migration.applied", ["database", "tag"] as const);

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
// logged (the structural replacement for slice 0·4's interim console.error seam).
export const authDenied = defineEvent("auth.denied", ["cause", "route", "errorId"] as const);

// The catalog's event names — derived from the builders themselves (each carries its `eventName`),
// so this registry cannot drift from the real builders and the uniqueness fitness test checks the
// actual catalog, not a hand-copied parallel list. Adding a builder above adds it here.
export const EVENT_NAMES = [
  requestCompleted,
  errorCaptured,
  outboxSwept,
  migrationApplied,
  emailSent,
  incidentCreated,
  operationFailed,
  outboxDeadLettered,
  authDenied,
].map((builder) => builder.eventName);
