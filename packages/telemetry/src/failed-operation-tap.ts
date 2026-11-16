// A second destination for `operation.failed`, the event a failure nobody was shown is logged as (a
// sweep, a queue consumer, a Cron pass, a step behind a response). Workers Logs keeps every such
// line, but reading them back needs an account token a deployment may not hold, so a Worker that
// keeps its own record of failures installs a tap here and the Workers logger hands it each one.
//
// Module state, for the reason service-identity.ts gives: an isolate serves one Worker, and the
// alternative is threading a database handle through some sixty call sites that have no other reason
// to hold one. The tap is handed the event AFTER it was scrubbed and emitted, so it can only ever
// see what the log line already says, and it must not throw or log: a tap that logged its own
// failure as `operation.failed` would be handed that event too.
import type { TelemetryEvent } from "./event.ts";

export type FailedOperationTap = (event: TelemetryEvent) => void;

let installed: FailedOperationTap | null = null;

/** Install (or, with null, remove) the tap the Workers logger hands each `operation.failed` to. */
export function setFailedOperationTap(tap: FailedOperationTap | null): void {
  installed = tap;
}

/** The installed tap, or null. */
export function failedOperationTap(): FailedOperationTap | null {
  return installed;
}

/** The event name a tap is handed. */
export const FAILED_OPERATION_EVENT = "operation.failed";
