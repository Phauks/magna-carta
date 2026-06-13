// The event catalog (spec §1) — telemetry grows by ADDING a builder here, never by free-form
// logging. Each builder enumerates exactly its loggable fields (the three-class model: technical
// metadata always; opaque identifier handles allowed; content fields have no slot to exist in).
import { defineEvent } from "./event.ts";

// request.completed — one per served request (route TEMPLATE, never the concrete path, which can
// embed matter numbers; decided #2).
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

// outbox.swept — the relay sweep result (one per sweep).
export const outboxSwept = defineEvent("outbox.swept", [
  "database",
  "dispatched",
  "failed",
  "deadLettered",
] as const);

// migration.applied — a per-database migration apply.
export const migrationApplied = defineEvent("migration.applied", ["database", "tag"] as const);

// email.sent — a transactional email send outcome (never the body).
export const emailSent = defineEvent("email.sent", ["messageClass", "outcome"] as const);

// incident.created — a user-reported incident landed (the diagnostics agent's future feed).
export const incidentCreated = defineEvent("incident.created", [
  "incidentId",
  "errorIdCount",
] as const);

// telemetry.scrubbed — the backstop tripwire fired (scrub.ts found a denylisted shape the allowlist
// let through). A non-zero count in tests fails the suite (decided #3).
export const telemetryScrubbed = defineEvent("telemetry.scrubbed", ["eventName", "field"] as const);

// auth.denied — a route-specific auth guard refused a request. The platform-admin guard logs the
// denial CAUSE (the operator signal — `unconfigured`/`missing-header`/`mismatch`) against the same
// errorId the client receives, while the client still sees one field-identical 401. The allowlist is
// the redaction: there is NO field for the presented or configured key, so neither can ever be
// logged (the structural replacement for slice 0·4's interim console.error seam).
export const authDenied = defineEvent("auth.denied", ["cause", "route", "errorId"] as const);

// The catalog's event names — used by the uniqueness fitness test and as a registry of what may be
// logged. Keep in sync with the builders above.
export const EVENT_NAMES = [
  "request.completed",
  "error.captured",
  "outbox.swept",
  "migration.applied",
  "email.sent",
  "incident.created",
  "telemetry.scrubbed",
  "auth.denied",
] as const;
